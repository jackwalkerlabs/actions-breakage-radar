import { appendFile, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { analyzeWorkflow } from './scanner.js';

function commandValue(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function commandProperty(value) {
  return commandValue(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

async function workflowFiles(root) {
  const directory = join(root, '.github', 'workflows');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function summaryFor(filesScanned, findings) {
  const heading = findings.length
    ? `## ${findings.length} critical breakage risk${findings.length === 1 ? '' : 's'} found`
    : '## No known critical breakage found';
  const lines = [heading, '', `Scanned ${filesScanned} workflow file${filesScanned === 1 ? '' : 's'}.`];
  if (findings.length) {
    lines.push('', '| Workflow | Line | Finding | Fix |', '| --- | ---: | --- | --- |');
    for (const finding of findings) {
      lines.push(`| \`${finding.file}\` | ${finding.line} | ${finding.title} | ${finding.fix} |`);
    }
  }
  lines.push('', '[Open Actions Breakage Radar](https://actions-breakage-radar.netlify.app) for evidence links and public-repository scans.', '');
  return lines.join('\n');
}

export async function runAction({
  root = process.env.GITHUB_WORKSPACE || process.cwd(),
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
  outputPath = process.env.GITHUB_OUTPUT,
  failOnFindings = /^true$/i.test(process.env['INPUT_FAIL-ON-FINDINGS'] || ''),
  writeLine = console.log,
} = {}) {
  const files = await workflowFiles(root);
  const findings = [];
  for (const file of files) {
    const path = relative(root, file).split('\\').join('/');
    const content = await readFile(file, 'utf8');
    findings.push(...analyzeWorkflow(path, content));
  }

  const annotationLevel = failOnFindings ? 'error' : 'warning';
  for (const finding of findings) {
    const properties = `file=${commandProperty(finding.file)},line=${finding.line},title=${commandProperty('Actions Breakage Radar')}`;
    writeLine(`::${annotationLevel} ${properties}::${commandValue(`${finding.title}. ${finding.fix}`)}`);
  }
  if (!findings.length) writeLine(`No known critical breakage found in ${files.length} workflow file${files.length === 1 ? '' : 's'}.`);

  if (summaryPath) await appendFile(summaryPath, summaryFor(files.length, findings));
  if (outputPath) await appendFile(outputPath, `findings=${findings.length}\nfiles-scanned=${files.length}\n`);

  return {
    filesScanned: files.length,
    findings,
    exitCode: failOnFindings && findings.length ? 1 : 0,
  };
}

async function main() {
  try {
    const result = await runAction();
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`::error title=Actions Breakage Radar::${commandValue(error.message)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
