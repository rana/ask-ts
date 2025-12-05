import { defineCommand } from 'citty';
import { getConfigPath } from '../lib/config.ts';
import { output } from '../lib/output.ts';
import { getVersionInfo } from '../lib/version.ts';

export async function showVersion(): Promise<void> {
  const info = getVersionInfo();

  output.field('ask', `v${info.version}`);
  output.field('commit', info.commit);
  output.field('built', info.buildDate);
  output.field('runtime', info.runtime);
  output.field('config', getConfigPath());
}

export default defineCommand({
  meta: {
    name: 'version',
    description: 'Show version information',
  },
  async run() {
    await showVersion();
  },
});
