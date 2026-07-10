import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  assert.doesNotMatch(readme, /cron:/);
});

test('repository exposes a dependency-free GitHub Action contract', async () => {
  const metadata = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
  assert.match(metadata, /^name: Actions Breakage Radar/m);
  assert.match(metadata, /fail-on-findings:/);
  assert.match(metadata, /default: ['"]false['"]/);
  assert.match(metadata, /using: ['"]node24['"]/);
  assert.match(metadata, /main: ['"]action\.mjs['"]/);
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
  assert.match(await readFile(summaryPath, 'utf8'), /actions\/upload-artifact@v3 is blocked/);
  assert.match(await readFile(outputPath, 'utf8'), /findings=2/);
});
