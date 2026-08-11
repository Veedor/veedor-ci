import type { ConfidenceBreakdown, FlakyConfidence, OutputFormat, ReportJobRow, ScanReport } from './types.js';

const TOP_MARKDOWN_JOBS = 5;

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatMinutes(value: number): string {
  return value.toFixed(2);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

const TABLE_HEADERS = ['Job', 'Runs', 'Flaky', 'Rate', 'Wasted min', 'USD'];

const CONFIRMED_LABEL = 'Confirmed flaky';
const LIKELY_LABEL = 'Likely flaky';
const CONFIRMED_EVIDENCE = 'same commit, retried and passed';

function likelyEvidence(retryWindowMinutes: number): string {
  return `push-to-retry pattern within ${retryWindowMinutes} min`;
}

function jobsByConfidence(report: ScanReport, confidence: FlakyConfidence): ReportJobRow[] {
  return report.jobs.filter((job) => job.confidence === confidence);
}

function jobToTableRow(job: ReportJobRow): string[] {
  return [
    job.jobName,
    String(job.sampleSize),
    String(job.flakyRuns),
    formatPercent(job.flakinessRate),
    formatMinutes(job.wastedMinutes),
    formatUsd(job.costUsd),
  ];
}

function renderTableSection(title: string, evidence: string, rows: ReportJobRow[], total: ConfidenceBreakdown): string[] {
  const lines: string[] = [];
  lines.push(`${title} (evidence: ${evidence})`);

  const tableRows = rows.map(jobToTableRow);
  const allRows = [TABLE_HEADERS, ...tableRows];
  const widths = TABLE_HEADERS.map((_, col) => Math.max(...allRows.map((row) => row[col]?.length ?? 0)));
  const formatRow = (row: string[]): string =>
    row.map((cell, col) => (col === 0 ? padRight(cell, widths[col]!) : padLeft(cell, widths[col]!))).join('  ');

  lines.push(formatRow(TABLE_HEADERS));
  lines.push(widths.map((width) => '-'.repeat(width)).join('  '));

  if (tableRows.length === 0) {
    lines.push('(none detected)');
  } else {
    for (const row of tableRows) {
      lines.push(formatRow(row));
    }
  }

  lines.push(`${title} total: ${formatMinutes(total.wastedMinutes)} min — ${formatUsd(total.costUsd)}`);

  return lines;
}

export function renderTable(report: ScanReport): string {
  const confirmedRows = jobsByConfidence(report, 'confirmed');
  const likelyRows = jobsByConfidence(report, 'likely');

  const lines: string[] = [];
  lines.push(`Veedor CI report for ${report.repo}${report.workflow ? ` (workflow: ${report.workflow})` : ''}`);
  lines.push(
    `Runs analyzed: ${report.runsAnalyzed} (${formatDate(report.dateRange.from)} to ${formatDate(
      report.dateRange.to,
    )}, ${report.analyzedDays.toFixed(1)} days)`,
  );
  lines.push(`Retry window for "likely flaky": ${report.retryWindowMinutes} min`);
  lines.push(
    `Runs excluded from "likely flaky" detection (no branch info): ${report.excludedRunsMissingBranch}`,
  );
  lines.push('');

  lines.push(...renderTableSection(CONFIRMED_LABEL, CONFIRMED_EVIDENCE, confirmedRows, report.confirmed));
  lines.push('');
  lines.push(...renderTableSection(LIKELY_LABEL, likelyEvidence(report.retryWindowMinutes), likelyRows, report.likely));
  lines.push('');

  lines.push(`Combined total wasted: ${formatMinutes(report.totalWastedMinutes)} min — ${formatUsd(report.totalCostUsd)}`);
  lines.push(`Projected monthly cost: ${formatUsd(report.projectedMonthlyCostUsd)}`);

  return lines.join('\n');
}

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}

function renderMarkdownSection(
  title: string,
  evidence: string,
  rows: ReportJobRow[],
  total: ConfidenceBreakdown,
): string[] {
  const top = rows.slice(0, TOP_MARKDOWN_JOBS);
  const lines: string[] = [];

  lines.push(`### ${title}`);
  lines.push('');
  lines.push(
    `_Evidence: ${evidence}._ Total: **${formatUsd(total.costUsd)}** (${formatMinutes(total.wastedMinutes)} min).`,
  );
  lines.push('');

  if (top.length === 0) {
    lines.push('No jobs detected in this category.');
  } else {
    lines.push('| Job | Runs | Flaky | Rate | Wasted min | USD |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const job of top) {
      lines.push(
        `| ${job.jobName} | ${job.sampleSize} | ${job.flakyRuns} | ${formatPercent(job.flakinessRate)} | ${formatMinutes(
          job.wastedMinutes,
        )} | ${formatUsd(job.costUsd)} |`,
      );
    }
    if (rows.length > top.length) {
      lines.push('');
      lines.push(`_...and ${rows.length - top.length} more._`);
    }
  }

  return lines;
}

export function renderMarkdown(report: ScanReport): string {
  const confirmedRows = jobsByConfidence(report, 'confirmed');
  const likelyRows = jobsByConfidence(report, 'likely');
  const lines: string[] = [];

  lines.push(`## Veedor CI report — ${report.repo}`);
  lines.push('');
  lines.push(
    `**Total wasted spend: ${formatUsd(report.totalCostUsd)}** across ${report.runsAnalyzed} runs analyzed ` +
      `(${formatDate(report.dateRange.from)} to ${formatDate(report.dateRange.to)}, ~${report.analyzedDays.toFixed(
        1,
      )} days) — projected **${formatUsd(report.projectedMonthlyCostUsd)}/month** if this trend holds.`,
  );
  lines.push('');
  lines.push(
    `> **Confidence levels:** _Confirmed_ = the same commit was retried and passed — hard evidence. ` +
      `_Likely_ = a failure was followed by a pass on the *next* commit pushed to the same branch within ` +
      `${report.retryWindowMinutes} min (push-to-retry) — a strong signal, but not proof: the "fix" could also ` +
      `have been a real code change rather than a flake.`,
  );
  lines.push('');
  lines.push(
    `<sub>${report.excludedRunsMissingBranch} run(s) excluded from "likely flaky" detection: no branch info reported.</sub>`,
  );
  lines.push('');

  lines.push(...renderMarkdownSection(CONFIRMED_LABEL, CONFIRMED_EVIDENCE, confirmedRows, report.confirmed));
  lines.push('');
  lines.push(...renderMarkdownSection(LIKELY_LABEL, likelyEvidence(report.retryWindowMinutes), likelyRows, report.likely));
  lines.push('');
  lines.push(
    `**Combined: ${formatUsd(report.totalCostUsd)}** (${formatMinutes(report.totalWastedMinutes)} min) across both categories.`,
  );
  lines.push('');
  lines.push(`<sub>Generated by veedor-ci on ${formatDate(report.generatedAt)}.</sub>`);

  return lines.join('\n');
}

export function renderReport(report: ScanReport, format: OutputFormat): string {
  switch (format) {
    case 'table':
      return renderTable(report);
    case 'json':
      return renderJson(report);
    case 'markdown':
      return renderMarkdown(report);
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported format: ${String(exhaustive)}`);
    }
  }
}
