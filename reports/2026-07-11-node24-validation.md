# Node 24 migration validation — 2026-07-11

Actions Breakage Radar's Node 24 rules were run live against three public repositories at 2026-07-11T01:18:48Z using scanner SHA-256 `59f351d64f0e621b231e3f019ee59725c58be979b003f3d9baff0506aa8c6eaa`.

This is a small convenience validation, not a prevalence estimate.

## Results

| Repository | Active workflow files | Critical | Node 24 warnings |
| --- | ---: | ---: | ---: |
| [tsviz/actions-runner-telemetry](https://github.com/tsviz/actions-runner-telemetry) | 5 | 0 | 19 |
| [swimblocks/.github](https://github.com/swimblocks/.github) | 3 | 0 | 4 |
| [dolph/find-replace](https://github.com/dolph/find-replace) | 4 | 0 | 0 |

All 3 scans completed. The scanner read 12 active workflow files and produced 23 Node 24 migration warnings in two repositories.

Representative exact-line evidence:

- [`tsviz/actions-runner-telemetry` uses `actions/checkout@v4`](https://github.com/tsviz/actions-runner-telemetry/blob/main/.github/workflows/example-usage.yml#L23) and [`actions/upload-artifact@v4`](https://github.com/tsviz/actions-runner-telemetry/blob/main/.github/workflows/example-usage.yml#L88); the tagged actions declare Node 20, while `actions/checkout@v5` and `actions/upload-artifact@v6` declare Node 24.
- [`swimblocks/.github` uses `actions/checkout@v4`](https://github.com/swimblocks/.github/blob/main/.github/workflows/reconcile-repo-defaults.yml#L30) and [`actions/setup-python@v5`](https://github.com/swimblocks/.github/blob/main/.github/workflows/reconcile-repo-defaults.yml#L32); the suggested upgrades are `@v5` and `@v6` respectively.
- `dolph/find-replace`, which had a public issue about retired/EOL action versions, produced no current warnings in its four active workflows. This negative case is intentional.

GitHub's [official Node 20 deprecation notice](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) says runners began using Node 24 by default on June 16, 2026 and tells users to update workflows to action versions that run on Node 24.

## Directional demand signal

Authenticated GitHub code search observed 36,864 matches for `actions/checkout@v4`, 63,232 for `actions/github-script@v7`, 12,092 for `actions/cache@v4`, 8,052 for `actions/setup-python@v5`, 7,724 for `actions/setup-java@v4`, and 6,036 for `actions/setup-node@v4` in `.github/workflows` paths. Counts are point-in-time directional signals, can include forks or inactive files, and do not prove product adoption or willingness to pay.

The machine-readable validation result is in [`2026-07-11-node24-validation.json`](2026-07-11-node24-validation.json).
