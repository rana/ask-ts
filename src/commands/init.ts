import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defineCommand } from 'citty';
import { ensureConfig } from '../lib/config.ts';
import { AskError, exitWithError } from '../lib/errors.ts';
import { output } from '../lib/output.ts';

const DEFAULT_FILENAME = 'session.md';

async function resolveSessionPath(inputPath?: string): Promise<string> {
  if (!inputPath) {
    return DEFAULT_FILENAME;
  }

  // If path ends with / or is existing directory, append default filename
  if (inputPath.endsWith('/') || inputPath.endsWith(path.sep)) {
    return path.join(inputPath, DEFAULT_FILENAME);
  }

  try {
    const stat = await fs.stat(inputPath);
    if (stat.isDirectory()) {
      return path.join(inputPath, DEFAULT_FILENAME);
    }
  } catch {
    // Path doesn't exist, treat as file path
  }

  return inputPath;
}

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a new session file',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path for session file (default: session.md)',
      required: false,
    },
  },
  async run({ args }) {
    try {
      const sessionPath = await resolveSessionPath(args.path as string | undefined);

      const file = Bun.file(sessionPath);
      if (await file.exists()) {
        throw new AskError(`${sessionPath} already exists`, 'Delete it to start fresh');
      }

      // Create parent directories if needed
      const dir = path.dirname(sessionPath);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }

      const content = '# [1] Human\n\n\n';
      await Bun.write(sessionPath, content);

      output.success(`Created ${sessionPath}`);

      try {
        await ensureConfig();
      } catch (error) {
        output.warning(`Could not create config file: ${error}`);
      }

      output.info('');
      output.info('Next steps:');
      output.info(`1. Add your question to ${sessionPath}`);
      output.info(`2. Run: ask ${sessionPath === DEFAULT_FILENAME ? '' : sessionPath}`);
    } catch (error) {
      exitWithError(error);
    }
  },
});
