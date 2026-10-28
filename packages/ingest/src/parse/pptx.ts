// PPTX → one unit per slide, located "slide N" where N is the slide's place in the show. The show
// order is ppt/presentation.xml's slide list (through its relationships), which can differ from
// the slide file names after a deck is reordered. A deck without that part falls back to the
// slide file numbers, sorted as numbers (slide10 after slide9). Each DrawingML paragraph (<a:p>)
// is a line; its text runs (<a:t>) join, and a soft break (<a:br>) splits it. Speaker notes,
// layouts and masters are not read.
//
// Every part is read through openZip's unzipped-bytes budget. A part with a DOCTYPE is refused
// (Office never writes one, and entity expansion is how XML bombs work).
import { posix } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { IngestError } from '../errors.js';
import type { ParsedDocument } from '../types.js';
import { numberedUnits, requireTitle } from './sections.js';
import { openZip, type ZipFile } from './zip.js';

/** fast-xml-parser's ordered output: one tag name → children, plus ':@' attributes or '#text'. */
type XmlNode = Record<string, unknown>;

const PRESENTATION = 'ppt/presentation.xml';
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels';
const SLIDE_FILE = /^ppt\/slides\/slide(\d+)\.xml$/;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
});

const damaged = (): IngestError =>
  new IngestError('validation', false, 'the file could not be read as a PPTX');

function parseXml(xml: string): XmlNode[] {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) throw damaged();
  return parser.parse(xml) as XmlNode[];
}

function tagOf(node: XmlNode): string {
  return Object.keys(node).find((k) => k !== ':@') as string;
}

function childrenOf(node: XmlNode): XmlNode[] {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

/** Every element with this tag, in document order, with its attributes (absent for malformed
 * XML, so callers must check before use — they already do, via `damaged()`). */
function elements(nodes: readonly XmlNode[], tag: string): Record<string, string | undefined>[] {
  const found: Record<string, string | undefined>[] = [];
  for (const node of nodes) {
    if (tagOf(node) === tag) found.push((node[':@'] ?? {}) as Record<string, string | undefined>);
    found.push(...elements(childrenOf(node), tag));
  }
  return found;
}

/** The text of one paragraph: runs and fields joined, a soft break as a newline. */
function paragraphText(nodes: readonly XmlNode[]): string {
  let text = '';
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === 'a:t') {
      text += childrenOf(node)
        .map((c) => c['#text'])
        .filter((t): t is string => typeof t === 'string')
        .join('');
    } else if (tag === 'a:br') text += '\n';
    else text += paragraphText(childrenOf(node));
  }
  return text;
}

function slideLines(nodes: readonly XmlNode[]): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    if (tagOf(node) === 'a:p') lines.push(...paragraphText(childrenOf(node)).split('\n'));
    else lines.push(...slideLines(childrenOf(node)));
  }
  return lines;
}

async function slideOrder(zip: ZipFile): Promise<string[]> {
  if (!zip.has(PRESENTATION)) {
    return zip
      .names()
      .map((name) => SLIDE_FILE.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => m[0]);
  }
  const ids = elements(parseXml(await zip.text(PRESENTATION)), 'p:sldId').map((a) => a['r:id']);
  if (ids.length === 0) return [];
  const targets = new Map(
    elements(parseXml(await zip.text(PRESENTATION_RELS)), 'Relationship').map((a) => [
      a.Id,
      a.Target,
    ]),
  );
  return ids.map((id) => {
    const target = id === undefined ? undefined : targets.get(id);
    if (target === undefined) throw damaged();
    return target.startsWith('/') ? target.slice(1) : posix.normalize(`ppt/${target}`);
  });
}

export async function parsePptx(bytes: Uint8Array, sourceTitle: string): Promise<ParsedDocument> {
  const title = requireTitle(sourceTitle);
  const zip = await openZip(bytes, 'PPTX');
  const pages: string[][] = [];
  for (const part of await slideOrder(zip)) {
    pages.push(slideLines(parseXml(await zip.text(part))));
  }
  return numberedUnits(title, 'slide', pages);
}
