// Task 9.4b: renders an agent reply as markdown with react-markdown + remark-gfm (human answer B-32),
// replacing 9.4's hand-rolled renderer under the same XSS tests (4.6b safety review).
// - No raw HTML: no raw-HTML rehype plugin (banned by no-raw-html.test.ts), so react-markdown turns
//   raw HTML in the model's text into plain text nodes; it shows literally, never as an element.
// - Allowlisted elements only (ALLOWED). Anything else is unwrapped to its text (e.g. a heading's
//   text stays, the <h1> does not); a markdown image has no text children, so it renders not at all.
// - Links: a real <a> only for http:, https: and mailto: (SafeLink); any other link is its text.
// - Strikethrough needs `~~x~~`: singleTilde is off so `l~o~op` stays literal, matching the
//   locked-content guard's reading (lead decision, 4.6c).
// - GFM task-list checkboxes show as the text "[x]" / "[ ]", never an <input>.
// - Paragraphs keep single newlines visible (pre-wrap). TeX stays literal (KaTeX is parked):
//   protectMath backslash-escapes punctuation inside $…$, $$…$$, \(…\) and \[…\] outside code, so
//   markdown neither eats TeX's backslashes nor reads `_`/`*` in it as emphasis.
import type { ComponentProps, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ALLOWED = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'hr',
  'ul',
  'ol',
  'li',
  'input',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
];

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The href if it is an absolute http(s)/mailto URL, else null. Exported for direct tests. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  // Control/format/whitespace characters are dropped before parsing so `java\tscript:` and
  // zero-width tricks can't hide a protocol; URL() then lower-cases the scheme.
  const cleaned = href.replace(/[\p{Cc}\p{Cf}\s]/gu, '');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return null;
  try {
    return SAFE_PROTOCOLS.has(new URL(cleaned).protocol) ? href : null;
  } catch {
    return null;
  }
}

function SafeLink({ href, children }: ComponentProps<'a'>): ReactNode {
  const safe = safeHref(href);
  if (safe === null) return <>{children}</>;
  return (
    <a href={safe} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
}

const COMPONENTS: Components = {
  a: SafeLink,
  p: ({ children }) => <p style={{ whiteSpace: 'pre-wrap' }}>{children}</p>,
  input: ({ checked }) => (checked ? '[x]' : '[ ]'),
};

// Fenced code (``` or ~~~, to its matching close or the end of the text) and inline code spans
// are left as-is.
const CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|(?![\s\S]))|(`+)[\s\S]*?[^`]\2(?!`)/gm;
const MATH = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=\S)[^$\n]*?\S\$|\$\S\$/g;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/g;

function escapeMath(text: string): string {
  return text.replace(MATH, (m) => m.replace(ASCII_PUNCT, '\\$&'));
}

/** Escapes TeX segments outside code so markdown leaves them literal. Exported for direct tests. */
export function protectMath(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    out += escapeMath(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + escapeMath(text.slice(last));
}

export function renderReply(text: string): ReactNode {
  return (
    <ReactMarkdown
      remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
      allowedElements={ALLOWED}
      unwrapDisallowed
      skipHtml={false}
      components={COMPONENTS}
    >
      {protectMath(text)}
    </ReactMarkdown>
  );
}
