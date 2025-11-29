#!/usr/bin/env bun
import { 
  BedrockRuntimeClient, 
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type Message
} from '@aws-sdk/client-bedrock-runtime';
import { 
  BedrockClient,
  ListInferenceProfilesCommand,
  ListFoundationModelsCommand
} from '@aws-sdk/client-bedrock';
import { appendFileSync } from 'node:fs';
import type { Turn, Session, StreamEvent } from './types.ts';

// Constants
const SESSION_PATH = 'session.md';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Model patterns to search for
const MODEL_PATTERNS = {
  opus: 'claude-4-5-opus',    // Will find latest opus
  sonnet: 'claude-4-5-sonnet', // Will find latest sonnet  
  haiku: 'claude-4-5-haiku'    // Will find latest haiku
} as const;

// Conservative token limits that work with most profiles
const TOKEN_LIMITS = {
  opus: 4096,
  sonnet: 4096,
  haiku: 4096
} as const;

type ModelType = keyof typeof MODEL_PATTERNS;
const DEFAULT_MODEL: ModelType = 'opus';

// Create AWS clients with timeout
function createBedrockClient() {
  return new BedrockClient({
    region: process.env['AWS_REGION'] || 'us-west-2',
    requestHandler: {
      requestTimeout: TIMEOUT_MS,
      httpsAgent: { keepAlive: true }
    } as any
  });
}

function createBedrockRuntimeClient() {
  return new BedrockRuntimeClient({
    region: process.env['AWS_REGION'] || 'us-west-2',
    requestHandler: {
      requestTimeout: TIMEOUT_MS,
      httpsAgent: { keepAlive: true }
    } as any
  });
}

// Discover available models
async function discoverAvailableModels(): Promise<Map<string, string>> {
  const client = createBedrockClient();
  const modelMap = new Map<string, string>();

  try {
    const command = new ListFoundationModelsCommand({});
    const response = await client.send(command);
    
    if (response.modelSummaries) {
      for (const model of response.modelSummaries) {
        if (model.modelId && model.modelName) {
          const id = model.modelId.toLowerCase();
          
          // Check each pattern
          for (const [type, pattern] of Object.entries(MODEL_PATTERNS)) {
            if (id.includes(pattern)) {
              // Store the most recent (by ID sorting)
              const existing = modelMap.get(type);
              if (!existing || id > existing) {
                modelMap.set(type, model.modelId);
              }
            }
          }
        }
      }
    }
    
    return modelMap;
  } catch (error) {
    console.error('Warning: Could not list foundation models:', error);
    return modelMap;
  }
}

// Find inference profile for model type
async function findInferenceProfile(modelType: ModelType): Promise<{ profileArn: string; modelId: string }> {
  const client = createBedrockClient();

  try {
    const command = new ListInferenceProfilesCommand({
      maxResults: 100
    });
    
    const response = await client.send(command);
    
    if (!response.inferenceProfileSummaries || response.inferenceProfileSummaries.length === 0) {
      throw new Error('No inference profiles found. Check your AWS account has cross-region inference enabled.');
    }

    const pattern = MODEL_PATTERNS[modelType];
    
    // First, try to find by model pattern in profile models
    for (const profile of response.inferenceProfileSummaries) {
      if (!profile.inferenceProfileArn || !profile.models) continue;
      
      for (const model of profile.models) {
        if (model.modelArn?.toLowerCase().includes(pattern)) {
          return {
            profileArn: profile.inferenceProfileArn,
            modelId: model.modelArn
          };
        }
      }
    }
    
    // Second, try to find by profile name
    for (const profile of response.inferenceProfileSummaries) {
      if (!profile.inferenceProfileArn) continue;
      
      const profileName = profile.inferenceProfileName?.toLowerCase() || '';
      if (profileName.includes(modelType)) {
        return {
          profileArn: profile.inferenceProfileArn,
          modelId: `${pattern} (via profile name)`
        };
      }
    }
    
    // List available models for better error message
    const availableModels = await discoverAvailableModels();
    const availableList = Array.from(availableModels.entries())
      .map(([type, id]) => `  ${type}: ${id}`)
      .join('\n');
    
    throw new Error(`No inference profile found for ${modelType} models.

Available models in your account:
${availableList || '  (none found)'}

This model requires a system-provided cross-region inference profile.

Solutions:
  1. Check AWS Bedrock console for available models
  2. Try a different model: bun run src/index.ts --model sonnet
  3. Contact AWS support to enable cross-region inference

Visit: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html`);
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('inference profile')) {
      throw error;
    }
    throw new Error(`Failed to list inference profiles: ${error}\n\nMake sure your AWS credentials have bedrock:ListInferenceProfiles permission`);
  }
}

