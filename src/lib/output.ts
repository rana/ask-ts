import chalk from 'chalk';

export const output = {
  // Status indicators
  success: (msg: string) => console.log(`${chalk.green('✓')} ${msg}`),
  warning: (msg: string) => console.log(`${chalk.yellow('⚠')} ${msg}`),
  error: (msg: string) => console.error(`${chalk.red('✗')} ${msg}`),

  // Basic output
  info: (msg: string) => console.log(msg),
  log: (msg: string) => console.log(msg),
  blank: () => console.log(),

  // Inline formatters (return strings for composition)
  dim: (text: string) => chalk.dim(text),
  bold: (text: string) => chalk.bold(text),
  cyan: (text: string) => chalk.cyan(text),
  green: (text: string) => chalk.green(text),
  yellow: (text: string) => chalk.yellow(text),
  red: (text: string) => chalk.red(text),

  // Semantic formatters
  command: (text: string) => chalk.cyan.bold(text),
  identifier: (text: string) => chalk.cyan(text),
  value: (text: string) => chalk.white(text),
  hint: (text: string) => console.log(chalk.dim(text)),
  number: (n: number) => n.toLocaleString(),
  separator: () => chalk.dim('·'),

  // Fetch status indicators
  fetchStart: (url: string) => {
    const display = truncateUrl(url, 60);
    console.log(`${chalk.blue('↓')} Fetching ${chalk.dim(display)}...`);
  },
  fetchSuccess: (url: string, chars?: number) => {
    const display = truncateUrl(url, 50);
    const size = chars ? chalk.dim(` (${Math.ceil(chars / 1000)}k chars)`) : '';
    console.log(`${chalk.green('✓')} ${display}${size}`);
  },
  fetchError: (url: string, error: string) => {
    const display = truncateUrl(url, 50);
    console.log(`${chalk.red('✗')} ${display} ${chalk.dim('-')} ${chalk.red(error)}`);
  },

  // Refresh indicators
  refreshStart: (ref: string) => {
    console.log(`${chalk.blue('↓')} Refreshing ${chalk.dim(ref)}...`);
  },
  refreshSuccess: (ref: string, detail?: string) => {
    const extra = detail ? chalk.dim(` (${detail})`) : '';
    console.log(`${chalk.green('✓')} ${ref}${extra}`);
  },

  // Model ID formatting - strip noise, keep essence
  modelName: (modelId: string): string => {
    const name = modelId
      .replace(/^anthropic\./, '')
      .replace(/-\d{8}.*$/, '')
      .replace(/-v\d+:\d+$/, '');
    return chalk.cyan(name);
  },

  // Structured field output
  field: (key: string, value: string, width: number = 12) => {
    const paddedKey = `${key}:`.padStart(width);
    console.log(`${chalk.cyan(paddedKey)} ${value}`);
  },

  fieldDim: (key: string, value: string, width: number = 12) => {
    const paddedKey = `${key}:`.padStart(width);
    console.log(`${chalk.cyan(paddedKey)} ${chalk.dim(value)}`);
  },

  // Metadata line (key: value · key: value)
  meta: (items: Array<[string, string | number]>) => {
    const formatted = items
      .map(
        ([key, val]) =>
          `${chalk.dim(`${key}:`)} ${typeof val === 'number' ? val.toLocaleString() : val}`,
      )
      .join(chalk.dim('  ·  '));
    console.log(`  ${formatted}`);
  },

  // Progress/streaming line (overwrites current line)
  progress: (msg: string) => {
    process.stdout.write(`\r\x1b[K${msg}`);
  },

  // Clear current line
  clearLine: () => {
    process.stdout.write('\r\x1b[K');
  },

  // Write without newline
  write: (msg: string) => {
    process.stdout.write(msg);
  },
};

/**
 * Truncate URL for display, keeping domain visible
 */
function truncateUrl(url: string, maxLen: number): string {
  if (url.length <= maxLen) return url;

  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const path = parsed.pathname + parsed.search;

    // Keep domain, truncate path
    const availableForPath = maxLen - domain.length - 10; // "https://" + "..."
    if (availableForPath > 10) {
      const truncatedPath =
        path.length > availableForPath ? `${path.slice(0, availableForPath)}...` : path;
      return `${parsed.protocol}//${domain}${truncatedPath}`;
    }

    return `${url.slice(0, maxLen - 3)}...`;
  } catch {
    return `${url.slice(0, maxLen - 3)}...`;
  }
}
