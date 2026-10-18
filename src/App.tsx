/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { GameCatalogItem, GameCategory } from './lib/types';
import { resolvePagesUrl } from './lib/catalogManager';
import { GamePortal } from './components/GamePortal';
import { GamePlayerView } from './components/GamePlayerView';
import { AdminStudio } from './components/AdminStudio';

type ActiveRoute =
  | { view: 'portal'; category: GameCategory | 'All' }
  | { view: 'game'; slug: string }
  | { view: 'admin' };

export default function App() {
  const basePath = import.meta.env.BASE_URL || './';
  const [catalog, setCatalog] = useState<GameCatalogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [route, setRoute] = useState<ActiveRoute>({
    view: 'portal',
    category: 'All',
  });

  const loadCatalog = useCallback(async () => {
    try {
      // Try local admin studio bootstrap first if running locally so drafts are visible in Admin Studio
      const adminRes = await fetch('/api/admin/bootstrap').catch(() => null);
      if (adminRes && adminRes.ok) {
        const data = await adminRes.json();
        if (Array.isArray(data.catalog)) {
          setCatalog(data.catalog);
          setLoading(false);
          return;
        }
      }

      // Static-first fallback for GitHub Pages deployment (loads ./data/games.json relative to basePath)
      const manifestUrl = resolvePagesUrl(basePath, 'data/games.json');
      const staticRes = await fetch(manifestUrl);
      if (staticRes.ok) {
        const items = (await staticRes.json()) as GameCatalogItem[];
        setCatalog(items);
      }
    } catch (err) {
      console.error('Failed to load game catalog:', err);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const activeGame =
    route.view === 'game'
      ? catalog.find((g) => g.slug === route.slug) || null
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract (frontend-design Section 2) */}
      <header className="sticky top-0 z-30 bg-[#0B0F17]/95 border-b border-slate-800/90 px-6 py-4 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#discover"
          onClick={(e) => {
            e.preventDefault();
            setRoute({ view: 'portal', category: 'All' });
          }}
          className="font-display text-xl font-extrabold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
        >
          JRO9I Games
        </a>

        {/* Zone 2: 4–5 concise single-line navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
        >
          <a
            href="#discover"
            onClick={(e) => {
              e.preventDefault();
              setRoute({ view: 'portal', category: 'All' });
            }}
            className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 ${
              route.view === 'portal' && route.category === 'All'
                ? 'text-amber-400 underline underline-offset-8'
                : ''
            }`}
          >
            Discover
          </a>
          <a
            href="#action"
            onClick={(e) => {
              e.preventDefault();
              setRoute({ view: 'portal', category: 'Action' });
            }}
            className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 ${
              route.view === 'portal' && route.category === 'Action'
                ? 'text-amber-400 underline underline-offset-8'
                : ''
            }`}
          >
            Action
          </a>
          <a
            href="#3d"
            onClick={(e) => {
              e.preventDefault();
              setRoute({ view: 'portal', category: '3D' });
            }}
            className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 ${
              route.view === 'portal' && route.category === '3D'
                ? 'text-amber-400 underline underline-offset-8'
                : ''
            }`}
          >
            3D Racing
          </a>
          <a
            href="#puzzle"
            onClick={(e) => {
              e.preventDefault();
              setRoute({ view: 'portal', category: 'Puzzle' });
            }}
            className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 ${
              route.view === 'portal' && route.category === 'Puzzle'
                ? 'text-amber-400 underline underline-offset-8'
                : ''
            }`}
          >
            Puzzle
          </a>
          <a
            href="#strategy"
            onClick={(e) => {
              e.preventDefault();
              setRoute({ view: 'portal', category: 'Strategy' });
            }}
            className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 ${
              route.view === 'portal' && route.category === 'Strategy'
                ? 'text-amber-400 underline underline-offset-8'
                : ''
            }`}
          >
            Strategy
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() =>
              setRoute((prev) =>
                prev.view === 'admin'
                  ? { view: 'portal', category: 'All' }
                  : { view: 'admin' }
              )
            }
            className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {route.view === 'admin' ? 'Exit Admin Studio' : 'Admin Studio'}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        {loading ? (
          <div className="max-w-[1360px] mx-auto px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-72 bg-[#111827] border border-slate-800 rounded-2xl animate-pulse"
              />
            ))}
          </div>
        ) : route.view === 'admin' ? (
          <AdminStudio
            catalog={catalog}
            basePath={basePath}
            onRefreshCatalog={loadCatalog}
            onOpenPublicGame={(slug) => setRoute({ view: 'game', slug })}
          />
        ) : route.view === 'game' && activeGame ? (
          <GamePlayerView
            game={activeGame}
            allGames={catalog}
            basePath={basePath}
            onBack={() => setRoute({ view: 'portal', category: 'All' })}
            onSelectGame={(slug) => setRoute({ view: 'game', slug })}
          />
        ) : (
          <GamePortal
            catalog={catalog}
            basePath={basePath}
            activeCategory={route.view === 'portal' ? route.category : 'All'}
            onSelectCategory={(category) =>
              setRoute({ view: 'portal', category })
            }
            onOpenGame={(slug) => setRoute({ view: 'game', slug })}
          />
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-800/80 px-6 py-6 text-xs text-slate-500">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            JRO9I Games · Static GitHub Pages Gaming Platform &amp; Local AI Studio
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setRoute({ view: 'portal', category: 'All' })}
              className="hover:text-slate-300 cursor-pointer"
            >
              Public Catalog
            </button>
            <button
              type="button"
              onClick={() => setRoute({ view: 'admin' })}
              className="hover:text-slate-300 cursor-pointer"
            >
              Local Admin Studio
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
