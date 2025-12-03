import { defineCommand } from 'citty';
import { getConfigPath } from '../lib/config.ts';
import { output } from '../lib/output.ts';

export async function showVersion(): Promise<void> {
  const pkg = await Bun.file('package.json').json();

  output.field('ask', `v${pkg.version}`);
  output.field('runtime', `Bun ${Bun.version}`);
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
