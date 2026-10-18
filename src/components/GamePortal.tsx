import React, { useMemo, useState } from 'react';
import { Search, Play, Gamepad2, Sparkles, Clock } from 'lucide-react';
import { GameCatalogItem, GameCategory } from '../lib/types';
import { getPublicCatalog, resolvePagesUrl } from '../lib/catalogManager';

interface GamePortalProps {
  catalog: GameCatalogItem[];
  basePath: string;
  activeCategory: GameCategory | 'All';
  onSelectCategory: (cat: GameCategory | 'All') => void;
  onOpenGame: (slug: string) => void;
  onOpenAdminWithPrompt?: (prompt: string) => void;
}

const CATEGORIES: Array<GameCategory | 'All'> = [
  'All',
  'Action',
  'Arcade',
  '3D',
  'Puzzle',
  'Strategy',
];

export const GamePortal: React.FC<GamePortalProps> = ({
  catalog,
  basePath,
  activeCategory,
  onSelectCategory,
  onOpenGame,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const publishedGames = useMemo(
    () =>
      getPublicCatalog(catalog, {
        search: searchQuery,
        category: activeCategory,
      }),
    [catalog, searchQuery, activeCategory]
  );

  const featuredGame = useMemo(() => {
    const allPublished = getPublicCatalog(catalog);
    return allPublished.find((g) => g.featured) || allPublished[0] || null;
  }, [catalog]);

  const recentlyAdded = useMemo(() => {
    return [...getPublicCatalog(catalog)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 4);
  }, [catalog]);

  return (
    <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-12">
      {/* Section 1: Hero Spotlight */}
      {featuredGame && activeCategory === 'All' && !searchQuery.trim() && (
        <section
          aria-label="Featured Game Spotlight"
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch bg-[#111827] border border-slate-800/90 rounded-2xl overflow-hidden p-6 lg:p-8"
        >
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
            <div className="space-y-3">
              <div className="text-xs font-medium text-amber-400 tracking-wide">
                Featured Spotlight · {featuredGame.category} · Instant Browser Play
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-50 tracking-tight leading-[1.1]">
                {featuredGame.title}
              </h1>
              <p className="text-slate-300 text-base leading-relaxed max-w-[62ch]">
                {featuredGame.description}
              </p>
            </div>

            <div className="space-y-4 pt-2">
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenGame(featuredGame.slug)}
                  className="inline-flex items-center gap-2.5 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Play {featuredGame.title}
                </button>
                <span className="text-xs text-slate-400">
                  {featuredGame.controls.slice(0, 2).join(' · ')}
                </span>
              </div>

              <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                <span>Engine: {featuredGame.engine || 'html5-canvas'}</span>
                <span aria-hidden="true">·</span>
                <span>Tags: {featuredGame.tags.join(', ')}</span>
                {featuredGame.version && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">v{featuredGame.version}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenGame(featuredGame.slug)}
            aria-label={`Launch ${featuredGame.title}`}
            className="lg:col-span-5 relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 min-h-[240px] cursor-pointer block text-left focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {!failedImages[featuredGame.slug] ? (
              <img
                src={resolvePagesUrl(basePath, featuredGame.thumbnail)}
                alt={featuredGame.title}
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedImages((prev) => ({ ...prev, [featuredGame.slug]: true }))
                }
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 p-6 text-center">
                <Gamepad2 className="w-12 h-12 text-amber-400 mb-3" />
                <span className="font-bold text-slate-100">{featuredGame.title}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
          </button>
        </section>
      )}

      {/* Section 2: Search & Interactive Category Filter Bar */}
      <section aria-label="Catalog Filter Controls" className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          {/* Interactive Segmented Category Filter */}
          <div
            role="group"
            aria-label="Filter games by category"
            className="flex items-center gap-1.5 p-1.5 bg-[#111827] border border-slate-800/90 rounded-xl overflow-x-auto"
          >
            {CATEGORIES.map((category) => {
              const isActive = activeCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => onSelectCategory(category)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  {category === 'All' ? 'All Games' : category}
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <label htmlFor="game-search-input" className="sr-only">
              Search games by title, category, or tag
            </label>
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="game-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search games, genres, or tags..."
              className="w-full pl-10 pr-4 py-2.5 bg-[#111827] border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
        </div>

        {/* Section Header */}
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">
              {activeCategory === 'All' ? 'Published Browser Games' : `${activeCategory} Games`}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Loaded dynamically from deployed <code className="text-slate-300">data/games.json</code> manifest ·{' '}
              <span className="tabular-nums font-mono">{publishedGames.length}</span> available
            </p>
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-amber-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              Clear Search
            </button>
          )}
        </div>

        {/* Game Card Grid */}
        {publishedGames.length === 0 ? (
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-12 text-center space-y-3">
            <p className="text-base font-semibold text-slate-200">
              No published games match your filter
            </p>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Try clearing your search query or switching back to All Games.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                onSelectCategory('All');
              }}
              className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div
            data-testid="game-catalog-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {publishedGames.map((game) => (
              <article
                key={game.slug}
                className="group bg-[#111827] border border-slate-800/90 hover:border-amber-500/60 rounded-2xl overflow-hidden flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5"
              >
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenGame(game.slug)}
                    className="block w-full text-left relative aspect-[4/3] bg-slate-950 overflow-hidden cursor-pointer"
                  >
                    {!failedImages[game.slug] ? (
                      <img
                        src={resolvePagesUrl(basePath, game.thumbnail)}
                        alt={game.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedImages((prev) => ({ ...prev, [game.slug]: true }))
                        }
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 p-4 text-center">
                        <Gamepad2 className="w-10 h-10 text-amber-400 mb-2" />
                        <span className="text-sm font-bold text-slate-100">{game.title}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400">
                        <Play className="w-3.5 h-3.5 fill-current" /> Play Now
                      </span>
                    </div>
                  </button>

                  <div className="p-5 space-y-2">
                    {/* Clean unboxed metadata kicker (Zero-Pill Discipline) */}
                    <div className="text-xs text-slate-400 flex items-center gap-1.5">
                      <span className="text-amber-400 font-medium">{game.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{game.tags.slice(0, 2).join(' / ')}</span>
                    </div>

                    <h3 className="text-lg font-bold text-slate-100 group-hover:text-amber-400 transition-colors">
                      <button
                        type="button"
                        onClick={() => onOpenGame(game.slug)}
                        className="text-left cursor-pointer focus:outline-none"
                      >
                        {game.title}
                      </button>
                    </h3>

                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {game.description}
                    </p>
                  </div>
                </div>

                <div className="px-5 pb-5 pt-2 flex items-center justify-between border-t border-slate-800/60 mt-2">
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    /{game.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenGame(game.slug)}
                    aria-label={`Play ${game.title}`}
                    className="px-3.5 py-1.5 bg-slate-800/90 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Play Game
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Section 3: Recently Added & Static Architecture Proof */}
      <section
        aria-label="Recently Published Releases"
        className="pt-6 border-t border-slate-800/80 grid grid-cols-1 lg:grid-cols-12 gap-8"
      >
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h2 className="text-xl font-bold text-slate-100">Recently Added Releases</h2>
          </div>
          <div className="divide-y divide-slate-800/80 bg-[#111827] border border-slate-800/90 rounded-2xl overflow-hidden">
            {recentlyAdded.map((item) => (
              <div
                key={item.slug}
                className="p-4 sm:px-6 flex items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200 truncate">{item.title}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-400">{item.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {item.updatedAt.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{item.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenGame(item.slug)}
                  aria-label={`Open ${item.title}`}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Open Game
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 bg-[#111827] border border-slate-800/90 rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
              <Sparkles className="w-4 h-4" />
              <span>GitHub Pages Static Architecture</span>
            </div>
            <h3 className="text-lg font-bold text-slate-100">
              Zero Server Dependency in Production
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every game on JRO9I Games runs inside an isolated directory (
              <code className="text-slate-300">games/&lt;slug&gt;/index.html</code>) and is
              indexed via <code className="text-slate-300">data/games.json</code>. All assets
              resolve cleanly under repository subpaths.
            </p>
          </div>
          <div className="pt-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-1 font-mono tabular-nums">
            <div>Base Path: {basePath}</div>
            <div>Published Titles: {getPublicCatalog(catalog).length}</div>
            <div>Sandbox Mode: allow-scripts allow-pointer-lock</div>
          </div>
        </div>
      </section>
    </div>
  );
};
