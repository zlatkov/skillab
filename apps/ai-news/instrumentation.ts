import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export let langfuseSpanProcessor: LangfuseSpanProcessor;

export function register() {
  langfuseSpanProcessor = new LangfuseSpanProcessor();

  const provider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  });

  provider.register();
}
