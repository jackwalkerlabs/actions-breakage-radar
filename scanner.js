export function extractRepo(input) {
  const value = String(input || '').trim().replace(/\.git$/, '').replace(/\/$/, '');
  const match = value.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

const RUNNER_RETIREMENTS = {
  'ubuntu-20.04': {
    replacement: 'ubuntu-24.04',
    evidenceUrl: 'https://github.com/actions/runner-images/issues/11101'
  },
  'windows-2019': {
    replacement: 'windows-2022',
    evidenceUrl: 'https://github.com/actions/runner-images/issues/12045'
  },
  'macos-13': {
    replacement: 'macos-15',
    evidenceUrl: 'https://github.com/actions/runner-images/issues/13046'
  }
};

const NODE20_ACTION_UPGRADES = {
  'actions/checkout@v4': 'actions/checkout@v5',
  'actions/setup-node@v4': 'actions/setup-node@v5',
  'actions/setup-python@v5': 'actions/setup-python@v6',
  'actions/cache@v4': 'actions/cache@v5',
  'actions/upload-artifact@v4': 'actions/upload-artifact@v6',
  'actions/upload-artifact@v5': 'actions/upload-artifact@v6',
  'actions/setup-java@v4': 'actions/setup-java@v5',
  'actions/github-script@v7': 'actions/github-script@v8',
  'docker/setup-buildx-action@v3': 'docker/setup-buildx-action@v4',
  'docker/login-action@v3': 'docker/login-action@v4'
};

const NODE20_EVIDENCE_URL = 'https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/';

function workflowReferences(lines) {
  const actions = new Map();
  const runners = new Map();
  let jobsIndent = null;
  let jobIndent = null;
  let jobPropertyIndent = null;
  let stepsIndent = null;
  let stepIndent = null;
  let stepKeyIndent = null;

  lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const indent = text.match(/^ */)[0].length;

    if (jobsIndent === null) {
      if (indent === 0 && /^jobs:\s*(?:&[^\s#]+\s*)?(?:#.*)?$/i.test(trimmed)) jobsIndent = indent;
      return;
    }
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      jobPropertyIndent = null;
      stepsIndent = null;
      stepIndent = null;
      stepKeyIndent = null;
      return;
    }

    if (jobIndent === null) {
      jobIndent = indent;
      return;
    }
    if (indent === jobIndent) {
      jobPropertyIndent = null;
      stepsIndent = null;
      stepIndent = null;
      stepKeyIndent = null;
      return;
    }

    if (stepsIndent !== null) {
      const item = text.match(/^(\s*)-(\s+)(.*)$/);
      const isStepItem = Boolean(item && (stepIndent === null ? indent >= stepsIndent : indent === stepIndent));
      if (indent < stepsIndent || (indent === stepsIndent && !isStepItem)) {
        stepsIndent = null;
        stepIndent = null;
        stepKeyIndent = null;
      } else {
        if (isStepItem) {
          stepIndent = indent;
          stepKeyIndent = indent + 1 + item[2].length;
          const action = item[3].match(/^uses:\s*(?:&[^\s#]+\s+)?['"]?([^'"\s#]+)['"]?/i)?.[1];
          if (action) actions.set(index, action);
          return;
        }
        if (stepKeyIndent !== null && indent === stepKeyIndent) {
          const action = trimmed.match(/^uses:\s*(?:&[^\s#]+\s+)?['"]?([^'"\s#]+)['"]?/i)?.[1];
          if (action) actions.set(index, action);
        }
        return;
      }
    }

    if (jobPropertyIndent === null) jobPropertyIndent = indent;
    if (indent === jobPropertyIndent) {
      const runner = trimmed.match(/^runs-on:\s*(?:&[^\s#]+\s+)?['"]?([^'"\s#]+)['"]?/i)?.[1];
      if (runner) runners.set(index, runner);
      if (/^steps:\s*(?:&[^\s#]+\s*)?(?:#.*)?$/i.test(trimmed)) stepsIndent = indent;
    }
  });

  return { actions, runners };
}

export function createReport({ repository = null, branch = null, filesScanned, findings }) {
  const critical = findings.filter((finding) => finding.severity === 'critical').length;
  const warning = findings.filter((finding) => finding.severity === 'warning').length;
  return {
    schemaVersion: 1,
    repository,
    branch,
    filesScanned,
    counts: { critical, warning, total: findings.length },
    findings,
  };
}

export function analyzeWorkflow(file, content) {
  const findings = [];
  const lines = String(content || '').split(/\r?\n/);
  const references = workflowReferences(lines);
  lines.forEach((text, index) => {
    const runner = references.runners.get(index);
    const retirement = RUNNER_RETIREMENTS[runner];
    if (retirement) {
      findings.push({
        code: 'retired-runner',
        severity: 'critical',
        file,
        line: index + 1,
        title: `${runner} is retired`,
        detail: 'GitHub no longer provides this hosted runner image, so jobs can stop starting.',
        fix: `Move this job to ${retirement.replacement} and test it before merging.`,
        evidenceUrl: retirement.evidenceUrl
      });
    }

    const action = references.actions.get(index);
    const artifact = action?.match(/^actions\/(upload-artifact|download-artifact)@v([1-3])\b/i);
    if (artifact) {
      findings.push({
        code: 'blocked-action',
        severity: 'critical',
        file,
        line: index + 1,
        title: `actions/${artifact[1]}@v${artifact[2]} is blocked`,
        detail: 'GitHub retired v1-v3 of the artifact actions on GitHub.com, so this step can fail immediately.',
        fix: `Upgrade to actions/${artifact[1]}@v4 and review the v4 migration notes.`,
        evidenceUrl: 'https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/'
      });
    }

    const replacement = NODE20_ACTION_UPGRADES[action?.toLowerCase()];
    if (replacement) {
      findings.push({
        code: 'node20-action',
        severity: 'warning',
        file,
        line: index + 1,
        title: `${action} declares Node 20`,
        detail: 'GitHub runners began defaulting JavaScript actions to Node 24 on June 16, 2026; this major version still declares Node 20 in its action metadata.',
        fix: `Upgrade to ${replacement} and test the workflow on Node 24.`,
        evidenceUrl: NODE20_EVIDENCE_URL
      });
    }
  });
  return findings;
}

export async function scanRepository(input, fetchImpl = fetch) {
  const parsed = extractRepo(input);
  if (!parsed) throw new Error('Enter a public GitHub repository as owner/repo or a GitHub URL.');

  const repository = `${parsed.owner}/${parsed.repo}`;
  const apiBase = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const headers = { Accept: 'application/vnd.github+json' };
  const repoResponse = await fetchImpl(apiBase, { headers });
  if (!repoResponse.ok) {
    throw new Error(repoResponse.status === 404 ? 'Repository not found or not public.' : `GitHub returned HTTP ${repoResponse.status}.`);
  }
  const repoData = await repoResponse.json();
  const branch = repoData.default_branch;
  const activeWorkflowPaths = new Set();
  let workflowPage = 1;
  let workflowStatesSeen = 0;
  while (true) {
    const statesResponse = await fetchImpl(`${apiBase}/actions/workflows?per_page=100&page=${workflowPage}`, { headers });
    if (!statesResponse.ok) {
      throw new Error(`GitHub returned HTTP ${statesResponse.status} while listing active workflows.`);
    }
    const statesData = await statesResponse.json();
    if (!Array.isArray(statesData.workflows)) {
      throw new Error('GitHub returned malformed workflow state data.');
    }
    for (const workflow of statesData.workflows) {
      if (workflow.state === 'active' && workflow.path) activeWorkflowPaths.add(workflow.path);
    }
    workflowStatesSeen += statesData.workflows.length;
    const totalCount = Number.isInteger(statesData.total_count) ? statesData.total_count : null;
    if (statesData.workflows.length < 100 || (totalCount !== null && workflowStatesSeen >= totalCount)) break;
    workflowPage += 1;
  }
  const workflowsResponse = await fetchImpl(`${apiBase}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`, { headers });
  if (!workflowsResponse.ok) {
    if (workflowsResponse.status === 404) {
      return { repository, branch, repositoryUrl: repoData.html_url, workflowCount: 0, findings: [] };
    }
    throw new Error(`GitHub returned HTTP ${workflowsResponse.status} while listing workflows.`);
  }

  const entries = await workflowsResponse.json();
  const workflows = entries.filter((entry) =>
    /\.ya?ml$/i.test(entry.path || entry.name || '') && activeWorkflowPaths.has(entry.path)
  );
  for (const workflow of workflows) {
    if (!workflow.download_url) {
      throw new Error(`Active workflow ${workflow.path} has no readable content URL.`);
    }
  }
  const findings = [];
  for (const workflow of workflows) {
    const response = await fetchImpl(workflow.download_url);
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status} while reading ${workflow.path}.`);
    }
    const content = await response.text();
    for (const finding of analyzeWorkflow(workflow.path, content)) {
      findings.push({
        ...finding,
        sourceUrl: `${workflow.html_url}#L${finding.line}`
      });
    }
  }

  return {
    repository,
    branch,
    repositoryUrl: repoData.html_url,
    workflowCount: workflows.length,
    findings
  };
}
