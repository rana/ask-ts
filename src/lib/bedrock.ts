/**
 * AWS Bedrock operations - hides all AWS complexity
 */

import { 
  BedrockRuntimeClient, 
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { 
  type InferenceProfileSummary,
  BedrockClient,
  ListInferenceProfilesCommand,
  ListFoundationModelsCommand
} from '@aws-sdk/client-bedrock';

import type { ModelType, Message, StreamEvent, InferenceProfile } from '../types.ts';
import { AskError } from './errors.ts';

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Cached clients
let bedrockClient: BedrockClient | null = null;
let runtimeClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockClient({
      region: process.env['AWS_REGION'] || 'us-west-2',
      requestHandler: {
        requestTimeout: TIMEOUT_MS,
        httpsAgent: { keepAlive: true }
      } as any
    });
  }
  return bedrockClient;
}

function getRuntimeClient(): BedrockRuntimeClient {
  if (!runtimeClient) {
    runtimeClient = new BedrockRuntimeClient({
      region: process.env['AWS_REGION'] || 'us-west-2',
      requestHandler: {
        requestTimeout: TIMEOUT_MS,
        httpsAgent: { keepAlive: true }
      } as any
    });
  }
  return runtimeClient;
}

async function fetchAllInferenceProfiles(
  client: BedrockClient
): Promise<InferenceProfileSummary[]> {
  const allProfiles: InferenceProfileSummary[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListInferenceProfilesCommand({
      maxResults: 100,
      ...(nextToken && { nextToken })
    });
    
    const response = await client.send(command);
    
    if (response.inferenceProfileSummaries) {
      allProfiles.push(...response.inferenceProfileSummaries);
    }
    
    nextToken = response.nextToken;
  } while (nextToken);

  return allProfiles;
}

function parseModelVersion(modelId: string): { major: number; minor: number; date: string } {
  // Extract date (8 digits)
  const dateMatch = modelId.match(/(\d{8})/);
  const date = dateMatch?.[1] || '00000000';
  
  // Split by dash and find numeric segments before the date
  const parts = modelId.split('-');
  const dateIndex = parts.findIndex(part => part === date);
  
  if (dateIndex === -1) {
    return { major: 3, minor: 0, date };
  }
  
  // Look for version numbers before the date
  const versionParts: number[] = [];
  
  for (let i = 0; i < dateIndex; i++) {
    const part = parts[i];
    // Check if this part is a pure number
    if (part && /^\d+$/.test(part)) {
      versionParts.push(parseInt(part, 10));
    }
  }
  
  // If no version parts found, default to 3.0
  if (versionParts.length === 0) {
    return { major: 3, minor: 0, date };
  }
  
  // First number is major, second is minor (if exists)
  const major = versionParts[0] || 3;
  const minor = versionParts[1] || 0;
  
  return { major, minor, date };
}

