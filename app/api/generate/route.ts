import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// --- In-memory sliding-window rate limiter (per IP, server-key only) ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // max requests per window per IP

const ipRequestLog = new Map<string, number[]>();

// Periodically clean stale entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipRequestLog) {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) ipRequestLog.delete(ip);
    else ipRequestLog.set(ip, valid);
  }
}, 60_000);

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = (ipRequestLog.get(ip) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    ipRequestLog.set(ip, timestamps);
    return { allowed: false, remaining: 0 };
  }
  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);
  return { allowed: true, remaining: RATE_LIMIT_MAX - timestamps.length };
}

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
) {
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

    case 'groq':
      return createGroq({ apiKey })(modelId);

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
      {
        description: TOOL_DESCRIPTIONS[name] || `Execute the ${name} tool`,
        parameters: genericParams,
        execute: async (_args: { input: string }) => `[Mock result from ${name}]`,
      },
    ]),
  );
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  azure: 'AZURE_API_KEY',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      provider,
      apiKey: userApiKey,
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

    if (!provider || !modelId) {
      return NextResponse.json({ error: 'Missing required fields: provider, modelId' }, { status: 400 });
    }

    // Resolve API key: user-provided takes priority, then env var
    const apiKey = userApiKey || (PROVIDER_ENV_KEYS[provider] ? process.env[PROVIDER_ENV_KEYS[provider]] : undefined);
    if (!apiKey) {
      return NextResponse.json({ error: `No API key provided for ${provider}` }, { status: 400 });
    }

    // Rate-limit only when using server-side API keys (not BYOK)
    if (!userApiKey) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const { allowed, remaining } = checkRateLimit(ip);
      if (!allowed) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please wait a minute or use your own API key.' },
          {
            status: 429,
            headers: {
              'Retry-After': '60',
              'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
              'X-RateLimit-Remaining': String(remaining),
            },
          },
        );
      }
    }

    const model = createModel(provider, modelId, apiKey, azureResourceName);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: Record<string, any> = {
      model,
      temperature,
    };

    if (messages) options.messages = messages;
    if (system) options.system = system;
    if (prompt) options.prompt = prompt;
    if (useMockTools && mockToolNames.length > 0) {
      options.tools = buildMockTools(mockToolNames);
      options.maxSteps = maxSteps;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (generateText as Function)(options);

    const allToolCalls = result.steps?.flatMap((s: any) => s.toolCalls ?? []) ?? [];

    return NextResponse.json({
      text: result.text,
      toolCalls: allToolCalls.map((tc: any) => ({ toolName: tc.toolName, args: tc.args })),
      steps: (result.steps ?? []).map((s: any) => ({
        toolCalls: (s.toolCalls ?? []).map((tc: any) => ({ toolName: tc.toolName, args: tc.args })),
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
