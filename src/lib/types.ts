export type PublishStatus =
  | 'draft'
  | 'validating'
  | 'committing'
  | 'deploying'
  | 'published'
  | 'failed';

export type GameCategory =
  | 'Action'
  | 'Arcade'
  | 'Puzzle'
  | '3D'
  | 'Strategy'
  | 'Sports';

export type GameEngineType =
  | 'html5-canvas'
  | 'threejs-webgl'
  | 'typescript-canvas'
  | 'arcade-2d';

export interface GameCatalogItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  instructions: string;
  controls: string[];
  category: GameCategory;
  tags: string[];
  thumbnail: string;
  path: string;
  status: PublishStatus;
  featured?: boolean;
  engine?: GameEngineType;
  createdAt: string;
  updatedAt: string;
  version?: string;
  aiGenerated?: boolean;
  aiProvider?: string;
  lastCommitSha?: string;
  lastCommitUrl?: string;
  lastWorkflowRunUrl?: string;
  lastError?: string;
}

export interface GameFile {
  /** Path relative to the game's directory (e.g. "index.html", "assets/sprite.svg", "game.js") */
  path: string;
  /** UTF-8 string content or base64 encoded content */
  content: string;
  encoding?: 'utf-8' | 'base64';
  sizeBytes?: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  file?: string;
}

export interface ValidationReport {
  valid: boolean;
  checkedAt: string;
  entryPointFound: boolean;
  entryPointPath: string;
  totalFiles: number;
  totalBytes: number;
  assetReferencesChecked: number;
  missingAssets: string[];
  securityPassed: boolean;
  subpathCompatible: boolean;
  issues: ValidationIssue[];
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  pagesBasePath: string;
  allowRemoteCommit: boolean;
  deploymentPath: string;
}

export interface PlannedFileChange {
  repoPath: string;
  action: 'create' | 'update' | 'delete';
  sizeBytes: number;
  sha1: string;
  summary: string;
  contentPreview?: string;
}

export interface CommitPlan {
  id: string;
  createdAt: string;
  gameSlug: string;
  gameTitle: string;
  targetRepo: string;
  targetBranch: string;
  commitMessage: string;
  dryRun: boolean;
  securityScanPassed: boolean;
  files: PlannedFileChange[];
  catalogDiffSummary: string;
}

export interface PublishPipelineStep {
  id: PublishStatus;
  label: string;
  state: 'pending' | 'active' | 'completed' | 'error';
  detail?: string;
  timestamp?: string;
}

export interface PublishExecutionResult {
  success: boolean;
  finalStatus: PublishStatus;
  mode: 'dry-run' | 'local-stage' | 'github-remote';
  commitPlan: CommitPlan;
  commitSha?: string;
  commitUrl?: string;
  workflowRunId?: number;
  workflowRunUrl?: string;
  deployedUrl?: string;
  steps: PublishPipelineStep[];
  logs: string[];
  error?: string;
}
