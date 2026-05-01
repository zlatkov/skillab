import type { SkillDefinition, SkillEdge, SkillGraph } from './types';
import { DUMMY_SKILLS } from './types';

// --- GitHub source resolution ---

const GITHUB_BLOB_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
const GITHUB_TREE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;
const GITHUB_REPO_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/;
const GITHUB_SHORTHAND_RE = /^([^/\s]+)\/([^/\s]+)$/;

function toRawGitHubUrl(owner: string, repo: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchGitHubTree(owner: string, repo: string, branch: string, subPath: string): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  const data = await res.json() as { tree: Array<{ path: string; type: string }> };
  const prefix = subPath ? `${subPath}/` : '';
  return data.tree
    .filter(item =>
      item.type === 'blob' &&
      item.path.toUpperCase().endsWith('SKILL.MD') &&
      (prefix === '' || item.path.startsWith(prefix)),
    )
    .map(item => item.path);
}

async function scanGitHubRepo(
  owner: string,
  repo: string,
  branch?: string,
  subPath?: string,
  onStatus?: (msg: string) => void,
): Promise<SkillDefinition[]> {
  const branches = branch ? [branch] : ['main', 'master'];
  let skillPaths: string[] = [];
  let usedBranch = '';

  for (const b of branches) {
    try {
      onStatus?.(`Scanning ${owner}/${repo} (${b})...`);
      skillPaths = await fetchGitHubTree(owner, repo, b, subPath ?? '');
      usedBranch = b;
      if (skillPaths.length > 0) break;
    } catch {
      continue;
    }
  }

  if (skillPaths.length === 0) {
    throw new Error(
      `No SKILL.md files found in ${owner}/${repo}${subPath ? `/${subPath}` : ''}`,
    );
  }

  onStatus?.(`Found ${skillPaths.length} skill(s), fetching...`);

  const skills: SkillDefinition[] = [];
  for (const filePath of skillPaths) {
    const rawUrl = toRawGitHubUrl(owner, repo, usedBranch, filePath);
    try {
      const content = await fetchText(rawUrl);
      const skill = parseSkillContent(content, filePath.split('/').slice(-2, -1)[0] || filePath);
      skills.push(skill);
    } catch {
      // skip unparseable files
    }
  }

  return skills;
}

async function fetchSingleSkill(owner: string, repo: string, branch: string, path: string): Promise<SkillDefinition> {
  const rawUrl = toRawGitHubUrl(owner, repo, branch, path);
  const content = await fetchText(rawUrl);
  return parseSkillContent(content, path);
}

/**
 * Fetch skills from a GitHub source. Supports:
 * - `owner/repo` — scans entire repo
 * - `https://github.com/owner/repo` — scans entire repo
 * - `https://github.com/owner/repo/tree/branch/path` — scans subfolder
 * - `https://github.com/owner/repo/blob/branch/path/SKILL.md` — single file
 */
export async function fetchSkillsFromGitHub(
  source: string,
  onStatus?: (msg: string) => void,
): Promise<SkillDefinition[]> {
  // GitHub blob URL — single file
  const blobMatch = source.match(GITHUB_BLOB_RE);
  if (blobMatch) {
    const [, owner, repo, branch, path] = blobMatch;
    onStatus?.(`Fetching ${path}...`);
    const skill = await fetchSingleSkill(owner, repo, branch, path);
    return [skill];
  }

  // GitHub tree URL — subfolder
  const treeMatch = source.match(GITHUB_TREE_RE);
  if (treeMatch) {
    const [, owner, repo, branch, path] = treeMatch;
    return scanGitHubRepo(owner, repo, branch, path, onStatus);
  }

  // GitHub repo URL
  const repoMatch = source.match(GITHUB_REPO_RE);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    return scanGitHubRepo(owner, repo, undefined, undefined, onStatus);
  }

  // GitHub shorthand (owner/repo)
  const shorthandMatch = source.match(GITHUB_SHORTHAND_RE);
  if (shorthandMatch && !source.includes('\\') && !source.includes(':')) {
    const [, owner, repo] = shorthandMatch;
    return scanGitHubRepo(owner, repo, undefined, undefined, onStatus);
  }

  throw new Error(
    `Invalid GitHub source: "${source}". Use owner/repo, a GitHub URL, or a direct blob/tree link.`,
  );
}

// --- Frontmatter parser ---

