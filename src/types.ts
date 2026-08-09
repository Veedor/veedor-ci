export type OutputFormat = 'table' | 'json' | 'markdown';

export interface ScanOptions {
  repo: string;
  workflow?: string;
  limit: number;
  format: OutputFormat;
}

export interface RawScanOptions {
  repo: string;
  workflow?: string;
  limit: string;
  format: string;
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  headSha: string;
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
  steps: JobStepSummary[];
}

export type RunnerOs = 'linux' | 'windows' | 'macos' | 'self-hosted';

export type PriceTableUsdPerMinute = Record<RunnerOs, number>;

export interface WastedJobMinutes {
  jobId: number;
  jobName: string;
  runnerOs: RunnerOs;
  wastedMinutes: number;
}

export interface JobCost {
  jobId: number;
  jobName: string;
  runnerOs: RunnerOs;
  wastedMinutes: number;
  pricePerMinuteUsd: number;
  costUsd: number;
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
  projection: MonthlyProjection;
}
