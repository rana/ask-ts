import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

/**
 * Default exclude patterns organized by category
 * Single source of truth for both schema defaults and config formatting
 */
const DEFAULT_EXCLUDE_GROUPS = [
  {
    name: 'Version control',
    patterns: ['.git/**', '.svn/**', '.hg/**'],
  },
  {
    name: 'Dependencies',
    patterns: ['node_modules/**', 'vendor/**', '*.lock', 'bun.lockb'],
  },
  {
    name: 'Build outputs',
    patterns: ['dist/**', 'build/**', 'out/**', '.next/**', '.nuxt/**', '*.min.js', '*.min.css'],
  },
  {
    name: 'Test & Coverage',
    patterns: ['test/**', 'tests/**', '__tests__/**', 'coverage/**', '*.test.ts', '*.spec.ts'],
  },
  {
    name: 'IDE & System',
    patterns: ['.vscode/**', '.idea/**', '.DS_Store', 'Thumbs.db'],
  },
  {
    name: 'Cache & Logs',
    patterns: ['*.log', '.cache/**', '.turbo/**', 'tmp/**'],
  },
  {
    name: 'Binary & Media',
    patterns: [
      '*.jpg',
      '*.jpeg',
      '*.png',
      '*.gif',
      '*.ico',
      '*.pdf',
      '*.zip',
      '*.tar.gz',
      '*.mp4',
      '*.mov',
      '*.woff',
      '*.woff2',
    ],
  },
  {
    name: 'Secrets',
    patterns: ['.env', '.env.*', '*.pem', '*.key'],
  },
  {
    name: 'Project files',
    patterns: ['.gitignore', '.dockerignore', 'LICENSE', 'LICENSE.*', 'session.md'],
  },
] as const;

/**
 * Flatten groups into a single array of patterns
 */
function getDefaultExcludePatterns(): string[] {
  return DEFAULT_EXCLUDE_GROUPS.flatMap((group) => group.patterns);
}

/**
 * Get all standard patterns for comparison
 */
function getStandardPatterns(): Set<string> {
  return new Set(getDefaultExcludePatterns());
}

export const ConfigSchema = z.object({
  model: z.enum(['opus', 'sonnet', 'haiku']).default('opus'),
  temperature: z.number().min(0).max(1).default(1.0),
  maxTokens: z.number().int().positive().max(200000).optional(),
  region: z.string().optional(),
  filter: z.boolean().default(true),
  web: z.boolean().default(true),
  exclude: z.array(z.string()).default(getDefaultExcludePatterns()),
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
    '',
    '  // Temperature: 0.0 (deterministic) to 1.0 (creative)',
    `  "temperature": ${config.temperature},`,
    '',
    '  // Filter comments and headers from expanded files',
    `  "filter": ${config.filter},`,
    '',
    '  // Fetch and expand [[https://...]] URL references',
    `  "web": ${config.web},`,
  ];

  if (config.maxTokens !== undefined) {
    lines.push('');
    lines.push('  // Maximum output tokens');
    lines.push(`  "maxTokens": ${config.maxTokens},`);
  }

  if (config.region !== undefined) {
    lines.push('');
    lines.push('  // Preferred AWS region');
    lines.push(`  "region": "${config.region}",`);
  }

  // Exclude array
  lines.push('');
  lines.push('  // File patterns to exclude from expansion');
  lines.push('  "exclude": [');

  const standardPatterns = getStandardPatterns();
  const customPatterns = config.exclude.filter((p) => !standardPatterns.has(p));

  // Output standard patterns by group
  let isFirstGroup = true;
  for (const group of DEFAULT_EXCLUDE_GROUPS) {
    const activePatterns = group.patterns.filter((p) => config.exclude.includes(p));
    if (activePatterns.length === 0) continue;

    if (!isFirstGroup) lines.push('');
    lines.push(`    // ${group.name}`);

    for (const pattern of activePatterns) {
      lines.push(`    "${pattern}",`);
    }

    isFirstGroup = false;
  }

  // Output custom patterns
  if (customPatterns.length > 0) {
    if (!isFirstGroup) lines.push('');
    lines.push('    // Custom');

    for (const pattern of customPatterns) {
      lines.push(`    "${pattern}",`);
    }
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
  } catch {
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
