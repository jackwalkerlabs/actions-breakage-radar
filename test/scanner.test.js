import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRepo } from '../scanner.js';

test('extractRepo accepts GitHub URL and owner/repo shorthand', () => {
  assert.deepEqual(extractRepo('https://github.com/actions/checkout'), { owner: 'actions', repo: 'checkout' });
  assert.deepEqual(extractRepo('actions/checkout'), { owner: 'actions', repo: 'checkout' });
  assert.equal(extractRepo('not a repo'), null);
});

test('analyzeWorkflow flags a retired hosted runner with line evidence', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const findings = analyzeWorkflow('ci.yml', 'name: CI\njobs:\n  test:\n    runs-on: ubuntu-20.04\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'retired-runner');
  assert.equal(findings[0].severity, 'critical');
  assert.equal(findings[0].line, 4);
  assert.match(findings[0].fix, /ubuntu-24\.04/);
  assert.match(findings[0].evidenceUrl, /^https:\/\//);
});

test('analyzeWorkflow flags blocked artifact action versions', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const findings = analyzeWorkflow('release.yml', 'steps:\n  - uses: actions/upload-artifact@v3\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'blocked-action');
  assert.equal(findings[0].severity, 'critical');
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].fix, /upload-artifact@v4/);
});

test('scanRepository fetches public workflow files and returns findings', async () => {
  const { scanRepository } = await import('../scanner.js');
  const responses = new Map([
    ['https://api.github.com/repos/acme/widget', { default_branch: 'main', html_url: 'https://github.com/acme/widget' }],
    ['https://api.github.com/repos/acme/widget/contents/.github/workflows?ref=main', [
      { name: 'ci.yml', path: '.github/workflows/ci.yml', download_url: 'https://raw.example/ci.yml', html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/ci.yml' }
    ]],
    ['https://raw.example/ci.yml', 'jobs:\n  test:\n    runs-on: ubuntu-20.04\n']
  ]);
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    json: async () => responses.get(url),
    text: async () => responses.get(url)
  });
  const report = await scanRepository('acme/widget', fetchImpl);
  assert.equal(report.repository, 'acme/widget');
  assert.equal(report.workflowCount, 1);
  assert.equal(report.findings[0].code, 'retired-runner');
  assert.equal(report.findings[0].sourceUrl, 'https://github.com/acme/widget/blob/main/.github/workflows/ci.yml#L3');
});
