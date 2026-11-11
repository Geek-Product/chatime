import { Fragment, type ReactNode } from 'react';
import { languageFromFence, languageLabel, useHighlighter } from '../lib/codeHighlight';

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;
const MENTION_RE = /@([a-zA-Z0-9_.-]{2,32})/g;
// Priority: code, bold, strike, italic (`_`), italic (`*`), URL, @mention
const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(~~[^~\n]+?~~)|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])|(https?:\/\/[^\s<>()]+)|(@[a-zA-Z0-9_.-]{2,32})/g;
const LIST_RE = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?/;
const FENCE_RE = /^\s*```/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

interface Ctx {
  me: string;
  knownUsernames?: Set<string>;
  onMentionClick?: (username: string) => void;
}

function stripUrls(text: string) {
  return text.replace(URL_RE, ' ');
}

/** Finds the emphasis token whose opening marker wraps `pos` (or the one starting at its end). */
function findWrapMarker(content: string, pos: number): { from: number; to: number } | null {
  for (const m of content.matchAll(INLINE_RE)) {
    if (!m[2] && !m[4]) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (start <= pos && end >= pos) return { from: start, to: end };
  }
  return null;
}

export function MessageText({
  content,
  me,
  knownUsernames,
  onMentionClick,
  className,
}: {
  content: string;
  me: string;
  knownUsernames?: Set<string>;
  onMentionClick?: (username: string) => void;
  className?: string;
}) {
  const ctx: Ctx = { me, knownUsernames, onMentionClick };
  const highlight = useHighlighter();
  let key = 0;
  const k = () => key++;
  return (
    <div className={`msg-content ${className ?? ''}`} title={content.length > 500 ? undefined : content}>
      {renderBlocks(content, ctx, k, highlight)}
    </div>
  );
}

function renderBlocks(
  content: string,
  ctx: Ctx,
  k: () => number,
  highlight: ((code: string, lang: string | null) => string | null) | null,
): ReactNode[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      const lang = languageFromFence(line.trim().replace(/^`{3,}/, ''));
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of content)
      const source = body.join('\n');
      const html = highlight ? highlight(source, lang) : null;
      out.push(
        <div key={k()} className="code-wrap">
          {lang && <span className="code-lang">{languageLabel(lang)}</span>}
          <pre className="code-block">
            {html === null
              ? <code>{source}</code>
              : <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: html }} />}
          </pre>
        </div>,
      );
      continue;
    }

    if (!line.trim()) {
      out.push(<br key={k()} />);
      i++;
      continue;
    }

    if (line.trimStart().startsWith('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const rows: string[][] = [];
      const split = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows.push(split(line));
      i += 2;
      while (i < lines.length && lines[i].trimStart().startsWith('|')) rows.push(split(lines[i++]));
      const [head, ...body] = rows;
      out.push(
        <div key={k()} className="table-wrap">
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{renderInline(c, ctx, k)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j}>{r.map((c, n) => <td key={n}>{renderInline(c, ctx, k)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const list = LIST_RE.exec(line);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m || Boolean(m[2]) !== ordered) break;
        items.push(m[3]);
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={k()} className="msg-list">
          {items.map((item, j) => <li key={j}>{renderInline(item, ctx, k)}</li>)}
        </Tag>,
      );
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) quoted.push(lines[i++].replace(QUOTE_RE, ''));
      out.push(
        <blockquote key={k()} className="msg-quote">
          {quoted.map((q, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {renderInline(q, ctx, k)}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE_RE.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(
      <Fragment key={k()}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(p, ctx, k)}
          </Fragment>
        ))}
      </Fragment>,
    );
  }
  return out;
}

/** Inline formatting: code > bold > strike > italic > URL > @mention. Input is text only (XSS-safe). */
export function renderInline(text: string, ctx: Ctx, k: () => number = (() => { let n = 0; return () => n++; })()): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;

  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    const [token, code, bold, strike, italicStar, italicUnderscore, url, mention] = m;
    if (idx > last) parts.push(text.slice(last, idx));
    if (code) parts.push(<code key={k()}>{code.slice(1, -1)}</code>);
    else if (bold) parts.push(<strong key={k()}>{renderInline(bold.slice(2, -2), ctx, k)}</strong>);
    else if (strike) parts.push(<s key={k()}>{renderInline(strike.slice(2, -2), ctx, k)}</s>);
    else if (italicStar || italicUnderscore) parts.push(<em key={k()}>{renderInline(token.slice(1, -1), ctx, k)}</em>);
    else if (url) {
      parts.push(
        <a key={k()} href={url} target="_blank" rel="noreferrer noopener">
          {url}
        </a>,
      );
    } else if (mention) {
      const name = mention.slice(1);
      const isKnown = !ctx.knownUsernames || ctx.knownUsernames.has(name.toLowerCase());
      const isMe = name.toLowerCase() === ctx.me.toLowerCase();
      parts.push(
        isKnown ? (
          <span
            key={k()}
            className={`mention-pill${isMe ? ' me' : ''}`}
            onClick={ctx.onMentionClick ? () => ctx.onMentionClick!(name) : undefined}
            role={ctx.onMentionClick ? 'button' : undefined}
            title={ctx.onMentionClick ? `View @${name}'s profile` : undefined}
          >{mention}</span>
        ) : (
          token
        ),
      );
    }
    last = idx + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function toggleInline(
  value: string,
  start: number,
  end: number,
  marker: string,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  const wrap = findWrapMarker(value, start);

  if (wrap) {
    // Already formatted around the selection: remove the markers.
    return {
      value: value.slice(0, wrap.from) + value.slice(wrap.from + marker.length, wrap.to - marker.length) + value.slice(wrap.to),
      start: Math.max(wrap.from, start - marker.length),
      end: Math.max(wrap.from, end - marker.length),
    };
  }
  const inner = selected || 'text';
  const pos = start + marker.length;
  return {
    value: value.slice(0, start) + marker + inner + marker + value.slice(end),
    start: pos,
    end: pos + inner.length,
  };
}

export function toggleLinePrefix(value: string, start: number, prefix: string): { value: string; start: number; end: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = value.indexOf('\n', start);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const line = value.slice(lineStart, lineEnd);
  const stripped = line.replace(prefix, '');
  const next = stripped === line ? prefix + line : stripped;
  const delta = next.length - line.length;
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    start: lineStart + Math.max(0, start - lineStart + delta),
    end: lineEnd + delta,
  };
}

/** Text used for compact previews (quotes, sidebar, notifications). */
export function plainText(content: string) {
  return stripUrls(
    content
      .replace(/```[\s\S]*?```/g, ' [code] ')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/(\*\*|~~|_)/g, '')
      .replace(/\*/g, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\s+/g, ' '),
  ).trim();
}

export { URL_RE, MENTION_RE };
