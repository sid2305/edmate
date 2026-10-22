// Task 9.6 Phase B, plan Q4: the notes document model -- what a student's downloaded notes PDF
// holds. No raw chat transcript (that stays in the complete JSON export only): progress, next
// steps, session summaries, the teacher's answers and mistakes to watch.
import type { ExportJson } from './buildExport';
import type { Progress } from '../progress/progress';
import type { PdfBlock } from './pdf';

export type { PdfBlock } from './pdf';

function moduleStateCount(topics: Progress['modules'][number]['topics']) {
  const mastered = topics.filter((t) => t.state === 'mastered').length;
  const practising = topics.filter((t) => t.state === 'practising').length;
  return { mastered, practising, total: topics.length };
}

/**
 * `teacherQuestions.listForStudent` never carries the answer's text (the contract has no such
 * field -- `answer()` writes it as a role `'teacher'` chat message instead, task 5.10). This pairs
 * each answered question with the first not-yet-used teacher-role message at or after its
 * `answeredAt`/`createdAt`, across every exported session (one at a time, oldest first): a
 * reasonable match given the schema, not a guaranteed exact one (decision, 22 Oct 2026).
 */
function answeredPairs(
  questions: ExportJson['teacherQuestions'],
  allMessages: ExportJson['sessions'][number]['messages'],
): Array<{ question: string; answer: string }> {
  const teacherMessages = allMessages
    .filter((m) => m.role === 'teacher')
    .map((m) => ({ createdAt: m.createdAt, text: m.text }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const answered = [...questions]
    .filter((q) => q.status === 'answered')
    .sort((a, b) => (a.answeredAt ?? a.createdAt).localeCompare(b.answeredAt ?? b.createdAt));
  const used = new Set<number>();
  const pairs: Array<{ question: string; answer: string }> = [];
  for (const q of answered) {
    const at = q.answeredAt ?? q.createdAt;
    const idx = teacherMessages.findIndex((m, i) => !used.has(i) && m.createdAt >= at);
    if (idx === -1) continue;
    used.add(idx);
    pairs.push({ question: q.text, answer: teacherMessages[idx]!.text });
  }
  return pairs;
}

/** Headings and lines in a fixed order: title, progress per module, next steps, session summaries
 * (newest first), answered teacher questions, mistakes to watch. */
export function notesDocument(exportJson: ExportJson, progress: Progress): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const packageName = exportJson.subscription?.package?.name ?? 'Edmate';
  const exportDate = exportJson.exportedAt.slice(0, 10);
  blocks.push({ kind: 'h1', text: `${packageName} – export ${exportDate}` });

  blocks.push({ kind: 'h2', text: 'Progress' });
  if (progress.modules.length === 0) {
    blocks.push({ kind: 'p', text: 'No progress yet.' });
  } else {
    for (const m of progress.modules) {
      const { mastered, practising, total } = moduleStateCount(m.topics);
      blocks.push({
        kind: 'li',
        text: `${m.title}: ${mastered}/${total} mastered, ${practising} in progress`,
      });
    }
  }

  blocks.push({ kind: 'h2', text: 'Next steps' });
  if (progress.nextSteps.length === 0) {
    blocks.push({ kind: 'p', text: 'Nothing new to try yet.' });
  } else {
    for (const step of progress.nextSteps) blocks.push({ kind: 'li', text: step.title });
  }

  blocks.push({ kind: 'h2', text: 'Session summaries' });
  const sessionsNewestFirst = [...exportJson.sessions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const withSummary = sessionsNewestFirst.filter((s) => s.summary);
  if (withSummary.length === 0) {
    blocks.push({ kind: 'p', text: 'No sessions yet.' });
  } else {
    for (const s of withSummary) blocks.push({ kind: 'p', text: s.summary! });
  }

  blocks.push({ kind: 'h2', text: 'Answers from your teacher' });
  const allMessages = exportJson.sessions.flatMap((s) => s.messages);
  const pairs = answeredPairs(exportJson.teacherQuestions, allMessages);
  if (pairs.length === 0) {
    blocks.push({ kind: 'p', text: 'No answered questions yet.' });
  } else {
    for (const pair of pairs) {
      blocks.push({ kind: 'p', text: pair.question });
      blocks.push({ kind: 'p', text: pair.answer });
    }
  }

  blocks.push({ kind: 'h2', text: 'Mistakes to watch' });
  const mistakes = exportJson.learnerProfile?.mistakes ?? [];
  if (mistakes.length === 0) {
    blocks.push({ kind: 'p', text: 'No mistakes recorded yet.' });
  } else {
    for (const m of mistakes) blocks.push({ kind: 'li', text: `${m.tag}: ${m.count}` });
  }

  return blocks;
}
