/**
 * AWS Bedrock operations - hides all AWS complexity
 */

import { 
  BedrockRuntimeClient, 
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { 
  BedrockClient,
  ListInferenceProfilesCommand,
  ListFoundationModelsCommand
} from '@aws-sdk/client-bedrock';

import type { ModelType, Message, StreamEvent, InferenceProfile } from '../types.ts';
import { AskError } from './errors.ts';
import { getModelInfo } from './models.ts';

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

/**
 * Find an inference profile for the given model type
 */
export async function findProfile(modelType: ModelType): Promise<InferenceProfile> {
  const client = getBedrockClient();
  const modelInfo = getModelInfo(modelType);

  try {
    const command = new ListInferenceProfilesCommand({
      maxResults: 100
    });
    
    const response = await client.send(command);
    
    if (!response.inferenceProfileSummaries || response.inferenceProfileSummaries.length === 0) {
      throw new AskError(
        'No inference profiles found',
        'Check your AWS account has cross-region inference enabled'
      );
    }

    // Collect all matching profiles
    const matches: InferenceProfile[] = [];

    for (const profile of response.inferenceProfileSummaries) {
      if (!profile.inferenceProfileArn || !profile.models) continue;
      
      for (const model of profile.models) {
        if (!model.modelArn) continue;
        
        const modelArn = model.modelArn.toLowerCase();
        
        // Skip if it doesn't match our model type
        if (!modelArn.includes(modelInfo.pattern)) continue;
        
        // Extract date from model ID (e.g., "20241022" from the ARN)
        const dateMatch = modelArn.match(/(\d{8})/);
        const modelDate = dateMatch?.[1] ?? '00000000';
        
        // Skip models before October 2024 (4.5 release timeframe)
        if (modelDate < '20241001') continue;
        
        matches.push({
          arn: profile.inferenceProfileArn,
          modelId: model.modelArn
        });
      }
    }
    
    // Sort by date descending (newest first)
    matches.sort((a, b) => {
      const dateA = a.modelId.match(/(\d{8})/)?.[1] ?? '0';
      const dateB = b.modelId.match(/(\d{8})/)?.[1] ?? '0';
      return dateB.localeCompare(dateA);
    });
    
    if (matches.length > 0) {
      return matches[0]!;
    }
    
    // Fallback: Match by profile name (but warn it might be old)
    for (const profile of response.inferenceProfileSummaries) {
      if (!profile.inferenceProfileArn) continue;
      
      const profileName = profile.inferenceProfileName?.toLowerCase() || '';
      if (profileName.includes(modelType)) {
        console.warn(`Warning: Using profile matched by name, might be older model`);
        return {
          arn: profile.inferenceProfileArn,
          modelId: `${modelInfo.pattern} (via profile name)`
        };
      }
    }
    
    // If we get here, no profile found - try to help
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
      `  2. Try a different model: bun run src/index.ts --model sonnet\n` +
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
  maxTokens: number
): AsyncGenerator<StreamEvent> {
  const client = getRuntimeClient();
  
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