import type { Config } from './config.ts';
import { loadConfig } from './config.ts';
import { filterContent, shouldFilter } from './filter.ts';
import { languageFor } from './languages.ts';
import { shouldExclude } from './patterns.ts';

/**
 * Calculate minimum fence length needed to safely wrap content
 */
function fenceFor(content: string): string {
  const pattern = /`{3,}/g;
  let maxLength = 2;

  for (const match of content.matchAll(pattern)) {
    maxLength = Math.max(maxLength, match[0].length);
  }

  return '`'.repeat(maxLength + 1);
}

/**
 * Resolve a file path, with case-insensitive fallback
 */
async function resolveFilePath(path: string): Promise<string> {
  const file = Bun.file(path);
  if (await file.exists()) {
    return path;
  }

  // Try case-insensitive match in the same directory
  const dir = path.lastIndexOf('/') >= 0 ? path.substring(0, path.lastIndexOf('/')) : '.';
  const filename = path.split('/').pop() ?? path;

  const entries = await Array.fromAsync(new Bun.Glob(`${dir}/*`).scan({ onlyFiles: true }));

  const match = entries.find((entry) => {
    const entryName = entry.split('/').pop() ?? '';
    return entryName.toLowerCase() === filename.toLowerCase();
  });

  if (match) {
    return match;
  }

  throw new Error('File not found');
}

/**
 * Check if file content appears to be binary
 */
async function isBinaryFile(file: ReturnType<typeof Bun.file>): Promise<boolean> {
  const preview = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  return preview.includes(0);
}

/**
 * Expand all [[reference]] patterns in content
 */
export async function expandReferences(
  content: string,
  turnNumber: number = 0,
): Promise<{ expanded: string; fileCount: number }> {
  const pattern = /\[\[([^\]​]+)\]\]/g;
  let expanded = content;
  let fileCount = 0;

  // Load config once for all expansions
  const config = await loadConfig();

  for (const [match, ref] of content.matchAll(pattern)) {
    if (!ref) continue;

    try {
      const { text, files } = await expandReference(ref, turnNumber, config);
      expanded = expanded.replace(match, () => text);
      fileCount += files;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      expanded = expanded.replace(match, `\n❌ Error: ${ref} - ${message}\n`);
    }
  }

  return { expanded, fileCount };
}

/**
 * Expand a single reference (file or directory)
 */
async function expandReference(
  ref: string,
  turnNumber: number,
  config: Config,
): Promise<{ text: string; files: number }> {
  const isRecursive = ref.endsWith('/**/');
  const isDirectory = ref.endsWith('/') || isRecursive;

  // Check if non-directory reference is actually a directory
  if (!isDirectory) {
    try {
      const stat = await Bun.file(ref).stat();
      if (stat.isDirectory()) {
        return expandDirectory(ref, false, turnNumber, config);
      }
    } catch {
      // Not a directory or doesn't exist, try as file
    }
  }

  if (isDirectory) {
    const dir = ref.replace(/\/?\*?\*?\/$/, '');
    return expandDirectory(dir, isRecursive, turnNumber, config);
  }

  return expandFile(ref, turnNumber, config);
}

/**
 * Expand a single file reference
 */
async function expandFile(
  path: string,
  turnNumber: number,
  config: Config,
): Promise<{ text: string; files: number }> {
  const resolvedPath = await resolveFilePath(path);
  const file = Bun.file(resolvedPath);

  if (await isBinaryFile(file)) {
    throw new Error('Binary file');
  }

  let content = await file.text();

  if (shouldFilter(config)) {
    content = filterContent(content, resolvedPath);
  }

  // Escape nested references with zero-width spaces
  content = content.replace(/\[\[/g, '[\u200B[');
  content = content.replace(/\]\]/g, ']\u200B]');

  const lang = languageFor(resolvedPath);
  const fence = fenceFor(content);
  const header = turnNumber > 0 ? `### [${turnNumber}] ${resolvedPath}` : `### ${resolvedPath}`;

  return {
    text: `\n${header}\n${fence}${lang}\n${content}\n${fence}\n`,
    files: 1,
  };
}

/**
 * Expand a directory reference
 */
async function expandDirectory(
  path: string,
  recursive: boolean,
  turnNumber: number,
  config: Config,
): Promise<{ text: string; files: number }> {
  const pattern = recursive ? `${path}/**/*` : `${path}/*`;
  const glob = new Bun.Glob(pattern);

  const sections: string[] = [];
  let fileCount = 0;
  let hasSubdirs = false;

  const { exclude } = config;

  // Check for subdirectories (only relevant for non-recursive)
  if (!recursive) {
    for await (const entry of new Bun.Glob(`${path}/*`).scan()) {
      if (shouldExclude(entry, exclude)) continue;
      const stat = await Bun.file(entry).stat();
      if (stat.isDirectory()) {
        hasSubdirs = true;
        break;
      }
    }
  }

  // Expand matching files
  for await (const filePath of glob.scan({ onlyFiles: true })) {
    if (shouldExclude(filePath, exclude)) continue;

    try {
      const { text } = await expandFile(filePath, turnNumber, config);
      sections.push(text);
      fileCount++;
    } catch {
      // Skip files that can't be expanded (binary, etc.)
    }
  }

  // Handle empty results
  if (sections.length === 0) {
    if (hasSubdirs) {
      return {
        text: `\n### ${path}/\n\n*(contains only subdirectories - use [[${path}/**/]] for recursive)*\n`,
        files: 0,
      };
    }
    return {
      text: `\n### ${path}/\n\n*(empty directory)*\n`,
      files: 0,
    };
  }

  // Wrap in directory markers
  const content = sections.join('');
  const marker = recursive ? '/**/' : '/';
  const wrapped = `<!-- dir: ${path}${marker} -->\n${content.trim()}\n<!-- /dir -->`;

  return {
    text: wrapped,
    files: fileCount,
  };
}
