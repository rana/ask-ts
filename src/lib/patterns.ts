/**
 * Checks if a path should be excluded based on glob patterns
 * Uses Bun.Glob for native pattern matching
 */
export function shouldExclude(path: string, patterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/');

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);

    // Check if the path matches the pattern
    if (glob.match(normalizedPath)) {
      return true;
    }

    // Also check path segments for directory patterns like "node_modules/**"
    // This catches "src/node_modules/foo.js" when pattern is "node_modules/**"
    const segments = normalizedPath.split('/');
    const patternBase = pattern.replace(/\/\*\*\/?$/, '').replace(/\/\*$/, '');

    if (segments.includes(patternBase)) {
      return true;
    }
  }

  return false;
}

/**
 * Creates a matcher function for repeated use
 */
export function createMatcher(patterns: string[]): (path: string) => boolean {
  return (path: string) => shouldExclude(path, patterns);
}
