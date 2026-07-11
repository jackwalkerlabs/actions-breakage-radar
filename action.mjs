import { appendFile, readdir, readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { analyzeWorkflow, createReport } from './scanner.js';

function commandValue(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function commandProperty(value) {
  return commandValue(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function markdownCell(value) {
  return Array.from(String(value), (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return ' ';
    if (/^[\p{L}\p{N} ]$/u.test(character)) return character;
    return `&#x${codePoint.toString(16)};`;
  }).join('');
}

async function workflowFiles(workspace) {
  const requestedDirectory = join(workspace, '.github', 'workflows');
  let directory;
  try {
    directory = await realpath(requestedDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const directoryFromWorkspace = relative(workspace, directory);
  if (directoryFromWorkspace === '..' || directoryFromWorkspace.startsWith(`..${sep}`) || isAbsolute(directoryFromWorkspace)) {
    throw new Error('The .github/workflows directory resolves outside the workspace.');
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function summaryFor(filesScanned, findings) {
  const critical = findings.filter((finding) => finding.severity === 'critical').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  let heading = '## No known critical breakage or Node 24 migration risk found';
  if (critical && warnings) heading = `## ${critical} critical, ${warnings} migration warning${warnings === 1 ? '' : 's'} found`;
  else if (critical) heading = `## ${critical} critical breakage risk${critical === 1 ? '' : 's'} found`;
  else if (warnings) heading = `## ${warnings} Node 24 migration warning${warnings === 1 ? '' : 's'} found`;
  const lines = [heading, '', `Scanned ${filesScanned} workflow file${filesScanned === 1 ? '' : 's'}.`];
  if (findings.length) {
    lines.push('', '| Workflow | Line | Finding | Fix |', '| --- | ---: | --- | --- |');
    for (const finding of findings) {
      lines.push(`| ${markdownCell(finding.file)} | ${finding.line} | ${markdownCell(finding.title)} | ${markdownCell(finding.fix)} |`);
    }
  }
  lines.push('', '[Open Actions Breakage Radar](https://actions-breakage-radar.netlify.app) for evidence links and public-repository scans.', '');
  return lines.join('\n');
}

export async function runAction({
  root = process.env.GITHUB_WORKSPACE || process.cwd(),
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
  outputPath = process.env.GITHUB_OUTPUT,
  repository = process.env.GITHUB_REPOSITORY || null,
  branch = process.env.GITHUB_REF_NAME || null,
  failOnFindings = /^true$/i.test(process.env['INPUT_FAIL-ON-FINDINGS'] || ''),
  writeLine = console.log,
} = {}) {
  const workspace = await realpath(root);
  const files = await workflowFiles(workspace);
  const findings = [];
  for (const file of files) {
    const path = relative(workspace, file).split('\\').join('/');
    const content = await readFile(file, 'utf8');
    findings.push(...analyzeWorkflow(path, content));
  }

  const report = createReport({ repository, branch, filesScanned: files.length, findings });
  const criticalFindings = report.counts.critical;
  const warnings = report.counts.warning;
  const annotationLevel = failOnFindings ? 'error' : 'warning';
  for (const finding of findings) {
    const properties = `file=${commandProperty(finding.file)},line=${finding.line},title=${commandProperty('Actions Breakage Radar')}`;
    writeLine(`::${annotationLevel} ${properties}::${commandValue(`${finding.title}. ${finding.fix}`)}`);
  }
  if (!findings.length) writeLine(`No known critical breakage or Node 24 migration risk found in ${files.length} workflow file${files.length === 1 ? '' : 's'}.`);

  if (summaryPath) await appendFile(summaryPath, summaryFor(files.length, findings));
  if (outputPath) {
    await appendFile(outputPath, [
      `findings=${findings.length}`,
      `critical-findings=${criticalFindings}`,
      `warnings=${warnings}`,
      `files-scanned=${files.length}`,
      `report-json=${JSON.stringify(report)}`,
      '',
    ].join('\n'));
  }

  return {
    filesScanned: files.length,
    criticalFindings,
    warnings,
    findings,
    report,
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
