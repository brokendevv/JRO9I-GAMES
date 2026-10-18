import type { GameCatalogItem, GameFile, ValidationIssue, ValidationReport } from './types.ts';

export const ALLOWED_GAME_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.wav',
  '.mp3',
  '.ogg',
  '.glsl',
  '.vert',
  '.frag',
  '.txt',
  '.md',
  '.woff',
  '.woff2',
]);

export const MAX_GAME_BUNDLE_BYTES = 25 * 1024 * 1024; // 25 MB limit
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_FILE_COUNT = 250;

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SECRET_FILENAME_PATTERNS = [
  /(^|\/)\.env(\..+)?$/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)credentials\.json$/i,
];

const SECRET_CONTENT_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'GitHub Classic PAT', regex: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub Fine-Grained PAT', regex: /\bgithub_pat_[A-Za-z0-9_]{35,}\b/ },
  { name: 'GitHub App Token', regex: /\b(ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: 'Private Key Block', regex: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack Token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
];

export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isValidSlug(slug: string): boolean {
  return Boolean(slug && slug.length >= 2 && slug.length <= 64 && SLUG_REGEX.test(slug));
}

export function normalizeRelativePath(rawPath: string): {
  safe: boolean;
  normalized: string;
  reason?: string;
} {
  if (!rawPath || typeof rawPath !== 'string') {
    return { safe: false, normalized: '', reason: 'Path is empty or not a string' };
  }
  if (rawPath.includes('\0')) {
    return { safe: false, normalized: '', reason: 'Path contains null byte' };
  }
  const slashNormalized = rawPath.replace(/\\/g, '/').trim();
  if (slashNormalized.startsWith('/') || /^[A-Za-z]:/.test(slashNormalized)) {
    return {
      safe: false,
      normalized: slashNormalized,
      reason: 'Absolute paths are forbidden in game bundles',
    };
  }

  const segments = slashNormalized.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) {
    return { safe: false, normalized: '', reason: 'Path resolves to empty' };
  }

  for (const segment of segments) {
    if (segment === '..' || segment.includes('..')) {
      return {
        safe: false,
        normalized: slashNormalized,
        reason: `Path traversal segment "${segment}" is blocked`,
      };
    }
  }

  return { safe: true, normalized: segments.join('/') };
}

export function getFileExtension(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return filename.slice(dotIdx).toLowerCase();
}

export function scanContentForSecrets(
  content: string,
  filePath: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    if (pattern.regex.test(content)) {
      issues.push({
        severity: 'error',
        code: 'SECRET_DETECTED',
        message: `Blocked credential material detected (${pattern.name})`,
        file: filePath,
      });
    }
  }
  return issues;
}

export function validateMetadata(meta: Partial<GameCatalogItem>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!meta.slug || !isValidSlug(meta.slug)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_SLUG',
      message: `Game slug "${meta.slug ?? ''}" must be lowercase alphanumeric with hyphens (2-64 chars).`,
    });
  }

  if (!meta.id || meta.id !== meta.slug) {
    issues.push({
      severity: 'error',
      code: 'MISMATCHED_ID_SLUG',
      message: 'Game id must match its canonical slug.',
    });
  }

  if (!meta.title || meta.title.trim().length < 2 || meta.title.trim().length > 80) {
    issues.push({
      severity: 'error',
      code: 'INVALID_TITLE',
      message: 'Game title is required and must be between 2 and 80 characters.',
    });
  }

  if (!meta.description || meta.description.trim().length < 10) {
    issues.push({
      severity: 'error',
      code: 'INVALID_DESCRIPTION',
      message: 'Game description must be at least 10 characters.',
    });
  }

  if (meta.slug) {
    const expectedPath = `games/${meta.slug}/`;
    if (meta.path !== expectedPath) {
      issues.push({
        severity: 'error',
        code: 'INVALID_GAME_PATH',
        message: `Game path must be strictly "${expectedPath}" (got "${meta.path ?? ''}").`,
      });
    }
  }

  if (!meta.thumbnail) {
    issues.push({
      severity: 'error',
      code: 'MISSING_THUMBNAIL',
      message: 'Game thumbnail path is required.',
    });
  } else {
    const normThumb = normalizeRelativePath(meta.thumbnail);
    if (!normThumb.safe || !normThumb.normalized.startsWith('assets/thumbnails/')) {
      issues.push({
        severity: 'error',
        code: 'INVALID_THUMBNAIL_PATH',
        message: `Thumbnail path must live inside "assets/thumbnails/" without path traversal (got "${meta.thumbnail}").`,
      });
    }
  }

  return issues;
}

