import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { generateText, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const MOCK_TOOLS: Record<string, { description: string; parameters: z.ZodObject<z.ZodRawShape> }> = {
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
};

function createModel(
  provider: string,
  modelId: string,
  apiKey: string,
  azureResourceName?: string,
): LanguageModel {
  switch (provider) {
    case 'openrouter':
      return createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        headers: {
          'HTTP-Referer': 'https://skillab.dev',
          'X-Title': 'skillab',
        },
      })(modelId);

    case 'openai':
      return createOpenAI({ apiKey })(modelId);

    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);

    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId);

    case 'azure': {
      if (!azureResourceName) {
        throw new Error('Azure resource name is required');
      }
      return createAzure({ resourceName: azureResourceName, apiKey })(modelId);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function buildMockTools() {
  return Object.fromEntries(
    Object.entries(MOCK_TOOLS).map(([name, def]) => [
      name,
      tool({
        description: def.description,
        parameters: def.parameters,
        execute: async () => `[Mock result from ${name}]`,
      }),
    ]),
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      provider,
      apiKey,
      modelId,
      messages,
      system,
      prompt,
      temperature = 0.3,
      useMockTools = false,
      maxSteps = 1,
      azureResourceName,
    } = body;

    if (!provider || !apiKey || !modelId) {
      return NextResponse.json({ error: 'Missing required fields: provider, apiKey, modelId' }, { status: 400 });
    }

    const model = createModel(provider, modelId, apiKey, azureResourceName);

    const options: Parameters<typeof generateText>[0] = {
      model,
      temperature,
    };

    if (messages) {
      options.messages = messages;
    }
    if (system) {
      (options as Record<string, unknown>).system = system;
    }
    if (prompt) {
      (options as Record<string, unknown>).prompt = prompt;
    }
    if (useMockTools) {
      options.tools = buildMockTools();
      options.maxSteps = maxSteps;
    }

    const result = await generateText(options);

    const allToolCalls = result.steps?.flatMap(s => s.toolCalls ?? []) ?? [];

    return NextResponse.json({
      text: result.text,
      toolCalls: allToolCalls.map(tc => ({ toolName: tc.toolName, args: tc.args })),
      steps: (result.steps ?? []).map(s => ({
        toolCalls: (s.toolCalls ?? []).map(tc => ({ toolName: tc.toolName, args: tc.args })),
      })),
    });
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : String(err);

    // AI SDK errors often wrap the real cause — try to extract it
    const cause = err instanceof Error && 'cause' in err ? (err.cause as Error)?.message : undefined;
    const data = err instanceof Error && 'data' in err ? JSON.stringify((err as Record<string, unknown>).data) : undefined;
    const responseBody = err instanceof Error && 'responseBody' in err ? String((err as Record<string, unknown>).responseBody) : undefined;

    const details = [cause, data, responseBody].filter(Boolean).join(' | ');
    if (details) {
      message = `${message} — ${details}`;
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
