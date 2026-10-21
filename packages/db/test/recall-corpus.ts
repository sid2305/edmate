// Task 5.3 Phase D: the demo course as the recall test (recall.int.test.ts) and the one-off
// recording script (scripts/record-demo-embeddings.ts) both see it. Package imports only, so the
// script can load this file with Node's own type stripping.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type DemoTeacherContent,
  loadDemoTeacherContent,
  type QaRecallItem,
} from '@edmate/content';
import { type ChunkDraft, chunkDocument, type ParsedDocument, parseMarkdown } from '@edmate/ingest';

export const DEMO_DIR = fileURLToPath(new URL('../../../content/demo-teacher/', import.meta.url));

/** Recorded vectors of the real embedding model (Q2); absent until the human records them. */
export const EMBEDDINGS_FIXTURE = fileURLToPath(
  new URL('./fixtures/demo-embeddings.json', import.meta.url),
);

export interface DemoModule {
  moduleId: string;
  title: string;
  parsed: ParsedDocument;
  drafts: ChunkDraft[];
}

export interface DemoCorpus {
  content: DemoTeacherContent;
  modules: DemoModule[];
  items: QaRecallItem[];
}

/** The demo course's notes, parsed and chunked exactly as indexing does (heading-located). */
export function demoCorpus(dir: string = DEMO_DIR): DemoCorpus {
  const content = loadDemoTeacherContent(dir);
  const modules = content.course.modules.map((m) => {
    const notes = content.notes.get(m.id);
    if (notes === undefined) throw new Error(`demo module ${m.id} has no notes`);
    const parsed = parseMarkdown(notes, `${m.title} notes`);
    return { moduleId: m.id, title: m.title, parsed, drafts: chunkDocument(parsed, { headings: true }) };
  });
  return { content, modules, items: content.qaRecall };
}

/** Every text the recall test embeds: each chunk and each question, once, in a fixed order. */
export function textsToEmbed(corpus: DemoCorpus): string[] {
  const all = [
    ...corpus.modules.flatMap((m) => m.drafts.map((d) => d.text)),
    ...corpus.items.map((i) => i.question),
  ];
  return [...new Set(all)];
}

export interface RecordedEmbeddings {
  model: string;
  dimension: number;
  entries: { text: string; vector: number[] }[];
}

/** The recorded vectors by text, or undefined when the fixture has not been recorded. */
export function readRecordedEmbeddings(
  file: string = EMBEDDINGS_FIXTURE,
): Map<string, number[]> | undefined {
  if (!existsSync(file)) return undefined;
  const data = JSON.parse(readFileSync(file, 'utf8')) as RecordedEmbeddings;
  return new Map(data.entries.map((e) => [e.text, e.vector]));
}
