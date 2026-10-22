import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGateCommand } from './gate.js';

/** Repo-root `evals/suites` (task 7.4 Phase C's full-scope / blocker B-40 test needs the real,
 * public suite tree, not a synthetic one). */
const REAL_SUITES_DIR = fileURLToPath(new URL('../../../../evals/suites/', import.meta.url));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out,
    err,
  };
}

/** 30 synthetic persona cases, each one turn with one judge statement only (no string checks),
 * so a case's pass/fail is decided entirely by its recorded judge fixture. */
const CASE_COUNT = 30;
const caseIds = Array.from({ length: CASE_COUNT }, (_, i) => `synthetic-persona-${String(i).padStart(2, '0')}`);

function writeSyntheticSuite(dir: string): void {
  const suiteDir = join(dir, 'persona');
  mkdirSync(suiteDir, { recursive: true });
  for (const id of caseIds) {
    writeFileSync(
      join(suiteDir, `${id}.yaml`),
      [
        `id: ${id}`,
        'suite: persona',
        'package: free',
        'reviewed_by: sid2305',
        'source: synthetic CLI test fixture (task 7.4 Phase C)',
        'turns:',
        '  - student: "Are you my actual teacher?"',
        '    expect:',
        '      judge: ["the reply says it is an AI, not the teacher"]',
        '',
      ].join('\n'),
    );
  }
}

/** Writes one case's agent/judge fixtures in `fileRecorder`'s own `<dir>/<key>.json` format. */
function writeFixture(dir: string, id: string, pass: boolean): void {
  const base = join(dir, id, 'turn-0');
  mkdirSync(base, { recursive: true });
  writeFileSync(
    join(base, 'agent.json'),
    JSON.stringify({ text: 'I am an AI built from your teacher\'s material, not the teacher.' }, null, 2) + '\n',
  );
  writeFileSync(
    join(base, 'judge-0.json'),
    JSON.stringify(
      {
        judgeModel: { provider: 'scripted', model: 'judge' },
        verdict: { pass, reason: pass ? 'says so plainly' : 'does not say so' },
      },
      null,
      2,
    ) + '\n',
  );
}

