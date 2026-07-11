import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(workflow) {
  const root = await mkdtemp(join(tmpdir(), 'breakage-radar-'));
  await mkdir(join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(join(root, '.github', 'workflows', 'release.yml'), workflow);
  return root;
}

test('README gives a copy-paste monitoring workflow and honest behavior', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /jackwalkerlabs\/actions-breakage-radar@v1/);
  assert.match(readme, /fail-on-findings: false/);
  assert.match(readme, /workflow annotations/);
  assert.match(readme, /checked-out.*workflow files/i);
  assert.match(readme, /Node 24 migration/i);
  assert.match(readme, /report-json/);
  assert.doesNotMatch(readme, /cron:/);
});

test('repository CI verifies tests, build, and the Action on pull requests', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /uses: \.\//);
  assert.match(workflow, /fail-on-findings: true/);
  assert.match(workflow, /permissions:\n  contents: read/);
});

test('repository exposes a dependency-free GitHub Action contract', async () => {
  const metadata = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
  assert.match(metadata, /^name: Actions Breakage Radar/m);
  assert.match(metadata, /fail-on-findings:/);
  assert.match(metadata, /default: ['"]false['"]/);
  assert.match(metadata, /using: ['"]node24['"]/);
  assert.match(metadata, /main: ['"]action\.mjs['"]/);
  assert.match(metadata, /critical-findings:/);
  assert.match(metadata, /warnings:/);
  assert.match(metadata, /report-json:/);
});

test('runAction rejects a workflows directory that resolves outside the workspace', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await fixture('jobs:\n  safe:\n    runs-on: ubuntu-latest\n');
  const external = await mkdtemp(join(tmpdir(), 'breakage-radar-external-'));
  await writeFile(join(external, 'stolen.yml'), 'jobs:\n  test:\n    runs-on: ubuntu-20.04\n');
  await rm(join(root, '.github', 'workflows'), { recursive: true });
  await symlink(external, join(root, '.github', 'workflows'));

  await assert.rejects(
    runAction({ root, writeLine: () => {} }),
    /workflows directory resolves outside the workspace/,
  );
});

test('runAction reports a clean Node 24 readiness check', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await fixture('jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n');
  const lines = [];

  await runAction({ root, writeLine: (line) => lines.push(line) });

  assert.match(lines.join('\n'), /No known critical breakage or Node 24 migration risk found/);
});

test('runAction reads the hyphenated GitHub input environment variable', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await fixture('jobs:\n  test:\n    runs-on: ubuntu-20.04\n');
  const previous = process.env['INPUT_FAIL-ON-FINDINGS'];
  process.env['INPUT_FAIL-ON-FINDINGS'] = 'true';
  try {
    const result = await runAction({ root, writeLine: () => {} });
    assert.equal(result.exitCode, 1);
  } finally {
    if (previous === undefined) delete process.env['INPUT_FAIL-ON-FINDINGS'];
    else process.env['INPUT_FAIL-ON-FINDINGS'] = previous;
  }
});

test('runAction fails only when fail-on-findings is enabled', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await fixture('jobs:\n  test:\n    runs-on: ubuntu-20.04\n');

  const result = await runAction({
    root,
    failOnFindings: true,
    writeLine: () => {},
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.exitCode, 1);
});

test('runAction renders workflow names as inert text in the job summary', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await mkdtemp(join(tmpdir(), 'breakage-radar-'));
  const workflows = join(root, '.github', 'workflows');
  const summaryPath = join(root, 'summary.md');
  await mkdir(workflows, { recursive: true });
  await writeFile(
    join(workflows, 'release[click](javascript:alert(1))|<img src=x>`_*~.yml'),
    'jobs:\n  test:\n    runs-on: ubuntu-20.04\n',
  );

  await runAction({ root, summaryPath, writeLine: () => {} });

  const summary = await readFile(summaryPath, 'utf8');
  assert.doesNotMatch(summary, /<img|\[click\]\(|`_\*~/);
  assert.match(summary, /release&#x5b;click&#x5d;&#x28;javascript&#x3a;alert&#x28;1&#x29;&#x29;&#x7c;&#x3c;img src&#x3d;x&#x3e;&#x60;&#x5f;&#x2a;&#x7e;&#x2e;yml/);
});

test('runAction writes severity counts and a machine-readable JSON report output', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await fixture([
    'name: CI',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/upload-artifact@v3',
  ].join('\n'));
  const summaryPath = join(root, 'summary.md');
  const outputPath = join(root, 'output.txt');

  const result = await runAction({
    root,
    summaryPath,
    outputPath,
    repository: null,
    branch: null,
    writeLine: () => {},
  });

  assert.equal(result.criticalFindings, 1);
  assert.equal(result.warnings, 1);
  const output = await readFile(outputPath, 'utf8');
  assert.match(output, /findings=2/);
  assert.match(output, /critical-findings=1/);
  assert.match(output, /warnings=1/);
  const reportLine = output.split('\n').find((line) => line.startsWith('report-json='));
  const report = JSON.parse(reportLine.slice('report-json='.length));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.repository, null);
  assert.equal(report.branch, null);
  assert.equal(report.filesScanned, 1);
  assert.deepEqual(report.counts, { critical: 1, warning: 1, total: 2 });
  assert.deepEqual(report.findings.map((finding) => finding.code), ['node20-action', 'blocked-action']);
  assert.match(await readFile(summaryPath, 'utf8'), /1 critical, 1 migration warning/);
});

test('runAction annotates findings and writes a useful job summary', async () => {
  const { runAction } = await import('../action.mjs');
  const root = await fixture('name: Release\njobs:\n  ship:\n    runs-on: ubuntu-20.04\n    steps:\n      - uses: actions/upload-artifact@v3\n');
  const summaryPath = join(root, 'summary.md');
  const outputPath = join(root, 'output.txt');
  const lines = [];

  const result = await runAction({
    root,
    summaryPath,
    outputPath,
    failOnFindings: false,
    writeLine: (line) => lines.push(line),
  });

  assert.equal(result.filesScanned, 1);
  assert.equal(result.findings.length, 2);
  assert.equal(result.exitCode, 0);
  assert.match(lines.join('\n'), /::warning file=\.github\/workflows\/release\.yml,line=4/);
  assert.match(lines.join('\n'), /ubuntu-20\.04 is retired/);
  assert.match(await readFile(summaryPath, 'utf8'), /2 critical breakage risks found/);
  assert.match(await readFile(summaryPath, 'utf8'), /actions&#x2f;upload&#x2d;artifact&#x40;v3 is blocked/);
  assert.match(await readFile(outputPath, 'utf8'), /findings=2/);
});