// Parse session.md into turns
function parseSession(content: string): Session {
  const turns: Turn[] = [];
  
  // Match headers like "# [1] Human" or "# [2] AI"
  const headerPattern = /^# \[(\d+)\] (Human|AI)$/gm;
  const matches = Array.from(content.matchAll(headerPattern));
  
  if (matches.length === 0) {
    return { turns: [], lastHumanTurnIndex: -1 };
  }
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match || match.index === undefined) continue;
    
    const number = parseInt(match[1]!, 10);
    const role = match[2] as 'Human' | 'AI';
    
    // Extract content between headers
    const startPos = match.index + match[0].length;
    const nextMatch = matches[i + 1];
    const endPos = nextMatch?.index ?? content.length;
    let turnContent = content.slice(startPos, endPos).trim();
    
    // Strip markdown wrapper from AI responses
    if (role === 'AI' && turnContent.startsWith('````markdown')) {
      turnContent = turnContent
        .replace(/^````markdown\n/, '')
        .replace(/\n````$/, '')
        .trim();
    }
    
    if (turnContent) {
      turns.push({ number, role, content: turnContent });
    }
  }
  
  // Find last human turn
  let lastHumanTurnIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn && turn.role === 'Human') {
      lastHumanTurnIndex = i;
      break;
    }
  }
  
  return { turns, lastHumanTurnIndex };
}

// Convert turns to Bedrock message format
function turnsToMessages(turns: Turn[]): Message[] {
  return turns.map(turn => ({
    role: turn.role === 'Human' ? 'user' : 'assistant',
    content: [{
      text: turn.content
    }]
  }));
}

// Stream response from Bedrock
async function* streamFromBedrock(
  profileArn: string, 
  messages: Message[],
  maxTokens: number
): AsyncGenerator<StreamEvent> {
  const client = createBedrockRuntimeClient();
  
  const input: ConverseStreamCommandInput = {
    modelId: profileArn,
    messages,
    inferenceConfig: {
      temperature: 1.0,
      maxTokens
    }
  };
  
  try {
    yield { type: 'start' };
    
    const command = new ConverseStreamCommand(input);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    try {
      const response = await client.send(command, {
        abortSignal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      let totalTokens = 0;
      
      if (response.stream) {
        for await (const event of response.stream) {
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text;
            const tokens = Math.ceil(text.length / 4);
            totalTokens += tokens;
            yield { type: 'chunk', text, tokens: totalTokens };
          }
          
          if (event.metadata?.usage?.outputTokens) {
            totalTokens = event.metadata.usage.outputTokens;
          }
        }
      }
      
      yield { type: 'end', totalTokens };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out after 5 minutes');
      }
      throw error;
    }
  } catch (error) {
    yield { type: 'error', error: error as Error };
  }
}

// Atomic file writer for streaming - now with real-time visibility
class StreamWriter {
  private headerWritten = false;
  private contentWritten = false;
  
  constructor(
    private sessionPath: string,
    private nextNumber: number
  ) {}
  
  async open(): Promise<void> {
    // Read current content and append header
    const content = await Bun.file(this.sessionPath).text();
    const header = `\n\n# [${this.nextNumber}] AI\n\n\`\`\`\`markdown\n`;
    
    // Use Bun.write for initial setup (replaces entire file)
    await Bun.write(this.sessionPath, content.trimEnd() + header);
    this.headerWritten = true;
  }
  
  async writeChunk(chunk: string): Promise<void> {
    if (!this.headerWritten) {
      await this.open();
    }
    
    // Append chunk directly to session.md for real-time visibility
    appendFileSync(this.sessionPath, chunk);
    this.contentWritten = true;
  }
  
  async close(interrupted: boolean = false): Promise<void> {
    if (this.headerWritten) {
      // Append closing markdown and next human turn
      let closing = '';
      
      if (interrupted && this.contentWritten) {
        closing += '\n[Interrupted]';
      }
      
      closing += `\n\`\`\`\`\n\n# [${this.nextNumber + 1}] Human\n\n`;
      
      appendFileSync(this.sessionPath, closing);
    }
  }
}

// Parse simple CLI args for Phase 1
function parseArgs(): { model: ModelType } {
  const args = Bun.argv.slice(2);
  let model: ModelType = DEFAULT_MODEL;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      const modelArg = args[i + 1] as string;
      if (modelArg in MODEL_PATTERNS) {
        model = modelArg as ModelType;
      } else {
        console.error(`Unknown model: ${modelArg}`);
        console.error(`Available models: ${Object.keys(MODEL_PATTERNS).join(', ')}`);
        process.exit(1);
      }
    }
  }
  
  return { model };
}

