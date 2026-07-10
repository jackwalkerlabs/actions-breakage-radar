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

export function analyzeWorkflow(file, content) {
  const findings = [];
  String(content || '').split(/\r?\n/).forEach((text, index) => {
    const runner = text.match(/^\s*runs-on:\s*['"]?([^'"\s#]+)['"]?/i)?.[1];
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

    const artifact = text.match(/^\s*-?\s*uses:\s*actions\/(upload-artifact|download-artifact)@v([1-3])\b/i);
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
  const workflowsResponse = await fetchImpl(`${apiBase}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`, { headers });
  if (!workflowsResponse.ok) {
    if (workflowsResponse.status === 404) {
      return { repository, branch, repositoryUrl: repoData.html_url, workflowCount: 0, findings: [] };
    }
    throw new Error(`GitHub returned HTTP ${workflowsResponse.status} while listing workflows.`);
  }

  const entries = await workflowsResponse.json();
  const workflows = entries.filter((entry) => /\.ya?ml$/i.test(entry.name || '') && entry.download_url);
  const findings = [];
  for (const workflow of workflows) {
    const response = await fetchImpl(workflow.download_url);
    if (!response.ok) continue;
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
