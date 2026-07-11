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
  const findings = analyzeWorkflow('release.yml', 'jobs:\n  release:\n    steps:\n      - uses: actions/upload-artifact@v3\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'blocked-action');
  assert.equal(findings[0].severity, 'critical');
  assert.equal(findings[0].line, 4);
  assert.match(findings[0].fix, /upload-artifact@v4/);
});

test('analyzeWorkflow supports anchored jobs and steps mappings', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const workflow = [
    'jobs: &all_jobs',
    '  release: &release_job',
    '    runs-on: &old_runner ubuntu-20.04',
    '    steps: &release_steps',
    '      - uses: &checkout actions/checkout@v4',
  ].join('\n');

  const findings = analyzeWorkflow('release.yml', workflow);

  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((finding) => finding.code), ['retired-runner', 'node20-action']);
  assert.deepEqual(findings.map((finding) => finding.line), [3, 5]);
});

test('analyzeWorkflow supports bare-dash step maps and quoted structural keys', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const workflow = [
    '"jobs":',
    '  release:',
    "    'runs-on': ubuntu-20.04",
    '    "steps":',
    '      -',
    '        "uses": actions/checkout@v4',
  ].join('\n');

  const findings = analyzeWorkflow('release.yml', workflow);

  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((finding) => finding.code), ['retired-runner', 'node20-action']);
  assert.deepEqual(findings.map((finding) => finding.line), [3, 6]);
});

test('analyzeWorkflow supports indentationless step sequences', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const workflow = [
    'jobs:',
    '  release:',
    '    steps:',
    '    - uses: actions/upload-artifact@v3',
  ].join('\n');

  const findings = analyzeWorkflow('release.yml', workflow);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'blocked-action');
  assert.equal(findings[0].line, 4);
});

test('analyzeWorkflow flags known Node 20 action majors with exact Node 24 upgrades', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const workflow = [
    'jobs:',
    '  test:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '      - uses: actions/setup-python@v5',
    '      - uses: actions/cache@v4',
    '      - uses: actions/upload-artifact@v4',
    '      - uses: actions/upload-artifact@v5',
    '      - uses: actions/setup-java@v4',
    '      - uses: actions/github-script@v7',
    '      - uses: docker/setup-buildx-action@v3',
    '      - uses: docker/login-action@v3',
    '      - uses: actions/checkout@v5',
  ].join('\n');

  const findings = analyzeWorkflow('ci.yml', workflow);

  assert.equal(findings.length, 10);
  assert.deepEqual(findings.map((finding) => finding.code), Array(10).fill('node20-action'));
  assert.deepEqual(findings.map((finding) => finding.severity), Array(10).fill('warning'));
  assert.match(findings[0].title, /actions\/checkout@v4 declares Node 20/);
  assert.match(findings[0].fix, /actions\/checkout@v5/);
  assert.match(findings[4].fix, /actions\/upload-artifact@v6/);
  assert.match(findings[5].fix, /actions\/upload-artifact@v6/);
  assert.match(findings[0].evidenceUrl, /deprecation-of-node-20/);
});

test('analyzeWorkflow only treats uses keys on action steps as action references', async () => {
  const { analyzeWorkflow } = await import('../scanner.js');
  const workflow = [
    'env:',
    '  uses: actions/checkout@v4',
    '  runs-on: ubuntu-20.04',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    strategy:',
    '      matrix:',
    '        steps:',
    '          - uses: actions/setup-python@v5',
    '    steps:',
    '      - name: Keep action-looking text inert',
    '        env:',
    '          uses: actions/setup-node@v4',
    '        run: |',
    '          uses: actions/cache@v4',
    '          runs-on: ubuntu-20.04',
    '      - name: Real action step',
    '        uses: actions/checkout@v4',
  ].join('\n');

  const findings = analyzeWorkflow('ci.yml', workflow);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'node20-action');
  assert.equal(findings[0].line, 19);
});

test('createReport provides one shared machine-readable schema', async () => {
  const { createReport } = await import('../scanner.js');
  const report = createReport({
    repository: 'acme/widget',
    branch: 'main',
    filesScanned: 2,
    findings: [{ severity: 'warning', code: 'node20-action' }],
  });

  assert.deepEqual(report, {
    schemaVersion: 1,
    repository: 'acme/widget',
    branch: 'main',
    filesScanned: 2,
    counts: { critical: 0, warning: 1, total: 1 },
    findings: [{ severity: 'warning', code: 'node20-action' }],
  });
});

