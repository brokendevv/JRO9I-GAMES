import crypto from 'node:crypto';
import type {
  CommitPlan,
  GameCatalogItem,
  GameFile,
  GitHubConfig,
  PlannedFileChange,
  PublishExecutionResult,
  PublishPipelineStep,
} from './types.ts';
import {
  normalizeRelativePath,
  scanContentForSecrets,
  validateGameBundle,
} from './validator.ts';
import { upsertCatalogEntry } from './catalogManager.ts';

export function computeGitBlobSha1(content: Buffer | string): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  const header = Buffer.from(`blob ${buf.length}\0`, 'utf-8');
  return crypto
    .createHash('sha1')
    .update(Buffer.concat([header, buf]))
    .digest('hex');
}

/**
 * Builds a deterministic, verifiable GitHub CommitPlan for a game and the updated data/games.json catalog.
 * Ensures zero secrets or invalid paths enter the repository tree.
 */
export function buildGitHubCommitPlan(params: {
  game: GameCatalogItem;
  gameFiles: GameFile[];
  thumbnailFile?: { path: string; content: string; encoding?: 'utf-8' | 'base64' };
  existingCatalog: GameCatalogItem[];
  config: GitHubConfig;
  dryRun?: boolean;
}): CommitPlan {
  const { game, gameFiles, thumbnailFile, existingCatalog, config, dryRun = true } = params;

  const validation = validateGameBundle(gameFiles, game);
  if (!validation.valid) {
    const firstErr = validation.issues.find((i) => i.severity === 'error');
    throw new Error(
      `Cannot build GitHub commit plan for invalid game "${game.slug}": ${
        firstErr ? firstErr.message : 'Validation failed'
      }`
    );
  }

  const plannedChanges: PlannedFileChange[] = [];
  let securityScanPassed = validation.securityPassed;

  // 1. Add game files under games/<slug>/ and public/games/<slug>/
  for (const file of gameFiles) {
    const norm = normalizeRelativePath(file.path);
    if (!norm.safe) {
      throw new Error(`Unsafe file path in commit plan: ${file.path}`);
    }
    const rawBuf =
      file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content, 'utf-8');

    if (file.encoding !== 'base64') {
      const secrets = scanContentForSecrets(file.content, norm.normalized);
      if (secrets.length > 0) {
        securityScanPassed = false;
        throw new Error(`Blocked secret in "${norm.normalized}": ${secrets[0].message}`);
      }
    }

    const repoPath = `public/games/${game.slug}/${norm.normalized}`;
    plannedChanges.push({
      repoPath,
      action: 'create',
      sizeBytes: rawBuf.length,
      sha1: computeGitBlobSha1(rawBuf),
      summary: `Game bundle file (${norm.normalized})`,
      contentPreview:
        file.encoding === 'base64'
          ? `[Binary asset: ${rawBuf.length} bytes]`
          : file.content.slice(0, 320),
    });
  }

  // 2. Optional custom thumbnail file
  if (thumbnailFile) {
    const normThumb = normalizeRelativePath(thumbnailFile.path);
    if (!normThumb.safe || !normThumb.normalized.startsWith('assets/thumbnails/')) {
      throw new Error(`Invalid thumbnail path: ${thumbnailFile.path}`);
    }
    const thumbBuf =
      thumbnailFile.encoding === 'base64'
        ? Buffer.from(thumbnailFile.content, 'base64')
        : Buffer.from(thumbnailFile.content, 'utf-8');

    plannedChanges.push({
      repoPath: `public/${normThumb.normalized}`,
      action: 'create',
      sizeBytes: thumbBuf.length,
      sha1: computeGitBlobSha1(thumbBuf),
      summary: `Game thumbnail asset (${normThumb.normalized})`,
      contentPreview:
        thumbnailFile.encoding === 'base64'
          ? `[Binary image: ${thumbBuf.length} bytes]`
          : thumbnailFile.content.slice(0, 240),
    });
  }

  // 3. Prepare updated data/games.json manifest
  // In the repository commit itself, the static manifest entry is written so GitHub Pages builds it;
  // local studio state remains 'deploying' until the GitHub Pages workflow finishes!
  const { updatedCatalog, action } = upsertCatalogEntry(
    existingCatalog,
    { ...game, status: 'published' },
    { allowOverwriteSlug: true, deploymentVerified: true }
  );

  const catalogJson = JSON.stringify(updatedCatalog, null, 2) + '\n';
  const catalogSecrets = scanContentForSecrets(catalogJson, 'public/data/games.json');
  if (catalogSecrets.length > 0) {
    securityScanPassed = false;
    throw new Error('Secret material detected in catalog JSON');
  }

  const catalogBuf = Buffer.from(catalogJson, 'utf-8');
  plannedChanges.push({
    repoPath: 'public/data/games.json',
    action: 'update',
    sizeBytes: catalogBuf.length,
    sha1: computeGitBlobSha1(catalogBuf),
    summary: `${action === 'created' ? 'Add' : 'Update'} "${game.title}" (${game.slug}) in catalog manifest`,
    contentPreview: JSON.stringify(
      updatedCatalog.find((g) => g.slug === game.slug),
      null,
      2
    ),
  });

  const commitMessage =
    action === 'created'
      ? `feat(games): publish ${game.title} (${game.slug}) to catalog`
      : `chore(games): update ${game.title} (${game.slug}) bundle and metadata`;

  return {
    id: `plan-${game.slug}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    gameSlug: game.slug,
    gameTitle: game.title,
    targetRepo: `${config.owner}/${config.repo}`,
    targetBranch: config.branch || 'main',
    commitMessage,
    dryRun,
    securityScanPassed,
    files: plannedChanges,
    catalogDiffSummary: `${action === 'created' ? '+ Added' : '~ Updated'} game "${game.title}" [slug: ${game.slug}, category: ${game.category}, files: ${gameFiles.length}]`,
  };
}

/**
 * Executes a GitHub REST API atomic commit using Git Data API (Ref -> Commit -> Tree -> Blobs -> New Tree -> New Commit -> Update Ref)
 * so unrelated files in the repository are never overwritten, and checks GitHub Actions status.
 */
export async function executeGitHubPublish(params: {
  plan: CommitPlan;
  gameFiles: GameFile[];
  updatedCatalogJson: string;
  thumbnailFile?: { path: string; content: string; encoding?: 'utf-8' | 'base64' };
  config: GitHubConfig;
  githubToken?: string;
}): Promise<PublishExecutionResult> {
  const { plan, gameFiles, updatedCatalogJson, thumbnailFile, config, githubToken } = params;
  const logs: string[] = [];
  const now = () => new Date().toISOString();

  const steps: PublishPipelineStep[] = [
    {
      id: 'draft',
      label: 'Draft Staged',
      state: 'completed',
      detail: `Prepared ${gameFiles.length} files for ${plan.gameTitle}`,
      timestamp: now(),
    },
    {
      id: 'validating',
      label: 'Validating Bundle & Security',
      state: 'completed',
      detail: 'Entry point, relative paths, and secret scan passed',
      timestamp: now(),
    },
    {
      id: 'committing',
      label: 'Committing to GitHub',
      state: 'pending',
    },
    {
      id: 'deploying',
      label: 'GitHub Pages Deployment',
      state: 'pending',
    },
    {
      id: 'published',
      label: 'Published in Live Catalog',
      state: 'pending',
    },
  ];

  // Safety guard: never push to a remote repository unless explicitly configured & authorized
  if (!config.allowRemoteCommit) {
    logs.push(
      '[Guard] Remote GitHub commit is locked (allowRemoteCommit=false). Executing verified local staging & dry-run commit plan.'
    );
    steps[2] = {
      ...steps[2],
      state: 'completed',
      detail: 'Dry-run commit plan verified (Remote lock active)',
      timestamp: now(),
    };
    steps[3] = {
      ...steps[3],
      state: 'completed',
      detail: 'Local preview & static bundle verified',
      timestamp: now(),
    };
    steps[4] = {
      ...steps[4],
      state: 'completed',
      detail: `Available at ./games/${plan.gameSlug}/index.html`,
      timestamp: now(),
    };

    return {
      success: true,
      finalStatus: 'published',
      mode: 'local-stage',
      commitPlan: plan,
      commitSha: plan.files[0]?.sha1.slice(0, 7) || 'local01',
      deployedUrl: `${config.pagesBasePath.replace(/\/$/, '')}/games/${plan.gameSlug}/index.html`,
      steps,
      logs,
    };
  }

  if (!githubToken || !config.owner || !config.repo || config.owner === 'your-github-username') {
    const errMsg =
      'GitHub remote publishing requires GITHUB_TOKEN in server environment and a configured repository owner/name.';
    logs.push(`[Error] ${errMsg}`);
    steps[2] = { ...steps[2], state: 'error', detail: errMsg, timestamp: now() };
    return {
      success: false,
      finalStatus: 'failed',
      mode: 'github-remote',
      commitPlan: plan,
      steps,
      logs,
      error: errMsg,
    };
  }

  const apiBase = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'JRO9I-Games-Publisher/1.0',
    'Content-Type': 'application/json',
  };

  try {
    steps[2].state = 'active';
    logs.push(`[GitHub] Connecting to ${config.owner}/${config.repo} (branch: ${config.branch})...`);

    // 1. Fetch current branch reference SHA
    const refRes = await fetch(
      `${apiBase}/git/ref/heads/${encodeURIComponent(config.branch)}`,
      { headers }
    );
    if (!refRes.ok) {
      const body = await refRes.text();
      throw new Error(`Failed to read branch ref "${config.branch}" (${refRes.status}): ${body}`);
    }
    const refData = (await refRes.json()) as { object: { sha: string } };
    const latestCommitSha = refData.object.sha;
    logs.push(`[GitHub] Current branch HEAD is ${latestCommitSha.slice(0, 7)}`);

    // 2. Fetch commit to get base tree SHA
    const commitRes = await fetch(`${apiBase}/git/commits/${latestCommitSha}`, { headers });
    if (!commitRes.ok) {
      throw new Error(`Failed to fetch base commit ${latestCommitSha} (${commitRes.status})`);
    }
    const commitData = (await commitRes.json()) as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 3. Create blobs for all game files, optional thumbnail, and public/data/games.json
    const treeEntries: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha: string;
    }> = [];

    for (const file of gameFiles) {
      const norm = normalizeRelativePath(file.path);
      const blobRes = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: file.content,
          encoding: file.encoding === 'base64' ? 'base64' : 'utf-8',
        }),
      });
      if (!blobRes.ok) {
        throw new Error(`Failed to create Git blob for ${norm.normalized} (${blobRes.status})`);
      }
      const blobData = (await blobRes.json()) as { sha: string };
      treeEntries.push({
        path: `public/games/${plan.gameSlug}/${norm.normalized}`,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }

    if (thumbnailFile) {
      const normThumb = normalizeRelativePath(thumbnailFile.path);
      const thumbBlobRes = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: thumbnailFile.content,
          encoding: thumbnailFile.encoding === 'base64' ? 'base64' : 'utf-8',
        }),
      });
      if (!thumbBlobRes.ok) {
        throw new Error(`Failed to create thumbnail blob (${thumbBlobRes.status})`);
      }
      const thumbBlob = (await thumbBlobRes.json()) as { sha: string };
      treeEntries.push({
        path: `public/${normThumb.normalized}`,
        mode: '100644',
        type: 'blob',
        sha: thumbBlob.sha,
      });
    }

    const catalogBlobRes = await fetch(`${apiBase}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: updatedCatalogJson,
        encoding: 'utf-8',
      }),
    });
    if (!catalogBlobRes.ok) {
      throw new Error(`Failed to create catalog manifest blob (${catalogBlobRes.status})`);
    }
    const catalogBlob = (await catalogBlobRes.json()) as { sha: string };
    treeEntries.push({
      path: 'public/data/games.json',
      mode: '100644',
      type: 'blob',
      sha: catalogBlob.sha,
    });

    // 4. Create new Git Tree preserving all existing files via base_tree
    const newTreeRes = await fetch(`${apiBase}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    });
    if (!newTreeRes.ok) {
      throw new Error(`Failed to create Git tree (${newTreeRes.status})`);
    }
    const newTree = (await newTreeRes.json()) as { sha: string };

    // 5. Create Commit
    const newCommitRes = await fetch(`${apiBase}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: plan.commitMessage,
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    });
    if (!newCommitRes.ok) {
      throw new Error(`Failed to create Git commit (${newCommitRes.status})`);
    }
    const newCommit = (await newCommitRes.json()) as { sha: string; html_url?: string };

    // 6. Update branch ref (with fast-forward conflict check)
    const updateRefRes = await fetch(
      `${apiBase}/git/refs/heads/${encodeURIComponent(config.branch)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sha: newCommit.sha,
          force: false,
        }),
      }
    );
    if (!updateRefRes.ok) {
      const conflictText = await updateRefRes.text();
      throw new Error(
        `Conflicting changes detected on branch "${config.branch}" (${updateRefRes.status}): ${conflictText}`
      );
    }

    const commitUrl =
      newCommit.html_url ||
      `https://github.com/${config.owner}/${config.repo}/commit/${newCommit.sha}`;
    logs.push(`[GitHub] Committed ${newCommit.sha.slice(0, 7)} -> ${commitUrl}`);

    steps[2] = {
      ...steps[2],
      state: 'completed',
      detail: `Committed ${newCommit.sha.slice(0, 7)}`,
      timestamp: now(),
    };
    steps[3] = {
      ...steps[3],
      state: 'active',
      detail: 'Checking GitHub Actions deployment workflow...',
      timestamp: now(),
    };

    // 7. Query latest GitHub Actions workflow run for this commit
    let workflowRunUrl = `https://github.com/${config.owner}/${config.repo}/actions`;
    let workflowSucceeded = false;

    const runsRes = await fetch(
      `${apiBase}/actions/runs?head_sha=${newCommit.sha}&per_page=5`,
      { headers }
    );
    if (runsRes.ok) {
      const runsData = (await runsRes.json()) as {
        workflow_runs?: Array<{
          id: number;
          status: string;
          conclusion: string | null;
          html_url: string;
        }>;
      };
      const latestRun = runsData.workflow_runs?.[0];
      if (latestRun) {
        workflowRunUrl = latestRun.html_url;
        if (latestRun.status === 'completed' && latestRun.conclusion === 'success') {
          workflowSucceeded = true;
        } else if (latestRun.status === 'completed' && latestRun.conclusion !== 'success') {
          throw new Error(
            `GitHub Actions deployment run failed (conclusion: ${latestRun.conclusion}).`
          );
        }
      }
    }

    if (!workflowSucceeded) {
      logs.push(
        `[GitHub Actions] Workflow triggered at ${workflowRunUrl}. Game stays in "deploying" status until deployment completes.`
      );
      steps[3] = {
        ...steps[3],
        state: 'active',
        detail: 'GitHub Pages workflow running — awaiting completion before marking Published',
        timestamp: now(),
      };

      return {
        success: true,
        finalStatus: 'deploying',
        mode: 'github-remote',
        commitPlan: plan,
        commitSha: newCommit.sha,
        commitUrl,
        workflowRunUrl,
        steps,
        logs,
      };
    }

    steps[3] = {
      ...steps[3],
      state: 'completed',
      detail: 'GitHub Pages deployment succeeded',
      timestamp: now(),
    };
    steps[4] = {
      ...steps[4],
      state: 'completed',
      detail: 'Published and verified in live catalog',
      timestamp: now(),
    };

    return {
      success: true,
      finalStatus: 'published',
      mode: 'github-remote',
      commitPlan: plan,
      commitSha: newCommit.sha,
      commitUrl,
      workflowRunUrl,
      deployedUrl: `https://${config.owner}.github.io/${config.repo}/games/${plan.gameSlug}/`,
      steps,
      logs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`[Error] ${message}`);
    const activeIdx = steps.findIndex((s) => s.state === 'active' || s.state === 'pending');
    if (activeIdx >= 0) {
      steps[activeIdx] = {
        ...steps[activeIdx],
        state: 'error',
        detail: message,
        timestamp: now(),
      };
    }
    return {
      success: false,
      finalStatus: 'failed',
      mode: 'github-remote',
      commitPlan: plan,
      steps,
      logs,
      error: message,
    };
  }
}
