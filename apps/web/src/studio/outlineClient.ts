// Task 8.3 Phase C: the browser side of the studio outline API (see docs/tasks/8.3b/handoff.md
// for the server shapes). Client-safe: no node imports. Mirrors uploadClient.ts's
// `ApiResult`/`call` shape (rule 4: no real network in tests, fetch is always stubbed).

/** One source link of a topic: which chunk, from which file, where in it. Never the chunk text. */
export interface OutlineSource {
  chunkId: string;
  sourceTitle: string;
  locator: string;
}

export interface OutlineTopic {
  id: string;
  title: string;
  order: number;
  chunkIds: OutlineSource[];
}

export interface OutlineModule {
  id: string;
  title: string;
  order: number;
  topics: OutlineTopic[];
}

/** A teacher's whole outline, as `GET`/`PUT`/`generate` return it. */
export interface Outline {
  courseId: string;
  outlineVersion: number;
  modules: OutlineModule[];
}

/** One topic of a `PUT`: `id` absent for a new topic (a split's new half). */
export interface TopicInput {
  id?: string;
  title: string;
  order: number;
  chunkIds: string[];
}

export interface ModuleInput {
  id: string;
  title: string;
  order: number;
  topics: TopicInput[];
}

/** The whole edited tree a `PUT` sends. */
export interface OutlineInput {
  modules: ModuleInput[];
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

const BASE = '/api/studio/outline';
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

export function getOutline(): Promise<ApiResult<Outline>> {
  return call(BASE, { method: 'GET' }, asJson<Outline>);
}

export function putOutline(input: OutlineInput): Promise<ApiResult<Outline>> {
  return call(
    BASE,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) },
    asJson<Outline>,
  );
}

export function generateOutline(): Promise<ApiResult<Outline>> {
  return call(`${BASE}/generate`, { method: 'POST' }, asJson<Outline>);
}
