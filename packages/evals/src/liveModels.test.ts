import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiveModelEntrySchema, LiveModelsLoadError, loadLiveModels } from './liveModels.js';

describe('LiveModelEntrySchema', () => {
  it('accepts a minimal anthropic entry', () => {
    expect(
      LiveModelEntrySchema.parse({ label: 'haiku', provider: 'anthropic', model: 'claude-haiku-4-5' }),
    ).toEqual({ label: 'haiku', provider: 'anthropic', model: 'claude-haiku-4-5' });
  });

  it('accepts an openai-compatible entry with a baseURL', () => {
    const entry = {
      label: 'oss-model',
      provider: 'openai-compatible' as const,
      model: 'some-model',
      baseURL: 'https://example.com/v1',
    };
    expect(LiveModelEntrySchema.parse(entry)).toEqual(entry);
  });

  it('rejects unknown keys', () => {
    expect(() =>
      LiveModelEntrySchema.parse({
        label: 'haiku',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        extra: 'nope',
      }),
    ).toThrow();
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      LiveModelEntrySchema.parse({ label: 'x', provider: 'openai', model: 'gpt' }),
    ).toThrow();
  });

  it('rejects an empty label', () => {
    expect(() =>
      LiveModelEntrySchema.parse({ label: '', provider: 'anthropic', model: 'claude-haiku-4-5' }),
    ).toThrow();
  });
});

describe('loadLiveModels', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'live-models-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a valid list, in file order', () => {
    const path = join(dir, 'live-models.yaml');
    writeFileSync(
      path,
      '- label: haiku\n  provider: anthropic\n  model: claude-haiku-4-5\n' +
        '- label: sonnet\n  provider: anthropic\n  model: claude-sonnet-4-5\n',
    );
    expect(loadLiveModels(path)).toEqual([
      { label: 'haiku', provider: 'anthropic', model: 'claude-haiku-4-5' },
      { label: 'sonnet', provider: 'anthropic', model: 'claude-sonnet-4-5' },
    ]);
  });

  it('throws naming the missing file', () => {
    expect(() => loadLiveModels(join(dir, 'nope.yaml'))).toThrow(LiveModelsLoadError);
  });

  it('throws on invalid YAML', () => {
    const path = join(dir, 'bad.yaml');
    writeFileSync(path, '- label: [unterminated\n');
    expect(() => loadLiveModels(path)).toThrow(/invalid YAML/);
  });

  it('throws when the document is not a list', () => {
    const path = join(dir, 'notlist.yaml');
    writeFileSync(path, 'label: haiku\n');
    expect(() => loadLiveModels(path)).toThrow(/expected a YAML list/);
  });

  it('throws naming the bad entry index', () => {
    const path = join(dir, 'bad-entry.yaml');
    writeFileSync(path, '- label: haiku\n  provider: anthropic\n  model: 123\n');
    expect(() => loadLiveModels(path)).toThrow(/entry 0 is invalid/);
  });

  it('throws when an openai-compatible entry has no baseURL', () => {
    const path = join(dir, 'no-base-url.yaml');
    writeFileSync(path, '- label: oss\n  provider: openai-compatible\n  model: some-model\n');
    expect(() => loadLiveModels(path)).toThrow(/baseURL is required/);
  });

  it('throws on a duplicate label', () => {
    const path = join(dir, 'dup.yaml');
    writeFileSync(
      path,
      '- label: haiku\n  provider: anthropic\n  model: claude-haiku-4-5\n' +
        '- label: haiku\n  provider: anthropic\n  model: claude-sonnet-4-5\n',
    );
    expect(() => loadLiveModels(path)).toThrow(/duplicate label/);
  });

  it('accepts an empty list', () => {
    const path = join(dir, 'empty.yaml');
    writeFileSync(path, '[]\n');
    expect(loadLiveModels(path)).toEqual([]);
  });
});
