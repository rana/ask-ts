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
import { withRetry } from './retry.ts';
import { getCachedProfile, saveProfileCache } from './cache.ts';
import { loadConfig } from './config.ts';

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
    
    const response = await withRetry(() => client.send(command));
    
    if (response.inferenceProfileSummaries) {
      allProfiles.push(...response.inferenceProfileSummaries);
    }
    
    nextToken = response.nextToken;
  } while (nextToken);

  return allProfiles;
}

function parseModelVersion(modelId: string): { major: number; minor: number; date: string } {
  const dateMatch = modelId.match(/(\d{8})/);
  const date = dateMatch?.[1] || '00000000';
  
  const parts = modelId.split('-');
  const dateIndex = parts.findIndex(part => part === date);
  
  if (dateIndex === -1) {
    return { major: 3, minor: 0, date };
  }
  
  const versionParts: number[] = [];
  
  for (let i = 0; i < dateIndex; i++) {
    const part = parts[i];
    if (part && /^\d+$/.test(part)) {
      versionParts.push(parseInt(part, 10));
    }
  }
  
  if (versionParts.length === 0) {
    return { major: 3, minor: 0, date };
  }
  
  const major = versionParts[0] || 3;
  const minor = versionParts[1] || 0;
  
  return { major, minor, date };
}

export async function findProfile(modelType: ModelType): Promise<InferenceProfile> {
  // Check cache first
  const cached = await getCachedProfile(modelType);
  if (cached) {
    console.log('Using cached inference profile');
    return cached;
  }

  console.log('Discovering AWS inference profiles...');
  
  const client = getBedrockClient();
  const config = await loadConfig();
  const preferredRegion = config.region;

  try {
    const allProfiles = await fetchAllInferenceProfiles(client);
    
    if (allProfiles.length === 0) {
      throw new AskError(
        'No inference profiles found',
        'Check your AWS account has cross-region inference enabled'
      );
    }

    console.log(`Found ${allProfiles.length} profiles, filtering for ${modelType} models...`);

    const matches: Array<{
      arn: string;
      modelId: string;
      version: ReturnType<typeof parseModelVersion>;
      region: string;
    }> = [];

    for (const profile of allProfiles) {
      if (!profile.inferenceProfileArn || !profile.models) continue;
      
      const region = profile.inferenceProfileArn.match(/arn:aws:bedrock:([^:]+):/)?.[1] || 'unknown';
      
      for (const model of profile.models) {
        if (!model.modelArn) continue;
        
        const modelArn = model.modelArn.toLowerCase();
        
        if (!modelArn.includes(modelType)) continue;
        
        const modelId = model.modelArn.split('/').pop() || model.modelArn;
        const version = parseModelVersion(modelId);
        
        matches.push({
          arn: profile.inferenceProfileArn,
          modelId,
          version,
          region
        });
      }
    }
    
    matches.sort((a, b) => {
      // First sort by region preference if configured
      if (preferredRegion) {
        const aPreferred = a.region === preferredRegion;
        const bPreferred = b.region === preferredRegion;
        if (aPreferred && !bPreferred) return -1;
        if (!aPreferred && bPreferred) return 1;
      }
      
      // Then by version
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
      const profile = {
        arn: selected.arn,
        modelId: selected.modelId
      };
      
      // Cache all discovered model types
      const profilesToCache: Partial<Record<ModelType, InferenceProfile>> = {};
      for (const modelType of ['opus', 'sonnet', 'haiku'] as ModelType[]) {
        const typeMatch = matches.find(m => m.modelId.toLowerCase().includes(modelType));
        if (typeMatch) {
          profilesToCache[modelType] = {
            arn: typeMatch.arn,
            modelId: typeMatch.modelId
          };
        }
      }
      
      if (Object.keys(profilesToCache).length > 0) {
        await saveProfileCache(profilesToCache as Record<ModelType, InferenceProfile>);
      }
      
      return profile;
    }

    // Fallback: try profile name matching
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

async function discoverAvailableModels(): Promise<Map<string, string>> {
  const client = getBedrockClient();
  const modelMap = new Map<string, string>();

  try {
    const command = new ListFoundationModelsCommand({});
    const response = await withRetry(() => client.send(command));
    
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
    return modelMap;
  }
}

export async function* streamCompletion(
  profileArn: string,
  messages: Message[],
  maxTokens: number,
  temperature: number = 1.0
): AsyncGenerator<StreamEvent> {
  const client = getRuntimeClient();
  
  // Cap maxTokens to known safe limit
  const effectiveMaxTokens = Math.min(maxTokens, 64000);
  
  // Log if we're capping the value
  if (maxTokens > 64000) {
    console.log(`Note: Capping maxTokens from ${maxTokens} to ${effectiveMaxTokens} (AWS limit)`);
  }
  
  const input: ConverseStreamCommandInput = {
    modelId: profileArn,
    messages,
    inferenceConfig: {
      temperature,
      maxTokens: effectiveMaxTokens
    }
  };

  try {
    yield { type: 'start' };
    
    const command = new ConverseStreamCommand(input);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    try {
      const response = await withRetry(() => 
        client.send(command, {
          abortSignal: controller.signal
        })
      );
      
      clearTimeout(timeoutId);
      
      let totalTokens = 0;
      
      if (response.stream) {
        for await (const event of response.stream) {
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text;
            const tokens = Math.ceil(text.length / 4); // Rough estimate
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
      throw error; // Re-throw to be caught by outer try
    }
  } catch (error) {
    yield { type: 'error', error: AskError.from(error) };
  }
}