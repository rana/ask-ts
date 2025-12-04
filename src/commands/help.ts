import { defineCommand } from 'citty';
import { output } from '../lib/output.ts';

interface CommandHelp {
  name: string;
  description: string;
  usage: string;
  args?: Array<{ name: string; description: string; required?: boolean }>;
  options?: Array<{ name: string; alias?: string; description: string }>;
  examples?: string[];
}

const COMMANDS: Record<string, CommandHelp> = {
  chat: {
    name: 'chat',
    description: 'Continue the conversation in a session file',
    usage: 'ask [chat] [session] [options]',
    args: [
      {
        name: 'session',
        description: 'Session file to process',
        required: false,
      },
    ],
    options: [{ name: 'model', alias: 'm', description: 'Model to use (opus/sonnet/haiku)' }],
    examples: ['ask', 'ask session.md', 'ask chat myfile.md -m sonnet'],
  },
  init: {
    name: 'init',
    description: 'Initialize a new session file',
    usage: 'ask init [path]',
    args: [
      {
        name: 'path',
        description: 'Path for session file (default: session.md)',
        required: false,
      },
    ],
    examples: ['ask init', 'ask init session-2.md', 'ask init notes/research.md'],
  },
  cfg: {
    name: 'cfg',
    description: 'View or update configuration',
    usage: 'ask cfg [field] [value]',
    args: [
      { name: 'field', description: 'Config field to set', required: false },
      { name: 'value', description: 'Value to set', required: false },
    ],
    examples: ['ask cfg', 'ask cfg model sonnet', 'ask cfg temperature 0.7', 'ask cfg reset'],
  },
  refresh: {
    name: 'refresh',
    description: 'Refresh all expanded file and directory references',
    usage: 'ask refresh [session]',
    args: [
      {
        name: 'session',
        description: 'Session file to refresh',
        required: false,
      },
    ],
    examples: ['ask refresh', 'ask refresh myfile.md'],
  },
  version: {
    name: 'version',
    description: 'Show version information',
    usage: 'ask version',
    examples: ['ask version'],
  },
  help: {
    name: 'help',
    description: 'Show help information',
    usage: 'ask help [command]',
    args: [{ name: 'command', description: 'Command to get help for', required: false }],
    examples: ['ask help', 'ask help cfg'],
  },
};

function showOverview(): void {
  output.blank();
  output.log(`${output.bold('ask')} ${output.dim('—')} AI conversations through Markdown`);
  output.blank();

  output.log(output.dim('Usage'));
  output.log(`  ask ${output.cyan('[command]')} ${output.dim('[options]')}`);
  output.blank();

  output.log(output.dim('Commands'));
  const maxName = Math.max(...Object.keys(COMMANDS).map((n) => n.length));

  for (const [name, cmd] of Object.entries(COMMANDS)) {
    const padded = name.padEnd(maxName + 2);
    const isDefault = name === 'chat' ? output.dim(' (default)') : '';
    output.log(`  ${output.command(padded)}${cmd.description}${isDefault}`);
  }

  output.blank();
  output.log(output.dim('Examples'));
  output.log(`  ${output.dim('$')} ask                     ${output.dim('Continue conversation')}`);
  output.log(`  ${output.dim('$')} ask init                ${output.dim('Start new session')}`);
  output.log(`  ${output.dim('$')} ask -m sonnet           ${output.dim('Use specific model')}`);
  output.log(`  ${output.dim('$')} ask help cfg            ${output.dim('Command help')}`);
  output.blank();

  output.log(`Run ${output.cyan('ask help <command>')} for details`);
  output.blank();
}

function showCommandHelp(cmdName: string): void {
  const cmd = COMMANDS[cmdName];

  if (!cmd) {
    output.blank();
    output.error(`Unknown command: ${cmdName}`);
    output.blank();
    output.log(
      `Available: ${Object.keys(COMMANDS)
        .map((c) => output.cyan(c))
        .join(', ')}`,
    );
    output.blank();
    return;
  }

  output.blank();
  output.log(`${output.bold('ask ' + cmd.name)} ${output.dim('—')} ${cmd.description}`);
  output.blank();

  output.log(output.dim('Usage'));
  output.log(`  ${cmd.usage}`);

  if (cmd.args && cmd.args.length > 0) {
    output.blank();
    output.log(output.dim('Arguments'));
    const maxArg = Math.max(...cmd.args.map((a) => a.name.length));
    for (const arg of cmd.args) {
      const padded = arg.name.padEnd(maxArg + 2);
      const optional = arg.required === false ? output.dim(' (optional)') : '';
      output.log(`  ${output.identifier(padded)}${arg.description}${optional}`);
    }
  }

  if (cmd.options && cmd.options.length > 0) {
    output.blank();
    output.log(output.dim('Options'));
    for (const opt of cmd.options) {
      const alias = opt.alias ? `${output.identifier('-' + opt.alias)}, ` : '    ';
      output.log(`  ${alias}${output.identifier('--' + opt.name.padEnd(10))} ${opt.description}`);
    }
  }

  if (cmd.examples && cmd.examples.length > 0) {
    output.blank();
    output.log(output.dim('Examples'));
    for (const example of cmd.examples) {
      output.log(`  ${output.dim('$')} ${example}`);
    }
  }

  output.blank();
}

export default defineCommand({
  meta: {
    name: 'help',
    description: 'Show help information',
  },
  args: {
    command: {
      type: 'positional',
      description: 'Command to get help for',
      required: false,
    },
  },
  run({ args }) {
    const command = args.command as string | undefined;

    if (command) {
      showCommandHelp(command);
    } else {
      showOverview();
    }
  },
});
