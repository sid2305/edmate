// Task 7.7a: `db:health-report` argument parsing and printed metrics. The repository is a fake;
// the Postgres-backed negative-path tests live in test/trace-sink.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { runHealthReportCli, type OpenHealthReport } from '../src/cli.js';
import { RepositoryError, type TurnTraceRow } from '../src/index.js';

const URL_WITH_PASSWORD = 'postgres://edmate:hunter2-secret@127.0.0.1:5432/edmate';

function trace(overrides: Partial<TurnTraceRow> = {}): TurnTraceRow {
  return {
    id: 'trc_1',
    sessionId: 'ses_1',
    turnId: 'trn_1',
    agentVersion: 1,
    packageVersion: 1,
    steps: [
      { name: 'firstToken', ms: 400, outcome: 'ok' },
      { name: 'generate', ms: 900, outcome: 'ok' },
    ],
    intent: 'ask',
    move: 'answer',
    guards: [{ name: 'pii', ok: true }],
    usage: [],
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  } as TurnTraceRow;
}

function fakeOpen(
  listForTeacherSince?: (...a: unknown[]) => Promise<TurnTraceRow[]>,
) {
  const close = vi.fn(async () => undefined);
  const turnTraces = {
    listForTeacherSince: vi.fn(listForTeacherSince ?? (async () => [trace()])),
  };
  const open: OpenHealthReport = vi.fn(() => ({ turnTraces, close })) as never;
  return { open, turnTraces, close };
}

async function run(
  argv: string[],
  open: OpenHealthReport,
  env: { DATABASE_URL?: string | undefined } = { DATABASE_URL: URL_WITH_PASSWORD },
) {
  const lines: string[] = [];
  const code = await runHealthReportCli(argv, env, (l) => lines.push(l), open);
  return { code, out: lines.join('\n') };
}

describe('db:health-report', () => {
  it('prints turn count, per-step p50/p95/n, error rate (by step) and guard rate (by guard)', async () => {
    const rows = [
      trace({
        turnId: 'trn_1',
        steps: [
          { name: 'firstToken', ms: 400, outcome: 'ok' },
          { name: 'generate', ms: 900, outcome: 'failed' },
        ],
        guards: [{ name: 'pii', ok: false }],
      }),
      trace({
        turnId: 'trn_2',
        steps: [
          { name: 'firstToken', ms: 300, outcome: 'ok' },
          { name: 'generate', ms: 700, outcome: 'ok' },
        ],
        guards: [{ name: 'pii', ok: true }],
      }),
    ];
    const f = fakeOpen(async () => rows);
    const { code, out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z'],
      f.open,
    );
    expect(code).toBe(0);
    expect(out).toBe(
      [
        'db:health-report: target postgres://127.0.0.1:5432/edmate',
        'db:health-report: turns=2',
        'db:health-report: firstToken p50=300 p95=400 n=2',
        'db:health-report: generate p50=700 p95=900 n=2',
        'db:health-report: errorRate=0.5 errorsByStep={"generate":1}',
        'db:health-report: guardRate=0.5 guardsByName={"pii":1}',
      ].join('\n'),
    );
    expect(f.turnTraces.listForTeacherSince).toHaveBeenCalledWith(
      { teacherId: 'tch_1' },
      '2026-10-20T09:00:00Z',
      undefined,
    );
  });

  it('passes --limit through to the repository', async () => {
    const f = fakeOpen(async () => [trace()]);
    await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z', '--limit', '50'],
      f.open,
    );
    expect(f.turnTraces.listForTeacherSince).toHaveBeenCalledWith(
      { teacherId: 'tch_1' },
      '2026-10-20T09:00:00Z',
      50,
    );
  });

  it('prints a plain message when there are no turns in the window', async () => {
    const f = fakeOpen(async () => []);
    const { code, out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z'],
      f.open,
    );
    expect(code).toBe(0);
    expect(out).toBe(
      [
        'db:health-report: target postgres://127.0.0.1:5432/edmate',
        'db:health-report: turns=0 (no turns in this window)',
      ].join('\n'),
    );
  });

  it('prints one usage line and returns 1 when --teacher is missing', async () => {
    const f = fakeOpen();
    const { code, out } = await run(['--since', '2026-10-20T09:00:00Z'], f.open);
    expect(code).toBe(1);
    expect(out).toBe(
      'db:health-report: usage: db:health-report -- --teacher <id> --since <iso> [--limit <n>]',
    );
    expect(f.open).not.toHaveBeenCalled();
  });

  it('prints one usage line and returns 1 when --since is missing', async () => {
    const f = fakeOpen();
    const { code, out } = await run(['--teacher', 'tch_1'], f.open);
    expect(code).toBe(1);
    expect(out).toContain('usage: db:health-report');
  });

  it('prints one usage line and returns 1 when --limit is not a number', async () => {
    const f = fakeOpen();
    const { code, out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z', '--limit', 'not-a-number'],
      f.open,
    );
    expect(code).toBe(1);
    expect(out).toContain('usage: db:health-report');
  });

  it('returns 1 when DATABASE_URL is not set', async () => {
    const f = fakeOpen();
    const { code, out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z'],
      f.open,
      {},
    );
    expect(code).toBe(1);
    expect(out).toBe('db:health-report: DATABASE_URL is not set');
    expect(f.open).not.toHaveBeenCalled();
  });

  it('never prints the raw connection string on failure, and always closes the handle', async () => {
    const f = fakeOpen(async () => {
      throw new Error(`boom at ${URL_WITH_PASSWORD}`);
    });
    const { code, out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z'],
      f.open,
    );
    expect(code).toBe(1);
    expect(out).not.toContain('hunter2-secret');
    expect(out).toContain('db:health-report: failed:');
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('prints the redacted target before opening the database', async () => {
    const f = fakeOpen();
    const { out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z'],
      f.open,
    );
    expect(out).toContain('db:health-report: target postgres://127.0.0.1:5432/edmate');
    expect(out).not.toContain('hunter2-secret');
  });

  it('prints a fixed message, not driver text, for a RepositoryError', async () => {
    const f = fakeOpen(async () => {
      throw new RepositoryError('invalid', 'turnTraces.listForTeacherSince');
    });
    const { code, out } = await run(
      ['--teacher', 'tch_1', '--since', '2026-10-20T09:00:00Z'],
      f.open,
    );
    expect(code).toBe(1);
    expect(out).toContain('db:health-report: failed:');
  });
});