// Main program
async function main(): Promise<void> {
  try {
    // Parse arguments
    const { model: modelType } = parseArgs();
    
    // Check if session.md exists
    const sessionFile = Bun.file(SESSION_PATH);
    if (!await sessionFile.exists()) {
      console.error('No session.md found. Run \'ask init\' to start');
      process.exit(1);
    }
    
    // Read and parse session
    const content = await sessionFile.text();
    const session = parseSession(content);
    
    // Validate session has proper format
    if (session.turns.length === 0) {
      console.error('No turns found in session.md. Make sure it has proper format:\n\n# [1] Human\n\nYour question here');
      process.exit(1);
    }
    
    // Validate session has a human turn
    if (session.lastHumanTurnIndex === -1) {
      console.error('No human turn found in session.md');
      process.exit(1);
    }
    
    // Check if last human turn has content
    const lastHumanTurn = session.turns[session.lastHumanTurnIndex];
    if (!lastHumanTurn || !lastHumanTurn.content.trim()) {
      console.error(`Turn ${lastHumanTurn?.number ?? '?'} has no content. Add your question and try again.`);
      process.exit(1);
    }
    
    // Check for existing AI response after last human turn
    const lastTurn = session.turns[session.turns.length - 1];
    if (lastTurn && lastTurn.role === 'AI' && lastTurn.number > lastHumanTurn.number) {
      console.error(`Turn ${lastHumanTurn.number} already has a response. Add a new human turn to continue.`);
      process.exit(1);
    }
    
    // Find inference profile for our model
    let profileArn: string;
    let modelId: string;
    try {
      const result = await findInferenceProfile(modelType);
      profileArn = result.profileArn;
      modelId = result.modelId;
    } catch (error) {
      console.error(`${error}`);
      process.exit(1);
    }
    
    // Show model info
    console.log(`Model: ${modelId}`);
    console.log();
    
    // Convert to Bedrock format  
    const messages = turnsToMessages(session.turns);
    
    // Create stream writer
    const writer = new StreamWriter(SESSION_PATH, lastHumanTurn.number + 1);
    
    // Stream response
    console.log('Streaming response... [ctrl+c to interrupt]');
    let lastTokenCount = 0;
    let interrupted = false;
    
    // Handle interruption
    const onInterrupt = () => {
      interrupted = true;
      process.stdout.write('\nInterrupting...\n');
    };
    process.on('SIGINT', onInterrupt);
    
    try {
      const maxTokens = TOKEN_LIMITS[modelType];
      
      for await (const event of streamFromBedrock(profileArn, messages, maxTokens)) {
        if (interrupted) break;
        
        switch (event.type) {
          case 'chunk':
            await writer.writeChunk(event.text);
            
            // Update progress
            if (event.tokens - lastTokenCount >= 100 || event.tokens < 100) {
              process.stdout.write(`\rStreaming response... ${event.tokens} tokens [ctrl+c to interrupt]`);
              lastTokenCount = event.tokens;
            }
            break;
            
          case 'error':
            // Clear progress line
            process.stdout.write('\r\x1b[K');
            
            // Handle specific error types
            if (event.error.name === 'CredentialsProviderError') {
              console.error('AWS credentials not configured.\n\nRun: aws configure');
            } else if (event.error.message.includes('ValidationException')) {
              console.error('Invalid request to Bedrock. Check your AWS region and model access.');
            } else if (event.error.message.includes('maximum tokens')) {
              console.error(`Token limit exceeded. This profile supports fewer tokens than requested.\nTry a shorter conversation or different model.`);
            } else if (event.error.message.includes('conversation must start with a user message')) {
              console.error('No valid human message found. Check session.md format.');
            } else if (event.error.message.includes('timed out')) {
              console.error('Request timed out. Try a shorter conversation or simpler request.');
            } else {
              console.error('Error:', event.error.message);
            }
            
            await writer.close(true);
            process.exit(1);
            break;
            
          case 'end':
            if (!interrupted) {
              // Clear progress line and show final count
              process.stdout.write(`\r\x1b[K`);
              console.log(`Response complete: ${event.totalTokens} tokens`);
            }
            break;
        }
      }
      
      await writer.close(interrupted);
      
      if (interrupted) {
        console.log('Response interrupted and saved');
      }
      
    } catch (error) {
      console.error('Streaming failed:', error);
      await writer.close(true);
      process.exit(1);
    } finally {
      process.off('SIGINT', onInterrupt);
    }
    
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
