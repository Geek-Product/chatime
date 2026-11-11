import { useEffect, useState } from 'react';

type Highlighter = (code: string, lang: string | null) => string | null;

/** Prism and its grammars are ~200 kB, so they load on first use rather than blocking the first paint. */
let highlighter: Highlighter | null = null;
let load: Promise<Highlighter> | null = null;

export function loadHighlighter(): Promise<Highlighter> {
  load ??= import('./prismSetup').then((m) => (highlighter = m.highlight));
  return load;
}

/** The highlighter once Prism is ready, otherwise null (callers render escaped plain text). */
export function useHighlighter(): Highlighter | null {
  const [ready, setReady] = useState<Highlighter | null>(() => highlighter);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadHighlighter().then((fn) => live && setReady(() => fn));
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

/** Prism grammar id → short display label. */
const LANGUAGES: Record<string, string> = {
  markup: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  javascript: 'JS',
  jsx: 'JSX',
  typescript: 'TS',
  tsx: 'TSX',
  json: 'JSON',
  python: 'PY',
  bash: 'SH',
  sql: 'SQL',
  yaml: 'YAML',
  go: 'GO',
  rust: 'RS',
  java: 'JAVA',
  markdown: 'MD',
  diff: 'DIFF',
  toml: 'TOML',
  ini: 'INI',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  php: 'PHP',
  ruby: 'RB',
  kotlin: 'KT',
  swift: 'SWIFT',
  docker: 'DOCKER',
  graphql: 'GQL',
};

const EXT_LANGUAGE: Record<string, string> = {
  html: 'markup', htm: 'markup', xhtml: 'markup', svg: 'markup', vue: 'markup',
  css: 'css', scss: 'scss', sass: 'scss', less: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', map: 'json',
  py: 'python', pyw: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  go: 'go', rs: 'rust', java: 'java',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  diff: 'diff', patch: 'diff',
  toml: 'toml', ini: 'ini', conf: 'ini', cfg: 'ini',
  cs: 'csharp',
  cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', h: 'c',
  c: 'c',
  php: 'php', rb: 'ruby',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  dockerfile: 'docker', graphql: 'graphql', gql: 'graphql',
};

export const codeExt = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? '';

export const languageForFile = (filename: string) => EXT_LANGUAGE[codeExt(filename)] ?? null;

/** Language labels shown on a file chip (e.g. "JS"), or null for non-code files. */
export const languageLabel = (lang: string | null) => (lang && LANGUAGES[lang]) || lang;

/** Fence info string (e.g. ```js or ```javascript) → Prism grammar id. */
const FENCE_LANGUAGE: Record<string, string> = {
  ...Object.fromEntries(Object.keys(LANGUAGES).map((id) => [id, id])),
  ...Object.fromEntries(Object.entries(EXT_LANGUAGE).map(([word, id]) => [word, id])),
  html: 'markup', htm: 'markup', xhtml: 'markup',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  ts: 'typescript', py: 'python', rs: 'rust', md: 'markdown',
  yml: 'yaml', c: 'c', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp',
};

export function languageFromFence(info: string): string | null {
  return FENCE_LANGUAGE[info.trim().toLowerCase()] ?? null;
}

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
