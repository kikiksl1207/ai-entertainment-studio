import type { FactoryProvider } from '@nestjs/common';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { semanticConfig } from './story-semantic-analysis.config';
import { StoryContinuationWorker } from './story-continuation.worker';

// Reuse the tested serial Nest lifecycle/drain implementation without changing
// the continuation worker's registration, flags, or provider.
export const SEMANTIC_WORKER = Symbol('SEMANTIC_ANALYSIS_WORKER');
export const SEMANTIC_PROVIDER_FACTORY: FactoryProvider = {
  provide: SemanticAnalysisProvider, useFactory: () => new SemanticAnalysisProvider(semanticConfig()),
};
export const SEMANTIC_WORKER_FACTORY: FactoryProvider = {
  provide: SEMANTIC_WORKER, inject: [SemanticAnalysisService, SemanticAnalysisProvider],
  useFactory: (service: SemanticAnalysisService, provider: SemanticAnalysisProvider) => new StoryContinuationWorker(
    service, provider, { enabled: provider.config.enabled && provider.config.workerEnabled,
      pollMs: 250, maxBackoffMs: 30000, drainMs: 75000 },
  ),
};
