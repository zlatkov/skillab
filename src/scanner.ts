import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseSkill } from './parser.js';
import type { SkillDefinition } from './config.js';

const SKILL_FILENAME = 'SKILL.md';

const GITHUB_TREE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;
const GITHUB_REPO_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/;
const GITHUB_SHORTHAND_RE = /^([^/\s]+)\/([^/\s]+)$/;

interface ScanResult {
  skills: SkillDefinition[];
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}

async function scanLocalFolder(folderPath: string): Promise<ScanResult> {
  const absolutePath = resolve(folderPath);
  const skillPaths: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip common non-skill directories
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        await walk(fullPath);
      } else if (entry.name.toUpperCase() === SKILL_FILENAME.toUpperCase()) {
        skillPaths.push(fullPath);
      }
    }
  }

  await walk(absolutePath);

  const skills: SkillDefinition[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const path of skillPaths) {
    try {
      const skill = await parseSkill(path);
      skills.push(skill);
    } catch (err) {
      errors.push({ path, error: (err as Error).message });
    }
  }

  return { skills, paths: skillPaths, errors };
}

async function fetchGitHubTree(owner: string, repo: string, branch: string, path: string): Promise<string[]> {
  // Use GitHub API to recursively list files under a path
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);

  const data = await res.json() as { tree: Array<{ path: string; type: string }> };
  const prefix = path ? `${path}/` : '';

  return data.tree
    .filter(item =>
      item.type === 'blob' &&
      item.path.toUpperCase().endsWith(SKILL_FILENAME.toUpperCase()) &&
      (prefix === '' || item.path.startsWith(prefix)),
    )
    .map(item => item.path);
}

async function scanGitHubRepo(owner: string, repo: string, branch?: string, subPath?: string): Promise<ScanResult> {
  const branches = branch ? [branch] : ['main', 'master'];
  let skillFilePaths: string[] = [];
  let usedBranch = '';

  for (const b of branches) {
    try {
      skillFilePaths = await fetchGitHubTree(owner, repo, b, subPath ?? '');
      usedBranch = b;
      if (skillFilePaths.length > 0) break;
    } catch {
      continue;
    }
  }

  if (skillFilePaths.length === 0) {
    throw new Error(
      `No SKILL.md files found in ${owner}/${repo}${subPath ? `/${subPath}` : ''}. ` +
      `Searched branches: ${branches.join(', ')}`,
    );
  }

  const skills: SkillDefinition[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const paths: string[] = [];

  for (const filePath of skillFilePaths) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${usedBranch}/${filePath}`;
    paths.push(rawUrl);
    try {
      const skill = await parseSkill(rawUrl);
      skills.push(skill);
    } catch (err) {
      errors.push({ path: rawUrl, error: (err as Error).message });
    }
  }

  return { skills, paths, errors };
}

export async function scanForSkills(source: string): Promise<ScanResult> {
  // Case 1: GitHub tree URL (e.g., https://github.com/owner/repo/tree/main/skills)
  const treeMatch = source.match(GITHUB_TREE_RE);
  if (treeMatch) {
    const [, owner, repo, branch, path] = treeMatch;
    return scanGitHubRepo(owner, repo, branch, path);
  }

  // Case 2: GitHub repo URL (e.g., https://github.com/owner/repo)
  const repoMatch = source.match(GITHUB_REPO_RE);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    return scanGitHubRepo(owner, repo);
  }

  // Case 3: GitHub shorthand (owner/repo)
  const shorthandMatch = source.match(GITHUB_SHORTHAND_RE);
  if (shorthandMatch && !source.includes('\\') && !source.includes(':')) {
    const [, owner, repo] = shorthandMatch;
    return scanGitHubRepo(owner, repo);
  }

  // Case 4: Local folder path
  try {
    const stats = await stat(source);
    if (stats.isDirectory()) {
      return scanLocalFolder(source);
    }
  } catch {
    // Not a valid path
  }

  throw new Error(
    `"${source}" is not a valid folder path, GitHub repo URL, or GitHub shorthand. ` +
    'The scan command requires a directory or repository to search for SKILL.md files.',
  );
}
