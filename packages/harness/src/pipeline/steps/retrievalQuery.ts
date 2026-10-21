// Step 6 helper: the retrieval query. The student's latest message alone is often a bare answer
// ("42"), so the most recent agent message (the active problem) is added (3.5 plan Q2).
import type { Message, TurnInput } from '@edmate/contracts';

/** Each part of the query is capped, so one long message can't dominate or bloat it. */
export const QUERY_PART_MAX_CHARS = 1000;

/** The head of the input; the tail of the agent message, where its question usually is. */
const head = (t: string) => t.slice(0, QUERY_PART_MAX_CHARS);
const tail = (t: string) => t.slice(Math.max(0, t.length - QUERY_PART_MAX_CHARS));

export interface RetrievalQueries {
  /**
   * The student's own words alone (the head of the trimmed input text). The locked probe and the
   * locked-precedence check (3.4c) run on this; the agent's reply can never inflate or dilute it.
   */
  student: string;
  /** The student's words plus the tail of the latest agent message, exactly as before 3.4c. */
  withContext: string;
}

/** The student's own words and the agent-widened query, built once (3.4c). */
export function retrievalQueries(input: TurnInput, history: readonly Message[]): RetrievalQueries {
  const student = head((input.text ?? '').trim());
  let agent = '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i] as Message;
    if (m.role === 'agent') {
      agent = tail(m.text.trim());
      break;
    }
  }
  const withContext = [student, agent].filter((p) => p !== '').join('\n');
  return { student, withContext };
}

/** One query string: the input text, then the latest agent message; `''` when both are blank. */
export function retrievalQuery(input: TurnInput, history: readonly Message[]): string {
  return retrievalQueries(input, history).withContext;
}
