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

Or as a GitHub Action:

```yaml
- uses: veedor/veedor-ci@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

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
