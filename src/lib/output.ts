import chalk from 'chalk';

export const output = {
  // Status with prefix
  success: (msg: string) => console.log(chalk.green('✓') + ' ' + msg),
  warning: (msg: string) => console.log(chalk.yellow('⚠') + ' ' + msg),
  error: (msg: string) => console.log(chalk.red('✗') + ' ' + msg),
  
  // Plain output
  info: (msg: string) => console.log(msg),
  indent: (msg: string) => console.log('  ' + msg),
  
  // Formatters (return strings)
  dim: (text: string) => chalk.dim(text),
  parens: (text: string) => chalk.dim(`(${text})`),
  number: (n: number) => n.toLocaleString(),
};
