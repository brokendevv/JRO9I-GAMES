import fs from 'node:fs';
import path from 'node:path';
import type { GameCatalogItem, GameFile } from '../src/lib/types.ts';
import { scanContentForSecrets, validateGameBundle } from '../src/lib/validator.ts';

function readDirectoryRecursive(dirPath: string, baseDir = dirPath): GameFile[] {
  const results: GameFile[] = [];
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push(...readDirectoryRecursive(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp3', '.wav', '.ogg', '.woff', '.woff2'].includes(ext);
      const buf = fs.readFileSync(fullPath);
      results.push({
        path: relPath,
        content: isBinary ? buf.toString('base64') : buf.toString('utf-8'),
        encoding: isBinary ? 'base64' : 'utf-8',
        sizeBytes: buf.length,
      });
    }
  }
  return results;
}

function main() {
  const rootDir = process.cwd();
  const catalogPath = path.join(rootDir, 'public', 'data', 'games.json');

  if (!fs.existsSync(catalogPath)) {
    console.error(`[FAIL] Missing catalog manifest at ${catalogPath}`);
    process.exit(1);
  }

  const rawCatalog = fs.readFileSync(catalogPath, 'utf-8');
  const secretIssues = scanContentForSecrets(rawCatalog, 'public/data/games.json');
  if (secretIssues.length > 0) {
    console.error(`[FAIL] Secret detected in games.json:`, secretIssues);
    process.exit(1);
  }

  const catalog = JSON.parse(rawCatalog) as GameCatalogItem[];
  const seenSlugs = new Set<string>();
  let hasErrors = false;

  console.log(`[JRO9I Validator] Checking ${catalog.length} catalog entries...`);

  for (const item of catalog) {
    if (seenSlugs.has(item.slug)) {
      console.error(`[FAIL] Duplicate slug in catalog: ${item.slug}`);
      hasErrors = true;
    }
    seenSlugs.add(item.slug);

    const gameDir = path.join(rootDir, 'public', 'games', item.slug);
    if (!fs.existsSync(gameDir)) {
      console.error(`[FAIL] Missing game directory for "${item.slug}" at ${gameDir}`);
      hasErrors = true;
      continue;
    }

    const thumbPath = path.join(rootDir, 'public', item.thumbnail);
    if (!fs.existsSync(thumbPath)) {
      console.error(`[FAIL] Missing thumbnail for "${item.slug}" at ${thumbPath}`);
      hasErrors = true;
    }

    const files = readDirectoryRecursive(gameDir);
    const report = validateGameBundle(files, item);
    if (!report.valid) {
      console.error(`[FAIL] Validation failed for "${item.slug}":`, report.issues);
      hasErrors = true;
    } else {
      console.log(
        `  [OK] ${item.slug} (${files.length} files, ${report.totalBytes} bytes, status=${item.status})`
      );
    }
  }

  if (hasErrors) {
    console.error('[JRO9I Validator] Validation failed with errors.');
    process.exit(1);
  }

  console.log('[JRO9I Validator] All games, paths, thumbnails, and security checks passed.');
}

main();