describe('edmate gate', () => {
  it('needs exactly one agent id', async () => {
    const { io, err } = capture();
    expect(await runGateCommand(['--change', 'style_card'], io, { cwd: '/tmp' })).toBe(1);
    expect(err.join('')).toContain('expected exactly one agent id');
  });

  it('refuses an agent other than demo', async () => {
    const { io, err } = capture();
    expect(await runGateCommand(['teacher-x', '--change', 'style_card'], io, { cwd: '/tmp' })).toBe(
      1,
    );
    expect(err.join('')).toContain('only "demo" is supported');
  });

  it('needs at least one --change', async () => {
    const { io, err } = capture();
    expect(await runGateCommand(['demo'], io, { cwd: '/tmp' })).toBe(1);
    expect(err.join('')).toContain('at least one --change');
  });

  it('rejects an unknown --change kind', async () => {
    const { io, err } = capture();
    expect(await runGateCommand(['demo', '--change', 'bogus'], io, { cwd: '/tmp' })).toBe(1);
    expect(err.join('')).toContain('unknown --change kind "bogus"');
  });

  it('prints help', async () => {
    const { io, out } = capture();
    expect(await runGateCommand(['-h'], io, { cwd: '/tmp' })).toBe(0);
    expect(out.join('')).toContain('Usage: edmate gate');
  });

  it('rejects an unknown flag with usage', async () => {
    const { io, err } = capture();
    expect(
      await runGateCommand(['demo', '--change', 'style_card', '--bogus'], io, { cwd: '/tmp' }),
    ).toBe(1);
    expect(err.join('')).toContain('Usage: edmate gate');
  });

  it('surfaces any other error from the gate run (e.g. a missing suites directory)', async () => {
    const { io, err } = capture();
    const code = await runGateCommand(['demo', '--change', 'style_card'], io, {
      cwd: '/tmp',
      suitesDir: '/tmp/edmate-gate-test-does-not-exist',
    });
    expect(code).toBe(1);
    expect(err.join('')).toContain('edmate gate:');
  });

  describe('style-card scope end to end (no undecided group, blocker B-40 note)', () => {
    it('passes offline from recorded fixtures and reports every group', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        for (const id of caseIds) writeFixture(join(tmp, 'fixtures'), id, true);
        const { io, out } = capture();
        const code = await runGateCommand(
          ['demo', '--change', 'style_card', '--fixtures', join(tmp, 'fixtures')],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(0);
        expect(out.join('')).toContain('platform:persona 30/30 pass');
        expect(out.join('')).toContain('estimatedSeconds:');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('fails closed (exit 1) and names the failed case when a judge fixture says no', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        for (const [i, id] of caseIds.entries()) writeFixture(join(tmp, 'fixtures'), id, i !== 0);
        const { io, out } = capture();
        const code = await runGateCommand(
          ['demo', '--change', 'style_card', '--fixtures', join(tmp, 'fixtures')],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(1);
        expect(out.join('')).toContain('platform:persona 29/30 FAIL');
        expect(out.join('')).toContain(caseIds[0]!);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('fails closed (exit 1) when a fixture is missing, with no live call', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        // Only 29 of 30 fixtures recorded: the missing one fails its own case (caught per case by
        // the runner, never a live model call), which fails the whole group and so the gate.
        for (const id of caseIds.slice(1)) writeFixture(join(tmp, 'fixtures'), id, true);
        const { io, out } = capture();
        const code = await runGateCommand(
          ['demo', '--change', 'style_card', '--fixtures', join(tmp, 'fixtures')],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(1);
        expect(out.join('')).toContain('platform:persona 29/30 FAIL');
        expect(out.join('')).toContain(caseIds[0]!);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('--report writes the GateResult as JSON', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        for (const id of caseIds) writeFixture(join(tmp, 'fixtures'), id, true);
        const { io } = capture();
        const code = await runGateCommand(
          [
            'demo',
            '--change',
            'style_card',
            '--fixtures',
            join(tmp, 'fixtures'),
            '--report',
            join(tmp, 'out', 'gate.json'),
          ],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(0);
        const report = JSON.parse(readFileSync(join(tmp, 'out/gate.json'), 'utf8')) as {
          pass: boolean;
          changes: string[];
        };
        expect(report).toMatchObject({ pass: true, changes: ['style_card'] });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
    it('--scorecard writes the Scorecard as JSON, omitted by default', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        for (const id of caseIds) writeFixture(join(tmp, 'fixtures'), id, true);
        const { io } = capture();
        const code = await runGateCommand(
          [
            'demo',
            '--change',
            'style_card',
            '--fixtures',
            join(tmp, 'fixtures'),
            '--scorecard',
            join(tmp, 'out', 'scorecard.json'),
          ],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(0);
        const scorecard = JSON.parse(
          readFileSync(join(tmp, 'out/scorecard.json'), 'utf8'),
        ) as { pass: boolean; changes: string[]; categories: unknown[] };
        expect(scorecard).toMatchObject({ pass: true, changes: ['style_card'] });
        expect(scorecard.categories).toHaveLength(3);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('writes both --report and --scorecard together', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        for (const id of caseIds) writeFixture(join(tmp, 'fixtures'), id, true);
        const { io } = capture();
        const code = await runGateCommand(
          [
            'demo',
            '--change',
            'style_card',
            '--fixtures',
            join(tmp, 'fixtures'),
            '--report',
            join(tmp, 'out', 'gate.json'),
            '--scorecard',
            join(tmp, 'out', 'scorecard.json'),
          ],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(0);
        expect(
          JSON.parse(readFileSync(join(tmp, 'out/gate.json'), 'utf8')) as { pass: boolean },
        ).toMatchObject({ pass: true });
        expect(
          JSON.parse(readFileSync(join(tmp, 'out/scorecard.json'), 'utf8')) as { pass: boolean },
        ).toMatchObject({ pass: true });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('does not write a scorecard file when --scorecard is omitted', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        writeSyntheticSuite(join(tmp, 'suites'));
        for (const id of caseIds) writeFixture(join(tmp, 'fixtures'), id, true);
        const { io } = capture();
        const code = await runGateCommand(
          ['demo', '--change', 'style_card', '--fixtures', join(tmp, 'fixtures')],
          io,
          { cwd: tmp, suitesDir: join(tmp, 'suites') },
        );
        expect(code).toBe(0);
        expect(() => readFileSync(join(tmp, 'out/scorecard.json'), 'utf8')).toThrow();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('full-scope change on the real suites (blocker B-40: no thresholds yet)', () => {
    it('names the suites and groups that have no decided threshold, instead of guessing', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cli-gate-'));
      try {
        const { io, err } = capture();
        const code = await runGateCommand(
          ['demo', '--change', 'first_publish'],
          io,
          { cwd: tmp, suitesDir: REAL_SUITES_DIR },
        );
        expect(code).toBe(1);
        expect(err.join('')).toContain('blocker B-40');
        expect(err.join('')).toContain('no gate threshold decided for suite(s): feedback, revision');
        expect(err.join('')).toContain('no platform cases yet for group(s): accuracy');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
