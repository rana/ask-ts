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
  hint: (text: string) => chalk.dim(text),
  number: (n: number) => n.toLocaleString(),
  separator: () => chalk.dim('·'),

  // Model ID formatting - strip noise, keep essence
  modelName: (modelId: string): string => {
    // anthropic.claude-opus-4-5-20251101-v1:0 -> claude-opus-4-5
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
          `${chalk.dim(key + ':')} ${typeof val === 'number' ? val.toLocaleString() : val}`,
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
