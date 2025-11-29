/**
 * Unified error handling for ask-ts
 * 
 * Philosophy: One error class with helpful messages.
 * Every error should explain what went wrong and how to fix it.
 */

export class AskError extends Error {
  constructor(message: string, public help?: string) {
    super(message);
    this.name = 'AskError';
  }

  /**
   * Convert any error into an AskError with helpful context
   */
  static from(error: unknown): AskError {
    if (error instanceof AskError) return error;
    
    const message = error instanceof Error ? error.message : String(error);
    
    // AWS Credential errors
    if (message.includes('CredentialsProviderError')) {
      return new AskError(
        'AWS credentials not configured',
        'Run: aws configure'
      );
    }
    
    // Bedrock validation errors
    if (message.includes('ValidationException')) {
      return new AskError(
        'Invalid request to Bedrock',
        'Check your AWS region and model access'
      );
    }
    
    // Token limit errors
    if (message.includes('maximum tokens')) {
      return new AskError(
        'Token limit exceeded',
        'Try a shorter conversation or different model'
      );
    }
    
    // Message format errors
    if (message.includes('conversation must start with a user message')) {
      return new AskError(
        'Invalid conversation format',
        'Check session.md has proper Human/AI structure'
      );
    }
    
    // Timeout errors
    if (message.includes('timed out') || message.includes('AbortError')) {
      return new AskError(
        'Request timed out after 5 minutes',
        'Try a shorter conversation or simpler request'
      );
    }
    
    // Profile not found
    if (message.includes('inference profile')) {
      return new AskError(message); // Already has good context
    }
    
    // Generic error
    return new AskError(message);
  }

  /**
   * Format error for display
   */
  override toString(): string {
    if (this.help) {
      return `${this.message}\n\n${this.help}`;
    }
    return this.message;
  }
}

/**
 * Check if a file exists, throw helpful error if not
 */
export async function requireFile(path: string, hint: string): Promise<void> {
  const file = Bun.file(path);
  if (!await file.exists()) {
    throw new AskError(
      `No ${path} found`,
      hint
    );
  }
}

/**
 * Exit with error message
 */
export function exitWithError(error: unknown): never {
  const askError = AskError.from(error);
  console.error(askError.toString());
  process.exit(1);
}
