export type OutputFormat = 'table' | 'json' | 'markdown';

export interface ScanOptions {
  repo: string;
  workflow?: string;
  limit: number;
  format: OutputFormat;
  priceOverrides?: Partial<PriceTableUsdPerMinute>;
  retryWindowMinutes: number;
}

export interface RawScanOptions {
  repo: string;
  workflow?: string;
  limit: string;
  format: string;
  pricePerMinute?: string;
  retryWindow?: string;
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  headSha: string;
  headBranch: string | null;
  /** Commit author email, falling back to the triggering actor's login. */
  authorId: string | null;
  runAttempt: number;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
}

export interface JobStepSummary {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface JobSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  runAttempt: number;
  labels: string[];
  steps: JobStepSummary[];
}

export type RunnerOs = 'linux' | 'windows' | 'macos' | 'self-hosted';

export type PriceTableUsdPerMinute = Record<RunnerOs, number>;

/**
 * "confirmed": same run, same commit SHA, an earlier attempt failed and a
 * later attempt (run_attempt > 1) succeeded — high-certainty evidence.
 * "likely": a failure on one commit followed by a success on a *different*
 * commit pushed to the same branch within the retry window — the
 * push-to-retry pattern, which is common but inferred rather than proven
 * (the fix could be a real code change instead of a flake).
 */
export type FlakyConfidence = 'confirmed' | 'likely';

export interface WastedJobMinutes {
  jobId: number;
  jobName: string;
  runnerOs: RunnerOs;
  wastedMinutes: number;
  confidence: FlakyConfidence;
}

export interface JobCost {
  jobId: number;
  jobName: string;
  runnerOs: RunnerOs;
  wastedMinutes: number;
  pricePerMinuteUsd: number;
  costUsd: number;
  confidence: FlakyConfidence;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MonthlyProjection {
  analyzedDays: number;
  totalCostUsd: number;
  projectedMonthlyCostUsd: number;
}

export interface CostReport {
  jobs: JobCost[];
  totalCostUsd: number;
  confirmedCostUsd: number;
  likelyCostUsd: number;
  projection: MonthlyProjection;
}

export interface FlakyJobStat {
  jobName: string;
  runnerOs: RunnerOs;
  flakyRuns: number;
  sampleSize: number;
  flakinessRate: number;
  wastedMinutes: number;
}

export interface LikelyFlakyDetectionResult {
  stats: FlakyJobStat[];
  /**
   * Finished runs (concrete success/failure conclusion) that were skipped
   * because GitHub didn't report a head branch for them — likely detection
   * can't group them, so they're invisible to it. Surfaced so the "likely"
   * numbers read as a floor, not an exact count.
   */
  excludedRunsMissingBranch: number;
}

export interface ReportJobRow {
  jobName: string;
  runnerOs: RunnerOs;
  confidence: FlakyConfidence;
  flakyRuns: number;
  sampleSize: number;
  flakinessRate: number;
  wastedMinutes: number;
  pricePerMinuteUsd: number;
  costUsd: number;
}

export interface ConfidenceBreakdown {
  wastedMinutes: number;
  costUsd: number;
}

export interface ScanReport {
  repo: string;
  workflow?: string;
  generatedAt: string;
  runsAnalyzed: number;
  dateRange: { from: string; to: string };
  retryWindowMinutes: number;
  jobs: ReportJobRow[];
  confirmed: ConfidenceBreakdown;
  likely: ConfidenceBreakdown;
  excludedRunsMissingBranch: number;
  totalWastedMinutes: number;
  totalCostUsd: number;
  analyzedDays: number;
  projectedMonthlyCostUsd: number;
}
