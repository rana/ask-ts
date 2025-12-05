// These values are replaced at build time by the build script
export const VERSION = '__VERSION__';
export const GIT_COMMIT = '__GIT_COMMIT__';
export const BUILD_DATE = '__BUILD_DATE__';

export interface VersionInfo {
  version: string;
  commit: string;
  buildDate: string;
  runtime: string;
}

export function getVersionInfo(): VersionInfo {
  return {
    version: VERSION,
    commit: GIT_COMMIT,
    buildDate: BUILD_DATE,
    runtime: `Bun ${Bun.version}`,
  };
}
