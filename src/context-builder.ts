import { z } from 'zod';
import { tool, type CoreTool } from 'ai';
import { DUMMY_SKILLS, type SkillDefinition } from './config.js';

// Tools provided to the model during compliance testing, matching what real agent hosts offer
const KNOWN_TOOLS: Record<string, { description: string; parameters: z.ZodType }> = {
  WebFetch: {
    description: 'Fetch content from a URL',
    parameters: z.object({ url: z.string().describe('The URL to fetch') }),
  },
  WebSearch: {
    description: 'Search the web for information',
    parameters: z.object({ query: z.string().describe('The search query') }),
  },
  BraveSearch: {
    description: 'Search the web using Brave Search',
    parameters: z.object({ query: z.string().describe('The search query') }),
  },
  Read: {
    description: 'Read a file from the filesystem',
    parameters: z.object({ file_path: z.string().describe('The file path to read') }),
  },
  Write: {
    description: 'Write content to a file',
    parameters: z.object({
      file_path: z.string().describe('The file path to write'),
      content: z.string().describe('The content to write'),
    }),
  },
  Edit: {
    description: 'Edit a file by replacing text',
    parameters: z.object({
      file_path: z.string().describe('The file path to edit'),
      old_string: z.string().describe('The text to replace'),
      new_string: z.string().describe('The replacement text'),
    }),
  },
  Bash: {
    description: 'Execute a shell command',
    parameters: z.object({ command: z.string().describe('The command to execute') }),
  },
  Grep: {
    description: 'Search file contents using regex',
    parameters: z.object({
      pattern: z.string().describe('The regex pattern to search for'),
      path: z.string().optional().describe('The directory to search in'),
    }),
  },
  Glob: {
    description: 'Find files matching a pattern',
    parameters: z.object({ pattern: z.string().describe('The glob pattern') }),
  },
  NotebookEdit: {
    description: 'Edit a Jupyter notebook cell',
    parameters: z.object({
      notebook: z.string().describe('The notebook file path'),
      cell: z.number().describe('The cell index'),
      new_source: z.string().describe('The new cell content'),
    }),
  },
  code_interpreter: {
    description: 'Execute Python code in a sandbox',
    parameters: z.object({ code: z.string().describe('The Python code to execute') }),
  },
  browser: {
    description: 'Browse a web page',
    parameters: z.object({ url: z.string().describe('The URL to browse') }),
  },
};

const BASE_SYSTEM_PROMPT = `You are a helpful AI agent. You have access to various skills that can help you complete tasks. When a user's request matches a skill's description, you should use that skill by following its instructions.

When you determine a skill is relevant to the user's request:
1. Announce that you are using the skill
2. Follow the skill's instructions carefully

When no skill matches the user's request, respond normally without mentioning any skills.`;

function buildSkillXml(name: string, description: string, location?: string): string {
  const loc = location ?? `skills/${name}/SKILL.md`;
  return `<skill>
  <name>${name}</name>
  <description>${description}</description>
  <location>${loc}</location>
</skill>`;
}

export function buildTriggerSystemPrompt(skill: SkillDefinition, siblingSkills?: SkillDefinition[]): string {
  let distractorXmls: string[];

  // Always include dummy skills as distractors
  distractorXmls = DUMMY_SKILLS.map(d => buildSkillXml(d.name, d.description));

  // Also include real sibling skills when available
  if (siblingSkills && siblingSkills.length > 0) {
    const siblingXmls = siblingSkills
      .filter(s => s.name !== skill.name)
      .map(s => buildSkillXml(s.name, s.description));
    distractorXmls.push(...siblingXmls);
  }

  // Insert target skill at a random-ish position among distractors
  const targetXml = buildSkillXml(skill.name, skill.description);
  const insertIdx = Math.min(2, distractorXmls.length);
  distractorXmls.splice(insertIdx, 0, targetXml);

  return `${BASE_SYSTEM_PROMPT}

<available_skills>
${distractorXmls.join('\n')}
</available_skills>`;
}

export function buildMockTools(): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const [name, def] of Object.entries(KNOWN_TOOLS)) {
    tools[name] = tool({
      description: def.description,
      parameters: def.parameters as z.ZodObject<z.ZodRawShape>,
      execute: async () => `[Mock result from ${name}]`,
    });
  }

  return tools;
}

export function buildComplianceSystemPrompt(skill: SkillDefinition): string {
  return `${BASE_SYSTEM_PROMPT}

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
