# Actions Breakage Radar

A zero-signup browser tool that scans public GitHub repositories for high-confidence GitHub Actions breakage risks.

Current checks:

- Retired GitHub-hosted runners: `ubuntu-20.04`, `windows-2019`, `macos-13`
- Blocked artifact actions: `actions/upload-artifact@v1-v3`, `actions/download-artifact@v1-v3`
- Node 24 migration warnings for ten common action major versions whose tagged `action.yml` still declares Node 20: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, `actions/cache@v4`, `actions/upload-artifact@v4-v5`, `actions/setup-java@v4`, `actions/github-script@v7`, `docker/setup-buildx-action@v3`, and `docker/login-action@v3`

GitHub runners began defaulting JavaScript actions to Node 24 on June 16, 2026. Every finding links to the exact workflow line and [GitHub's migration notice](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) or other official/public deprecation evidence. The browser scanner reads active workflows on the default branch through GitHub's public API and stores nothing.

## Monitor on every change

Add this workflow to get line-level workflow annotations and a job summary on pull requests and manual runs:

```yaml
name: Actions breakage radar
on:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - id: radar
        uses: jackwalkerlabs/actions-breakage-radar@v1
        with:
          fail-on-findings: false
```

The Action scans checked-out `.github/workflows/*.yml` and `.yaml` workflow files. It has no runtime dependencies and does not send repository contents anywhere. The default is advisory: findings create workflow annotations but do not fail the job. Set `fail-on-findings: true` only when you want any critical or migration finding to block the check.

For downstream automation, the `report-json` output is compact schema-versioned JSON. Separate `critical-findings`, `warnings`, `findings`, and `files-scanned` outputs support simple policy checks:

```yaml
- name: Read report
  env:
    RADAR_REPORT: ${{ steps.radar.outputs['report-json'] }}
  run: printf '%s\n' "$RADAR_REPORT" | jq .
```

The browser report has the same schema and can be downloaded with **Download JSON**. Both surfaces return `schemaVersion`, `repository`, `branch`, `filesScanned`, `counts`, and `findings`; repository context is `null` when the local Action runtime does not provide it.

## Public field scan

A documented 50-repository validation set completed 50 successful scans with zero failures and detected two known active blocked declarations. The set deliberately includes the two positive repositories and is not a prevalence estimate. Read the [2026-07-10 validation report](reports/2026-07-10-active-workflows.md) and its [machine-readable result](reports/2026-07-10-active-workflows.json).

The Node 24 rules also completed a [three-repository live validation](reports/2026-07-11-node24-validation.md): 12 active workflow files, 23 migration warnings across two positive repositories, one clean negative case, and zero scan failures. This small convenience set is also not a prevalence estimate; its [machine-readable result](reports/2026-07-11-node24-validation.json) preserves the exact counts, representative source lines, scanner checksum, and search-count limitations.

## Run

```bash
python3 -m http.server 8877
```

Open `http://127.0.0.1:8877`.

## Build and deploy

```bash
npm run build
npx --yes netlify-cli@26.2.0 deploy --prod
```

The production artifact contains only `index.html` and `scanner.js`. Netlify security headers are configured in `netlify.toml`.

## Test

```bash
npm test
```

The suite covers repository input parsing, workflow analysis, API report assembly, and required page disclosures.

## Limits

- Public repositories only
- GitHub's unauthenticated API rate limit applies
- Node 24 checks match the listed major-version tags; SHA-pinned and unlisted third-party actions are not resolved over the network
- Deliberately narrow checks; a clean report is not a guarantee that a workflow will pass
- Validate remediation changes in a branch before merging
