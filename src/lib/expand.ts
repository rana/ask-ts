import type { Config } from './config.ts';
import { loadConfig } from './config.ts';
import { filterContent, shouldFilter } from './filter.ts';
import { languageFor } from './languages.ts';
import { output } from './output.ts';
import { shouldExclude } from './patterns.ts';
import { expandUrl, isUrl } from './url.ts';

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
  const pattern = /\[\[([^\]\u200B]+)\]\]/g;
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
      // URL errors already logged by expandUrl, others need logging
      if (!isUrl(ref)) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        output.fetchError(ref, message);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      expanded = expanded.replace(match, `\n❌ Error: ${ref} - ${message}\n`);
    }
  }

  return { expanded, fileCount };
}

/**
 * Expand a single reference (file, directory, or URL)
 */
async function expandReference(
  ref: string,
  turnNumber: number,
  config: Config,
): Promise<{ text: string; files: number }> {
  // Check for URL first
  if (isUrl(ref)) {
    return expandUrlReference(ref, config);
  }

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
 * Expand a URL reference
 */
async function expandUrlReference(
  url: string,
  config: Config,
): Promise<{ text: string; files: number }> {
  // Check if URL expansion is disabled
  if (!config.web) {
    // Return the reference unchanged (no expansion)
    return { text: `[[${url}]]`, files: 0 };
  }

  const result = await expandUrl(url);

  // Warn if content is large (>20k chars ≈ 5k tokens)
  if (result.content.length > 20_000) {
    const estimatedTokens = Math.ceil(result.content.length / 4);
    output.warning(`Large content from ${url} (≈${estimatedTokens.toLocaleString()} tokens)`);
  }

  // Build output with markers for refresh support
  const lines: string[] = [`<!-- url: ${url} -->`];

  if (result.title) {
    lines.push('', `# ${result.title}`);
  }

  lines.push('', result.content, '', '<!-- /url -->');

  return { text: '\n' + lines.join('\n') + '\n', files: 1 };
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
