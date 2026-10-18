import type { GameCatalogItem, GameCategory, GameEngineType, GameFile } from './types.ts';
import { sanitizeSlug } from './validator.ts';

export function generateGameThumbnailSvg(params: {
  title: string;
  category: GameCategory;
  accentColor?: string;
  secondaryColor?: string;
}): string {
  const { title, category } = params;
  const palette: Record<GameCategory, { bg1: string; bg2: string; accent: string; glow: string }> = {
    Action: { bg1: '#090D16', bg2: '#1E1B4B', accent: '#F59E0B', glow: '#EF4444' },
    Arcade: { bg1: '#0B132B', bg2: '#1C2541', accent: '#10B981', glow: '#3B82F6' },
    Puzzle: { bg1: '#0F172A', bg2: '#1E293B', accent: '#38BDF8', glow: '#F59E0B' },
    '3D': { bg1: '#111827', bg2: '#31102F', accent: '#F97316', glow: '#6366F1' },
    Strategy: { bg1: '#0C191E', bg2: '#1A2E35', accent: '#EAB308', glow: '#14B8A6' },
    Sports: { bg1: '#062019', bg2: '#0F392B', accent: '#22C55E', glow: '#FACC15' },
  };

  const p = palette[category] || palette.Action;
  const safeTitle = title.replace(/[<>&"']/g, '').slice(0, 24);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.bg1}"/>
      <stop offset="100%" stop-color="${p.bg2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="65%" cy="40%" r="55%">
      <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.32"/>
      <stop offset="60%" stop-color="${p.glow}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${p.bg1}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="640" height="480" fill="url(#bg)"/>
  <rect width="640" height="480" fill="url(#grid)"/>
  <rect width="640" height="480" fill="url(#glow)"/>
  <g transform="translate(320, 215)">
    <polygon points="0,-105 95,-50 95,55 0,110 -95,55 -95,-50" fill="${p.bg1}" fill-opacity="0.75" stroke="${p.accent}" stroke-width="3"/>
    <polygon points="0,-72 64,-34 64,38 0,76 -64,38 -64,-34" fill="none" stroke="${p.glow}" stroke-width="2" stroke-dasharray="10 6"/>
    <circle cx="0" cy="0" r="26" fill="${p.accent}" fill-opacity="0.2" stroke="${p.accent}" stroke-width="2.5"/>
    <polygon points="-8,-12 16,0 -8,12" fill="${p.accent}"/>
  </g>
  <rect x="32" y="388" width="576" height="62" rx="10" fill="#090D16" fill-opacity="0.82" stroke="#ffffff" stroke-opacity="0.1"/>
  <text x="54" y="427" fill="#F8FAFC" font-family="Outfit, sans-serif" font-weight="700" font-size="24" letter-spacing="0.5">${safeTitle}</text>
  <text x="586" y="425" fill="${p.accent}" font-family="JetBrains Mono, monospace" font-weight="600" font-size="13" text-anchor="end">${category.toUpperCase()}</text>
</svg>`;
}

export function buildPlayableStarterBundle(params: {
  title: string;
  slug?: string;
  category?: GameCategory;
  engine?: GameEngineType;
  description?: string;
}): {
  metadata: GameCatalogItem;
  files: GameFile[];
  thumbnailSvg: string;
} {
  const slug = sanitizeSlug(params.slug || params.title || 'starlight-defender');
  const category: GameCategory = params.category || 'Arcade';
  const engine: GameEngineType = params.engine || 'html5-canvas';
  const now = new Date().toISOString();

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${params.title}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body data-state="title">
  <div id="hud">
    <div class="hud-cluster">
      <span class="kicker">SCORE</span>
      <span id="score" class="readout">0</span>
    </div>
    <div class="hud-cluster">
      <span class="kicker">WAVE</span>
      <span id="wave" class="readout">1</span>
    </div>
    <div class="hud-cluster">
      <span class="kicker">HULL</span>
      <span id="hp" class="readout">100</span>
    </div>
  </div>
  <div id="overlay">
    <div class="card">
      <svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
        <polygon points="32,6 56,52 32,42 8,52" fill="#F59E0B" stroke="#FEF3C7" stroke-width="2"/>
      </svg>
      <h1 id="overlay-title">${params.title}</h1>
      <p id="overlay-sub">${params.description || 'Collect energy cores and dodge incoming hazards.'}</p>
      <button id="start-btn" data-start="true">Start Game</button>
      <div class="controls-hint">WASD / Arrows Move · Space Boost · P Pause</div>
    </div>
  </div>
  <canvas id="game-canvas" width="960" height="540"></canvas>
  <script src="game.js"></script>
</body>
</html>`;

  const css = `* { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
body {
  background: #070A12;
  color: #F8FAFC;
  font-family: system-ui, -apple-system, sans-serif;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
#game-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: radial-gradient(circle at 50% 40%, #131C31 0%, #070A12 75%);
}
#hud {
  position: fixed;
  top: 16px;
  left: 20px;
  right: 20px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  z-index: 10;
}
.hud-cluster {
  background: rgba(11, 15, 25, 0.85);
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 8px 14px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}
.kicker { font-size: 10px; letter-spacing: 0.12em; color: #94A3B8; font-weight: 700; }
.readout { font-size: 24px; font-weight: 800; color: #F8FAFC; font-variant-numeric: tabular-nums; }
#overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(7, 10, 18, 0.82);
  z-index: 20;
}
body[data-state="playing"] #overlay { display: none; }
.card {
  background: #0F172A;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px;
  padding: 32px 40px;
  text-align: center;
  max-width: 420px;
}
.card h1 { font-size: 28px; margin: 12px 0 8px; color: #F8FAFC; }
.card p { font-size: 14px; color: #94A3B8; margin-bottom: 20px; line-height: 1.5; }
#start-btn {
  background: #F59E0B;
  color: #090D16;
  border: none;
  padding: 12px 28px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
}
#start-btn:hover { background: #FBBF24; }
.controls-hint { margin-top: 16px; font-size: 12px; color: #64748B; }
`;

  const js = `(() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const waveEl = document.getElementById('wave');
  const hpEl = document.getElementById('hp');
  const startBtn = document.getElementById('start-btn');
  const overlayTitle = document.getElementById('overlay-title');

  let state = 'title';
  let score = 0;
  let wave = 1;
  let hp = 100;
  const keys = new Set();

  const player = { x: 480, y: 270, vx: 0, vy: 0, r: 16, boostCooldown: 0 };
  const orbs = [];
  const hazards = [];

  function spawnEntities() {
    orbs.length = 0;
    hazards.length = 0;
    for (let i = 0; i < 6; i++) {
      orbs.push({ x: 100 + Math.random() * 760, y: 80 + Math.random() * 380, r: 9 });
    }
    for (let i = 0; i < 3 + wave; i++) {
      hazards.push({
        x: i % 2 === 0 ? 60 : 900,
        y: 60 + Math.random() * 420,
        vx: (Math.random() * 120 + 90) * (i % 2 === 0 ? 1 : -1),
        vy: (Math.random() - 0.5) * 160,
        r: 14
      });
    }
  }

  function startGame() {
    state = 'playing';
    document.body.dataset.state = 'playing';
    score = 0;
    wave = 1;
    hp = 100;
    player.x = 480;
    player.y = 270;
    player.vx = 0;
    player.vy = 0;
    spawnEntities();
    startBtn.blur();
  }

  startBtn.addEventListener('click', startGame);
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if ((state === 'title' || state === 'gameover') && (e.code === 'Enter' || e.code === 'Space')) {
      startGame();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') {
        state = 'paused';
        document.body.dataset.state = 'paused';
        overlayTitle.textContent = 'Game Paused';
        startBtn.textContent = 'Resume';
      } else if (state === 'paused') {
        state = 'playing';
        document.body.dataset.state = 'playing';
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  if (new URLSearchParams(window.location.search).get('autostart') === '1') {
    startGame();
  }

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (state === 'playing') {
      const speed = keys.has('Space') ? 420 : 260;
      let ax = 0, ay = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ax -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) ax += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) ay -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) ay += 1;

      player.x = Math.max(24, Math.min(936, player.x + ax * speed * dt));
      player.y = Math.max(24, Math.min(516, player.y + ay * speed * dt));

      for (const o of orbs) {
        const dx = player.x - o.x, dy = player.y - o.y;
        if (Math.hypot(dx, dy) < player.r + o.r) {
          score += 25;
          o.x = 80 + Math.random() * 800;
          o.y = 80 + Math.random() * 380;
          if (score % 150 === 0) {
            wave += 1;
            hazards.push({ x: 60, y: 60, vx: 150, vy: 140, r: 14 });
          }
        }
      }

      for (const h of hazards) {
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (h.x < 20 || h.x > 940) h.vx *= -1;
        if (h.y < 20 || h.y > 520) h.vy *= -1;
        if (Math.hypot(player.x - h.x, player.y - h.y) < player.r + h.r) {
          hp = Math.max(0, hp - Math.round(35 * dt * 10));
          h.vx *= -1;
          if (hp <= 0) {
            state = 'gameover';
            document.body.dataset.state = 'gameover';
            overlayTitle.textContent = 'Run Complete — Score: ' + score;
            startBtn.textContent = 'Play Again';
          }
        }
      }

      scoreEl.textContent = String(Math.round(score));
      waveEl.textContent = String(wave);
      hpEl.textContent = String(Math.round(hp));
    }

    ctx.clearRect(0, 0, 960, 540);
    // Orbs
    ctx.fillStyle = '#10B981';
    for (const o of orbs) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hazards
    ctx.fillStyle = '#EF4444';
    for (const h of hazards) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
`;

  const metadata: GameCatalogItem = {
    id: slug,
    slug,
    title: params.title,
    description:
      params.description ||
      'Fast-paced browser arcade survival game where you collect energy cores across escalating hazard waves.',
    instructions:
      'Collect green energy cores to increase your score and advance waves. Avoid red plasma hazards or use Space to boost through tight gaps.',
    controls: ['WASD / Arrow Keys: Move', 'Space: Speed Boost', 'P / Esc: Pause'],
    category,
    tags: [category.toLowerCase(), 'arcade', 'html5'],
    thumbnail: `assets/thumbnails/${slug}.svg`,
    path: `games/${slug}/`,
    status: 'draft',
    engine,
    createdAt: now,
    updatedAt: now,
    aiGenerated: false,
  };

  const files: GameFile[] = [
    { path: 'index.html', content: html, encoding: 'utf-8' },
    { path: 'style.css', content: css, encoding: 'utf-8' },
    { path: 'game.js', content: js, encoding: 'utf-8' },
  ];

  const thumbnailSvg = generateGameThumbnailSvg({ title: params.title, category });

  return { metadata, files, thumbnailSvg };
}
