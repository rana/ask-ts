import { z } from 'zod';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

// Schema definition
export const ConfigSchema = z.object({
  model: z.enum(['opus', 'sonnet', 'haiku']).default('opus'),
  temperature: z.number().min(0).max(1).default(1.0),
  maxTokens: z.number().int().positive().max(200000).optional()
});

export type Config = z.infer<typeof ConfigSchema>;

// Path utilities
export function getConfigDir(): string {
  return path.join(os.homedir(), '.ask');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.jsonc');
}

// JSONC comment stripping
function stripJsonComments(text: string): string {
  // Remove single line comments
  const lines = text.split('\n');
  const stripped = lines.map(line => {
    const commentIndex = line.indexOf('//');
    if (commentIndex === -1) return line;
    
    // Check if // is inside a string
    const beforeComment = line.substring(0, commentIndex);
    const quoteCount = (beforeComment.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) return line; // Inside string
    
    return line.substring(0, commentIndex);
  });
  
  return stripped.join('\n');
}

// Format config with helpful comments
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
    lines.push('  // Maximum tokens in response');
    lines.push(`  "maxTokens": ${config.maxTokens}`);
  } else {
    lines.push('');
    lines.push('  ');
    lines.push('  // Optional: Maximum tokens (omit to use AWS defaults)');
    lines.push('  // "maxTokens": 4096');
  }
  
  lines.push('}');
  lines.push('');
  
  return lines.join('\n');
}

// Load config with defaults
export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  
  try {
    const text = await Bun.file(configPath).text();
    const json = stripJsonComments(text);
    const data = JSON.parse(json);
    return ConfigSchema.parse(data);
  } catch (error) {
    // Any error = use defaults
    return ConfigSchema.parse({});
  }
}

// Save config atomically
export async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  const configDir = getConfigDir();
  
  // Ensure directory exists
  await fs.mkdir(configDir, { recursive: true });
  
  // Format with comments
  const jsonc = formatConfigWithComments(config);
  
  // Atomic write
  const tmpPath = `${configPath}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, jsonc);
  await fs.rename(tmpPath, configPath);
}

// Update single field with proper typing
export async function updateConfig<K extends keyof Config>(
  field: K,
  value: Config[K]
): Promise<void> {
  const config = await loadConfig();
  config[field] = value;
  
  // Validate the complete config
  const validated = ConfigSchema.parse(config);
  await saveConfig(validated);
}

// Ensure config exists
export async function ensureConfig(): Promise<void> {
  const configPath = getConfigPath();
  
  try {
    await fs.access(configPath);
  } catch {
    // Create default config
    const config = ConfigSchema.parse({});
    await saveConfig(config);
  }
}