import type {
  CostReport,
  DateRange,
  JobCost,
  MonthlyProjection,
  PriceTableUsdPerMinute,
  RunnerOs,
  WastedJobMinutes,
} from './types.js';

export const RUNNER_OS_VALUES: readonly RunnerOs[] = ['linux', 'windows', 'macos', 'self-hosted'];

/**
 * USD per minute for GitHub-hosted runners (standard, non-larger runners)
 * plus a flat estimate for self-hosted infrastructure cost.
 * Verify against GitHub's current pricing before relying on this for
 * real budgeting — rates change and larger/GPU runners are priced higher:
 * https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions
 */
export const DEFAULT_PRICE_PER_MINUTE_USD: PriceTableUsdPerMinute = {
  linux: 0.008,
  windows: 0.016,
  macos: 0.08,
  'self-hosted': 0.002,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const USD_DECIMALS = 4;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundUsd(value: number): number {
  return roundTo(value, USD_DECIMALS);
}

function isRunnerOs(value: string): value is RunnerOs {
  return (RUNNER_OS_VALUES as readonly string[]).includes(value);
}

export function resolvePriceTable(overrides: Partial<PriceTableUsdPerMinute> = {}): PriceTableUsdPerMinute {
  const table: PriceTableUsdPerMinute = { ...DEFAULT_PRICE_PER_MINUTE_USD };
  for (const os of RUNNER_OS_VALUES) {
    const override = overrides[os];
    if (override === undefined) {
      continue;
    }
    if (!Number.isFinite(override) || override < 0) {
      throw new Error(`Invalid price override for "${os}": ${override}. Must be a non-negative number.`);
    }
    table[os] = override;
  }
  return table;
}

/**
 * Parses the `--price-per-minute` flag value.
 * Accepts either a flat rate applied to every runner OS ("0.01") or
 * per-OS overrides ("linux=0.01,windows=0.02,macos=0.09,self-hosted=0.001").
 */
export function parsePricePerMinuteFlag(raw: string): Partial<PriceTableUsdPerMinute> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      'Invalid --price-per-minute value: expected a number (e.g. "0.01") or comma-separated os=price pairs (e.g. "linux=0.01,windows=0.02").',
    );
  }

  if (!trimmed.includes('=')) {
    const flat = Number(trimmed);
    if (!Number.isFinite(flat) || flat < 0) {
      throw new Error(`Invalid --price-per-minute value: "${raw}". Expected a non-negative number.`);
    }
    const overrides: Partial<PriceTableUsdPerMinute> = {};
    for (const os of RUNNER_OS_VALUES) {
      overrides[os] = flat;
    }
    return overrides;
  }

  const overrides: Partial<PriceTableUsdPerMinute> = {};
  for (const pair of trimmed.split(',')) {
    const [osRaw, priceRaw] = pair.split('=').map((part) => part.trim());
    if (!osRaw || priceRaw === undefined || priceRaw === '') {
      throw new Error(`Invalid --price-per-minute entry: "${pair}". Expected format "os=price".`);
    }
    if (!isRunnerOs(osRaw)) {
      throw new Error(
        `Invalid --price-per-minute runner "${osRaw}". Expected one of ${RUNNER_OS_VALUES.join(', ')}.`,
      );
    }
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(
        `Invalid --price-per-minute value for "${osRaw}": "${priceRaw}". Must be a non-negative number.`,
      );
    }
    overrides[osRaw] = price;
  }
  return overrides;
}

export function computeJobCosts(
  wastedJobs: readonly WastedJobMinutes[],
  priceTable: PriceTableUsdPerMinute,
): JobCost[] {
  return wastedJobs.map((job) => {
    const pricePerMinuteUsd = priceTable[job.runnerOs];
    return {
      jobId: job.jobId,
      jobName: job.jobName,
      runnerOs: job.runnerOs,
      wastedMinutes: job.wastedMinutes,
      pricePerMinuteUsd,
      costUsd: roundUsd(job.wastedMinutes * pricePerMinuteUsd),
      confidence: job.confidence,
    };
  });
}

export function sumCostUsd(jobs: readonly JobCost[]): number {
  return roundUsd(jobs.reduce((total, job) => total + job.costUsd, 0));
}

/**
 * Extrapolates a simple monthly cost from the total wasted spend observed
 * over the analyzed date range: total / analyzed-days * days-per-month.
 * A zero-width range is treated as one day to avoid an unbounded projection.
 */
export function projectMonthlyCost(totalCostUsd: number, range: DateRange, daysPerMonth = 30): MonthlyProjection {
  const spanMs = range.to.getTime() - range.from.getTime();
  if (spanMs < 0) {
    throw new Error('Invalid date range: "to" must not be before "from".');
  }

  const analyzedDays = Math.max(spanMs / MS_PER_DAY, 1);
  const dailyCostUsd = totalCostUsd / analyzedDays;

  return {
    analyzedDays: roundTo(analyzedDays, 2),
    totalCostUsd,
    projectedMonthlyCostUsd: roundUsd(dailyCostUsd * daysPerMonth),
  };
}

export interface BuildCostReportParams {
  wastedJobs: readonly WastedJobMinutes[];
  dateRange: DateRange;
  priceOverrides?: Partial<PriceTableUsdPerMinute>;
  daysPerMonth?: number;
}

export function buildCostReport(params: BuildCostReportParams): CostReport {
  const priceTable = resolvePriceTable(params.priceOverrides);
  const jobs = computeJobCosts(params.wastedJobs, priceTable);
  const totalCostUsd = sumCostUsd(jobs);
  const confirmedCostUsd = sumCostUsd(jobs.filter((job) => job.confidence === 'confirmed'));
  const likelyCostUsd = sumCostUsd(jobs.filter((job) => job.confidence === 'likely'));
  const projection = projectMonthlyCost(totalCostUsd, params.dateRange, params.daysPerMonth);

  return { jobs, totalCostUsd, confirmedCostUsd, likelyCostUsd, projection };
}
