// Reading and committing site content in the VUZOL GitHub repository.
// Every save from the admin becomes one commit on the main branch; the
// "Deploy VUZOL to GitHub Pages" workflow then republishes the site.

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function repoConfig(env) {
  return {
    repo: env.GITHUB_REPO || 'ProMedia-Ukraine/vuzol',
    branch: env.GITHUB_BRANCH || 'main',
    token: env.GITHUB_TOKEN,
    api: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
  };
}

async function gh(cfg, path, init = {}) {
  if (!cfg.token) throw new GitHubError('Адмінка не підключена до GitHub: немає ключа GITHUB_TOKEN.', 500);
  const res = await fetch(`${cfg.api}/repos/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vuzol-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GitHubError(`GitHub ${res.status} on ${path}: ${text.slice(0, 300)}`, res.status);
  }
  return res.status === 204 ? null : res.json();
}

function decodeBase64Utf8(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Returns { text, sha } of a file on the branch, or null if it does not exist.
export async function readText(cfg, path) {
  try {
    const file = await gh(cfg, `/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`);
    return { text: decodeBase64Utf8(file.content), sha: file.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// Returns raw bytes of a file (for photo previews), or null.
export async function readBinary(cfg, path) {
  const res = await fetch(`${cfg.api}/repos/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vuzol-admin',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(`GitHub ${res.status} reading ${path}`, res.status);
  return res.arrayBuffer();
}

/**
 * One commit with several changes.
 * changes: [{ path, text } | { path, base64 } | { path, delete: true }]
 * expect: { path, sha } — refuse with 409 if that file changed meanwhile.
 */
export async function commit(cfg, { message, changes, expect, author }) {
  const ref = await gh(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const head = ref.object.sha;

  if (expect) {
    const current = await readText(cfg, expect.path);
    if ((current?.sha || null) !== (expect.sha || null)) {
      throw new GitHubError('Хтось інший уже змінив ці дані. Оновіть сторінку й повторіть зміни.', 409);
    }
  }

  const headCommit = await gh(cfg, `/git/commits/${head}`);
  const tree = [];
  for (const ch of changes) {
    if (ch.delete) {
      tree.push({ path: ch.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await gh(cfg, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: ch.base64 ?? encodeUtf8Base64(ch.text), encoding: 'base64' }),
    });
    tree.push({ path: ch.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh(cfg, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
  });
  const newCommit = await gh(cfg, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [head],
      ...(author ? { author: { name: author, email: 'admin@vuzol.org.ua' } } : {}),
    }),
  });
  try {
    await gh(cfg, `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    });
  } catch (e) {
    if (e.status === 422) throw new GitHubError('Сайт саме змінювався. Спробуйте зберегти ще раз.', 409);
    throw e;
  }
  return newCommit.sha;
}

// Latest run of the site deploy workflow, to show "сайт оновлюється".
export async function deployStatus(cfg) {
  const data = await gh(cfg, `/actions/workflows/deploy-pages.yml/runs?branch=${encodeURIComponent(cfg.branch)}&per_page=1`);
  const run = data.workflow_runs?.[0];
  if (!run) return null;
  return { status: run.status, conclusion: run.conclusion, sha: run.head_sha, started: run.run_started_at, url: run.html_url };
}
