import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { generateText, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const TOOL_DESCRIPTIONS: Record<string, string> = {
  WebFetch: 'Fetch content from a URL',
  WebSearch: 'Search the web for information',
  BraveSearch: 'Search the web using Brave Search',
  Read: 'Read a file from the filesystem',
  Write: 'Write content to a file',
  Edit: 'Edit a file by replacing text',
  Bash: 'Execute a shell command',
  Grep: 'Search file contents using regex',
  Glob: 'Find files matching a pattern',
  ListFiles: 'List files in a directory',
  TodoRead: 'Read the current to-do list',
  TodoWrite: 'Write or update the to-do list',
  NotebookEdit: 'Edit a Jupyter notebook cell',
  Agent: 'Delegate a task to a sub-agent',
};

const genericParams = z.object({
  input: z.string().describe('The primary input for this tool'),
});

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

function buildMockTools(toolNames: string[]) {
  return Object.fromEntries(
    toolNames.map(name => [
      name,
      tool({
        description: TOOL_DESCRIPTIONS[name] || `Execute the ${name} tool`,
        parameters: genericParams,
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
      mockToolNames = [] as string[],
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
    if (useMockTools && mockToolNames.length > 0) {
      options.tools = buildMockTools(mockToolNames);
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