export function extractLocalHtmlAssetRefs(html: string): {
  relativeRefs: string[];
  rootAbsoluteRefs: string[];
} {
  const relativeRefs: string[] = [];
  const rootAbsoluteRefs: string[] = [];

  const attrRegex = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(html)) !== null) {
    const rawRef = match[1].trim();
    if (
      !rawRef ||
      rawRef.startsWith('#') ||
      rawRef.startsWith('data:') ||
      rawRef.startsWith('blob:') ||
      rawRef.startsWith('mailto:') ||
      rawRef.startsWith('javascript:') ||
      /^https?:\/\//i.test(rawRef) ||
      rawRef.startsWith('//')
    ) {
      continue;
    }

    const cleanRef = rawRef.split('?')[0].split('#')[0];
    if (!cleanRef) continue;

    if (cleanRef.startsWith('/')) {
      rootAbsoluteRefs.push(cleanRef);
    } else {
      relativeRefs.push(cleanRef.replace(/^\.\//, ''));
    }
  }

  return { relativeRefs, rootAbsoluteRefs };
}

export function validateGameBundle(
  files: GameFile[],
  metadata?: Partial<GameCatalogItem>
): ValidationReport {
  const issues: ValidationIssue[] = [];
  let totalBytes = 0;
  let securityPassed = true;
  let subpathCompatible = true;

  if (metadata) {
    const metaIssues = validateMetadata(metadata);
    issues.push(...metaIssues);
    if (metaIssues.some((i) => i.code.includes('PATH') || i.code.includes('SLUG'))) {
      securityPassed = false;
    }
  }

  if (!Array.isArray(files) || files.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_BUNDLE',
      message: 'Game bundle contains no files.',
    });
  }

  if (files.length > MAX_FILE_COUNT) {
    issues.push({
      severity: 'error',
      code: 'TOO_MANY_FILES',
      message: `Game bundle exceeds maximum file count (${files.length} > ${MAX_FILE_COUNT}).`,
    });
  }

  const normalizedMap = new Map<string, GameFile>();

  for (const file of files) {
    const norm = normalizeRelativePath(file.path);
    if (!norm.safe) {
      securityPassed = false;
      issues.push({
        severity: 'error',
        code: 'PATH_TRAVERSAL_BLOCKED',
        message: norm.reason || `Invalid file path: ${file.path}`,
        file: file.path,
      });
      continue;
    }

    for (const secretFilePattern of SECRET_FILENAME_PATTERNS) {
      if (secretFilePattern.test(norm.normalized)) {
        securityPassed = false;
        issues.push({
          severity: 'error',
          code: 'FORBIDDEN_SECRET_FILE',
          message: `Secret or environment file "${norm.normalized}" cannot be included in a game bundle.`,
          file: norm.normalized,
        });
      }
    }

    const ext = getFileExtension(norm.normalized);
    if (!ALLOWED_GAME_EXTENSIONS.has(ext)) {
      securityPassed = false;
      issues.push({
        severity: 'error',
        code: 'DISALLOWED_FILE_TYPE',
        message: `File "${norm.normalized}" has disallowed extension "${ext || '(none)'}".`,
        file: norm.normalized,
      });
    }

    const byteLength =
      file.sizeBytes ??
      (file.encoding === 'base64'
        ? Math.floor((file.content.length * 3) / 4)
        : new TextEncoder().encode(file.content).length);

    totalBytes += byteLength;

    if (byteLength > MAX_SINGLE_FILE_BYTES) {
      issues.push({
        severity: 'error',
        code: 'FILE_TOO_LARGE',
        message: `File "${norm.normalized}" exceeds single-file limit (${byteLength} bytes).`,
        file: norm.normalized,
      });
    }

    if (file.encoding !== 'base64') {
      const secretIssues = scanContentForSecrets(file.content, norm.normalized);
      if (secretIssues.length > 0) {
        securityPassed = false;
        issues.push(...secretIssues);
      }
    }

    normalizedMap.set(norm.normalized, file);
  }

  if (totalBytes > MAX_GAME_BUNDLE_BYTES) {
    issues.push({
      severity: 'error',
      code: 'BUNDLE_TOO_LARGE',
      message: `Total bundle size (${totalBytes} bytes) exceeds 25 MB limit.`,
    });
  }

  const indexFile = normalizedMap.get('index.html');
  const entryPointFound = Boolean(indexFile);
  let assetReferencesChecked = 0;
  const missingAssets: string[] = [];

  if (!indexFile) {
    issues.push({
      severity: 'error',
      code: 'MISSING_ENTRY_POINT',
      message: 'Every game must contain a root "index.html" entry point inside its directory.',
    });
  } else {
    const htmlContent = indexFile.content;
    if (!/<html|<canvas|<body|<!doctype/i.test(htmlContent)) {
      issues.push({
        severity: 'warning',
        code: 'MINIMAL_HTML_STRUCTURE',
        message: 'index.html does not appear to have standard HTML document tags.',
        file: 'index.html',
      });
    }

    const { relativeRefs, rootAbsoluteRefs } = extractLocalHtmlAssetRefs(htmlContent);
    assetReferencesChecked = relativeRefs.length + rootAbsoluteRefs.length;

    for (const absRef of rootAbsoluteRefs) {
      subpathCompatible = false;
      issues.push({
        severity: 'error',
        code: 'ROOT_ABSOLUTE_ASSET_PATH',
        message: `Asset reference "${absRef}" uses a root-absolute path ("/...") which breaks under GitHub Pages repository subpaths (e.g. /repo-name/). Use relative paths instead.`,
        file: 'index.html',
      });
    }

    for (const relRef of relativeRefs) {
      const refNorm = normalizeRelativePath(relRef);
      if (!refNorm.safe) {
        securityPassed = false;
        missingAssets.push(relRef);
        issues.push({
          severity: 'error',
          code: 'ASSET_PATH_TRAVERSAL',
          message: `Asset reference "${relRef}" attempts to escape the game directory.`,
          file: 'index.html',
        });
      } else if (!normalizedMap.has(refNorm.normalized)) {
        missingAssets.push(refNorm.normalized);
        issues.push({
          severity: 'error',
          code: 'MISSING_INTERNAL_ASSET',
          message: `Referenced internal asset "${refNorm.normalized}" was not found in the game bundle.`,
          file: 'index.html',
        });
      }
    }
  }

  const valid =
    entryPointFound &&
    securityPassed &&
    subpathCompatible &&
    missingAssets.length === 0 &&
    !issues.some((i) => i.severity === 'error');

  return {
    valid,
    checkedAt: new Date().toISOString(),
    entryPointFound,
    entryPointPath: 'index.html',
    totalFiles: files.length,
    totalBytes,
    assetReferencesChecked,
    missingAssets,
    securityPassed,
    subpathCompatible,
    issues,
  };
}
