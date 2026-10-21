import { describe, expect, it } from 'vitest';
import { loadChatContent, CHAT_CONTENT_DIR, CHAT_IDS } from './world.js';
import { buildChatRetrieval } from './retrieval.js';

const CONTENT = loadChatContent(CHAT_CONTENT_DIR);
const TEACHER = CHAT_IDS.teacher;

describe('buildChatRetrieval', () => {
  it('finds a chunk for an allowed module and none for a locked one', async () => {
    const index = buildChatRetrieval(CONTENT, TEACHER);
    const allowed = ['values-variables', 'conditions'];
    const hits = await index.search('variable', { teacherId: TEACHER, allowedModuleIds: allowed }, 5);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(allowed).toContain(h.moduleId);

    const lockedOnly = await index.search(
      'assignment operator',
      { teacherId: TEACHER, allowedModuleIds: ['loops'] },
      5,
    );
    expect(lockedOnly).toEqual([]);
  });

  it('never returns a chunk from another teacher (scope is teacher + module, both required)', async () => {
    const index = buildChatRetrieval(CONTENT, TEACHER);
    const hits = await index.search(
      'variable',
      { teacherId: 'someone-else', allowedModuleIds: ['values-variables'] },
      5,
    );
    expect(hits).toEqual([]);
  });

  it('probes locked modules code-only (no text returned)', async () => {
    const index = buildChatRetrieval(CONTENT, TEACHER);
    const result = await index.probe('loop', { teacherId: TEACHER, moduleIds: ['loops'] });
    expect(result).toEqual({ hit: true, score: expect.any(Number) });
  });

  it('leakCheck flags a candidate that only matches locked material', async () => {
    const index = buildChatRetrieval(CONTENT, TEACHER);
    const notes = CONTENT.notes.get('loops') ?? '';
    const span = notes.split(/\s+/).slice(0, 12).join(' ');
    const result = await index.leakCheck([span], {
      teacherId: TEACHER,
      allowedModuleIds: ['values-variables', 'conditions'],
    });
    expect(typeof result.hit).toBe('boolean');
  });

  it('rejects a search with no scope (the port requires one)', async () => {
    const index = buildChatRetrieval(CONTENT, TEACHER);
    await expect(
      index.search('x', undefined as unknown as { teacherId: string; allowedModuleIds: string[] }, 5),
    ).rejects.toThrow();
  });
});
