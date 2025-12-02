import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import type { InferenceProfile, ModelType } from '../types.ts';

interface CacheEntry {
  arn: string;
  model_id: string;
  region: string;
  discovered_at: string;
}

interface ProfileCache {
  version: number;
  cached_at: string;
  expires_at: string;
  profiles: Partial<Record<ModelType, CacheEntry>>;
}

const CACHE_VERSION = 1;
const CACHE_TTL_DAYS = 7;

export function getCacheDir(): string {
  return path.join(os.homedir(), '.ask', 'cache');
}

export function getCachePath(): string {
  return path.join(getCacheDir(), 'profiles.jsonc');
}

function formatCacheWithComments(cache: ProfileCache): string {
  const profiles = Object.entries(cache.profiles)
    .filter(([_, entry]) => entry !== undefined)
    .map(([type, entry]) => {
      return `    "${type}": {
      "arn": "${entry!.arn}",
      "model_id": "${entry!.model_id}",
      "region": "${entry!.region}",
      "discovered_at": "${entry!.discovered_at}"
    }`;
    })
    .join(',\n');

  return `{
  // Profile cache for AWS Bedrock inference profiles
  // Expires after ${CACHE_TTL_DAYS} days to ensure fresh discovery
  
  "version": ${cache.version},
  "cached_at": "${cache.cached_at}",
  "expires_at": "${cache.expires_at}",
  
  "profiles": {
${profiles}
  }
}
`;
}

export async function loadProfileCache(): Promise<ProfileCache | null> {
  try {
    const text = await Bun.file(getCachePath()).text();
    // Remove comments for JSON parsing
    const json = text.replace(/\/\/.*$/gm, '');
    const data = JSON.parse(json);
    
    // Validate cache
    if (data.version !== CACHE_VERSION) return null;
    
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) return null;
    
    return data as ProfileCache;
  } catch {
    return null;
  }
}

export async function saveProfileCache(
  profiles: Record<ModelType, InferenceProfile>
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);
  
  const cache: ProfileCache = {
    version: CACHE_VERSION,
    cached_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    profiles: {}
  };
  
  for (const [type, profile] of Object.entries(profiles)) {
    // Extract region from ARN: arn:aws:bedrock:REGION::...
    const regionMatch = profile.arn.match(/arn:aws:bedrock:([^:]+):/);
    const region = regionMatch?.[1] || 'unknown';
    
    cache.profiles[type as ModelType] = {
      arn: profile.arn,
      model_id: profile.modelId,
      region,
      discovered_at: now.toISOString()
    };
  }
  
  const cacheDir = getCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });
  
  const jsonc = formatCacheWithComments(cache);
  
  const tmpPath = `${getCachePath()}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, jsonc);
  await fs.rename(tmpPath, getCachePath());
}

export async function getCachedProfile(
  modelType: ModelType
): Promise<InferenceProfile | null> {
  const cache = await loadProfileCache();
  if (!cache) return null;
  
  const entry = cache.profiles[modelType];
  if (!entry) return null;
  
  return {
    arn: entry.arn,
    modelId: entry.model_id
  };
}

export function extractRegion(profile: InferenceProfile): string {
  const regionMatch = profile.arn.match(/arn:aws:bedrock:([^:]+):/);
  return regionMatch?.[1] || 'unknown';
}