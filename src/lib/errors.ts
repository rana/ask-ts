import { output } from './output.ts';

export class AskError extends Error {
  constructor(
    message: string,
    public help?: string,
  ) {
    super(message);
    this.name = 'AskError';
  }

  static from(error: unknown): AskError {
    if (error instanceof AskError) return error;

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('CredentialsProviderError')) {
      return new AskError('AWS credentials not configured', 'Run: aws configure');
    }

    if (message.includes('ValidationException')) {
      return new AskError('Invalid request to Bedrock', 'Check your AWS region and model access');
    }

    if (message.includes('maximum tokens')) {
      return new AskError('Token limit exceeded', 'Try a shorter conversation or different model');
    }

    if (message.includes('conversation must start with a user message')) {
      return new AskError(
        'Invalid conversation format',
        'Check session.md has proper Human/AI structure',
      );
    }

    if (message.includes('timed out') || message.includes('AbortError')) {
      return new AskError(
        'Request timed out after 5 minutes',
        'Try a shorter conversation or simpler request',
      );
    }

    if (message.includes('inference profile')) {
      return new AskError(message);
    }

    return new AskError(message);
  }

  override toString(): string {
    if (this.help) {
      return `${this.message}\n\n${this.help}`;
    }
    return this.message;
  }
}

export async function requireFile(path: string, hint: string): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new AskError(`No ${path} found`, hint);
  }
}

export function exitWithError(error: unknown): never {
  const askError = AskError.from(error);
  output.error(askError.message);
  if (askError.help) {
    output.info('');
    output.info(askError.help);
  }
  process.exit(1);
}
