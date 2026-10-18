import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  GameCatalogItem,
  GameCategory,
  GameEngineType,
  GameFile,
  GitHubConfig,
  PublishExecutionResult,
  PublishStatus,
} from './src/lib/types.ts';
import {
  isValidSlug,
  normalizeRelativePath,
  sanitizeSlug,
  validateGameBundle,
} from './src/lib/validator.ts';
import { createZipArchive, extractAndValidateZip } from './src/lib/zipEngine.ts';
import {
  buildPlayableStarterBundle,
  generateGameThumbnailSvg,
} from './src/lib/sampleTemplates.ts';
import {
  buildGitHubCommitPlan,
  executeGitHubPublish,
} from './src/lib/githubPublisher.ts';

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CATALOG_PATH = path.join(PUBLIC_DIR, 'data', 'games.json');
const GAMES_DIR = path.join(PUBLIC_DIR, 'games');
const THUMBS_DIR = path.join(PUBLIC_DIR, 'assets', 'thumbnails');

// Ensure directories exist
fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
fs.mkdirSync(GAMES_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

// Server-side runtime state for Local Admin Publishing Studio (Option B)
let githubConfig: GitHubConfig = {
  owner: process.env.GITHUB_OWNER || 'jro9i',
  repo: process.env.GITHUB_REPO || 'jro9i-games',
  branch: process.env.GITHUB_BRANCH || 'main',
  pagesBasePath: process.env.GITHUB_PAGES_BASE_PATH || '/jro9i-games/',
  allowRemoteCommit: process.env.ALLOW_REMOTE_GITHUB_COMMIT === 'true',
  deploymentPath: '/',
};

// Track studio drafts & deployment history (including drafts not yet published to public catalog)
const draftCatalogMap = new Map<string, GameCatalogItem>();
const deploymentHistory: PublishExecutionResult[] = [];

function readCatalogFromDisk(): GameCatalogItem[] {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return [];
    const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
    return JSON.parse(raw) as GameCatalogItem[];
  } catch (err) {
    console.error('Failed to read catalog:', err);
    return [];
  }
}

function writeCatalogToDisk(items: GameCatalogItem[]): void {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(items, null, 2) + '\n', 'utf-8');
}

