// Task 9.4: renders an agent reply with no raw HTML (4.6b safety review). Everything is React
// text nodes, so HTML in the model's text shows literally. Supported: paragraphs (split on blank
// lines, single newlines kept with pre-wrap), fenced code blocks as <pre><code> (no highlighting),
// and inline `code`. No links, no images; TeX stays literal (KaTeX is parked).
// The interface `renderReply(text): ReactNode` lets a markdown library (plan Q1) be swapped in
// later under the same tests.
import type { ReactNode } from 'react';

type Block = { kind: 'p'; text: string } | { kind: 'code'; text: string };

const FENCE = /^ {0,3}```/;
const FENCE_CLOSE = /^ {0,3}```\s*$/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  const flush = () => {
    if (para.length > 0) out.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (code !== null) {
      if (FENCE_CLOSE.test(line)) {
        out.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
    } else if (FENCE.test(line)) {
      flush();
      code = [];
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  // An unclosed fence (the reply is still streaming) shows what has arrived as code.
  if (code !== null) out.push({ kind: 'code', text: code.join('\n') });
  return out;
}

function inline(text: string): ReactNode[] {
  // Odd parts are the inside of a `code` span.
  return text
    .split(/`([^`\n]+)`/)
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
    .filter((part) => part !== '');
}

export function renderReply(text: string): ReactNode {
  return blocks(text).map((b, i) =>
    b.kind === 'code' ? (
      <pre key={i}>
        <code>{b.text}</code>
      </pre>
    ) : (
      <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
        {inline(b.text)}
      </p>
    ),
  );
}
