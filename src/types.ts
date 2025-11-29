// Domain types that map to user concepts
export type Turn = {
  number: number;
  role: 'Human' | 'AI';
  content: string;
};

export type Session = {
  turns: Turn[];
  lastHumanTurnIndex: number;
};

// Bedrock message format
export type BedrockMessage = {
  role: 'user' | 'assistant';
  content: Array<{
    text: string;
  }>;
};

// Stream events for progress tracking
export type StreamEvent = 
  | { type: 'start' }
  | { type: 'chunk'; text: string; tokens: number }
  | { type: 'error'; error: Error }
  | { type: 'end'; totalTokens: number };

// Model types we support
export type ModelType = 'opus' | 'sonnet' | 'haiku';

// Inference profile info
export type InferenceProfile = {
  arn: string;
  name: string;
  modelType: ModelType;
};
