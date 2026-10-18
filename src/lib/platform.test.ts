import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLocalHtmlAssetRefs,
  isValidSlug,
  normalizeRelativePath,
  scanContentForSecrets,
  validateGameBundle,
  validateMetadata,
} from './validator.ts';
import { createZipArchive, extractAndValidateZip } from './zipEngine.ts';
import {
  getPublicCatalog,
  getRelatedGames,
  resolvePagesUrl,
  transitionGameStatus,
  upsertCatalogEntry,
} from './catalogManager.ts';
import { buildGitHubCommitPlan } from './githubPublisher.ts';
import { buildPlayableStarterBundle } from './sampleTemplates.ts';
import type { GameCatalogItem, GitHubConfig } from './types.ts';

test('1. Sample game generation and bundle validation passes cleanly', () => {
  const sample = buildPlayableStarterBundle({
    title: 'Quantum Striker',
    slug: 'quantum-striker',
    category: 'Action',
  });

  const report = validateGameBundle(sample.files, sample.metadata);
  assert.equal(report.valid, true);
  assert.equal(report.entryPointFound, true);
  assert.equal(report.securityPassed, true);
  assert.equal(report.subpathCompatible, true);
  assert.equal(report.missingAssets.length, 0);
});

test('2. Path traversal, absolute paths, and missing internal assets are blocked', () => {
  assert.equal(normalizeRelativePath('../secret.txt').safe, false);
  assert.equal(normalizeRelativePath('assets/../../etc/passwd').safe, false);
  assert.equal(normalizeRelativePath('/etc/passwd').safe, false);
  assert.equal(normalizeRelativePath('assets/sprite.svg').safe, true);

  const badBundle = validateGameBundle([
    {
      path: 'index.html',
      content: '<html><body><script src="/absolute-broken.js"></script><img src="missing.png" /></body></html>',
    },
    {
      path: '../escape.js',
      content: 'console.log(1)',
    },
  ]);

  assert.equal(badBundle.valid, false);
  assert.equal(badBundle.securityPassed, false);
  assert.equal(badBundle.subpathCompatible, false);
  assert.ok(badBundle.missingAssets.includes('missing.png'));
});

test('3. Secret files and credential tokens are strictly blocked from game bundles', () => {
  const fakePat = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const secretIssues = scanContentForSecrets(`const token = "${fakePat}";`, 'game.js');
  assert.equal(secretIssues.length, 1);
  assert.equal(secretIssues[0].code, 'SECRET_DETECTED');

  const envBundle = validateGameBundle([
    { path: 'index.html', content: '<!doctype html><html><body></body></html>' },
    { path: '.env.production', content: 'SECRET=123' },
  ]);
  assert.equal(envBundle.valid, false);
  assert.equal(envBundle.securityPassed, false);
});

test('4. ZIP archive creation, extraction, and traversal protection work deterministically', () => {
  const sample = buildPlayableStarterBundle({
    title: 'Zip Test Game',
    slug: 'zip-test-game',
  });

  const zipBuf = createZipArchive(sample.files);
  const extracted = extractAndValidateZip(zipBuf);
  assert.equal(extracted.success, true);
  assert.equal(extracted.files.length, 3);

  // Test malicious ZIP with path traversal
  const maliciousZip = createZipArchive([
    { path: '../../outside.html', content: '<html></html>' },
  ]);
  const maliciousResult = extractAndValidateZip(maliciousZip);
  assert.equal(maliciousResult.success, false);
  assert.ok(maliciousResult.errors.some((e) => e.includes('Blocked unsafe ZIP path')));
});

test('5. Catalog updates, duplicate slug prevention, and failed deployment gating', () => {
  const sampleOne = buildPlayableStarterBundle({
    title: 'Game One',
    slug: 'game-one',
    category: 'Action',
  }).metadata;

  // Cannot mark published if deploymentVerified is false
  assert.throws(() => {
    upsertCatalogEntry([], { ...sampleOne, status: 'published' }, { deploymentVerified: false });
  }, /Cannot mark game as "published" before GitHub Pages deployment has succeeded/);

  // Can insert as deploying or draft, and mark published once verified
  const { updatedCatalog: cat1 } = upsertCatalogEntry(
    [],
    { ...sampleOne, status: 'published' },
    { deploymentVerified: true }
  );
  assert.equal(cat1.length, 1);
  assert.equal(cat1[0].status, 'published');

  // Duplicate slug is rejected when allowOverwriteSlug is false
  assert.throws(() => {
    upsertCatalogEntry(
      cat1,
      { ...sampleOne, status: 'draft' },
      { allowOverwriteSlug: false }
    );
  }, /Duplicate game slug/);

  // Failed deployments are never included in the public catalog
  const sampleTwo = buildPlayableStarterBundle({
    title: 'Broken Deploy Game',
    slug: 'broken-deploy',
    category: 'Puzzle',
  }).metadata;
  const { updatedCatalog: cat2 } = upsertCatalogEntry(cat1, {
    ...sampleTwo,
    status: 'failed',
  });

  const publicGames = getPublicCatalog(cat2);
  assert.equal(publicGames.length, 1);
  assert.equal(publicGames[0].slug, 'game-one');

  // Transition to published requires deploymentVerified: true
  assert.throws(() => {
    transitionGameStatus(cat2, 'broken-deploy', 'published', { deploymentVerified: false });
  });
});

test('6. GitHub Pages subpath URL resolution works for root and /repository-name/ subpaths', () => {
  assert.equal(
    resolvePagesUrl('/jro9i-games/', 'games/game-one/index.html'),
    '/jro9i-games/games/game-one/index.html'
  );
  assert.equal(
    resolvePagesUrl('/jro9i-games', '/assets/thumbnails/game-one.svg'),
    '/jro9i-games/assets/thumbnails/game-one.svg'
  );
  assert.equal(
    resolvePagesUrl('./', 'games/game-one/index.html'),
    './games/game-one/index.html'
  );
});

test('7. GitHub CommitPlan produces deterministic file tree changes and blocks secrets', () => {
  const sample = buildPlayableStarterBundle({
    title: 'Nebula Runner',
    slug: 'nebula-runner',
    category: 'Arcade',
  });

  const config: GitHubConfig = {
    owner: 'jro9i',
    repo: 'jro9i-games',
    branch: 'main',
    pagesBasePath: '/jro9i-games/',
    allowRemoteCommit: false,
    deploymentPath: '/',
  };

  const plan = buildGitHubCommitPlan({
    game: sample.metadata,
    gameFiles: sample.files,
    thumbnailFile: {
      path: sample.metadata.thumbnail,
      content: sample.thumbnailSvg,
      encoding: 'utf-8',
    },
    existingCatalog: [],
    config,
    dryRun: true,
  });

  assert.equal(plan.securityScanPassed, true);
  assert.equal(plan.targetRepo, 'jro9i/jro9i-games');
  assert.ok(plan.files.some((f) => f.repoPath === 'public/games/nebula-runner/index.html'));
  assert.ok(plan.files.some((f) => f.repoPath === 'public/assets/thumbnails/nebula-runner.svg'));
  assert.ok(plan.files.some((f) => f.repoPath === 'public/data/games.json'));

  const related = getRelatedGames(
    [
      { ...sample.metadata, status: 'published' },
      {
        ...buildPlayableStarterBundle({
          title: 'Second Arcade',
          slug: 'second-arcade',
          category: 'Arcade',
        }).metadata,
        status: 'published',
      },
    ],
    'nebula-runner'
  );
  assert.equal(related.length, 1);
  assert.equal(related[0].slug, 'second-arcade');
});
