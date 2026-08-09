import { detectFlakyJobs } from './analyze.js';
import { buildCostReport, parsePricePerMinuteFlag } from './cost.js';
import { createOctokitFromEnv, listWorkflowRuns, type GitHubClient } from './github.js';
import type {
  DateRange,
  OutputFormat,
  RawScanOptions,
  ReportJobRow,
  ScanOptions,
  ScanReport,
  WastedJobMinutes,
  WorkflowRunSummary,
} from './types.js';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['table', 'json', 'markdown'];

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export function isValidRepo(repo: string): boolean {
  return REPO_PATTERN.test(repo);
}

export function isValidFormat(format: string): format is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(format);
}

export function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: "${value}". Must be a positive integer.`);
  }
  return parsed;
}

export function buildScanOptions(raw: RawScanOptions): ScanOptions {
  if (!isValidRepo(raw.repo)) {
    throw new Error(`Invalid repo: "${raw.repo}". Expected format "owner/name".`);
  }
  if (!isValidFormat(raw.format)) {
    throw new Error(`Invalid format: "${raw.format}". Expected one of ${OUTPUT_FORMATS.join(', ')}.`);
  }

  return {
    repo: raw.repo,
    workflow: raw.workflow,
    limit: parseLimit(raw.limit),
    format: raw.format,
    priceOverrides: raw.pricePerMinute === undefined ? undefined : parsePricePerMinuteFlag(raw.pricePerMinute),
  };
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo: "${repo}". Expected format "owner/name".`);
  }
  return { owner, repo: name };
}

function computeDateRange(runs: readonly WorkflowRunSummary[]): DateRange {
  if (runs.length === 0) {
    const now = new Date();
    return { from: now, to: now };
  }
  const createdTimes = runs.map((run) => new Date(run.createdAt).getTime());
  return {
    from: new Date(Math.min(...createdTimes)),
    to: new Date(Math.max(...createdTimes)),
  };
}

export interface RunScanDependencies {
  client?: GitHubClient;
}

export async function runScan(options: ScanOptions, deps: RunScanDependencies = {}): Promise<ScanReport> {
  const { owner, repo } = splitRepo(options.repo);
  const client = deps.client ?? createOctokitFromEnv();

  const runs = await listWorkflowRuns(client, { owner, repo, limit: options.limit, workflow: options.workflow });
  const flakyStats = await detectFlakyJobs(client, { owner, repo, runs });

  const wastedJobs: WastedJobMinutes[] = flakyStats.map((stat, index) => ({
    jobId: index + 1,
    jobName: stat.jobName,
    runnerOs: stat.runnerOs,
    wastedMinutes: stat.wastedMinutes,
  }));

  const dateRange = computeDateRange(runs);
  const costReport = buildCostReport({ wastedJobs, dateRange, priceOverrides: options.priceOverrides });

  const jobs: ReportJobRow[] = flakyStats
    .map((stat, index) => {
      const cost = costReport.jobs[index]!;
      return {
        jobName: stat.jobName,
        runnerOs: stat.runnerOs,
        flakyRuns: stat.flakyRuns,
        sampleSize: stat.sampleSize,
        flakinessRate: stat.flakinessRate,
        wastedMinutes: stat.wastedMinutes,
        pricePerMinuteUsd: cost.pricePerMinuteUsd,
        costUsd: cost.costUsd,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || a.jobName.localeCompare(b.jobName));

  return {
    repo: options.repo,
    workflow: options.workflow,
    generatedAt: new Date().toISOString(),
    runsAnalyzed: runs.length,
    dateRange: { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() },
    jobs,
    totalWastedMinutes: Math.round(jobs.reduce((sum, job) => sum + job.wastedMinutes, 0) * 100) / 100,
    totalCostUsd: costReport.totalCostUsd,
    analyzedDays: costReport.projection.analyzedDays,
    projectedMonthlyCostUsd: costReport.projection.projectedMonthlyCostUsd,
  };
}

export type { OutputFormat, RawScanOptions, ScanOptions };
