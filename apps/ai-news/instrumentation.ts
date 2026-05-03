import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export function register() {
  const processor = new LangfuseSpanProcessor();

  const provider = new NodeTracerProvider({
    spanProcessors: [processor],
  });

  provider.register();

  (globalThis as { __langfuseProcessor?: LangfuseSpanProcessor }).__langfuseProcessor = processor;
}
