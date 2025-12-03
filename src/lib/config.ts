import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

export const ConfigSchema = z.object({
  model: z.enum(['opus', 'sonnet', 'haiku']).default('opus'),
  temperature: z.number().min(0).max(1).default(1.0),
  maxTokens: z.number().int().positive().max(200000).optional(),
  region: z.string().optional(),
  filter: z.boolean().default(true),
  exclude: z.array(z.string()).default([
    // Version control
    '.git/**',
    '.svn/**',

    // Dependencies
    'node_modules/**',
    'vendor/**',

    // Build outputs
    'dist/**',
    'build/**',
    'out/**',
    '*.min.js',
    '*.min.css',

    // IDE/System
    '.vscode/**',
    '.idea/**',
    '.DS_Store',
    'Thumbs.db',

    // Logs/Cache
    '*.log',
    '.cache/**',
    'tmp/**',

    // Binary files
    '*.mp4',
    '*.mov',
    '*.zip',
    '*.tar.gz',
    '*.pdf',
    '*.jpg',
    '*.png',
    '*.gif',

    // Miscellaneous
    'LICENSE',
    'session.md',
    '*.lock',
    '.gitignore',
  ]),
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
  const stripped = lines.map((line) => {
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
    `  "temperature": ${config.temperature},`,
    '  ',
    '  // Filter comments and headers from expanded files',
    `  "filter": ${config.filter},`,
  ];

  if (config.maxTokens !== undefined) {
    lines.push('  ');
    lines.push('  // Maximum output tokens');
    lines.push(`  "maxTokens": ${config.maxTokens},`);
  }

  if (config.region !== undefined) {
    lines.push('  ');
    lines.push('  // Preferred AWS region');
    lines.push(`  "region": "${config.region}",`);
  }

  // Exclude array (always last, no trailing comma)
  lines.push('  ');
  lines.push('  // File patterns to exclude from expansion');
  lines.push('  "exclude": [');

  const excludeGroups = [
    { comment: '// Version control', patterns: ['.git/**', '.svn/**'] },
    { comment: '// Dependencies', patterns: ['node_modules/**', 'vendor/**'] },
    {
      comment: '// Build outputs',
      patterns: ['dist/**', 'build/**', 'out/**', '*.min.js', '*.min.css'],
    },
    {
      comment: '// IDE/System files',
      patterns: ['.vscode/**', '.idea/**', '.DS_Store', 'Thumbs.db'],
    },
    { comment: '// Logs/Cache', patterns: ['*.log', '.cache/**', 'tmp/**'] },
    {
      comment: '// Binary files',
      patterns: ['*.mp4', '*.mov', '*.zip', '*.tar.gz', '*.pdf', '*.jpg', '*.png', '*.gif'],
    },
  ];

  const allGroupPatterns = excludeGroups.flatMap((g) => g.patterns);
  const customPatterns = config.exclude.filter((p) => !allGroupPatterns.includes(p));

  let isFirstGroup = true;
  for (const group of excludeGroups) {
    const groupPatterns = group.patterns.filter((p) => config.exclude.includes(p));
    if (groupPatterns.length > 0) {
      if (!isFirstGroup) lines.push('    ');
      lines.push(`    ${group.comment}`);

      groupPatterns.forEach((pattern) => {
        lines.push(`    "${pattern}",`);
      });

      isFirstGroup = false;
    }
  }

  if (customPatterns.length > 0) {
    if (!isFirstGroup) lines.push('    ');
    lines.push('    // Custom patterns');
    customPatterns.forEach((pattern) => {
      lines.push(`    "${pattern}",`);
    });
  }

  // Remove trailing comma from last item
  const lastIdx = lines.length - 1;
  lines[lastIdx] = lines[lastIdx]!.replace(/,$/, '');

  lines.push('  ]');
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
  } catch (_error) {
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
  value: Config[K],
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
