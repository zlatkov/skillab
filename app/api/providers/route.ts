import { NextResponse } from 'next/server';

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  azure: 'AZURE_API_KEY',
};

export async function GET() {
  const hasKey: Record<string, boolean> = {};
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_KEYS)) {
    hasKey[provider] = !!process.env[envVar];
  }
  return NextResponse.json({ hasKey });
}
