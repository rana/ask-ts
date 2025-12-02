import { z } from 'zod';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

export const ConfigSchema = z.object({
  model: z.enum(['opus', 'sonnet', 'haiku']).default('opus'),
  temperature: z.number().min(0).max(1).default(1.0),
  maxTokens: z.number().int().positive().max(200000).optional(),
  region: z.string().optional()
});

export type Config = z.infer<typeof ConfigSchema>;

export function getConfigDir(): string {
  return path.join(os.homedir(), '.ask');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.jsonc');
}

function stripJsonComments(text: string): string {
  const lines = text.split('\n');
  const stripped = lines.map(line => {
    const commentIndex = line.indexOf('//');
    if (commentIndex === -1) return line;
    
    const beforeComment = line.substring(0, commentIndex);
    const quoteCount = (beforeComment.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) return line; // Inside string
    
    return line.substring(0, commentIndex);
  });
  
  return stripped.join('\n');
}

function formatConfigWithComments(config: Config): string {
  const lines = [
    '{',
    '  // Model selection: opus (default), sonnet, or haiku',
    `  "model": "${config.model}",`,
    '  ',
    '  // Temperature: 0.0 (deterministic) to 1.0 (creative)',
    `  "temperature": ${config.temperature}`
  ];
  
  if (config.maxTokens !== undefined) {
    lines.push(',');
    lines.push('  ');
    lines.push('  // Maximum output tokens (default: 32000)');
    lines.push('  // Note: AWS Bedrock may enforce lower limits than model capabilities');
    lines.push('  // Safe range: 1000-32000, experimental: up to 64000');
    lines.push(`  "maxTokens": ${config.maxTokens}`);
  }
  
  if (config.region !== undefined) {
    lines.push(',');
    lines.push('  ');
    lines.push('  // Preferred AWS region for inference profiles');
    lines.push(`  "region": "${config.region}"`);
  }
  
  if (config.maxTokens === undefined && config.region === undefined) {
    lines.push('');
    lines.push('  ');
    lines.push('  // Optional settings:');
    lines.push('  // "maxTokens": 32000,  // Safe: 1000-32000, experimental: up to 64000');
    lines.push('  // "region": "us-west-2"');
  }
  
  lines.push('}');
  lines.push('');
  
  return lines.join('\n');
}


export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  
  try {
    const text = await Bun.file(configPath).text();
    const json = stripJsonComments(text);
    const data = JSON.parse(json);
    return ConfigSchema.parse(data);
  } catch (error) {
    return ConfigSchema.parse({});
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  const configDir = getConfigDir();
  
  await fs.mkdir(configDir, { recursive: true });
  
  const jsonc = formatConfigWithComments(config);
  
  const tmpPath = `${configPath}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, jsonc);
  await fs.rename(tmpPath, configPath);
}

export async function updateConfig<K extends keyof Config>(
  field: K,
  value: Config[K]
): Promise<void> {
  const config = await loadConfig();
  config[field] = value;
  
  const validated = ConfigSchema.parse(config);
  await saveConfig(validated);
}

export async function ensureConfig(): Promise<void> {
  const configPath = getConfigPath();
  
  try {
    await fs.access(configPath);
  } catch {
    const config = ConfigSchema.parse({});
    await saveConfig(config);
  }
}
