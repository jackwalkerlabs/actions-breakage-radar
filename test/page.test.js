import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('web app exposes the scanner, evidence promise, and privacy disclosure', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Will your GitHub Actions break/);
  assert.match(html, /id="repo-form"/);
  assert.match(html, /Every finding links to source evidence/);
  assert.match(html, /No active workflow files found/);
  assert.match(html, /\.scanner-footer\{flex-direction:column/);
  assert.match(html, /public repositories only/i);
  assert.match(html, /type="module"/);
});

test('scan results offer a qualified continuous-monitoring interest path', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Get continuous monitoring/);
  assert.match(html, /github\.com\/jackwalkerlabs\/actions-breakage-radar\/issues\/new/);
  assert.match(html, /Continuous monitoring interest/);
  assert.match(html, /repository scan/);
  assert.match(html, /\.monitoring\[hidden\]\s*\{ display:none/);
});

test('web app links to the latest verifiable public scan report', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const report = await readFile(new URL('../reports/2026-07-10-active-workflows.md', import.meta.url), 'utf8');
  const raw = await readFile(new URL('../reports/2026-07-10-active-workflows.json', import.meta.url), 'utf8');
  assert.match(html, /Latest field scan: 50-repository validation set/);
  assert.match(html, /reports\/2026-07-10-active-workflows\.md/);
  assert.match(report, /darkweak\/souin/);
  assert.match(report, /koide3\/small_gicp/);
  assert.match(report, /successfully scanned all 50/);
  assert.match(report, /2026-07-10-active-workflows\.json/);
  assert.match(report, /stars:100\.\.1000 pushed:>=2026-06-10 archived:false fork:false/);
  assert.match(report, /actions\/upload-artifact@v3/);
  const data = JSON.parse(raw);
  assert.equal(data.counts.repositoriesSelected, 50);
  assert.equal(data.counts.uniqueRepositories, 50);
  assert.equal(data.counts.repositoriesScanned, 50);
  assert.equal(data.counts.failures, 0);
  assert.equal(data.counts.riskyRepositories, 2);
  assert.equal(data.repositories.length, 50);
  assert.equal(new Set(data.repositories).size, 50);
  assert.equal(data.source.notPrevalenceEstimate, true);
});
