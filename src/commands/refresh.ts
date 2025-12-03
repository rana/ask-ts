import { defineCommand } from 'citty';
import { exitWithError, requireFile } from '../lib/errors.ts';
import { output } from '../lib/output.ts';
import { refreshAllContent } from '../lib/session.ts';

export default defineCommand({
  meta: {
    name: 'refresh',
    description: 'Refresh all expanded file and directory references',
  },
  args: {
    session: {
      type: 'positional',
      description: 'Session file to refresh (default: session.md)',
      required: false,
    },
  },
  async run({ args }) {
    try {
      const sessionPath = (args.session as string | undefined) ?? 'session.md';

      await requireFile(sessionPath, `File not found: ${sessionPath}`);

      const result = await refreshAllContent(sessionPath);

      if (result.refreshed) {
        output.success(`Refreshed ${result.fileCount} file${result.fileCount !== 1 ? 's' : ''}`);
      } else {
        output.info('No expanded references found to refresh');
        output.hint('Use [[path/]] or [[file.ext]] to expand files');
      }
    } catch (error) {
      exitWithError(error);
    }
  },
});