// Browser-compatible frontmatter parser (replaces gray-matter which requires Node.js fs)
// Handles YAML block scalars (> and |) and simple key: value pairs
function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, string> = {};
  const lines = match[1].split('\n');
  let currentKey = '';
  let currentValue = '';
  let inBlock = false;

  for (const line of lines) {
    // Indented continuation line (part of a multi-line value)
    if (inBlock && (line.startsWith('  ') || line.startsWith('\t') || line.trim() === '')) {
      currentValue += (currentValue ? ' ' : '') + line.trim();
      continue;
    }

    // Save previous key if we were accumulating
    if (inBlock && currentKey) {
      data[currentKey] = currentValue.trim();
      inBlock = false;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();

      // Block scalar indicators: > (folded) or | (literal)
      if (rawValue === '>' || rawValue === '|') {
        currentKey = key;
        currentValue = '';
        inBlock = true;
        continue;
      }

      // Simple key: value
      const value = rawValue.replace(/^["']|["']$/g, '');
      if (key && value) data[key] = value;
      currentKey = key;
      currentValue = value;
      // Check if next lines might be indented continuation even without > or |
      inBlock = !value;
    }
  }

  // Flush last block value
  if (inBlock && currentKey && currentValue.trim()) {
    data[currentKey] = currentValue.trim();
  }

  return { data, body: match[2] };
}

export function parseSkillContent(rawContent: string, fallbackName?: string): SkillDefinition {
  const { data, body } = parseFrontmatter(rawContent);

  if (!body || !body.trim()) {
    throw new Error('SKILL.md has no content body');
  }

  let name = data.name;
  if (!name) {
    const headingMatch = body.match(/^#\s+(.+)$/m);
    name = headingMatch ? headingMatch[1].trim() : (fallbackName ?? 'unknown-skill');
  }

  let description = data.description;
  if (!description) {
    const firstParagraph = body
      .split('\n\n')
      .find(p => p.trim() && !p.trim().startsWith('#'));
    description = firstParagraph
      ? firstParagraph.trim().slice(0, 200)
      : 'No description available';
  }

  return { name, description, body: body.trim(), rawContent };
}

// Context builder
function buildSkillXml(name: string, description: string, location?: string): string {
  const loc = location ?? `skills/${name}/SKILL.md`;
  return `<skill>
  <name>${name}</name>
  <description>${description}</description>
  <location>${loc}</location>
</skill>`;
}

export function buildTriggerSystemPrompt(skill: SkillDefinition, siblingSkills?: SkillDefinition[]): string {
  const basePrompt = `You are a helpful AI agent. You have access to various skills that can help you complete tasks. When a user's request matches a skill's description, you should use that skill by following its instructions.

When you determine a skill is relevant to the user's request:
1. Announce that you are using the skill
2. Follow the skill's instructions carefully

When no skill matches the user's request, respond normally without mentioning any skills.`;

  let distractorXmls = DUMMY_SKILLS.map(d => buildSkillXml(d.name, d.description));

  if (siblingSkills && siblingSkills.length > 0) {
    const siblingXmls = siblingSkills
      .filter(s => s.name !== skill.name)
      .map(s => buildSkillXml(s.name, s.description));
    distractorXmls.push(...siblingXmls);
  }

  const targetXml = buildSkillXml(skill.name, skill.description);
  const insertIdx = Math.min(2, distractorXmls.length);
  distractorXmls.splice(insertIdx, 0, targetXml);

  return `${basePrompt}

<available_skills>
${distractorXmls.join('\n')}
</available_skills>`;
}

export function buildComplianceSystemPrompt(skill: SkillDefinition): string {
  const basePrompt = `You are a helpful AI agent. You have access to various skills that can help you complete tasks. When a user's request matches a skill's description, you should use that skill by following its instructions.

When you determine a skill is relevant to the user's request:
1. Announce that you are using the skill
2. Follow the skill's instructions carefully

When no skill matches the user's request, respond normally without mentioning any skills.`;

  return `${basePrompt}

<available_skills>
<skill>
  <name>${skill.name}</name>
  <description>${skill.description}</description>
  <instructions>
${skill.body}
  </instructions>
</skill>
</available_skills>`;
}

// Dependency graph
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function buildDependencyGraph(skills: SkillDefinition[]): SkillGraph {
  const nodes = skills.map(s => s.name);
  const edges: SkillEdge[] = [];

  for (const skill of skills) {
    const searchText = skill.rawContent;
    for (const other of skills) {
      if (other.name === skill.name) continue;
      const mentions: string[] = [];

      const namePattern = new RegExp(`\\b${escapeRegex(other.name)}\\b`, 'gi');
      if (namePattern.test(searchText)) {
        mentions.push(`name: "${other.name}"`);
      }

      const slugified = slugify(other.name);
      const pathPatterns = [
        new RegExp(`skills/${escapeRegex(slugified)}/`, 'gi'),
        new RegExp(`skills/${escapeRegex(other.name)}/`, 'gi'),
      ];
      for (const pattern of pathPatterns) {
        if (pattern.test(searchText)) {
          mentions.push('path reference');
          break;
        }
      }

      const depsPattern = new RegExp(
        `(?:dependencies|requires|uses|depends_on|related)\\s*:.*${escapeRegex(other.name)}`,
        'gim',
      );
      if (depsPattern.test(searchText)) {
        mentions.push('frontmatter dependency');
      }

      if (mentions.length > 0) {
        edges.push({ from: skill.name, to: other.name, mentions });
      }
    }
  }

  return { nodes, edges };
}
