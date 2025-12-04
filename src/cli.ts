import { runMain } from 'citty';
import ask from './commands/ask.ts';
import cfg from './commands/cfg.ts';
import help from './commands/help.ts';
import init from './commands/init.ts';
import refresh from './commands/refresh.ts';
import version, { showVersion } from './commands/version.ts';

const SUBCOMMANDS = ['chat', 'init', 'cfg', 'version', 'refresh', 'help'];

const args = Bun.argv.slice(2);
const firstArg = args[0];

// Handle version flags
if (firstArg === '--version' || firstArg === '-v') {
  await showVersion();
  process.exit(0);
}

// Handle help flags
if (firstArg === '--help' || firstArg === '-h') {
  args[0] = 'help';
}

// Default to chat if no subcommand
const isSubcommand = firstArg && SUBCOMMANDS.includes(firstArg);
if (!firstArg || firstArg.startsWith('-') || !isSubcommand) {
  args.unshift('chat');
}

await runMain(
  {
    meta: {
      name: 'ask',
      version: '1.0.0',
      description: 'AI conversation management through markdown files',
    },
    subCommands: {
      chat: ask,
      init,
      cfg,
      version,
      refresh,
      help,
    },
  },
  {
    rawArgs: args,
  },
);
