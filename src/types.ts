/**
 * Core types shared across ask-ts modules
 */

// Session types
export type Turn = {
  number: number;
  role: 'Human' | 'AI';
  content: string;
};

export type Session = {
  turns: Turn[];
  lastHumanTurnIndex: number;
};

// Bedrock types
export type Message = {
  role: 'user' | 'assistant';
  content: Array<{
    text: string;
  }>;
};

export type StreamEvent =
  | { type: 'start' }
  | { type: 'chunk'; text: string; tokens: number }
  | { type: 'error'; error: Error }
  | { type: 'end'; totalTokens: number };

// Model types
export type ModelType = 'opus' | 'sonnet' | 'haiku';

export type ModelInfo = {
  type: ModelType;
  pattern: string;
  maxTokens: number;
};

// Profile types
export type InferenceProfile = {
  arn: string;
  modelId: string;
};
