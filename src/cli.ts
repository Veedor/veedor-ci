#!/usr/bin/env node
import { Command } from 'commander';
import { buildScanOptions } from './index.js';

const program = new Command();

program
  .name('veedor-ci')
  .description("Find the tests wasting your CI minutes — and see the bill they generate.")
  .version('0.1.0');

program
  .command('scan')
  .description("Scan a repository's workflow history for flaky, money-wasting tests.")
  .requiredOption('--repo <owner/name>', 'GitHub repository to scan, e.g. octocat/hello-world')
  .option('--workflow <name>', 'Limit the scan to a single workflow')
  .option('--limit <n>', 'Number of workflow runs to inspect', '200')
  .option('--format <table|json|markdown>', 'Output format', 'table')
  .action((options: { repo: string; workflow?: string; limit: string; format: string }) => {
    try {
      const config = buildScanOptions(options);
      console.log('Scan configuration:');
      console.log(JSON.stringify(config, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

program.parse();