export async function findProfile(modelType: ModelType): Promise<InferenceProfile> {
  const client = getBedrockClient();

  try {
    const allProfiles = await fetchAllInferenceProfiles(client);
    
    if (allProfiles.length === 0) {
      throw new AskError(
        'No inference profiles found',
        'Check your AWS account has cross-region inference enabled'
      );
    }

    // Find all matching models
    const matches: Array<{
      arn: string;
      modelId: string;
      version: ReturnType<typeof parseModelVersion>;
    }> = [];

    for (const profile of allProfiles) {
      if (!profile.inferenceProfileArn || !profile.models) continue;
      
      for (const model of profile.models) {
        if (!model.modelArn) continue;
        
        const modelArn = model.modelArn.toLowerCase();
        
        // Match by model type (opus/sonnet/haiku)
        if (!modelArn.includes(modelType)) continue;
        
        // Extract model ID from ARN
        const modelId = model.modelArn.split('/').pop() || model.modelArn;
        const version = parseModelVersion(modelId);
        
        matches.push({
          arn: profile.inferenceProfileArn,
          modelId,
          version
        });
      }
    }
    
    // Sort by version (major.minor) then date
    matches.sort((a, b) => {
      if (a.version.major !== b.version.major) {
        return b.version.major - a.version.major;
      }
      if (a.version.minor !== b.version.minor) {
        return b.version.minor - a.version.minor;
      }
      return b.version.date.localeCompare(a.version.date);
    });
    
    if (matches.length > 0) {
      const selected = matches[0]!;
      return {
        arn: selected.arn,
        modelId: selected.modelId
      };
    }

    // Fallback: Try to find by profile name
    for (const profile of allProfiles) {
      if (!profile.inferenceProfileArn) continue;
      
      const profileName = profile.inferenceProfileName?.toLowerCase() || '';
      if (profileName.includes(modelType)) {
        let modelId = `${modelType} (profile matched by name)`;
        
        if (profile.models && profile.models.length > 0) {
          const firstModel = profile.models[0];
          if (firstModel?.modelArn) {
            modelId = firstModel.modelArn.split('/').pop() || firstModel.modelArn;
          }
        }
        
        return {
          arn: profile.inferenceProfileArn,
          modelId: modelId
        };
      }
    }
    
    // If no profile found, show available models
    const availableModels = await discoverAvailableModels();
    const availableList = Array.from(availableModels.entries())
      .map(([type, id]) => `  ${type}: ${id}`)
      .join('\n');
    
    throw new AskError(
      `No inference profile found for ${modelType} models.\n\n` +
      `Available models in your account:\n${availableList || '  (none found)'}\n\n` +
      `This model requires a system-provided cross-region inference profile.\n\n` +
      `Solutions:\n` +
      `  1. Check AWS Bedrock console for available models\n` +
      `  2. Try a different model: bun run src/cli.ts --model sonnet\n` +
      `  3. Contact AWS support to enable cross-region inference\n\n` +
      `Visit: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html`
    );
    
  } catch (error) {
    if (error instanceof AskError) throw error;
    throw new AskError(
      `Failed to list inference profiles: ${error}`,
      'Make sure your AWS credentials have bedrock:ListInferenceProfiles permission'
    );
  }
}

/**
 * Discover what models are available (for error messages)
 */
async function discoverAvailableModels(): Promise<Map<string, string>> {
  const client = getBedrockClient();
  const modelMap = new Map<string, string>();

  try {
    const command = new ListFoundationModelsCommand({});
    const response = await client.send(command);
    
    if (response.modelSummaries) {
      for (const model of response.modelSummaries) {
        if (model.modelId && model.modelName) {
          const id = model.modelId.toLowerCase();
          
          if (id.includes('opus')) {
            modelMap.set('opus', model.modelId);
          } else if (id.includes('sonnet')) {
            modelMap.set('sonnet', model.modelId);
          } else if (id.includes('haiku')) {
            modelMap.set('haiku', model.modelId);
          }
        }
      }
    }
    
    return modelMap;
  } catch (error) {
    // Non-critical, just for helpful error messages
    return modelMap;
  }
}

/**
 * Stream a completion from Bedrock
 */
export async function* streamCompletion(
  profileArn: string,
  messages: Message[],
  maxTokens: number,
  temperature: number = 1.0
): AsyncGenerator<StreamEvent> {
  const client = getRuntimeClient();
  
  const input: ConverseStreamCommandInput = {
    modelId: profileArn,
    messages,
    inferenceConfig: {
      temperature,
      maxTokens
    }
  };

  try {
    yield { type: 'start' };
    
    const command = new ConverseStreamCommand(input);
    
    // Setup timeout handling
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
          // Handle text chunks
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text;
            const tokens = Math.ceil(text.length / 4); // Rough estimate
            totalTokens += tokens;
            yield { type: 'chunk', text, tokens: totalTokens };
          }
          
          // Update token count from metadata
          if (event.metadata?.usage?.outputTokens) {
            totalTokens = event.metadata.usage.outputTokens;
          }
        }
      }
      
      yield { type: 'end', totalTokens };
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error; // Re-throw to be caught by outer try
    }
  } catch (error) {
    yield { type: 'error', error: AskError.from(error) };
  }
}