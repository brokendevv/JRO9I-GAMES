import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Maximize2,
  RotateCcw,
  ExternalLink,
  ShieldCheck,
  Play,
} from 'lucide-react';
import { GameCatalogItem } from '../lib/types';
import { getRelatedGames, resolvePagesUrl } from '../lib/catalogManager';

interface GamePlayerViewProps {
  game: GameCatalogItem;
  allGames: GameCatalogItem[];
  basePath: string;
  onBack: () => void;
  onSelectGame: (slug: string) => void;
}

export const GamePlayerView: React.FC<GamePlayerViewProps> = ({
  game,
  allGames,
  basePath,
  onBack,
  onSelectGame,
}) => {
  const iframeContainerRef = useRef<HTMLDivElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [autostart, setAutostart] = useState(false);

  const gameEntryUrl = useMemo(() => {
    const baseEntry = resolvePagesUrl(basePath, `${game.path}index.html`);
    return autostart ? `${baseEntry}?autostart=1` : baseEntry;
  }, [basePath, game.path, autostart]);

  const relatedGames = useMemo(
    () => getRelatedGames(allGames, game.slug, 4),
    [allGames, game.slug]
  );

  const handleFullscreen = () => {
    const el = iframeContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <div className="max-w-[1360px] mx-auto px-6 py-6 space-y-10">
      {/* Top Breadcrumb & Back Control */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#111827] hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Catalog
          </button>
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Games</span>
            <span aria-hidden="true">/</span>
            <span className="text-amber-400">{game.category}</span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-200 font-medium">{game.title}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAutostart((prev) => !prev);
              setReloadKey((k) => k + 1);
            }}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              autostart
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-[#111827] border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {autostart ? 'Instant Autostart: On' : 'Instant Autostart: Off'}
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#111827] hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reload Game
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Fullscreen
          </button>
        </div>
      </div>

      {/* Main Sandboxed Game Viewport */}
      <div
        ref={iframeContainerRef}
        className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl"
      >
        <div className="aspect-[16/9] w-full max-h-[680px] relative bg-[#070B14]">
          <iframe
            key={`${game.slug}-${reloadKey}`}
            src={gameEntryUrl}
            title={game.title}
            sandbox="allow-scripts allow-pointer-lock"
            className="w-full h-full border-0"
          />
        </div>

        {/* Viewport Bottom Action Bar */}
        <div className="px-6 py-4 bg-[#111827] border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="text-xl font-bold text-slate-100">{game.title}</h1>
            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
              <span className="text-amber-400 font-medium">{game.category}</span>
              <span aria-hidden="true">·</span>
              <span>Tags: {game.tags.join(', ')}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Path: {game.path}index.html</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              Sandboxed Static Iframe
            </span>
            <a
              href={gameEntryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-slate-300 hover:text-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              Open Standalone <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Game Details, Instructions, Controls & Related Games */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6 bg-[#111827] border border-slate-800/90 rounded-2xl p-6">
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-slate-100">About {game.title}</h2>
            <p className="text-sm text-slate-300 leading-relaxed">{game.description}</p>
          </div>

          <div className="space-y-2 pt-4 border-t border-slate-800/80">
            <h3 className="text-sm font-bold text-slate-100">How to Play & Instructions</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{game.instructions}</p>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-800/80">
            <h3 className="text-sm font-bold text-slate-100">Controls</h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300">
              {game.controls.map((ctrl, idx) => (
                <li
                  key={idx}
                  className="px-3.5 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl font-mono"
                >
                  {ctrl}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Related Games Column */}
        <div className="lg:col-span-4 space-y-4">
          <h2 className="text-lg font-bold text-slate-100">Related Games</h2>
          <div className="space-y-3">
            {relatedGames.map((rel) => (
              <button
                key={rel.slug}
                type="button"
                onClick={() => onSelectGame(rel.slug)}
                className="w-full text-left p-3.5 bg-[#111827] hover:bg-slate-800/70 border border-slate-800/90 hover:border-amber-500/50 rounded-xl flex items-center gap-4 transition-colors cursor-pointer group"
              >
                <img
                  src={resolvePagesUrl(basePath, rel.thumbnail)}
                  alt={rel.title}
                  referrerPolicy="no-referrer"
                  className="w-20 h-15 object-cover rounded-lg bg-slate-950 shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-xs text-amber-400 font-medium">
                    {rel.category} · {rel.tags[0] || 'html5'}
                  </div>
                  <div className="text-sm font-bold text-slate-100 group-hover:text-amber-400 truncate">
                    {rel.title}
                  </div>
                  <div className="inline-flex items-center gap-1 text-xs text-slate-400">
                    <Play className="w-3 h-3 fill-current" /> Play Instant
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
