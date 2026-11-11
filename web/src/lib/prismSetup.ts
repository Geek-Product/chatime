import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-csharp';
// cpp extends the c grammar, so c must be registered first.
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
// php registers a hook that calls markup-templating, so that grammar has to exist first.
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-scss';

/**
 * Highlighted HTML for `dangerouslySetInnerHTML`. Safe for untrusted source: Prism escapes the
 * input and only adds its own `<span class="token …">` wrappers before highlighting.
 * Returns null when the grammar isn't registered, so callers fall back to escaped text.
 */
export function highlight(code: string, lang: string | null): string | null {
  if (!lang) return null;
  const grammar = Prism.languages[lang];
  if (!grammar) return null;
  // A trailing newline inside <pre> would render as a phantom line.
  return Prism.highlight(code, grammar, lang).replace(/\n$/, '');
}
