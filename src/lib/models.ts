import type { ModelInfo, ModelType } from '../types.ts';

export const MODEL_PATTERNS = {
  opus: 'claude-4-5-opus', // Matches all opus models
  sonnet: 'claude-4-5-sonnet', // Matches all sonnet models
  haiku: 'claude-4-5-haiku', // Matches all haiku models
} as const;

export const MODEL_INFO: Record<ModelType, ModelInfo> = {
  opus: {
    type: 'opus',
    pattern: MODEL_PATTERNS.opus,
    maxTokens: 64000,
  },
  sonnet: {
    type: 'sonnet',
    pattern: MODEL_PATTERNS.sonnet,
    maxTokens: 64000,
  },
  haiku: {
    type: 'haiku',
    pattern: MODEL_PATTERNS.haiku,
    maxTokens: 64000,
  },
};

export const DEFAULT_MODEL: ModelType = 'opus';

export function getModelInfo(type: ModelType): ModelInfo {
  return MODEL_INFO[type];
}

export function isValidModel(value: unknown): value is ModelType {
  return typeof value === 'string' && value in MODEL_INFO;
}
