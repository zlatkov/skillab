import { z } from 'zod';
import { tool, type CoreTool } from 'ai';
import { DUMMY_SKILLS, type SkillDefinition } from './config.js';

// Tools that require structured definitions — without these, the model fabricates results in text
// Each tool has aliases to match common variations in skill descriptions
const KNOWN_TOOLS: Record<string, { description: string; parameters: z.ZodType; aliases: string[] }> = {
  WebFetch: {
    description: 'Fetch content from a URL',
    parameters: z.object({ url: z.string().describe('The URL to fetch') }),
    aliases: ['WebFetch', 'web_fetch', 'fetch'],
  },
  WebSearch: {
    description: 'Search the web for information',
    parameters: z.object({ query: z.string().describe('The search query') }),
    aliases: ['WebSearch', 'web_search', 'web search'],
  },
  BraveSearch: {
    description: 'Search the web using Brave Search',
    parameters: z.object({ query: z.string().describe('The search query') }),
    aliases: ['BraveSearch', 'brave_search', 'Brave Search', 'brave search'],
  },
  Read: {
    description: 'Read a file from the filesystem',
    parameters: z.object({ file_path: z.string().describe('The file path to read') }),
    aliases: ['Read', 'read_file', 'read file'],
  },
  Write: {
    description: 'Write content to a file',
    parameters: z.object({
      file_path: z.string().describe('The file path to write'),
      content: z.string().describe('The content to write'),
    }),
    aliases: ['Write', 'write_file', 'write file'],
  },
  Edit: {
    description: 'Edit a file by replacing text',
    parameters: z.object({
      file_path: z.string().describe('The file path to edit'),
      old_string: z.string().describe('The text to replace'),
      new_string: z.string().describe('The replacement text'),
    }),
    aliases: ['Edit', 'edit_file', 'edit file'],
  },
  Bash: {
    description: 'Execute a shell command',
    parameters: z.object({ command: z.string().describe('The command to execute') }),
    aliases: ['Bash', 'bash', 'shell', 'terminal', 'run command'],
  },
  Grep: {
    description: 'Search file contents using regex',
    parameters: z.object({
      pattern: z.string().describe('The regex pattern to search for'),
      path: z.string().optional().describe('The directory to search in'),
    }),
    aliases: ['Grep', 'grep', 'search files'],
  },
  Glob: {
    description: 'Find files matching a pattern',
    parameters: z.object({ pattern: z.string().describe('The glob pattern') }),
    aliases: ['Glob', 'glob', 'find files'],
  },
  NotebookEdit: {
    description: 'Edit a Jupyter notebook cell',
    parameters: z.object({
      notebook: z.string().describe('The notebook file path'),
      cell: z.number().describe('The cell index'),
      new_source: z.string().describe('The new cell content'),
    }),
    aliases: ['NotebookEdit', 'notebook_edit', 'notebook edit'],
  },
  code_interpreter: {
    description: 'Execute Python code in a sandbox',
    parameters: z.object({ code: z.string().describe('The Python code to execute') }),
    aliases: ['code_interpreter', 'code interpreter', 'python'],
  },
  browser: {
    description: 'Browse a web page',
    parameters: z.object({ url: z.string().describe('The URL to browse') }),
    aliases: ['browser', 'browse', 'web browser'],
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

export function buildTriggerSystemPrompt(skill: SkillDefinition): string {
  const allSkills = [
    buildSkillXml(DUMMY_SKILLS[0].name, DUMMY_SKILLS[0].description),
    buildSkillXml(DUMMY_SKILLS[1].name, DUMMY_SKILLS[1].description),
    buildSkillXml(skill.name, skill.description),
    buildSkillXml(DUMMY_SKILLS[2].name, DUMMY_SKILLS[2].description),
  ];

  return `${BASE_SYSTEM_PROMPT}

<available_skills>
${allSkills.join('\n')}
</available_skills>`;
}

export function extractMockTools(skill: SkillDefinition): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};
  const body = skill.body;

  for (const [name, def] of Object.entries(KNOWN_TOOLS)) {
    const matched = def.aliases.some(alias => {
      const pattern = new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      return pattern.test(body);
    });
    if (matched) {
      tools[name] = tool({
        description: def.description,
        parameters: def.parameters as z.ZodObject<z.ZodRawShape>,
        execute: async () => `[Mock result from ${name}]`,
      });
    }
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
