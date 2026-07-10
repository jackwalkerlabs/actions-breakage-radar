# Validation scan: active GitHub Actions workflows

Generated: 2026-07-10 21:54 UTC

## Result

Actions Breakage Radar successfully scanned all 50 repositories in a fixed validation set with zero API or content failures. It detected two active blocked declarations:

1. [`darkweak/souin`](https://github.com/darkweak/souin) — [`actions/upload-artifact@v3` in `.github/workflows/release.yml` line 122](https://github.com/darkweak/souin/blob/master/.github/workflows/release.yml#L122)
2. [`koide3/small_gicp`](https://github.com/koide3/small_gicp) — [`actions/upload-artifact@v3` in `.github/workflows/paper.yml` line 23](https://github.com/koide3/small_gicp/blob/master/.github/workflows/paper.yml#L23)

GitHub’s official notice says v1–v3 of the artifact actions are retired on GitHub.com: [deprecation notice](https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/).

## Selection

This is a validation set, not a prevalence estimate.

- 48 unique repositories were taken in order from the first page of this public GitHub search:
  - `stars:100..1000 pushed:>=2026-06-10 archived:false fork:false`
  - sorted by stars descending
- The two previously verified positive repositories above were appended.
- All 50 repository names, failures, findings, scanner settings, and scanner SHA-256 are preserved in the [machine-readable result](2026-07-10-active-workflows.json).

The positive repositories were deliberately included to prove the scanner still detects known breakage while false-positive filtering is active. Do not use the 2/50 ratio as a population estimate.

## Scanner behavior

For each public repository, the scanner:

1. reads repository metadata and the default branch;
2. paginates GitHub’s workflow registry;
3. reads `.github/workflows` from the default branch;
4. scans only YAML files present on the default branch whose workflow state is active;
5. ignores GitHub-generated `dynamic/*` workflows and stale registry entries for deleted files;
6. fails rather than reports a clean result when workflow-state metadata or an active file cannot be read;
7. checks retired hosted runners and blocked artifact-action versions.

No private repository data was accessed or stored.

## Limitations

- Public repositories only.
- Focused high-confidence checks, not a complete CI audit.
- GitHub’s live repository data can change after this report.
- The set was constructed for validation and must not be treated as representative prevalence data.