test('scanRepository fetches public workflow files and returns findings', async () => {
  const { scanRepository } = await import('../scanner.js');
  const responses = new Map([
    ['https://api.github.com/repos/acme/widget', { default_branch: 'main', html_url: 'https://github.com/acme/widget' }],
    ['https://api.github.com/repos/acme/widget/actions/workflows?per_page=100&page=1', { workflows: [
      { path: '.github/workflows/ci.yml', state: 'active' }
    ] }],
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

test('scanRepository reads all workflow-state pages', async () => {
  const { scanRepository } = await import('../scanner.js');
  const apiBase = 'https://api.github.com/repos/acme/widget';
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    path: `.github/workflows/disabled-${index}.yml`,
    state: 'disabled_manually'
  }));
  const fetchImpl = async (url) => {
    if (url === apiBase) {
      return { ok: true, status: 200, json: async () => ({ default_branch: 'main', html_url: 'https://github.com/acme/widget' }) };
    }
    if (url === `${apiBase}/actions/workflows?per_page=100&page=1`) {
      return { ok: true, status: 200, json: async () => ({ total_count: 101, workflows: firstPage }) };
    }
    if (url === `${apiBase}/actions/workflows?per_page=100&page=2`) {
      return { ok: true, status: 200, json: async () => ({ total_count: 101, workflows: [
        { path: '.github/workflows/late.yml', state: 'active' }
      ] }) };
    }
    if (url === `${apiBase}/contents/.github/workflows?ref=main`) {
      return { ok: true, status: 200, json: async () => [
        { name: 'late.yml', path: '.github/workflows/late.yml', download_url: 'https://raw.example/late.yml', html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/late.yml' }
      ] };
    }
    if (url === 'https://raw.example/late.yml') {
      return { ok: true, status: 200, text: async () => 'jobs:\n  release:\n    steps:\n      - uses: actions/upload-artifact@v3\n' };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const report = await scanRepository('acme/widget', fetchImpl);
  assert.equal(report.workflowCount, 1);
  assert.equal(report.findings[0].code, 'blocked-action');
});

test('scanRepository fails closed when workflow state cannot be verified', async () => {
  const { scanRepository } = await import('../scanner.js');
  const fetchImpl = async (url) => {
    if (url === 'https://api.github.com/repos/acme/widget') {
      return { ok: true, status: 200, json: async () => ({ default_branch: 'main', html_url: 'https://github.com/acme/widget' }) };
    }
    if (url === 'https://api.github.com/repos/acme/widget/actions/workflows?per_page=100&page=1') {
      return { ok: false, status: 503 };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  await assert.rejects(
    scanRepository('acme/widget', fetchImpl),
    /HTTP 503 while listing active workflows/
  );
});

test('scanRepository fails closed when an active workflow cannot be read', async () => {
  const { scanRepository } = await import('../scanner.js');
  const apiBase = 'https://api.github.com/repos/acme/widget';
  const responses = new Map([
    [apiBase, { default_branch: 'main', html_url: 'https://github.com/acme/widget' }],
    [`${apiBase}/actions/workflows?per_page=100&page=1`, { workflows: [
      { path: '.github/workflows/ci.yml', state: 'active' }
    ] }],
    [`${apiBase}/contents/.github/workflows?ref=main`, [
      { name: 'ci.yml', path: '.github/workflows/ci.yml', download_url: 'https://raw.example/ci.yml', html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/ci.yml' }
    ]]
  ]);
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 502,
    json: async () => responses.get(url),
    text: async () => responses.get(url)
  });
  await assert.rejects(
    scanRepository('acme/widget', fetchImpl),
    /HTTP 502 while reading \.github\/workflows\/ci\.yml/
  );
});

test('scanRepository ignores platform-generated workflows when no workflow directory exists', async () => {
  const { scanRepository } = await import('../scanner.js');
  const apiBase = 'https://api.github.com/repos/acme/widget';
  const fetchImpl = async (url) => {
    if (url === apiBase) {
      return { ok: true, status: 200, json: async () => ({ default_branch: 'main', html_url: 'https://github.com/acme/widget' }) };
    }
    if (url === `${apiBase}/actions/workflows?per_page=100&page=1`) {
      return { ok: true, status: 200, json: async () => ({ workflows: [
        { path: 'dynamic/dependabot/dependabot-updates', state: 'active' }
      ] }) };
    }
    if (url === `${apiBase}/contents/.github/workflows?ref=main`) {
      return { ok: false, status: 404 };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const report = await scanRepository('acme/widget', fetchImpl);
  assert.equal(report.workflowCount, 0);
  assert.deepEqual(report.findings, []);
});

test('scanRepository fails closed when an active workflow has no content URL', async () => {
  const { scanRepository } = await import('../scanner.js');
  const apiBase = 'https://api.github.com/repos/acme/widget';
  const responses = new Map([
    [apiBase, { default_branch: 'main', html_url: 'https://github.com/acme/widget' }],
    [`${apiBase}/actions/workflows?per_page=100&page=1`, { workflows: [
      { path: '.github/workflows/ci.yml', state: 'active' }
    ] }],
    [`${apiBase}/contents/.github/workflows?ref=main`, [
      { name: 'ci.yml', path: '.github/workflows/ci.yml', download_url: null, html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/ci.yml' }
    ]]
  ]);
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    json: async () => responses.get(url)
  });
  await assert.rejects(
    scanRepository('acme/widget', fetchImpl),
    /Active workflow \.github\/workflows\/ci\.yml has no readable content URL/
  );
});

test('scanRepository ignores stale active metadata absent from the default branch', async () => {
  const { scanRepository } = await import('../scanner.js');
  const apiBase = 'https://api.github.com/repos/acme/widget';
  const responses = new Map([
    [apiBase, { default_branch: 'main', html_url: 'https://github.com/acme/widget' }],
    [`${apiBase}/actions/workflows?per_page=100&page=1`, { workflows: [
      { path: '.github/workflows/deleted.yml', state: 'active' },
      { path: '.github/workflows/ci.yml', state: 'active' }
    ] }],
    [`${apiBase}/contents/.github/workflows?ref=main`, [
      { name: 'ci.yml', path: '.github/workflows/ci.yml', download_url: 'https://raw.example/ci.yml', html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/ci.yml' }
    ]],
    ['https://raw.example/ci.yml', 'jobs:\n  test:\n    runs-on: ubuntu-latest\n']
  ]);
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    json: async () => responses.get(url),
    text: async () => responses.get(url)
  });
  const report = await scanRepository('acme/widget', fetchImpl);
  assert.equal(report.workflowCount, 1);
  assert.deepEqual(report.findings, []);
});

test('scanRepository excludes disabled workflows from risk findings', async () => {
  const { scanRepository } = await import('../scanner.js');
  const responses = new Map([
    ['https://api.github.com/repos/acme/widget', { default_branch: 'main', html_url: 'https://github.com/acme/widget' }],
    ['https://api.github.com/repos/acme/widget/actions/workflows?per_page=100&page=1', { workflows: [
      { path: '.github/workflows/active.yml', state: 'active' },
      { path: '.github/workflows/disabled.yml', state: 'disabled_manually' }
    ] }],
    ['https://api.github.com/repos/acme/widget/contents/.github/workflows?ref=main', [
      { name: 'active.yml', path: '.github/workflows/active.yml', download_url: 'https://raw.example/active.yml', html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/active.yml' },
      { name: 'disabled.yml', path: '.github/workflows/disabled.yml', download_url: 'https://raw.example/disabled.yml', html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/disabled.yml' }
    ]],
    ['https://raw.example/active.yml', 'jobs:\n  test:\n    runs-on: ubuntu-latest\n'],
    ['https://raw.example/disabled.yml', 'jobs:\n  test:\n    runs-on: ubuntu-20.04\n']
  ]);
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    json: async () => responses.get(url),
    text: async () => responses.get(url)
  });
  const report = await scanRepository('acme/widget', fetchImpl);
  assert.equal(report.workflowCount, 1);
  assert.deepEqual(report.findings, []);
});
