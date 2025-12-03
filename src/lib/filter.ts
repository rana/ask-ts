interface CommentStyle {
  line?: string;
  blockStart?: string;
  blockEnd?: string;
}

const PRESERVE_PATTERNS = [
  /^#!/, // Shebang
  /^\/\/\s*@ts-/, // TypeScript directives
  /^\/\/go:/, // Go directives
  /^#\s*-\*-.*-\*-/, // Python encoding
  /^#\s*frozen_string_literal/, // Ruby directive
  /^['"]use strict['"];?$/, // JavaScript strict mode
];

const HEADER_PATTERNS = [
  { start: /^\/\*+/, end: /\*+\// },
  { start: /^<!--/, end: /-->/ },
  { start: /^"""/, end: /"""/ },
  { start: /^'''/, end: /'''/ },
];

// Use const assertion for better type inference
const COMMENT_PATTERNS = {
  cStyle: { line: '//', blockStart: '/*', blockEnd: '*/' },
  hash: { line: '#' },
  sql: { line: '--' },
  html: { blockStart: '<!--', blockEnd: '-->' },
} as const;

export function shouldFilter(config: { filter?: boolean }): boolean {
  return config.filter ?? true;
}

export function filterContent(content: string, filePath: string): string {
  content = stripHeaders(content);
  content = stripComments(content, filePath);
  return content.replace(/\n{3,}/g, '\n\n').trim();
}

function stripHeaders(content: string): string {
  const trimmed = content.trimStart();

  for (const { start, end } of HEADER_PATTERNS) {
    if (start.test(trimmed)) {
      const endMatch = trimmed.match(end);
      if (endMatch && endMatch.index !== undefined) {
        const afterHeader = trimmed.slice(endMatch.index + endMatch[0].length);
        return stripHeaders(afterHeader);
      }
    }
  }

  return content;
}

function stripComments(content: string, filePath: string): string {
  const style = detectCommentStyle(content, filePath);
  if (!style) return content;

  const lines = content.split('\n');
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (PRESERVE_PATTERNS.some((p) => p.test(line.trim()))) {
      result.push(line);
      continue;
    }

    if (style.blockStart && !inBlock && line.trim().startsWith(style.blockStart)) {
      inBlock = true;
      continue;
    }

    if (inBlock && style.blockEnd && line.includes(style.blockEnd)) {
      inBlock = false;
      continue;
    }

    if (inBlock) continue;

    if (style.line) {
      const commentIdx = line.indexOf(style.line);
      if (commentIdx === 0) continue;
      if (commentIdx > 0) {
        const before = line.substring(0, commentIdx).trimEnd();
        if (before) result.push(before);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

function detectCommentStyle(content: string, filePath: string): CommentStyle | null {
  // First, try to detect from content
  if (
    content.includes('//') &&
    (content.includes('/*') || filePath.match(/\.(js|ts|java|c|cpp|go)$/i))
  ) {
    return COMMENT_PATTERNS.cStyle;
  }

  if (content.match(/^\s*#/m) && filePath.match(/\.(py|rb|sh|yaml|yml)$/i)) {
    return COMMENT_PATTERNS.hash;
  }

  if (content.includes('<!--')) {
    return COMMENT_PATTERNS.html;
  }

  if (content.includes('--') && filePath.match(/\.sql$/i)) {
    return COMMENT_PATTERNS.sql;
  }

  // Fallback to file extension
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;

  // Most common cases
  if (
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'java',
      'c',
      'cpp',
      'cs',
      'go',
      'swift',
      'kt',
      'scala',
      'rs',
    ].includes(ext)
  ) {
    return COMMENT_PATTERNS.cStyle;
  }

  if (['py', 'rb', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml'].includes(ext)) {
    return COMMENT_PATTERNS.hash;
  }

  return null;
}
