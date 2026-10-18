# JRO9I Games — GitHub-Powered AI Gaming Platform

JRO9I Games is a Poki-inspired static browser gaming portal paired with a **Local Administrator AI Game Studio & GitHub Publisher** (**Option B Architecture**).

- **Public Gaming Website (`dist/` on GitHub Pages)**: 100% static HTML/CSS/JS application. Loads the deployed game catalog from `data/games.json` and launches isolated HTML5 Canvas / 3D WebGL games inside sandboxed iframes (`games/<slug>/index.html`). Works seamlessly under root domains (`/`) or GitHub Pages repository subpaths (`/jro9i-games/`).
- **Private Administrator Studio (`server.ts` run locally via `npm run studio`)**: Runs on your local machine, keeping `GEMINI_API_KEY` and `GITHUB_TOKEN` exclusively in server-side environment variables. Never exposes secrets, tokens, or shared passwords in the public frontend bundle.

---

## 1. Repository Structure

```text
/
  index.html                        # Portal entry point
  server.ts                         # Local Admin Studio & GitHub REST API publishing server
  public/
    data/
      games.json                    # Public game catalog manifest
    games/
      index.html                    # Static games directory index
      astro-drift/
        index.html                  # Playable HTML5 Canvas space survival game
      horizon-runner-3d/
        index.html                  # Playable 3D canyon racer
      tactical-grid/
        index.html                  # Playable spatial matrix puzzle game
      citadel-defense/
        index.html                  # Playable bastion tower defense game
    assets/
      thumbnails/                   # Game key-art thumbnails (.svg / .webp)
  src/
    lib/
      types.ts                      # Data models for catalog, validation, and commit plans
      validator.ts                  # Untrusted bundle & secret/path-traversal validator
      zipEngine.ts                  # Zero-dependency PKZIP parser & archive creator
      catalogManager.ts             # Deployment-gated catalog state & subpath URL resolver
      githubPublisher.ts            # GitHub Git Data API atomic commit planner & publisher
      sampleTemplates.ts            # Starter game templates & SVG thumbnail generator
      platform.test.ts              # Node test runner suite (node --test)
    components/
      GamePortal.tsx                # Public Poki-inspired gaming portal
      GamePlayerView.tsx            # Sandboxed game player with fullscreen & related games
      AdminStudio.tsx               # Private Admin Dashboard & AI Game Studio
  scripts/
    validate-games.ts               # Standalone CLI game & catalog validator
  .github/
    workflows/
      deploy.yml                    # Official GitHub Pages validation & deployment workflow
      validate-games.yml            # Pull request / push game bundle security check
```

---

## 2. Local Commands

```bash
# 1. Install dependencies
npm install

# 2. Run the Local Administrator Studio + Portal (http://localhost:3000)
npm run studio

# 3. Run unit & security tests
npm test

# 4. Validate all games in public/games/ and public/data/games.json
npm run validate:games

# 5. Build static site for GitHub Pages (supports GITHUB_PAGES_BASE_PATH)
GITHUB_PAGES_BASE_PATH="/jro9i-games/" npm run build

# 6. Preview the built static site locally
npm run preview
```

---

## 3. Manual GitHub Settings Required Before Live Remote Publishing

Before enabling **Authorize Live Remote GitHub Commits** in the Admin Studio, complete these steps on GitHub:

1. **Create or Push to Your Repository**: Push this repository to GitHub (e.g., `https://github.com/<your-username>/jro9i-games`).
2. **Enable GitHub Pages via GitHub Actions**:
   - Navigate to **Settings → Pages** in your GitHub repository.
   - Under **Build and deployment → Source**, select **GitHub Actions**.
3. **Configure Actions Permissions**:
   - Navigate to **Settings → Actions → General**.
   - Ensure Actions are enabled. The workflow `.github/workflows/deploy.yml` requests least-privilege permissions (`contents: read`, `pages: write`, `id-token: write`).
4. **Create a Fine-Grained Personal Access Token (or GitHub App Token)**:
   - Go to **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
   - Restrict Repository access strictly to your `jro9i-games` repository.
   - Grant Repository permissions:
     - **Contents**: `Read and write` (for committing `public/games/<slug>/` and `public/data/games.json`)
     - **Actions**: `Read-only` (for checking workflow deployment status)
     - **Pages**: `Read-only`
5. **Configure Local `.env`**:
   - Copy `.env.example` to `.env` on your computer and fill in `GITHUB_TOKEN`, `GEMINI_API_KEY`, `GITHUB_OWNER`, and `GITHUB_REPO`.
   - Never commit `.env` to Git.

---

## 4. Security & Untrusted Game Code Notice

- Every uploaded ZIP or AI-generated game is validated without executing game code on the server.
- Games run inside `<iframe sandbox="allow-scripts allow-same-origin allow-pointer-lock">`.
- Path traversal (`..`), root-absolute asset references (`/assets/...`), disallowed file extensions, and secret files (`.env`, `.pem`, private keys, API tokens) are automatically blocked before staging or committing.
- **Public Source Code Notice**: GitHub Pages is a public static host. Any game published to GitHub Pages will have its client-side HTML/JS/CSS source code publicly readable by visitors. Never embed private API keys inside a browser game.
