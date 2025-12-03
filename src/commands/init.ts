import { defineCommand } from 'citty';
import { ensureConfig } from '../lib/config.ts';
import { AskError, exitWithError } from '../lib/errors.ts';
import { output } from '../lib/output.ts';

const SESSION_FILE = 'session.md';

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a new session.md file',
  },
  async run() {
    try {
      const file = Bun.file(SESSION_FILE);
      if (await file.exists()) {
        throw new AskError('session.md already exists', 'Delete it to start fresh');
      }

      const content = '# [1] Human\n\n\n';
      await Bun.write(SESSION_FILE, content);

      output.success('Created session.md');

      try {
        await ensureConfig();
      } catch (error) {
        output.warning(`Could not create config file: ${error}`);
      }

      output.info('');
      output.info('Next steps:');
      output.info('1. Add your question to session.md');
      output.info('2. Run: ask');
    } catch (error) {
      exitWithError(error);
    }
  },
});
