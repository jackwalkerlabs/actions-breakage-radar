# Actions Breakage Radar

A zero-signup browser tool that scans public GitHub repositories for high-confidence GitHub Actions breakage risks.

Current checks:

- Retired GitHub-hosted runners: `ubuntu-20.04`, `windows-2019`, `macos-13`
- Blocked artifact actions: `actions/upload-artifact@v1-v3`, `actions/download-artifact@v1-v3`

Every finding links to the exact workflow line and official/public deprecation evidence. The scanner reads active workflows on the default branch through GitHub's public API and stores nothing.

## Public field scan

A documented 50-repository validation set completed 50 successful scans with zero failures and detected two known active blocked declarations. The set deliberately includes the two positive repositories and is not a prevalence estimate. Read the [2026-07-10 validation report](reports/2026-07-10-active-workflows.md) and its [machine-readable result](reports/2026-07-10-active-workflows.json).

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
- Deliberately narrow checks; a clean report is not a guarantee that a workflow will pass
- Validate remediation changes in a branch before merging
