// Task 8.4b: the browser side of the studio style-card API (see styleCardRoutes.ts). Client-safe:
// no node imports. Mirrors uploadClient.ts's `ApiResult<T>` shape.
import type { StyleCardQuestionKey } from './styleCardQuestions';

/** What the studio shows for the teacher's current, saved style card. */
export interface StyleCardView {
  id: string;
  teacherId: string;
  version: number;
  text: string;
  mistakeTags: string[];
}

/** A drafted card: not yet saved, always editable before it is. */
export interface StyleCardDraft {
  text: string;
  mistakeTags: string[];
}

/** The style interview a teacher submits for a draft. */
export interface StyleCardInterview {
  answers: Partial<Record<StyleCardQuestionKey, string>>;
  sampleExplanations: string[];
  mistakeCandidates: string[];
}

/** A teacher's own proposed mistake tag, pending review (6.3a). */
export interface MistakeProposalRow {
  tag: string;
  count: number;
  lastSeen: string;
  status: 'pending' | 'approved' | 'rejected';
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

const BASE = '/api/studio/style-card';
const PROPOSALS_BASE = '/api/studio/mistake-proposals';
const JSON_HEADERS = { 'content-type': 'application/json' };

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    const code = body.error?.code;
    return typeof code === 'string' ? code : 'provider_error';
  } catch {
    return 'provider_error';
  }
}

async function call<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    return { ok: false, status: 0, code: 'provider_error' };
  }
  if (!res.ok) return { ok: false, status: res.status, code: await errorCode(res) };
  try {
    return { ok: true, value: await read(res) };
  } catch {
    return { ok: false, status: res.status, code: 'provider_error' };
  }
}

const asJson = <T>(res: Response) => res.json() as Promise<T>;

/** The newest saved version, or `null` before the teacher's first save. */
export function getStyleCard(): Promise<ApiResult<StyleCardView | null>> {
  return call(BASE, { method: 'GET' }, async (res) => {
    return (await asJson<{ card: StyleCardView | null }>(res)).card;
  });
}

/** Drafts from the style interview; the draft is never written. */
export function draftStyleCardApi(
  interview: StyleCardInterview,
): Promise<ApiResult<StyleCardDraft>> {
  return call(
    `${BASE}/draft`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(interview) },
    async (res) => (await asJson<{ draft: StyleCardDraft }>(res)).draft,
  );
}

/** Saves the given text and tags as a new, immutable version. */
export function saveStyleCard(input: {
  text: string;
  mistakeTags: string[];
}): Promise<ApiResult<StyleCardView>> {
  return call(
    BASE,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) },
    async (res) => (await asJson<{ card: StyleCardView }>(res)).card,
  );
}

/** The signed-in teacher's own pending proposed mistake tags. */
export function listMistakeProposals(): Promise<ApiResult<MistakeProposalRow[]>> {
  return call(PROPOSALS_BASE, { method: 'GET' }, async (res) => {
    return (await asJson<{ proposals: MistakeProposalRow[] }>(res)).proposals;
  });
}

/** Approves or rejects a proposed tag; approving returns the new style-card version. */
export function decideMistakeProposal(input: {
  tag: string;
  action: 'approve' | 'reject';
}): Promise<ApiResult<{ approved: boolean; card: StyleCardView | null } | { rejected: boolean }>> {
  return call(
    PROPOSALS_BASE,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
    async (res) =>
      asJson<{ approved: boolean; card: StyleCardView | null } | { rejected: boolean }>(res),
  );
}
