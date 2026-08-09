# Contributing

## Setup

```bash
npm install
```

Requires Node 20+.

## Workflow

```bash
npm run build      # tsc (CLI/library) + esbuild bundle (GitHub Action)
npm test            # vitest
npm run typecheck   # tsc --noEmit, no build artifacts
```

CI (`.github/workflows/ci.yml`) runs all three on every push to `main`
and every pull request. Make sure they pass locally before opening a PR.

## Project layout

- `src/*.ts` — CLI, library, and Action source. `src/*.test.ts` are the
  matching vitest suites (colocated, not in a separate `test/` folder).
- `dist/` is gitignored **except `dist/action/`**: the GitHub Action
  (`action.yml`) runs `dist/action/index.cjs` directly from the repo, with
  no install step, so that one bundle must be committed. **If you change
  anything under `src/` that the action touches (`action.ts`,
  `action-entry.ts`, or anything they import), run `npm run build` and
  commit the resulting `dist/action/index.cjs` changes** — nothing
  currently checks for this automatically, so a stale bundle would ship
  silently.
- Snapshot tests (`report.test.ts`) use vitest snapshots under
  `src/__snapshots__/`. If a rendering change is intentional, update them
  with `npx vitest run -u`; review the diff before committing.

## Style

- No hardcoded tokens — auth is `GITHUB_TOKEN` from the environment only.
- No network calls other than the GitHub API.
- Prefer extending an existing module's narrow client interface (see
  `GitHubClient` in `github.ts`, `IssueCommentClient` in `pr-comment.ts`)
  over widening it, so unrelated tests don't need new mock methods.
