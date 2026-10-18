import React, { useEffect, useState } from 'react';
import {
  Wand2,
  FolderGit2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Play,
  GitCommit,
  FileCode2,
  ShieldAlert,
  Download,
  Trash2,
  RefreshCw,
  ExternalLink,
  Eye,
  Lock,
  Unlock,
} from 'lucide-react';
import {
  CommitPlan,
  GameCatalogItem,
  GameCategory,
  GameEngineType,
  GameFile,
  GitHubConfig,
  PublishExecutionResult,
  PublishStatus,
  ValidationReport,
} from '../lib/types';
import { resolvePagesUrl } from '../lib/catalogManager';

interface AdminStudioProps {
  catalog: GameCatalogItem[];
  basePath: string;
  onRefreshCatalog: () => Promise<void>;
  onOpenPublicGame: (slug: string) => void;
}

type StudioTab = 'library' | 'ai-studio' | 'zip-import' | 'github-settings';

const PROMPT_PRESETS = [
  {
    label: 'Neon Asteroid Survivor (Canvas 2D)',
    title: 'Void Pulse Survivor',
    category: 'Action' as GameCategory,
    engine: 'html5-canvas' as GameEngineType,
    prompt:
      'Create a fast-paced top-down space survival game where the player steers a ship with WASD, fires plasma bolts at splitting asteroids, collects shield cells, and uses Space for a dash with cooldown.',
  },
  {
    label: 'Canyon Overdrive Racer (3D WebGL/Perspective)',
    title: 'Vector Canyon 3D',
    category: '3D' as GameCategory,
    engine: 'threejs-webgl' as GameEngineType,
    prompt:
      'Build a 3D perspective canyon speeder game where the player dodges red monolith gates, hits green turbo pads, and races against an accelerating horizon with score multipliers.',
  },
  {
    label: 'Cyber Circuit Matrix (Tactical Puzzle)',
    title: 'Circuit Matrix Pro',
    category: 'Puzzle' as GameCategory,
    engine: 'html5-canvas' as GameEngineType,
    prompt:
      'Create a grid-based tactical block puzzle game where players place energy conduits on a 6x6 board to clear rows and columns and build combo chains.',
  },
];

const PIPELINE_STEPS: PublishStatus[] = [
  'draft',
  'validating',
  'committing',
  'deploying',
  'published',
];

