import { readFileSync } from 'node:fs';
import { manualClock, ScriptedGateway, type GatewayScript } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../../src/chunk/chunker.js';
import { parseMarkdown } from '../../src/parse/markdown.js';
import { draftOutline } from '../../src/outline/draftOutline.js';
import type { OutlineModuleInput } from '../../src/outline/types.js';
import { IngestError } from '../../src/errors.js';

const scripted = (script: GatewayScript): ScriptedGateway =>
  new ScriptedGateway(script, manualClock());

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/outline/${name}`, import.meta.url), 'utf8');

/** Chunks a module's notes.md (real, already open-licensed demo-teacher content) by heading. */
function chunkedModule(moduleId: string, title: string, markdown: string): OutlineModuleInput {
  const doc = parseMarkdown(markdown, title);
  const drafts = chunkDocument(doc, { headings: true });
  return {
    moduleId,
    title,
    chunks: drafts.map((d) => ({
      id: `${moduleId}-c${String(d.ord).padStart(4, '0')}`,
      text: d.text,
      locator: d.locator,
    })),
  };
}

const DEMO_MODULES: readonly { id: string; title: string }[] = [
  { id: 'values-variables', title: 'Values and variables' },
  { id: 'conditions', title: 'Making decisions with if' },
];

function demoModuleInput(id: string, title: string): OutlineModuleInput {
  const markdown = readFileSync(
    new URL(`../../../../content/demo-teacher/modules/${id}/notes.md`, import.meta.url),
    'utf8',
  );
  return chunkedModule(id, title, markdown);
}

describe('draftOutline', () => {
  it('acceptance: the demo outline links every topic to source chunks', async () => {
    const modules = DEMO_MODULES.map((m) => demoModuleInput(m.id, m.title));
    const gateway = scripted({
      generateObject: modules.map((m) => ({
        value: {
          topics: [
            { topic: `${m.title}: part one`, chunkIds: [m.chunks[0]!.id] },
            {
              topic: `${m.title}: part two`,
              chunkIds: m.chunks.slice(1, 3).map((c) => c.id),
            },
          ],
        },
      })),
    });

    const outline = await draftOutline(gateway, modules);

    expect(outline.modules).toHaveLength(modules.length);
    for (const [i, moduleDraft] of outline.modules.entries()) {
      const known = new Set(modules[i]!.chunks.map((c) => c.id));
      expect(moduleDraft.topics.length).toBeGreaterThan(0);
      for (const topic of moduleDraft.topics) {
        expect(topic.topic.trim()).not.toBe('');
        expect(topic.chunkIds.length).toBeGreaterThan(0);
        for (const id of topic.chunkIds) expect(known.has(id)).toBe(true);
      }
    }
  });

  it('rejects a scripted answer that invents an unknown chunk id', async () => {
    const module = chunkedModule('sample', 'Sample module', fixture('sample-module.md'));
    const gateway = scripted({
      generateObject: [
        {
          value: {
            topics: [{ topic: 'Counters', chunkIds: [module.chunks[0]!.id, 'not-a-real-id'] }],
          },
        },
      ],
    });

    await expect(draftOutline(gateway, [module])).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
    });
  });

  it('rejects a scripted answer with an empty topic', async () => {
    const module = chunkedModule('sample', 'Sample module', fixture('sample-module.md'));
    const gateway = scripted({
      generateObject: [
        {
          value: { topics: [{ topic: '   ', chunkIds: [module.chunks[0]!.id] }] },
        },
      ],
    });

    await expect(draftOutline(gateway, [module])).rejects.toBeInstanceOf(IngestError);
  });

  it('wraps a gateway failure in a fixed IngestError', async () => {
    const module = chunkedModule('sample', 'Sample module', fixture('sample-module.md'));
    const gateway = scripted({ generateObject: [] });

    await expect(draftOutline(gateway, [module])).rejects.toMatchObject({
      name: 'IngestError',
      code: 'provider_error',
    });
  });

  it('rejects a scripted reply that fails the model output schema', async () => {
    const module = chunkedModule('sample', 'Sample module', fixture('sample-module.md'));
    const gateway = scripted({
      // Missing "topics" entirely: the schema call itself throws a ZodError, not a gateway error.
      generateObject: [{ value: { notTopics: [] } }],
    });

    await expect(draftOutline(gateway, [module])).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
      retryable: false,
    });
  });

  it('maps a real-gateway-shaped validation error to validation, not retryable', async () => {
    const module = chunkedModule('sample', 'Sample module', fixture('sample-module.md'));
    const gateway = {
      generateObject: <T>(): Promise<T> =>
        Promise.reject(
          Object.assign(new Error('schema mismatch'), {
            name: 'GatewayError',
            code: 'validation',
            retryable: false,
          }),
        ),
    };

    await expect(draftOutline(gateway, [module])).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
      retryable: false,
    });
  });

  it('keeps a real-gateway provider outage as provider_error, retryable', async () => {
    const module = chunkedModule('sample', 'Sample module', fixture('sample-module.md'));
    const gateway = {
      generateObject: <T>(): Promise<T> =>
        Promise.reject(
          Object.assign(new Error('rate limited'), {
            name: 'GatewayError',
            code: 'rate_limited',
            retryable: true,
          }),
        ),
    };

    await expect(draftOutline(gateway, [module])).rejects.toMatchObject({
      name: 'IngestError',
      code: 'provider_error',
      retryable: true,
    });
  });

  it('drafts independent modules in parallel, keeping output order equal to input order', async () => {
    const modules = DEMO_MODULES.map((m) => demoModuleInput(m.id, m.title));
    const resolveOrder: string[] = [];
    // The second module's call resolves first; output order must still match input order.
    const gateway = {
      generateObject: <T>(req: { messages: readonly { content: string }[] }): Promise<T> => {
        const module = modules.find((m) =>
          m.chunks.some((c) => req.messages.some((msg) => msg.content.includes(c.id))),
        )!;
        const delayMs = module.moduleId === modules[0]!.moduleId ? 10 : 0;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolveOrder.push(module.moduleId);
            resolve({
              topics: [{ topic: `${module.title}: part one`, chunkIds: [module.chunks[0]!.id] }],
            } as T);
          }, delayMs);
        });
      },
    };

    const outline = await draftOutline(gateway, modules);

    expect(resolveOrder[0]).toBe(modules[1]!.moduleId);
    expect(outline.modules.map((m) => m.moduleId)).toEqual(modules.map((m) => m.moduleId));
  });
});
