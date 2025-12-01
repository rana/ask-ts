#!/usr/bin/env bun
import { runMain } from 'citty';
import ask from './commands/ask.ts';
import init from './commands/init.ts';
import cfg from './commands/cfg.ts';

// Check if we should run ask by default
const args = Bun.argv.slice(2);
const firstArg = args[0];

// If no args or first arg is a flag, prepend 'chat' command
if (!firstArg || firstArg.startsWith('-')) {
  args.unshift('chat');
}

// Now citty will handle it properly
await runMain({
  meta: {
    name: 'ask',
    version: '0.1.0',
    description: 'AI conversation management through markdown files'
  },
  subCommands: {
    chat: ask,
    init,
    cfg
  }
}, {
  rawArgs: args
});