import { $ } from 'bun';

async function build() {
  // Get version from package.json
  const pkg = await Bun.file('package.json').json();
  const version = pkg.version;

  // Get git info
  let commit = 'unknown';
  try {
    const result = await $`git rev-parse --short HEAD`.text();
    commit = result.trim();
  } catch {
    console.warn('Could not get git commit');
  }

  // Build date
  const buildDate = new Date().toISOString().split('T')[0];

  console.log(`Building ask v${version} (${commit}) - ${buildDate}`);

  // Read the version file and replace placeholders
  const versionPath = 'src/lib/version.ts';
  let versionContent = await Bun.file(versionPath).text();

  const originalContent = versionContent;

  versionContent = versionContent
    .replace("'__VERSION__'", `'${version}'`)
    .replace("'__GIT_COMMIT__'", `'${commit}'`)
    .replace("'__BUILD_DATE__'", `'${buildDate}'`);

  // Write modified version file
  await Bun.write(versionPath, versionContent);

  try {
    // Build the binary
    const proc = Bun.spawn(['bun', 'build', '--compile', 'src/cli.ts', '--outfile=ask'], {
      stdout: 'inherit',
      stderr: 'inherit',
    });

    await proc.exited;

    if (proc.exitCode !== 0) {
      throw new Error(`Build failed with exit code ${proc.exitCode}`);
    }

    console.log('✓ Built ask binary');
  } finally {
    // Restore original version file
    await Bun.write(versionPath, originalContent);
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
