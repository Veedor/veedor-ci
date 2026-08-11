# Veedor CI

**Find the tests wasting your CI minutes — and see the bill they generate.**

Between 15% and 25% of a typical GitHub Actions bill is re-runs caused
by flaky tests. Veedor CI reads your workflow history, identifies which
specific jobs and tests are flaky, and quantifies exactly how much money
they're burning.

> 🔨 **Status: in active development.** Not yet published to npm.
> Watch this repo or follow the [blog](https://veedor.dev/blog) for the
> release announcement.

## What it will do

- **Detect re-runs**: same commit SHA, multiple attempts, fail → pass
  with zero code changes.
- **Detect push-to-retry**: fail on one commit, pass on the next commit
  pushed to the same branch — the pattern that same-SHA detection can't
  see, since developers usually push again instead of clicking "re-run".
- **Rank your flakiest jobs**: flakiness follows a power law — usually
  a handful of tests cause most of the waste.
- **Put a dollar figure on it**: minutes wasted × runner pricing =
  the line item GitHub doesn't show you.
- **Report where developers look**: CLI output, JSON, and a Markdown
  report ready for PR comments.

## How flakiness is detected

Veedor CI reports two confidence levels, and never blends them into a
single number without saying so:

- **Confirmed flaky** — the *same* commit (head SHA) was retried and
  passed: an earlier attempt of a run failed, a later attempt of that
  same run succeeded. This is hard evidence; nothing about the code
  changed between attempts.
- **Likely flaky** — a job failed on one commit and a job of the same
  name, on the same branch, **by the same commit author**, passed on
  the *very next* commit pushed within a configurable retry window
  (default 60 minutes, max 240). Requiring the same author is what
  turns this from a coincidence into a signal: on a busy shared branch,
  someone else's unrelated commit can easily pass right after your
  commit failed, and without matching authors that would be misread as
  a fix. This is the much more common "push-to-retry" pattern in real
  teams, but it's still inferred, not proven: the "fix" could have been
  a real code change instead of a flake. A run that already recovered
  via a same-SHA retry (confirmed) is never also counted as likely, so
  nothing is double-counted between the two categories.

Some finished runs don't report a branch (certain trigger types, mostly)
and can't be grouped for likely detection — they're excluded, and the
count of excluded runs is always shown in the report, so the "likely"
numbers read as a floor, not an exact count.

Every report — table, JSON, and markdown — breaks these out separately
with their own totals, plus a combined total.

## Planned usage

```bash
npx @veedor/ci scan --repo your-org/your-repo
```

### Options

| Flag                                | Default                       | Description                                                                                 |
| ------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `--repo <owner/name>`                | _(required)_                   | GitHub repository to scan.                                                                   |
| `--workflow <name>`                  | _(all workflows)_              | Limit the scan to a single workflow.                                                         |
| `--limit <n>`                        | `200`                          | Number of workflow runs to inspect.                                                          |
| `--format <table\|json\|markdown>`   | `table`                        | Output format.                                                                                |
| `--price-per-minute <value>`         | _(GitHub's published rates)_    | Override runner USD/min pricing: a flat rate (`0.01`) or per-os pairs (`linux=0.01,windows=0.02`). |
| `--retry-window <minutes>`           | `60`                            | Time window (max `240`) for detecting "likely flaky" push-to-retry patterns (fail on one commit, pass on the next by the same author). |

Auth is the `GITHUB_TOKEN` environment variable — there is no other way
to authenticate, and no token is ever read from a file or flag.

## GitHub Action

Veedor CI also ships as a GitHub Action that scans the repository it
runs in and, on pull requests, can post the report as a PR comment —
editing its previous comment in place instead of piling up new ones.

```yaml
# .github/workflows/veedor-ci.yml
name: Veedor CI

on:
  pull_request:

permissions:
  contents: read
  actions: read       # required to read workflow run and job history
  pull-requests: write # required only if comment-on-pr is true

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: Veedor/veedor-ci@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # workflow: ci.yml       # optional: limit the scan to one workflow
          limit: 200
          format: markdown
          retry-window: 60
          comment-on-pr: true
```

### Inputs

| Input           | Default   | Description                                                                                   |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `github-token`    | _(none)_  | GitHub token used to authenticate API requests. Falls back to the `GITHUB_TOKEN` env var if not set. |
| `workflow`        | _(all)_   | Limit the scan to a single workflow (file name or ID).                                          |
| `limit`           | `200`     | Number of workflow runs to inspect.                                                             |
| `format`          | `table`   | Output format for the workflow log: `table`, `json`, or `markdown`.                             |
| `retry-window`    | `60`      | Time window in minutes (max `240`) for detecting "likely flaky" push-to-retry patterns. See [How flakiness is detected](#how-flakiness-is-detected). |
| `comment-on-pr`   | `false`   | If `true` on a `pull_request`/`pull_request_target` event, publish the report as a PR comment.  |

The action resolves its token with the following precedence: the
`github-token` input, if set, wins; otherwise it falls back to the
`GITHUB_TOKEN` environment variable — the same variable the standalone
CLI reads. Either way, the default `secrets.GITHUB_TOKEN` provided by
the workflow is enough; no personal access token required. The
standalone CLI (outside of a GitHub Action) only ever reads the
`GITHUB_TOKEN` environment variable — it has no equivalent flag or
input.

## Free vs Pro

The scanner is and will remain **free and MIT-licensed**: scan any repo,
get the full report. **Pro** (planned) adds what requires persistence:
90-day history, trend tracking, automatic quarantine suggestions, and
an org-wide dashboard.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build/test/typecheck
commands, and notes on the committed GitHub Action bundle.

## About Veedor

Veedor builds tools that guard your pipeline's money and security.
Named after the *veedores* — colonial-era inspectors who verified
quality and compliance. Same job, five centuries later.
More at [veedor.dev](https://veedor.dev).

## License

MIT
