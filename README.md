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
- **Rank your flakiest jobs**: flakiness follows a power law — usually
  a handful of tests cause most of the waste.
- **Put a dollar figure on it**: minutes wasted × runner pricing =
  the line item GitHub doesn't show you.
- **Report where developers look**: CLI output, JSON, and a Markdown
  report ready for PR comments.

## Planned usage

```bash
npx @veedor/ci scan --repo your-org/your-repo
```

## GitHub Action

Veedor CI also ships as a Node 20 GitHub Action that scans the repository
it runs in and, on pull requests, can post the report as a PR comment —
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
      - uses: veedor/veedor-ci@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          # workflow: ci.yml       # optional: limit the scan to one workflow
          limit: 200
          format: markdown
          comment-on-pr: true
```

### Inputs

| Input           | Default   | Description                                                                                   |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `workflow`        | _(all)_   | Limit the scan to a single workflow (file name or ID).                                          |
| `limit`           | `200`     | Number of workflow runs to inspect.                                                             |
| `format`          | `table`   | Output format for the workflow log: `table`, `json`, or `markdown`.                             |
| `comment-on-pr`   | `false`   | If `true` on a `pull_request`/`pull_request_target` event, publish the report as a PR comment.  |

The action authenticates purely via the `GITHUB_TOKEN` environment
variable — the same variable the CLI reads — so no separate token input
is needed. The default `secrets.GITHUB_TOKEN` provided by the workflow is
enough; no personal access token required.

## Free vs Pro

The scanner is and will remain **free and MIT-licensed**: scan any repo,
get the full report. **Pro** (planned) adds what requires persistence:
90-day history, trend tracking, automatic quarantine suggestions, and
an org-wide dashboard.

## About Veedor

Veedor builds tools that guard your pipeline's money and security.
Named after the *veedores* — colonial-era inspectors who verified
quality and compliance. Same job, five centuries later.
More at [veedor.dev](https://veedor.dev).

## License

MIT
