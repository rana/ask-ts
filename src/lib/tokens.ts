import type { Message } from '../types.ts';

export function estimateTokens(messages: Message[]): number {
  let charCount = 0;
  
  for (const message of messages) {
    for (const content of message.content) {
      charCount += content.text.length;
    }
  }
  
  // ~4 characters per token (reasonable for code and English)
  return Math.ceil(charCount / 4);
}