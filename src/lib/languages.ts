const LANGUAGES: Record<string, string> = {
  // TypeScript/JavaScript
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  // Systems
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',

  // JVM
  java: 'java',
  kt: 'kotlin',
  scala: 'scala',

  // .NET
  cs: 'csharp',
  fs: 'fsharp',

  // Dynamic
  py: 'python',
  rb: 'ruby',
  php: 'php',
  pl: 'perl',
  lua: 'lua',

  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  fish: 'fish',
  ps1: 'powershell',

  // Mobile
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivec',

  // Data/Config
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  ini: 'ini',
  env: 'bash',

  // Markup
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',

  // Styles
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',

  // Database
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',

  // Other
  proto: 'protobuf',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  tex: 'latex',
  r: 'r',
  jl: 'julia',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  lisp: 'lisp',
  el: 'lisp',
  vim: 'vim',
  zig: 'zig',
  nim: 'nim',
  v: 'v',
  d: 'd',
  ada: 'ada',
  pas: 'pascal',
  f90: 'fortran',
  cob: 'cobol',
  asm: 'asm',
  wasm: 'wasm',
};

const FILENAMES: Record<string, string> = {
  Makefile: 'makefile',
  makefile: 'makefile',
  GNUmakefile: 'makefile',
  Justfile: 'just',
  justfile: 'just',
  Dockerfile: 'dockerfile',
  dockerfile: 'dockerfile',
  Containerfile: 'dockerfile',
  'docker-compose.yml': 'yaml',
  'docker-compose.yaml': 'yaml',
  '.gitignore': 'gitignore',
  '.gitattributes': 'gitattributes',
  '.dockerignore': 'dockerignore',
  '.env': 'bash',
  '.env.local': 'bash',
  '.env.example': 'bash',
  '.envrc': 'bash',
  '.bashrc': 'bash',
  '.zshrc': 'zsh',
  '.profile': 'bash',
  'CMakeLists.txt': 'cmake',
  'meson.build': 'meson',
  BUILD: 'starlark',
  'BUILD.bazel': 'starlark',
  WORKSPACE: 'starlark',
  'Cargo.toml': 'toml',
  'Cargo.lock': 'toml',
  'go.mod': 'gomod',
  'go.sum': 'gosum',
  'package.json': 'json',
  'tsconfig.json': 'jsonc',
  'jsconfig.json': 'jsonc',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  'deno.json': 'jsonc',
  'bun.lockb': 'text',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
  'requirements.txt': 'text',
  'pyproject.toml': 'toml',
  Pipfile: 'toml',
  'setup.py': 'python',
  'setup.cfg': 'ini',
  'pom.xml': 'xml',
  'build.gradle': 'gradle',
  'build.gradle.kts': 'kotlin',
  'settings.gradle': 'gradle',
  gradlew: 'bash',
};

export function languageFor(path: string): string {
  const filename = path.split('/').pop() ?? '';

  // Check exact filename matches first
  if (filename in FILENAMES) {
    return FILENAMES[filename]!;
  }

  // Check case-insensitive filename matches
  const lowerFilename = filename.toLowerCase();
  for (const [name, lang] of Object.entries(FILENAMES)) {
    if (name.toLowerCase() === lowerFilename) {
      return lang;
    }
  }

  // Extract extension
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) {
    // No extension or hidden file without extension
    return 'text';
  }

  const ext = filename.slice(lastDot + 1).toLowerCase();
  return LANGUAGES[ext] ?? ext;
}
