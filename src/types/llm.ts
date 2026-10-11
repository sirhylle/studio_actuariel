import { WorkerError } from './protocol';

export interface LlmConfig {
  endpoint: string;
  token: string;
  model: string;
  maxSampleRows: number;
  maxSelfHealingRetries: number;
  useMock?: boolean;
  apiType?: 'chat_completions' | 'responses_api';
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface SamplingStrategyResponse {
  strategyExplanation: string;
  extractionPythonCode: string;
}

export interface ActuarialCodeResponse {
  pythonCode: string;
  transformationsApplied: string[];
  warnings: string[];
  reconciliationAssertions?: string[];
}

export interface RepairContext {
  previousCode: string;
  error: WorkerError;
  userInstruction: string;
  sampleData?: Record<string, any>;
}