function getMergedAdminCatalog(): GameCatalogItem[] {
  const diskItems = readCatalogFromDisk();
  const merged = new Map<string, GameCatalogItem>();
  for (const item of diskItems) {
    merged.set(item.slug, item);
  }
  for (const [slug, draft] of draftCatalogMap.entries()) {
    merged.set(slug, draft);
  }
  return Array.from(merged.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

function readGameFilesFromDisk(slug: string): GameFile[] {
  if (!isValidSlug(slug)) return [];
  const gameDir = path.join(GAMES_DIR, slug);
  if (!fs.existsSync(gameDir)) return [];

  const results: GameFile[] = [];
  function walk(currentDir: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(gameDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isBinary = [
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.gif',
          '.ico',
          '.mp3',
          '.wav',
          '.ogg',
          '.woff',
          '.woff2',
        ].includes(ext);
        const buf = fs.readFileSync(fullPath);
        results.push({
          path: relPath,
          content: isBinary ? buf.toString('base64') : buf.toString('utf-8'),
          encoding: isBinary ? 'base64' : 'utf-8',
          sizeBytes: buf.length,
        });
      }
    }
  }
  walk(gameDir);
  return results;
}

function writeGameFilesToDisk(slug: string, files: GameFile[]): void {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid game slug: ${slug}`);
  }
  const gameDir = path.join(GAMES_DIR, slug);
  fs.mkdirSync(gameDir, { recursive: true });

  for (const file of files) {
    const norm = normalizeRelativePath(file.path);
    if (!norm.safe) {
      throw new Error(`Unsafe file path blocked: ${file.path}`);
    }
    const targetPath = path.join(gameDir, norm.normalized);
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(gameDir);
    if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Path traversal blocked: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
    const buf =
      file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content, 'utf-8');
    fs.writeFileSync(resolvedTarget, buf);
  }
}

function hasValidGeminiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 10 && key !== 'MY_GEMINI_API_KEY' && key !== 'YOUR_GEMINI_API_KEY_HERE');
}

function hasValidGithubToken(): boolean {
  const token = process.env.GITHUB_TOKEN;
  return Boolean(token && token.trim().length > 10 && token !== 'YOUR_FINE_GRAINED_GITHUB_PAT_HERE');
}

async function generateGameWithGemini(params: {
  prompt: string;
  title?: string;
  category?: GameCategory;
  engine?: GameEngineType;
  existingFiles?: GameFile[];
  revisionPrompt?: string;
}): Promise<{
  title: string;
  slug: string;
  description: string;
  instructions: string;
  controls: string[];
  category: GameCategory;
  tags: string[];
  files: GameFile[];
  changeSummary: string;
  providerUsed: string;
}> {
  if (!hasValidGeminiKey()) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the local studio server. Add GEMINI_API_KEY to your .env file or use the Starter Blueprint generator.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const isRevision = Boolean(params.existingFiles && params.existingFiles.length > 0 && params.revisionPrompt);

  const systemInstruction = `You are a Principal HTML5 Browser Game Engineer for JRO9I Games.
Generate a complete, self-contained, polished, and immediately playable browser game that runs inside a sandboxed static iframe on GitHub Pages.

CRITICAL REQUIREMENTS:
1. Entry point MUST be "index.html". Any additional scripts ("game.js") or styles ("style.css") must be referenced via relative paths (e.g. <script src="game.js"></script>, <link rel="stylesheet" href="style.css" />) — NEVER use root-absolute paths starting with "/".
2. Include a Title Screen overlay (<body data-state="title">) with a primary button carrying data-start="true", support "?autostart=1" query parameter to jump straight into playing, and bind Enter/Space to start and P/Escape to pause.
3. Implement a real 60fps game loop (clamped dt <= 0.05s), responsive keyboard/mouse controls, visible HUD (Score, Wave/Level, HP/Status with tabular-nums), Web Audio API synthesized sound effects, and a Game Over / Play Again state.
4. Detect headless browsers via (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent)) and throttle the loop with setTimeout(..., 60) when headless so screenshots never stall.
5. Never include external API keys, secrets, or broken external image URLs.`;

  const userContents = isRevision
    ? `Revise the existing browser game according to these instructions: "${params.revisionPrompt}"\n\nExisting files:\n${JSON.stringify(
        params.existingFiles,
        null,
        2
      )}`
    : `Create a new playable ${params.engine || 'html5-canvas'} browser game.\nUser Request: "${params.prompt}"\nPreferred Title: "${params.title || ''}"\nPreferred Category: "${params.category || 'Action'}"`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: userContents,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: 'Game title (2-60 chars)' },
          slug: { type: Type.STRING, description: 'Lowercase hyphenated slug' },
          description: { type: Type.STRING, description: 'Concise exciting game description' },
          instructions: { type: Type.STRING, description: 'How to play and win' },
          controls: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'List of control bindings, e.g. WASD: Move',
          },
          category: {
            type: Type.STRING,
            description: 'One of: Action, Arcade, Puzzle, 3D, Strategy, Sports',
          },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          changeSummary: {
            type: Type.STRING,
            description: 'Summary of generated or revised files and game mechanics',
          },
          files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING, description: 'Relative path e.g. index.html, game.js, style.css' },
                content: { type: Type.STRING, description: 'Complete UTF-8 source code of the file' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: [
          'title',
          'slug',
          'description',
          'instructions',
          'controls',
          'category',
          'tags',
          'changeSummary',
          'files',
        ],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  const parsed = JSON.parse(text);
  const validCategories: GameCategory[] = ['Action', 'Arcade', 'Puzzle', '3D', 'Strategy', 'Sports'];
  const cat: GameCategory = validCategories.includes(parsed.category)
    ? parsed.category
    : params.category || 'Action';
  const slug = sanitizeSlug(params.title || parsed.slug || parsed.title || 'ai-game');

  return {
    title: parsed.title || params.title || 'AI Generated Game',
    slug,
    description: parsed.description || 'AI-generated HTML5 browser game.',
    instructions: parsed.instructions || 'Use keyboard or mouse controls to play.',
    controls: Array.isArray(parsed.controls) && parsed.controls.length > 0
      ? parsed.controls
      : ['WASD / Arrows: Move', 'Space: Action', 'P: Pause'],
    category: cat,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [cat.toLowerCase(), 'html5'],
    files: (parsed.files || []).map((f: { path: string; content: string }) => ({
      path: f.path,
      content: f.content,
      encoding: 'utf-8' as const,
    })),
    changeSummary: parsed.changeSummary || 'Generated playable HTML5 game bundle via Gemini AI.',
    providerUsed: 'gemini-3.8-flash',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  // 1. Bootstrap endpoint for Admin Studio & Public Catalog
  app.get('/api/admin/bootstrap', (_req, res) => {
    res.json({
      localStudioAvailable: true,
      architectureMode: 'Option B — Local Admin Publishing Studio + Static GitHub Pages Portal',
      providers: {
        geminiConfigured: hasValidGeminiKey(),
        geminiModel: 'gemini-3.8-flash',
        localLlmConfigured: Boolean(process.env.LOCAL_LLM_BASE_URL),
        localLlmModel: process.env.LOCAL_LLM_MODEL || null,
        githubTokenConfigured: hasValidGithubToken(),
      },
      githubConfig,
      catalog: getMergedAdminCatalog(),
      deploymentHistory: deploymentHistory.slice(0, 15),
    });
  });

  // 2. Update GitHub Repository & Pages Settings
  app.post('/api/admin/config', (req, res) => {
    const body = req.body || {};
    githubConfig = {
      owner: String(body.owner ?? githubConfig.owner).trim() || 'jro9i',
      repo: String(body.repo ?? githubConfig.repo).trim() || 'jro9i-games',
      branch: String(body.branch ?? githubConfig.branch).trim() || 'main',
      pagesBasePath: String(body.pagesBasePath ?? githubConfig.pagesBasePath).trim() || '/jro9i-games/',
      allowRemoteCommit: Boolean(body.allowRemoteCommit),
      deploymentPath: String(body.deploymentPath ?? githubConfig.deploymentPath).trim() || '/',
    };
    res.json({ ok: true, githubConfig });
  });

  // 3. Read files of a specific game
  app.get('/api/admin/games/:slug/files', (req, res) => {
    const slug = sanitizeSlug(req.params.slug);
    const files = readGameFilesFromDisk(slug);
    const meta = getMergedAdminCatalog().find((g) => g.slug === slug);
    const validation = validateGameBundle(files, meta);
    res.json({ slug, files, validation });
  });

  // 4. AI Game Studio Generation & Revision
  app.post('/api/admin/ai/generate', async (req, res) => {
    try {
      const { prompt, title, category, engine, existingSlug, revisionPrompt } = req.body || {};
      if (!prompt && !revisionPrompt) {
        res.status(400).json({ error: 'Prompt or revision instruction is required.' });
        return;
      }

      const existingFiles = existingSlug ? readGameFilesFromDisk(sanitizeSlug(existingSlug)) : undefined;
      const aiResult = await generateGameWithGemini({
        prompt: prompt || '',
        title,
        category,
        engine,
        existingFiles,
        revisionPrompt,
      });

      const slug = existingSlug ? sanitizeSlug(existingSlug) : aiResult.slug;
      const now = new Date().toISOString();
      const metadata: GameCatalogItem = {
        id: slug,
        slug,
        title: aiResult.title,
        description: aiResult.description,
        instructions: aiResult.instructions,
        controls: aiResult.controls,
        category: aiResult.category,
        tags: aiResult.tags,
        thumbnail: `assets/thumbnails/${slug}.svg`,
        path: `games/${slug}/`,
        status: 'draft',
        engine: engine || 'html5-canvas',
        createdAt: now,
        updatedAt: now,
        aiGenerated: true,
        aiProvider: aiResult.providerUsed,
      };

      const validation = validateGameBundle(aiResult.files, metadata);
      if (validation.securityPassed) {
        writeGameFilesToDisk(slug, aiResult.files);
        const thumbSvg = generateGameThumbnailSvg({
          title: metadata.title,
          category: metadata.category,
        });
        fs.writeFileSync(path.join(THUMBS_DIR, `${slug}.svg`), thumbSvg, 'utf-8');
        draftCatalogMap.set(slug, metadata);
      }

      res.json({
        ok: true,
        metadata,
        files: aiResult.files,
        validation,
        changeSummary: aiResult.changeSummary,
        aiProviderUsed: aiResult.providerUsed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // 5. Deterministic Starter Blueprint Generator (Explicitly non-AI fallback / instant template)
  app.post('/api/admin/games/starter', (req, res) => {
    try {
      const { title, slug, category, engine, description } = req.body || {};
      const bundle = buildPlayableStarterBundle({
        title: title || 'Starlight Defender',
        slug: slug || title || 'starlight-defender',
        category: category || 'Arcade',
        engine: engine || 'html5-canvas',
        description,
      });

      const validation = validateGameBundle(bundle.files, bundle.metadata);
      writeGameFilesToDisk(bundle.metadata.slug, bundle.files);
      fs.writeFileSync(
        path.join(THUMBS_DIR, `${bundle.metadata.slug}.svg`),
        bundle.thumbnailSvg,
        'utf-8'
      );
      draftCatalogMap.set(bundle.metadata.slug, bundle.metadata);

      res.json({
        ok: true,
        metadata: bundle.metadata,
        files: bundle.files,
        validation,
        changeSummary: `Created playable starter bundle "${bundle.metadata.title}" (Template Blueprint — No AI provider invoked).`,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 6. Upload & Validate ZIP Game Archive
  app.post('/api/admin/games/upload-zip', (req, res) => {
    try {
      const { zipBase64, title, slug: rawSlug, category = 'Arcade', description } = req.body || {};
      if (!zipBase64) {
        res.status(400).json({ error: 'Missing zipBase64 payload.' });
        return;
      }

      const zipBuf = Buffer.from(zipBase64, 'base64');
      const extraction = extractAndValidateZip(zipBuf);
      if (!extraction.success) {
        res.status(400).json({
          ok: false,
          error: extraction.errors.join(' | '),
          extraction,
        });
        return;
      }

      const slug = sanitizeSlug(rawSlug || title || `uploaded-game-${Date.now()}`);
      const now = new Date().toISOString();
      const metadata: GameCatalogItem = {
        id: slug,
        slug,
        title: title || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description:
          description ||
          'Imported HTML5 browser game bundle validated for static GitHub Pages hosting.',
        instructions: 'Use keyboard or mouse controls inside the game viewport.',
        controls: ['Mouse / Keyboard: Standard Controls'],
        category,
        tags: [String(category).toLowerCase(), 'imported', 'html5'],
        thumbnail: `assets/thumbnails/${slug}.svg`,
        path: `games/${slug}/`,
        status: 'draft',
        engine: 'html5-canvas',
        createdAt: now,
        updatedAt: now,
        aiGenerated: false,
      };

      const validation = validateGameBundle(extraction.files, metadata);
      if (!validation.valid) {
        res.status(400).json({
          ok: false,
          error: validation.issues.map((i) => i.message).join(' | '),
          validation,
        });
        return;
      }

      writeGameFilesToDisk(slug, extraction.files);
      const thumbSvg = generateGameThumbnailSvg({
        title: metadata.title,
        category: metadata.category,
      });
      fs.writeFileSync(path.join(THUMBS_DIR, `${slug}.svg`), thumbSvg, 'utf-8');
      draftCatalogMap.set(slug, metadata);

      res.json({
        ok: true,
        metadata,
        files: extraction.files,
        validation,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 7. Export any game as a downloadable ZIP archive
  app.get('/api/admin/games/:slug/export-zip', (req, res) => {
    const slug = sanitizeSlug(req.params.slug);
    const files = readGameFilesFromDisk(slug);
    if (files.length === 0) {
      res.status(404).json({ error: `No files found for game "${slug}".` });
      return;
    }
    const zipBuf = createZipArchive(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);
    res.send(zipBuf);
  });

  // 8. Stage / Save Game Metadata & Files Locally
  app.post('/api/admin/games/:slug/stage', (req, res) => {
    try {
      const targetSlug = sanitizeSlug(req.params.slug);
      const { metadata, files, customThumbnailSvg } = req.body || {};

      const existing =
        getMergedAdminCatalog().find((g) => g.slug === targetSlug) ||
        buildPlayableStarterBundle({ title: targetSlug, slug: targetSlug }).metadata;

      const updatedMeta: GameCatalogItem = {
        ...existing,
        ...metadata,
        id: targetSlug,
        slug: targetSlug,
        path: `games/${targetSlug}/`,
        thumbnail: metadata?.thumbnail || existing.thumbnail || `assets/thumbnails/${targetSlug}.svg`,
        updatedAt: new Date().toISOString(),
      };

      const gameFiles: GameFile[] = Array.isArray(files)
        ? files
        : readGameFilesFromDisk(targetSlug);

      const validation = validateGameBundle(gameFiles, updatedMeta);
      if (!validation.securityPassed) {
        res.status(400).json({
          ok: false,
          error: 'Security validation failed.',
          validation,
        });
        return;
      }

      if (Array.isArray(files) && files.length > 0) {
        writeGameFilesToDisk(targetSlug, gameFiles);
      }

      if (customThumbnailSvg && typeof customThumbnailSvg === 'string') {
        fs.writeFileSync(path.join(THUMBS_DIR, `${targetSlug}.svg`), customThumbnailSvg, 'utf-8');
      } else if (!fs.existsSync(path.join(PUBLIC_DIR, updatedMeta.thumbnail))) {
        const svg = generateGameThumbnailSvg({
          title: updatedMeta.title,
          category: updatedMeta.category,
        });
        fs.writeFileSync(path.join(THUMBS_DIR, `${targetSlug}.svg`), svg, 'utf-8');
      }

      draftCatalogMap.set(targetSlug, updatedMeta);

      // If already in disk catalog, update its metadata on disk preserving status
      const diskCatalog = readCatalogFromDisk();
      const diskIdx = diskCatalog.findIndex((g) => g.slug === targetSlug);
      if (diskIdx >= 0) {
        diskCatalog[diskIdx] = updatedMeta;
        writeCatalogToDisk(diskCatalog);
      }

      res.json({
        ok: true,
        metadata: updatedMeta,
        validation,
        catalog: getMergedAdminCatalog(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 9. Update Game Status (Unpublish / Remove / Retry)
  app.post('/api/admin/games/:slug/action', (req, res) => {
    const slug = sanitizeSlug(req.params.slug);
    const { action } = req.body || {};
    const diskCatalog = readCatalogFromDisk();

    if (action === 'remove') {
      draftCatalogMap.delete(slug);
      const filtered = diskCatalog.filter((g) => g.slug !== slug);
      writeCatalogToDisk(filtered);
      res.json({ ok: true, catalog: getMergedAdminCatalog() });
      return;
    }

    if (action === 'unpublish') {
      const current = getMergedAdminCatalog().find((g) => g.slug === slug);
      if (!current) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }
      const updated: GameCatalogItem = {
        ...current,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      };
      draftCatalogMap.set(slug, updated);
      const nextDisk = diskCatalog.map((g) => (g.slug === slug ? updated : g));
      writeCatalogToDisk(nextDisk);
      res.json({ ok: true, metadata: updated, catalog: getMergedAdminCatalog() });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  });

  // 10. GitHub Commit Plan Dry-Run
  app.post('/api/admin/github/dry-run', (req, res) => {
    try {
      const { slug: rawSlug } = req.body || {};
      const slug = sanitizeSlug(rawSlug || '');
      const game = getMergedAdminCatalog().find((g) => g.slug === slug);
      if (!game) {
        res.status(404).json({ error: `Game "${slug}" not found.` });
        return;
      }

      const gameFiles = readGameFilesFromDisk(slug);
      const thumbPath = path.join(PUBLIC_DIR, game.thumbnail);
      const thumbnailFile = fs.existsSync(thumbPath)
        ? {
            path: game.thumbnail,
            content: fs.readFileSync(thumbPath, 'utf-8'),
            encoding: 'utf-8' as const,
          }
        : undefined;

      const plan = buildGitHubCommitPlan({
        game,
        gameFiles,
        thumbnailFile,
        existingCatalog: readCatalogFromDisk(),
        config: githubConfig,
        dryRun: true,
      });

      res.json({ ok: true, plan });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 11. Execute Full GitHub Publishing Workflow
  app.post('/api/admin/github/publish', async (req, res) => {
    try {
      const { slug: rawSlug, simulateFailure = false } = req.body || {};
      const slug = sanitizeSlug(rawSlug || '');
      const game = getMergedAdminCatalog().find((g) => g.slug === slug);
      if (!game) {
        res.status(404).json({ error: `Game "${slug}" not found.` });
        return;
      }

      const gameFiles = readGameFilesFromDisk(slug);
      const thumbPath = path.join(PUBLIC_DIR, game.thumbnail);
      const thumbnailFile = fs.existsSync(thumbPath)
        ? {
            path: game.thumbnail,
            content: fs.readFileSync(thumbPath, 'utf-8'),
            encoding: 'utf-8' as const,
          }
        : undefined;

      const existingDiskCatalog = readCatalogFromDisk();
      const plan = buildGitHubCommitPlan({
        game,
        gameFiles,
        thumbnailFile,
        existingCatalog: existingDiskCatalog,
        config: githubConfig,
        dryRun: !githubConfig.allowRemoteCommit,
      });

      if (simulateFailure) {
        const failedItem: GameCatalogItem = {
          ...game,
          status: 'failed',
          lastError: 'Simulated GitHub Actions deployment check failure — game was NOT marked Published.',
          updatedAt: new Date().toISOString(),
        };
        draftCatalogMap.set(slug, failedItem);
        const failResult: PublishExecutionResult = {
          success: false,
          finalStatus: 'failed',
          mode: 'local-stage',
          commitPlan: plan,
          steps: [
            { id: 'draft', label: 'Draft Staged', state: 'completed' },
            { id: 'validating', label: 'Validating Bundle & Security', state: 'completed' },
            { id: 'committing', label: 'Committing to GitHub', state: 'completed' },
            {
              id: 'deploying',
              label: 'GitHub Pages Deployment',
              state: 'error',
              detail: 'Deployment failed — game blocked from Published status',
            },
            { id: 'published', label: 'Published in Live Catalog', state: 'pending' },
          ],
          logs: [
            '[Validator] Game bundle and metadata verified.',
            '[GitHub] Commit staged.',
            '[Error] GitHub Pages deployment failed. Game remains in "failed" status and is excluded from the public catalog.',
          ],
          error: failedItem.lastError,
        };
        deploymentHistory.unshift(failResult);
        res.json({
          ok: false,
          result: failResult,
          metadata: failedItem,
          catalog: getMergedAdminCatalog(),
        });
        return;
      }

      const nextCatalogForCommit = [
        { ...game, status: 'published' as PublishStatus, updatedAt: new Date().toISOString() },
        ...existingDiskCatalog.filter((g) => g.slug !== slug),
      ];

      const execResult = await executeGitHubPublish({
        plan,
        gameFiles,
        updatedCatalogJson: JSON.stringify(nextCatalogForCommit, null, 2) + '\n',
        thumbnailFile,
        config: githubConfig,
        githubToken: process.env.GITHUB_TOKEN,
      });

      const finalMeta: GameCatalogItem = {
        ...game,
        status: execResult.finalStatus,
        lastCommitSha: execResult.commitSha ?? game.lastCommitSha,
        lastCommitUrl: execResult.commitUrl ?? game.lastCommitUrl,
        lastWorkflowRunUrl: execResult.workflowRunUrl ?? game.lastWorkflowRunUrl,
        lastError: execResult.error,
        updatedAt: new Date().toISOString(),
      };

      draftCatalogMap.set(slug, finalMeta);

      // Only write status: 'published' into public/data/games.json if finalStatus === 'published'
      if (execResult.finalStatus === 'published') {
        const updatedDisk = [
          finalMeta,
          ...existingDiskCatalog.filter((g) => g.slug !== slug),
        ];
        writeCatalogToDisk(updatedDisk);
      }

      deploymentHistory.unshift(execResult);

      res.json({
        ok: execResult.success,
        result: execResult,
        metadata: finalMeta,
        catalog: getMergedAdminCatalog(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // Mount Vite dev server or static production assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[JRO9I Games] Portal & Local Admin Studio running at http://localhost:${PORT}`);
  });
}

startServer();