export const AdminStudio: React.FC<AdminStudioProps> = ({
  catalog,
  basePath,
  onRefreshCatalog,
  onOpenPublicGame,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('library');
  const [selectedSlug, setSelectedSlug] = useState<string>(
    catalog[0]?.slug || 'astro-drift'
  );

  // Server bootstrap state
  const [localStudioOnline, setLocalStudioOnline] = useState<boolean>(true);
  const [providers, setProviders] = useState<{
    geminiConfigured: boolean;
    geminiModel: string;
    localLlmConfigured: boolean;
    githubTokenConfigured: boolean;
  }>({
    geminiConfigured: false,
    geminiModel: 'gemini-3.8-flash',
    localLlmConfigured: false,
    githubTokenConfigured: false,
  });

  const [githubConfig, setGithubConfig] = useState<GitHubConfig>({
    owner: 'jro9i',
    repo: 'jro9i-games',
    branch: 'main',
    pagesBasePath: '/jro9i-games/',
    allowRemoteCommit: false,
    deploymentPath: '/',
  });

  // Selected game files & validation
  const [gameFiles, setGameFiles] = useState<GameFile[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [previewKey, setPreviewKey] = useState<number>(0);

  // Editable metadata for selected game
  const selectedGame =
    catalog.find((g) => g.slug === selectedSlug) || catalog[0] || null;
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editCategory, setEditCategory] = useState<GameCategory>('Action');
  const [editTags, setEditTags] = useState('');
  const [editControls, setEditControls] = useState('');

  // Publishing & Dry-Run state
  const [activeCommitPlan, setActiveCommitPlan] = useState<CommitPlan | null>(null);
  const [lastPublishResult, setLastPublishResult] =
    useState<PublishExecutionResult | null>(null);
  const [publishingState, setPublishingState] = useState<PublishStatus | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // AI Game Studio state
  const [aiPrompt, setAiPrompt] = useState(PROMPT_PRESETS[0].prompt);
  const [aiTitle, setAiTitle] = useState(PROMPT_PRESETS[0].title);
  const [aiCategory, setAiCategory] = useState<GameCategory>('Action');
  const [aiEngine, setAiEngine] = useState<GameEngineType>('html5-canvas');
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastChangeSummary, setLastChangeSummary] = useState<string>('');

  // ZIP Upload state
  const [zipTitle, setZipTitle] = useState('Imported Arcade Classic');
  const [zipCategory, setZipCategory] = useState<GameCategory>('Arcade');
  const [zipScanResult, setZipScanResult] = useState<string>('');

  // Load studio bootstrap info
  const fetchBootstrap = async () => {
    try {
      const res = await fetch('/api/admin/bootstrap');
      if (!res.ok) throw new Error('Static environment');
      const data = await res.json();
      setLocalStudioOnline(Boolean(data.localStudioAvailable));
      if (data.providers) setProviders(data.providers);
      if (data.githubConfig) setGithubConfig(data.githubConfig);
    } catch {
      setLocalStudioOnline(false);
    }
  };

  useEffect(() => {
    fetchBootstrap();
  }, []);

  // Sync form fields when selected game changes
  useEffect(() => {
    if (!selectedGame) return;
    setEditTitle(selectedGame.title);
    setEditDesc(selectedGame.description);
    setEditInstructions(selectedGame.instructions);
    setEditCategory(selectedGame.category);
    setEditTags(selectedGame.tags.join(', '));
    setEditControls(selectedGame.controls.join('\n'));

    // Load game files and validation report from local studio server
    fetch(`/api/admin/games/${selectedGame.slug}/files`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.files) {
          setGameFiles(data.files);
          setActiveFileIndex(0);
        }
        if (data?.validation) {
          setValidationReport(data.validation);
        }
      })
      .catch(() => {});
  }, [selectedGame?.slug]);

  const handleSaveMetadataAndFiles = async () => {
    if (!selectedGame) return;
    setStatusBanner({ type: 'info', text: 'Validating game bundle and saving changes...' });
    try {
      const res = await fetch(`/api/admin/games/${selectedGame.slug}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            title: editTitle,
            description: editDesc,
            instructions: editInstructions,
            category: editCategory,
            tags: editTags
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean),
            controls: editControls
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean),
          },
          files: gameFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to validate and stage changes.');
      }
      setValidationReport(data.validation);
      setPreviewKey((k) => k + 1);
      await onRefreshCatalog();
      setStatusBanner({
        type: 'success',
        text: `Saved and validated "${editTitle}" (${gameFiles.length} files). Ready for GitHub commit preview.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDryRunCommitPlan = async (slugToPlan = selectedGame?.slug) => {
    if (!slugToPlan) return;
    setPublishingState('validating');
    try {
      const res = await fetch('/api/admin/github/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slugToPlan }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Dry-run validation failed.');
      }
      setActiveCommitPlan(data.plan);
      setPublishingState(null);
      setStatusBanner({
        type: 'success',
        text: `Dry-Run Commit Plan generated for "${data.plan.gameTitle}": ${data.plan.files.length} repository files staged.`,
      });
    } catch (err) {
      setPublishingState('failed');
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handlePublishToGitHub = async (
    slugToPublish = selectedGame?.slug,
    simulateFailure = false
  ) => {
    if (!slugToPublish) return;
    setPublishingState('validating');
    setStatusBanner({
      type: 'info',
      text: simulateFailure
        ? `Running simulated failed deployment check for "${slugToPublish}"...`
        : `Publishing "${slugToPublish}" through GitHub pipeline...`,
    });

    try {
      setPublishingState('committing');
      const res = await fetch('/api/admin/github/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slugToPublish, simulateFailure }),
      });
      const data = await res.json();
      if (data.result) {
        setLastPublishResult(data.result);
        setActiveCommitPlan(data.result.commitPlan);
      }
      await onRefreshCatalog();

      if (!res.ok || !data.ok) {
        setPublishingState('failed');
        setStatusBanner({
          type: 'error',
          text:
            data.error ||
            data.result?.error ||
            'Deployment failed — game was NOT marked Published.',
        });
        return;
      }

      setPublishingState(data.result.finalStatus);
      setStatusBanner({
        type: 'success',
        text:
          data.result.finalStatus === 'published'
            ? `"${slugToPublish}" is now Published and live in data/games.json!`
            : `"${slugToPublish}" committed (${data.result.commitSha?.slice(0, 7)}) — awaiting GitHub Pages deployment completion.`,
      });
    } catch (err) {
      setPublishingState('failed');
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleAiGenerate = async (isRevision = false) => {
    setIsGenerating(true);
    setStatusBanner({
      type: 'info',
      text: isRevision
        ? 'Applying AI revision to game files and re-validating...'
        : 'Generating HTML5 game project with Gemini AI...',
    });

    try {
      const res = await fetch('/api/admin/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          title: aiTitle,
          category: aiCategory,
          engine: aiEngine,
          existingSlug: isRevision ? selectedGame?.slug : undefined,
          revisionPrompt: isRevision ? revisionPrompt : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'AI generation failed.');
      }

      await onRefreshCatalog();
      setSelectedSlug(data.metadata.slug);
      setGameFiles(data.files || []);
      setActiveFileIndex(0);
      setValidationReport(data.validation);
      setLastChangeSummary(
        `[AI Provider: ${data.aiProviderUsed}] ${data.changeSummary}`
      );
      setPreviewKey((k) => k + 1);
      setRevisionPrompt('');
      setStatusBanner({
        type: 'success',
        text: `Generated "${data.metadata.title}" via ${data.aiProviderUsed}. Review files and preview below before publishing.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateStarterBlueprint = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/admin/games/starter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: aiTitle || 'Starlight Defender',
          category: aiCategory,
          engine: aiEngine,
          description: aiPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to create starter blueprint.');
      }
      await onRefreshCatalog();
      setSelectedSlug(data.metadata.slug);
      setGameFiles(data.files || []);
      setActiveFileIndex(0);
      setValidationReport(data.validation);
      setLastChangeSummary(data.changeSummary);
      setPreviewKey((k) => k + 1);
      setStatusBanner({
        type: 'success',
        text: `Created playable starter blueprint "${data.metadata.title}" (Template — No AI provider ran).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleZipFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result).split(',')[1] || '';
      try {
        const res = await fetch('/api/admin/games/upload-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            zipBase64: base64,
            title: zipTitle || file.name.replace(/\.zip$/i, ''),
            category: zipCategory,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setZipScanResult(`BLOCKED: ${data.error}`);
          setStatusBanner({ type: 'error', text: `ZIP rejected: ${data.error}` });
          return;
        }
        await onRefreshCatalog();
        setSelectedSlug(data.metadata.slug);
        setZipScanResult(
          `PASSED: Extracted ${data.files.length} files (${data.validation.totalBytes} bytes) into games/${data.metadata.slug}/.`
        );
        setStatusBanner({
          type: 'success',
          text: `ZIP archive validated and staged as "${data.metadata.title}".`,
        });
      } catch (err) {
        setZipScanResult(
          `ERROR: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveGitHubConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(githubConfig),
      });
      const data = await res.json();
      if (data.githubConfig) setGithubConfig(data.githubConfig);
      setStatusBanner({
        type: 'success',
        text: `Updated GitHub repository target: ${githubConfig.owner}/${githubConfig.repo} (${githubConfig.branch}).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleGameAction = async (slug: string, action: 'unpublish' | 'remove') => {
    try {
      const res = await fetch(`/api/admin/games/${slug}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await onRefreshCatalog();
        setStatusBanner({
          type: 'info',
          text:
            action === 'unpublish'
              ? `Unpublished "${slug}" back to Draft status.`
              : `Removed "${slug}" from catalog.`,
        });
      }
    } catch {}
  };

  return (
    <div className="min-h-[calc(100vh-65px)] flex flex-col lg:flex-row bg-[#0B0F17]">
      {/* Left Workspace Sidebar (260px on desktop) */}
      <aside
        aria-label="Administrator Studio Navigation"
        className="w-full lg:w-[260px] shrink-0 bg-[#0F172A] border-b lg:border-b-0 lg:border-r border-slate-800 p-5 flex flex-col justify-between gap-6"
      >
        <div className="space-y-6">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-amber-400">
              Sole Administrator Console
            </div>
            <h1 className="text-lg font-bold text-slate-100">
              Local Publishing Studio
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Option B Architecture: Commits from local studio to GitHub while public Pages stays 100% static.
            </p>
          </div>

          <nav className="flex lg:flex-col gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'library'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <FolderGit2 className="w-4 h-4 shrink-0" />
              Game Library & Publish
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ai-studio')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'ai-studio'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <Wand2 className="w-4 h-4 shrink-0" />
              AI Game Studio
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('zip-import')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'zip-import'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <Upload className="w-4 h-4 shrink-0" />
              ZIP Import & Security
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('github-settings')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'github-settings'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <GitCommit className="w-4 h-4 shrink-0" />
              GitHub & Actions Setup
            </button>
          </nav>
        </div>

        {/* Studio Environment Summary */}
        <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-2 text-xs">
          <div className="font-semibold text-slate-200">Environment Status</div>
          <div className="space-y-1 text-slate-400 font-mono text-[11px]">
            <div>
              Studio Server: {localStudioOnline ? 'Connected' : 'Static Read-Only'}
            </div>
            <div>
              Gemini AI: {providers.geminiConfigured ? 'Ready' : 'Env Not Set'}
            </div>
            <div>
              GitHub PAT: {providers.githubTokenConfigured ? 'Loaded' : 'Dry-Run Mode'}
            </div>
            <div>
              Remote Push:{' '}
              {githubConfig.allowRemoteCommit ? 'Unlocked' : 'Safety Locked'}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Studio Content Canvas */}
      <div className="flex-1 p-6 lg:p-8 space-y-8 overflow-y-auto max-w-[1220px]">
        {/* Status Banner */}
        {statusBanner && (
          <div
            role="status"
            className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-4 ${
              statusBanner.type === 'error'
                ? 'bg-red-950/50 border-red-800 text-red-200'
                : statusBanner.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                : 'bg-slate-900 border-slate-700 text-slate-200'
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Publishing Pipeline Progress Strip */}
        <section
          aria-label="Publishing Workflow State Machine"
          className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-200">
              Publishing Pipeline Status —{' '}
              <span className="text-amber-400">
                {selectedGame?.title || 'Select a Game'}
              </span>
            </div>
            <div className="text-xs text-slate-400 font-mono tabular-nums">
              Current State:{' '}
              <strong className="uppercase text-slate-100">
                {publishingState || selectedGame?.status || 'draft'}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1">
            {([...PIPELINE_STEPS, 'failed'] as PublishStatus[]).map((step) => {
              const current = publishingState || selectedGame?.status || 'draft';
              const isCurrent = current === step;
              const stepIdx = PIPELINE_STEPS.indexOf(step);
              const curIdx = PIPELINE_STEPS.indexOf(current);
              const isPassed = stepIdx !== -1 && curIdx > stepIdx && current !== 'failed';

              return (
                <div
                  key={step}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold capitalize flex items-center justify-between ${
                    step === 'failed' && isCurrent
                      ? 'bg-red-950/60 border-red-700 text-red-200'
                      : isCurrent
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : isPassed
                      ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300'
                      : 'bg-slate-900/60 border-slate-800 text-slate-500'
                  }`}
                >
                  <span>{step}</span>
                  {isPassed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {step === 'failed' && isCurrent && (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* TAB 1: GAME LIBRARY & PUBLISHING PIPELINE */}
        {activeTab === 'library' && (
          <div className="space-y-8">
            <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    Game Catalog & Draft Repository
                  </h2>
                  <p className="text-xs text-slate-400">
                    Games are only visible in the public catalog when status is{' '}
                    <code className="text-emerald-400">published</code> after deployment verification.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('ai-studio')}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Create New Game with AI
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                      <th className="py-3 px-5">Game Title & Slug</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Provenance</th>
                      <th className="py-3 px-4">Pipeline Status</th>
                      <th className="py-3 px-4">Commit SHA</th>
                      <th className="py-3 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {catalog.map((item) => {
                      const isSelected = item.slug === selectedGame?.slug;
                      return (
                        <tr
                          key={item.slug}
                          onClick={() => setSelectedSlug(item.slug)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                          }`}
                        >
                          <td className="py-3.5 px-5">
                            <div className="font-bold text-slate-100">{item.title}</div>
                            <div className="font-mono text-[11px] text-slate-400">
                              /{item.path}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-300">{item.category}</td>
                          <td className="py-3.5 px-4 text-slate-400">
                            {item.aiGenerated
                              ? `AI (${item.aiProvider || 'gemini'})`
                              : 'Template / ZIP'}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`font-mono font-semibold uppercase ${
                                item.status === 'published'
                                  ? 'text-emerald-400'
                                  : item.status === 'failed'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-slate-400">
                            {item.lastCommitSha ? item.lastCommitSha.slice(0, 7) : '—'}
                          </td>
                          <td
                            className="py-3.5 px-5 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Dry-Run ${item.title}`}
                                onClick={() => {
                                  setSelectedSlug(item.slug);
                                  handleDryRunCommitPlan(item.slug);
                                }}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Dry-Run
                              </button>
                              <button
                                type="button"
                                aria-label={`Publish ${item.title} to GitHub`}
                                onClick={() => {
                                  setSelectedSlug(item.slug);
                                  handlePublishToGitHub(item.slug, false);
                                }}
                                className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Publish to GitHub
                              </button>
                              {item.status === 'published' && (
                                <button
                                  type="button"
                                  aria-label={`Unpublish ${item.title}`}
                                  onClick={() => handleGameAction(item.slug, 'unpublish')}
                                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  Unpublish
                                </button>
                              )}
                              <a
                                href={`/api/admin/games/${item.slug}/export-zip`}
                                download={`${item.slug}.zip`}
                                aria-label={`Export ${item.title} ZIP`}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              <button
                                type="button"
                                onClick={() => handleGameAction(item.slug, 'remove')}
                                aria-label={`Remove ${item.title}`}
                                className="p-1.5 bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Game Inspector: Metadata Editor + Sandboxed Preview + Commit Plan */}
            {selectedGame && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Metadata & Controls Editor */}
                <div className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-slate-100 truncate">
                      Metadata & Controls — {selectedGame.title}
                    </h3>
                    <span className="text-xs font-mono text-slate-400 whitespace-nowrap shrink-0">
                      slug: {selectedGame.slug}
                    </span>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <label
                        htmlFor="meta-title-input"
                        className="block text-slate-300 font-semibold mb-1.5"
                      >
                        Game Title
                      </label>
                      <input
                        id="meta-title-input"
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="meta-category-select"
                          className="block text-slate-300 font-semibold mb-1.5"
                        >
                          Category
                        </label>
                        <select
                          id="meta-category-select"
                          value={editCategory}
                          onChange={(e) =>
                            setEditCategory(e.target.value as GameCategory)
                          }
                          className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                        >
                          <option value="Action">Action</option>
                          <option value="Arcade">Arcade</option>
                          <option value="3D">3D</option>
                          <option value="Puzzle">Puzzle</option>
                          <option value="Strategy">Strategy</option>
                          <option value="Sports">Sports</option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="meta-tags-input"
                          className="block text-slate-300 font-semibold mb-1.5"
                        >
                          Tags (comma-separated)
                        </label>
                        <input
                          id="meta-tags-input"
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="meta-desc-input"
                        className="block text-slate-300 font-semibold mb-1.5"
                      >
                        Description
                      </label>
                      <textarea
                        id="meta-desc-input"
                        rows={2}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="meta-instructions-input"
                        className="block text-slate-300 font-semibold mb-1.5"
                      >
                        Gameplay Instructions
                      </label>
                      <textarea
                        id="meta-instructions-input"
                        rows={2}
                        value={editInstructions}
                        onChange={(e) => setEditInstructions(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="meta-controls-input"
                        className="block text-slate-300 font-semibold mb-1.5"
                      >
                        Controls (one per line)
                      </label>
                      <textarea
                        id="meta-controls-input"
                        rows={3}
                        value={editControls}
                        onChange={(e) => setEditControls(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleSaveMetadataAndFiles}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Validate & Stage Changes
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDryRunCommitPlan(selectedGame.slug)}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Dry-Run Commit Plan
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePublishToGitHub(selectedGame.slug, false)}
                        className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Publish to GitHub
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Sandboxed Preview & Validation Summary */}
                <div className="lg:col-span-6 space-y-6">
                  <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-slate-200 truncate">
                        Sandboxed Preview — /{selectedGame.path}index.html
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewKey((k) => k + 1)}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Reload
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenPublicGame(selectedGame.slug)}
                          className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" /> Open Portal Page
                        </button>
                      </div>
                    </div>
                    <div className="aspect-[16/9] bg-slate-950">
                      <iframe
                        key={`${selectedGame.slug}-${previewKey}`}
                        src={resolvePagesUrl(basePath, `${selectedGame.path}index.html`)}
                        title={`Preview ${selectedGame.title}`}
                        sandbox="allow-scripts allow-pointer-lock"
                        className="w-full h-full border-0"
                      />
                    </div>
                  </div>

                  {/* Bundle Security & Validation Report */}
                  {validationReport && (
                    <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-100">
                          Bundle Security & Static Validation
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            validationReport.valid ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {validationReport.valid ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px] text-slate-300">
                        <div className="p-2.5 bg-slate-900 rounded-lg">
                          Entry: {validationReport.entryPointFound ? 'index.html' : 'Missing'}
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg">
                          Files: {validationReport.totalFiles} ({validationReport.totalBytes} B)
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg">
                          Subpath Safe: {validationReport.subpathCompatible ? 'Yes' : 'No'}
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg">
                          Secret Scan: {validationReport.securityPassed ? 'Clean' : 'Blocked'}
                        </div>
                      </div>
                      {validationReport.issues.length > 0 && (
                        <ul className="space-y-1 text-amber-300 font-mono text-[11px]">
                          {validationReport.issues.map((iss, i) => (
                            <li key={i}>
                              [{iss.severity.toUpperCase()}] {iss.code}: {iss.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Commit Plan Dry-Run & Deployment Logs Viewer */}
            {(activeCommitPlan || lastPublishResult) && (
              <div className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      GitHub Commit Plan & Deployment Audit
                    </h3>
                    {activeCommitPlan && (
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        Target: {activeCommitPlan.targetRepo} ({activeCommitPlan.targetBranch}) ·{' '}
                        Message: &ldquo;{activeCommitPlan.commitMessage}&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handlePublishToGitHub(selectedGame?.slug, true)
                      }
                      className="px-3 py-1.5 bg-slate-800 hover:bg-red-950/70 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Test Failed Deployment Guard
                    </button>
                  </div>
                </div>

                {activeCommitPlan && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 px-3">Action</th>
                          <th className="py-2 px-3">Repository Path</th>
                          <th className="py-2 px-3">Git Blob SHA-1</th>
                          <th className="py-2 px-3 text-right">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {activeCommitPlan.files.map((f) => (
                          <tr key={f.repoPath}>
                            <td className="py-2 px-3 text-amber-400 uppercase">
                              {f.action}
                            </td>
                            <td className="py-2 px-3 text-slate-200">{f.repoPath}</td>
                            <td className="py-2 px-3 text-slate-400">
                              {f.sha1.slice(0, 12)}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-300 tabular-nums">
                              {f.sizeBytes} B
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {lastPublishResult && (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs font-mono">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                      <span>
                        Final Status:{' '}
                        <strong
                          className={
                            lastPublishResult.finalStatus === 'published'
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }
                        >
                          {lastPublishResult.finalStatus.toUpperCase()}
                        </strong>
                      </span>
                      {lastPublishResult.commitUrl && (
                        <a
                          href={lastPublishResult.commitUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                        >
                          Commit {lastPublishResult.commitSha?.slice(0, 7)}{' '}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {lastPublishResult.workflowRunUrl && (
                        <a
                          href={lastPublishResult.workflowRunUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                        >
                          GitHub Actions Run <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-slate-400 space-y-1 pt-2 border-t border-slate-800">
                      {lastPublishResult.logs.map((log, i) => (
                        <div key={i}>{log}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AI GAME STUDIO */}
        {activeTab === 'ai-studio' && (
          <div className="space-y-8">
            <div className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-100">
                    AI Browser Game Studio
                  </h2>
                  <p className="text-xs text-slate-400">
                    Describe your game in natural language. Generated code is validated for relative paths, entry point, and sandbox safety before preview.
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-300 bg-slate-900 px-3.5 py-2 rounded-xl border border-slate-800">
                  Provider:{' '}
                  {providers.geminiConfigured
                    ? `Gemini AI (${providers.geminiModel})`
                    : 'No API Key — Blueprint Mode Available'}
                </div>
              </div>

              {/* Preset Prompts */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-400">
                  Quick Studio Presets:
                </span>
                <div className="flex flex-wrap gap-2">
                  {PROMPT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setAiTitle(preset.title);
                        setAiCategory(preset.category);
                        setAiEngine(preset.engine);
                        setAiPrompt(preset.prompt);
                      }}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <label
                    htmlFor="ai-game-title"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Game Title
                  </label>
                  <input
                    id="ai-game-title"
                    type="text"
                    value={aiTitle}
                    onChange={(e) => setAiTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="ai-game-category"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Category
                  </label>
                  <select
                    id="ai-game-category"
                    value={aiCategory}
                    onChange={(e) =>
                      setAiCategory(e.target.value as GameCategory)
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="Action">Action</option>
                    <option value="Arcade">Arcade</option>
                    <option value="3D">3D</option>
                    <option value="Puzzle">Puzzle</option>
                    <option value="Strategy">Strategy</option>
                    <option value="Sports">Sports</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="ai-game-engine"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Target Runtime / Engine
                  </label>
                  <select
                    id="ai-game-engine"
                    value={aiEngine}
                    onChange={(e) =>
                      setAiEngine(e.target.value as GameEngineType)
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="html5-canvas">HTML5 Canvas & JavaScript</option>
                    <option value="threejs-webgl">Three.js / 3D WebGL</option>
                    <option value="typescript-canvas">TypeScript Compiled Canvas</option>
                    <option value="arcade-2d">2D Arcade State Engine</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="ai-game-prompt"
                  className="block text-xs text-slate-300 font-semibold mb-1.5"
                >
                  Natural Language Game Specification
                </label>
                <textarea
                  id="ai-game-prompt"
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe gameplay mechanics, controls, visual theme, scoring rules, and win/loss conditions..."
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleAiGenerate(false)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Wand2 className="w-4 h-4" />
                  {isGenerating ? 'Generating Game...' : 'Generate Game with Gemini AI'}
                </button>

                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={handleCreateStarterBlueprint}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileCode2 className="w-4 h-4" />
                  Generate Starter Blueprint (No AI)
                </button>
              </div>

              {lastChangeSummary && (
                <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 font-mono">
                  {lastChangeSummary}
                </div>
              )}
            </div>

            {/* Generated File Inspector + Live Preview + Revision Controls */}
            {selectedGame && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Code Inspector */}
                <div className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                  <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-2 overflow-x-auto">
                    <div className="flex items-center gap-1.5">
                      {gameFiles.map((file, idx) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => setActiveFileIndex(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono cursor-pointer whitespace-nowrap shrink-0 ${
                            activeFileIndex === idx
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {file.path}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveMetadataAndFiles}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Save File Edits
                    </button>
                  </div>

                  <textarea
                    aria-label="Game source file editor"
                    value={gameFiles[activeFileIndex]?.content || ''}
                    onChange={(e) => {
                      const next = [...gameFiles];
                      if (next[activeFileIndex]) {
                        next[activeFileIndex] = {
                          ...next[activeFileIndex],
                          content: e.target.value,
                        };
                        setGameFiles(next);
                      }
                    }}
                    className="w-full h-[380px] p-4 bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed focus:outline-none resize-none"
                  />
                </div>

                {/* Sandboxed Preview & Revision Prompt */}
                <div className="lg:col-span-6 space-y-6">
                  <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">
                        Isolated Sandbox Preview — {selectedGame.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPreviewKey((k) => k + 1)}
                        className="text-xs text-amber-400 hover:underline cursor-pointer"
                      >
                        Reload Iframe
                      </button>
                    </div>
                    <div className="aspect-[16/9] bg-slate-950">
                      <iframe
                        key={`ai-${selectedGame.slug}-${previewKey}`}
                        src={resolvePagesUrl(basePath, `${selectedGame.path}index.html`)}
                        title={`AI Studio Preview ${selectedGame.title}`}
                        sandbox="allow-scripts allow-pointer-lock"
                        className="w-full h-full border-0"
                      />
                    </div>
                  </div>

                  <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4">
                    <label
                      htmlFor="ai-revision-input"
                      className="block text-xs font-bold text-slate-200"
                    >
                      Request Revision Before Publishing
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="ai-revision-input"
                        type="text"
                        value={revisionPrompt}
                        onChange={(e) => setRevisionPrompt(e.target.value)}
                        placeholder="e.g., Increase ship speed by 30% and add a boss wave at 500 points..."
                        className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100"
                      />
                      <button
                        type="button"
                        disabled={isGenerating || !revisionPrompt.trim()}
                        onClick={() => handleAiGenerate(true)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-400 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Revise with AI
                      </button>
                    </div>

                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('library');
                          handleDryRunCommitPlan(selectedGame.slug);
                        }}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Review Commit Plan
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('library');
                          handlePublishToGitHub(selectedGame.slug, false);
                        }}
                        className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Approve & Publish to GitHub
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ZIP IMPORT & SECURITY VALIDATION */}
        {activeTab === 'zip-import' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-100">
                  Upload HTML5 Game ZIP Archive
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Every uploaded archive is treated as untrusted code. Archives are scanned in memory before any file touches disk.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label
                    htmlFor="zip-game-title"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Target Game Title
                  </label>
                  <input
                    id="zip-game-title"
                    type="text"
                    value={zipTitle}
                    onChange={(e) => setZipTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="zip-game-category"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Category
                  </label>
                  <select
                    id="zip-game-category"
                    value={zipCategory}
                    onChange={(e) =>
                      setZipCategory(e.target.value as GameCategory)
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="Arcade">Arcade</option>
                    <option value="Action">Action</option>
                    <option value="3D">3D</option>
                    <option value="Puzzle">Puzzle</option>
                    <option value="Strategy">Strategy</option>
                  </select>
                </div>
              </div>

              <div className="p-6 border-2 border-dashed border-slate-700 rounded-2xl text-center space-y-3 bg-slate-900/40">
                <Upload className="w-8 h-8 text-amber-400 mx-auto" />
                <div className="text-xs text-slate-300">
                  Select a <code className="text-amber-300">.zip</code> bundle containing a root{' '}
                  <code className="text-amber-300">index.html</code> and relative assets.
                </div>
                <label
                  htmlFor="zip-file-input"
                  className="inline-block px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Choose ZIP Archive
                </label>
                <input
                  id="zip-file-input"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={handleZipFileUpload}
                  className="sr-only"
                />
              </div>

              {zipScanResult && (
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-200">
                  {zipScanResult}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
                <ShieldAlert className="w-4 h-4" />
                <span>Untrusted Code & Safety Guarantees</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
                <li>
                  • <strong>No Server Execution:</strong> Game code is never executed on the publishing server; it is validated purely as static AST/text.
                </li>
                <li>
                  • <strong>Path Traversal Block:</strong> Any ZIP entry containing{' '}
                  <code>..</code>, leading <code>/</code>, or null bytes is rejected immediately.
                </li>
                <li>
                  • <strong>Secret & Credential Block:</strong> Files matching{' '}
                  <code>.env</code>, <code>.pem</code>, <code>id_rsa</code>, or containing GitHub/API token patterns are blocked from commits.
                </li>
                <li>
                  • <strong>Subpath Verification:</strong> Root-absolute asset paths (<code>src=&quot;/...&quot;</code>) that would fail under{' '}
                  <code>/repository-name/</code> on GitHub Pages are flagged automatically.
                </li>
                <li>
                  • <strong>Public Source Visibility Notice:</strong> GitHub Pages serves static files publicly; never include proprietary backend keys inside client game code.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 4: GITHUB & PAGES SETTINGS */}
        {activeTab === 'github-settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <form
              onSubmit={handleSaveGitHubConfig}
              className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-5 text-xs"
            >
              <div>
                <h2 className="text-xl font-bold text-slate-100">
                  GitHub Repository & Pages Subpath Configuration
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure your target repository and subpath settings. Credentials stay strictly in server-side environment variables.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="gh-owner"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Repository Owner / Organization
                  </label>
                  <input
                    id="gh-owner"
                    type="text"
                    value={githubConfig.owner}
                    onChange={(e) =>
                      setGithubConfig({ ...githubConfig, owner: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label
                    htmlFor="gh-repo"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Repository Name
                  </label>
                  <input
                    id="gh-repo"
                    type="text"
                    value={githubConfig.repo}
                    onChange={(e) =>
                      setGithubConfig({ ...githubConfig, repo: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="gh-branch"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    Target Branch
                  </label>
                  <input
                    id="gh-branch"
                    type="text"
                    value={githubConfig.branch}
                    onChange={(e) =>
                      setGithubConfig({ ...githubConfig, branch: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label
                    htmlFor="gh-basepath"
                    className="block text-slate-300 font-semibold mb-1.5"
                  >
                    GitHub Pages Base Path
                  </label>
                  <input
                    id="gh-basepath"
                    type="text"
                    value={githubConfig.pagesBasePath}
                    onChange={(e) =>
                      setGithubConfig({
                        ...githubConfig,
                        pagesBasePath: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-bold text-slate-200 flex items-center gap-2">
                    {githubConfig.allowRemoteCommit ? (
                      <Unlock className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Lock className="w-4 h-4 text-emerald-400" />
                    )}
                    Authorize Live Remote GitHub Commits
                  </div>
                  <p className="text-slate-400">
                    Keep locked to test staging and commit plans locally without modifying your remote GitHub repository.
                  </p>
                </div>
                <input
                  id="gh-allow-remote"
                  type="checkbox"
                  checked={githubConfig.allowRemoteCommit}
                  onChange={(e) =>
                    setGithubConfig({
                      ...githubConfig,
                      allowRemoteCommit: e.target.checked,
                    })
                  }
                  aria-label="Authorize Live Remote GitHub Commits"
                  className="w-5 h-5 accent-amber-500 cursor-pointer"
                />
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl cursor-pointer whitespace-nowrap shrink-0"
              >
                Save GitHub Configuration
              </button>
            </form>

            <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
              <h3 className="text-base font-bold text-slate-100">
                Manual GitHub Setup Checklist
              </h3>
              <ol className="space-y-3 text-slate-300 leading-relaxed list-decimal list-inside">
                <li>
                  In your GitHub repository, open{' '}
                  <strong>Settings → Pages</strong> and set{' '}
                  <strong>Build and deployment → Source</strong> to{' '}
                  <code className="text-amber-300">GitHub Actions</code>.
                </li>
                <li>
                  Open <strong>Settings → Actions → General</strong> and ensure{' '}
                  <strong>Workflow permissions</strong> allow read and write or use the least-privilege permissions defined in{' '}
                  <code className="text-amber-300">.github/workflows/deploy.yml</code>.
                </li>
                <li>
                  Create a <strong>Fine-Grained Personal Access Token</strong>{' '}
                  scoped strictly to your repository with{' '}
                  <code>Contents: Read &amp; Write</code> and{' '}
                  <code>Actions: Read-only</code>.
                </li>
                <li>
                  Place <code>GITHUB_TOKEN</code> and <code>GEMINI_API_KEY</code>{' '}
                  inside your local <code>.env</code> file (never inside client code) and run <code>npm run studio</code>.
                </li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
