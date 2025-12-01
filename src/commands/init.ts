import { defineCommand } from 'citty';
import { AskError, exitWithError } from '../lib/errors.ts';
import { ensureConfig } from '../lib/config.ts';
import chalk from 'chalk';

const SESSION_PATH = 'session.md';

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a new session.md file'
  },
  async run() {
    try {
      // Check if session.md already exists
      const file = Bun.file(SESSION_PATH);
      if (await file.exists()) {
        throw new AskError(
          'session.md already exists',
          'Delete it to start fresh'
        );
      }
      
      // Create session.md with proper initial structure
      const content = '# [1] Human\n\n\n';
      await Bun.write(SESSION_PATH, content);
      
      console.log(chalk.green('✓') + ' Created session.md');
      
      // Ensure config exists (but don't mention it unless there's an error)
      try {
        await ensureConfig();
      } catch (error) {
        console.log(chalk.yellow('Note:') + ' Could not create config file:', error);
      }
      
      console.log('\nNext steps:');
      console.log('1. Add your question to session.md');
      console.log('2. Run: ask');
      
    } catch (error) {
      exitWithError(error);
    }
  }
});