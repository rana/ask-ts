import chalk from 'chalk';

export const output = {
  // Semantic messages
  success: (msg: string) => console.log(`${chalk.green('✓')} ${msg}`),
  warning: (msg: string) => console.log(`${chalk.yellow('⚠')} ${msg}`),
  error: (msg: string) => console.error(`${chalk.red('✗')} ${msg}`),

  // Informational
  info: (msg: string) => console.log(msg),
  hint: (msg: string) => console.log(chalk.dim(msg)),

  // Formatting primitives (return strings for composition)
  dim: (text: string) => chalk.dim(text),
  cyan: (text: string) => chalk.cyan(text),
  parens: (text: string) => chalk.dim(`(${text})`),
  number: (n: number) => n.toLocaleString(),

  // Structured output
  field: (key: string, value: string, width: number = 12) => {
    const paddedKey = `${key}:`.padStart(width);
    console.log(`${chalk.cyan(paddedKey)} ${value}`);
  },

  fieldDim: (key: string, value: string, width: number = 12) => {
    const paddedKey = `${key}:`.padStart(width);
    console.log(`${chalk.cyan(paddedKey)} ${chalk.dim(value)}`);
  },
};
