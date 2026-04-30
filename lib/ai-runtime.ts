import * as aiRuntimeJs from './ai-runtime.js';

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiRuntimeConfig = {
  apiUrl: string;
  model: string;
  apiKey: string;
  disableThinking: boolean;
};

export type RequestAiJsonOptions = Partial<AiRuntimeConfig> & {
  messages: AiMessage[];
  temperature?: number;
  timeoutMs?: number;
  cache?: RequestCache;
  includeThinkingControl?: boolean;
  extraBody?: Record<string, unknown>;
};

const runtime = aiRuntimeJs as {
  DEFAULT_AI_MODEL: string;
  DEFAULT_AI_URL: string;
  createAiRuntimeConfig: (overrides?: Partial<AiRuntimeConfig>) => AiRuntimeConfig;
  getAiApiKey: () => string;
  normalizeAiApiUrl: (value?: string) => string;
  parseJsonFromAiContent: <T>(content: string) => T | null;
  requestAiJson: <T>(options: RequestAiJsonOptions) => Promise<T | null>;
  shouldDisableThinking: (config: Partial<AiRuntimeConfig>) => boolean;
  shouldUseJsonFormat: (apiUrl: string, model: string) => boolean;
};

export const DEFAULT_AI_MODEL = runtime.DEFAULT_AI_MODEL;
export const DEFAULT_AI_URL = runtime.DEFAULT_AI_URL;
export const createAiRuntimeConfig = runtime.createAiRuntimeConfig;
export const getAiApiKey = runtime.getAiApiKey;
export const normalizeAiApiUrl = runtime.normalizeAiApiUrl;
export const parseJsonFromAiContent = runtime.parseJsonFromAiContent;
export const requestAiJson = runtime.requestAiJson;
export const shouldDisableThinking = runtime.shouldDisableThinking;
export const shouldUseJsonFormat = runtime.shouldUseJsonFormat;