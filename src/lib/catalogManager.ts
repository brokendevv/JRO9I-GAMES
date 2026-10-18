import type { GameCatalogItem, GameCategory, PublishStatus } from './types.ts';
import { isValidSlug, validateMetadata } from './validator.ts';

/**
 * Resolves a relative game or asset URL safely under any GitHub Pages base path
 * (e.g., "/" at root or "/jro9i-games/" under a project subpath).
 */
export function resolvePagesUrl(basePath: string, relativeAssetPath: string): string {
  const cleanRel = relativeAssetPath.replace(/^\/+/, '').replace(/^\.\//, '');
  if (!basePath || basePath === '.' || basePath === './') {
    return `./${cleanRel}`;
  }
  const normalizedBase = basePath.startsWith('/') ? basePath : `/${basePath}`;
  const withTrailingSlash = normalizedBase.endsWith('/')
    ? normalizedBase
    : `${normalizedBase}/`;
  return `${withTrailingSlash}${cleanRel}`;
}

/**
 * Filters the catalog for the public website.
 * CRITICAL RULE: Only games whose status === 'published' appear on the public portal.
 */
export function getPublicCatalog(
  allGames: GameCatalogItem[],
  options?: {
    search?: string;
    category?: GameCategory | 'All';
    tag?: string;
  }
): GameCatalogItem[] {
  const publishedOnly = allGames.filter((g) => g.status === 'published');

  return publishedOnly.filter((game) => {
    if (options?.category && options.category !== 'All' && game.category !== options.category) {
      return false;
    }
    if (options?.tag && !game.tags.includes(options.tag.toLowerCase())) {
      return false;
    }
    if (options?.search && options.search.trim().length > 0) {
      const q = options.search.toLowerCase().trim();
      const haystack = [
        game.title,
        game.description,
        game.category,
        ...game.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Computes related games for a dedicated game page based on shared category and tags.
 */
export function getRelatedGames(
  allGames: GameCatalogItem[],
  currentSlug: string,
  limit = 4
): GameCatalogItem[] {
  const published = allGames.filter((g) => g.status === 'published');
  const current = published.find((g) => g.slug === currentSlug);
  if (!current) {
    return published.filter((g) => g.slug !== currentSlug).slice(0, limit);
  }

  const scored = published
    .filter((g) => g.slug !== currentSlug)
    .map((candidate) => {
      let score = 0;
      if (candidate.category === current.category) score += 3;
      for (const tag of candidate.tags) {
        if (current.tags.includes(tag)) score += 2;
      }
      if (candidate.featured) score += 1;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score || b.candidate.updatedAt.localeCompare(a.candidate.updatedAt));

  return scored.slice(0, limit).map((s) => s.candidate);
}

/**
 * Safely inserts or updates a game in the catalog array without overwriting unrelated games.
 * Enforces rule: A game CANNOT be marked 'published' unless deploymentVerified === true.
 */
export function upsertCatalogEntry(
  existingCatalog: GameCatalogItem[],
  incoming: GameCatalogItem,
  options: {
    allowOverwriteSlug?: boolean;
    deploymentVerified?: boolean;
  } = {}
): {
  updatedCatalog: GameCatalogItem[];
  entry: GameCatalogItem;
  action: 'created' | 'updated';
} {
  if (!isValidSlug(incoming.slug)) {
    throw new Error(`Invalid game slug "${incoming.slug}".`);
  }

  const metaIssues = validateMetadata(incoming);
  const errors = metaIssues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Catalog metadata validation failed: ${errors[0].message}`);
  }

  // Enforce strict deployment verification before marking a game 'published'
  let effectiveStatus: PublishStatus = incoming.status;
  if (effectiveStatus === 'published' && !options.deploymentVerified) {
    throw new Error(
      'Cannot mark game as "published" before GitHub Pages deployment has succeeded and been verified.'
    );
  }

  const existingIdx = existingCatalog.findIndex(
    (g) => g.slug === incoming.slug || g.id === incoming.id
  );

  if (existingIdx !== -1 && options.allowOverwriteSlug === false) {
    throw new Error(`Duplicate game slug "${incoming.slug}" already exists in catalog.`);
  }

  const sanitizedEntry: GameCatalogItem = {
    ...incoming,
    id: incoming.slug,
    slug: incoming.slug,
    path: `games/${incoming.slug}/`,
    status: effectiveStatus,
    tags: Array.from(new Set(incoming.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))),
    updatedAt: new Date().toISOString(),
  };

  const nextCatalog = [...existingCatalog];
  if (existingIdx >= 0) {
    nextCatalog[existingIdx] = sanitizedEntry;
    return { updatedCatalog: nextCatalog, entry: sanitizedEntry, action: 'updated' };
  } else {
    nextCatalog.unshift(sanitizedEntry);
    return { updatedCatalog: nextCatalog, entry: sanitizedEntry, action: 'created' };
  }
}

/**
 * Transitions a game's publishing status safely.
 */
export function transitionGameStatus(
  catalog: GameCatalogItem[],
  slug: string,
  nextStatus: PublishStatus,
  options: {
    deploymentVerified?: boolean;
    commitSha?: string;
    commitUrl?: string;
    workflowRunUrl?: string;
    error?: string;
  } = {}
): GameCatalogItem[] {
  if (nextStatus === 'published' && !options.deploymentVerified) {
    throw new Error(
      'Cannot transition game to "published" until deployment has succeeded and catalog inclusion is verified.'
    );
  }

  return catalog.map((item) => {
    if (item.slug !== slug) return item;
    return {
      ...item,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      lastCommitSha: options.commitSha ?? item.lastCommitSha,
      lastCommitUrl: options.commitUrl ?? item.lastCommitUrl,
      lastWorkflowRunUrl: options.workflowRunUrl ?? item.lastWorkflowRunUrl,
      lastError: nextStatus === 'failed' ? options.error : undefined,
    };
  });
}
