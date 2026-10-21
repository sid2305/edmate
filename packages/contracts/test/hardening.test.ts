// Fix round 1 (security-reviewer, architect): size caps, safe formats and cross-field rules,
// each on both sides of its boundary.
import { describe, expect, it } from 'vitest';
import {
  demoAttachment,
  demoChunk,
  demoEntitlementEval,
  demoEntitlementPreview,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackageFree,
  demoPackagePaid,
  demoSafetyAlert,
  demoTurnContext,
  demoTurnInput,
  turnContextFull,
  turnInputSkillAction,
} from '../fixtures/index.js';
import { omit } from '../fixtures/omit.js';
import { teacherModuleIds } from '../fixtures/valid/teacher.js';
import {
  AttachmentSchema,
  GuardResultSchema,
  LIMITS,
  LocalePackSchema,
  SafetyAlertSchema,
  TurnContextSchema,
  TurnInputSchema,
} from '../src/index.js';

const ok = (r: { success: boolean }) => r.success;
const paths = (r: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path) ?? [];

describe('LIMITS for fix round 1', () => {
  it('holds the chosen caps', () => {
    expect(LIMITS).toMatchObject({
      idMaxLength: 128,
      storageKeyMaxLength: 200,
      attachmentMaxBytes: 20 * 1024 * 1024,
      skillPayloadMaxJsonLength: 16 * 1024,
      turnTextMaxLength: 8000,
      guardReasonMaxLength: 500,
      modelTextMaxLength: 8000,
      piiPatternMaxLength: 500,
    });
  });

  it('caps a saved help state at 8 KB of JSON (ADR-0005)', () => {
    expect(LIMITS.helpStateMaxJsonLength).toBe(8 * 1024);
  });

  it('caps a locale pack signer name at 200 characters (ADR-0008)', () => {
    expect(LIMITS.signerMaxLength).toBe(200);
  });
});

describe('ids', () => {
  it('allow letters, digits, _ and - up to 128 characters', () => {
    expect(
      ok(TurnInputSchema.safeParse({ ...demoTurnInput, agentId: 'A-z_0'.padEnd(128, 'x') })),
    ).toBe(true);
    expect(
      paths(TurnInputSchema.safeParse({ ...demoTurnInput, agentId: 'a'.repeat(129) })),
    ).toEqual([['agentId']]);
    for (const bad of ['a.b', 'a/b', 'a b', 'ä', '']) {
      expect(ok(TurnInputSchema.safeParse({ ...demoTurnInput, agentId: bad }))).toBe(false);
    }
  });
});

describe('Attachment', () => {
  it('accepts safe storage keys up to 200 characters', () => {
    for (const storageKey of ['a', 'test/uploads/x_1-2.png', 'a.b/c..d.png', 'k'.repeat(200)]) {
      expect(ok(AttachmentSchema.safeParse({ ...demoAttachment, storageKey }))).toBe(true);
    }
  });

  it('rejects traversal, absolute and odd keys', () => {
    for (const storageKey of [
      '..',
      '../x',
      'a/../b',
      'a/..',
      '/a',
      'a\\b',
      'a b',
      '',
      'k'.repeat(201),
    ]) {
      expect(paths(AttachmentSchema.safeParse({ ...demoAttachment, storageKey }))).toContainEqual([
        'storageKey',
      ]);
    }
  });

  it('allows only png, jpeg, webp and heic', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/heic']) {
      expect(ok(AttachmentSchema.safeParse({ ...demoAttachment, mime }))).toBe(true);
    }
    for (const mime of ['image/svg+xml', 'image/gif', 'application/pdf', 'image/png; x=1']) {
      expect(ok(AttachmentSchema.safeParse({ ...demoAttachment, mime }))).toBe(false);
    }
  });

  it('bytes is 1 to 20 MB', () => {
    expect(ok(AttachmentSchema.safeParse({ ...demoAttachment, bytes: 1 }))).toBe(true);
    expect(
      ok(AttachmentSchema.safeParse({ ...demoAttachment, bytes: LIMITS.attachmentMaxBytes })),
    ).toBe(true);
    for (const bytes of [0, -1, LIMITS.attachmentMaxBytes + 1, 1.5]) {
      expect(ok(AttachmentSchema.safeParse({ ...demoAttachment, bytes }))).toBe(false);
    }
  });
});

describe('TurnInput', () => {
  it('skillPayload up to 16 KB of JSON', () => {
    const at = { blob: 'x'.repeat(LIMITS.skillPayloadMaxJsonLength - '{"blob":""}'.length) };
    expect(JSON.stringify(at).length).toBe(LIMITS.skillPayloadMaxJsonLength);
    expect(ok(TurnInputSchema.safeParse({ ...turnInputSkillAction, skillPayload: at }))).toBe(true);
    const over = { blob: `${at.blob}x` };
    expect(
      paths(TurnInputSchema.safeParse({ ...turnInputSkillAction, skillPayload: over })),
    ).toEqual([['skillPayload']]);
  });

  it('skillPayload that JSON cannot serialise is rejected', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      paths(TurnInputSchema.safeParse({ ...turnInputSkillAction, skillPayload: circular })),
    ).toEqual([['skillPayload']]);
    expect(ok(TurnInputSchema.safeParse({ ...turnInputSkillAction, skillPayload: 10n }))).toBe(
      false,
    );
    expect(ok(TurnInputSchema.safeParse({ ...turnInputSkillAction, skillPayload: null }))).toBe(
      true,
    );
  });

  it('text over 8,000 UTF-16 units fails the length check before counting characters', () => {
    const r = TurnInputSchema.safeParse({ ...demoTurnInput, text: 'a'.repeat(8001) });
    expect(r.error?.issues[0]?.code).toBe('too_big');
  });
});

describe('model-output strings', () => {
  it('SafetyAlert.excerptRedacted is at most 8,000 characters', () => {
    expect(
      ok(SafetyAlertSchema.safeParse({ ...demoSafetyAlert, excerptRedacted: 'x'.repeat(8000) })),
    ).toBe(true);
    expect(
      ok(SafetyAlertSchema.safeParse({ ...demoSafetyAlert, excerptRedacted: 'x'.repeat(8001) })),
    ).toBe(false);
  });

  it('GuardResult reason is at most 500 and rewrite text at most 8,000 characters', () => {
    const r500 = 'x'.repeat(500);
    expect(ok(GuardResultSchema.safeParse({ ok: false, action: 'block', reason: r500 }))).toBe(
      true,
    );
    expect(
      ok(GuardResultSchema.safeParse({ ok: false, action: 'block', reason: `${r500}x` })),
    ).toBe(false);
    const t = 'x'.repeat(8000);
    expect(
      ok(GuardResultSchema.safeParse({ ok: false, action: 'rewrite', text: t, reason: 'r' })),
    ).toBe(true);
    expect(
      ok(GuardResultSchema.safeParse({ ok: false, action: 'rewrite', text: `${t}x`, reason: 'r' })),
    ).toBe(false);
    expect(
      ok(
        GuardResultSchema.safeParse({
          ok: false,
          action: 'rewrite',
          text: 't',
          reason: `${r500}x`,
        }),
      ),
    ).toBe(false);
  });
});

describe('LocalePack.piiPatterns', () => {
  it('each pattern compiles and is at most 500 characters', () => {
    expect(
      ok(LocalePackSchema.safeParse({ ...demoLocalePack, piiPatterns: ['a'.repeat(500)] })),
    ).toBe(true);
    expect(
      paths(LocalePackSchema.safeParse({ ...demoLocalePack, piiPatterns: ['\\d+', '[z-a]'] })),
    ).toEqual([['piiPatterns', 1]]);
  });
});

describe('LocalePack verification fields (ADR-0008)', () => {
  const line = demoLocalePack.helplines[0]!;
  const withLine = (h: Record<string, unknown>) =>
    LocalePackSchema.safeParse({ ...demoLocalePack, helplines: [h] });

  it('a helpline needs verifiedBy and verifiedOn', () => {
    expect(ok(withLine(line))).toBe(true);
    const noBy = omit(line, 'verifiedBy');
    const noOn = omit(line, 'verifiedOn');
    expect(paths(withLine(noBy))).toEqual([['helplines', 0, 'verifiedBy']]);
    expect(paths(withLine(noOn))).toEqual([['helplines', 0, 'verifiedOn']]);
  });

  it('verifiedBy is a name or handle: non-blank, at most 200 characters, never an email', () => {
    expect(ok(withLine({ ...line, verifiedBy: 'pending' }))).toBe(true);
    expect(ok(withLine({ ...line, verifiedBy: 'x'.repeat(LIMITS.signerMaxLength) }))).toBe(true);
    for (const bad of ['', '   ', 'x'.repeat(LIMITS.signerMaxLength + 1), 'someone@example.org']) {
      expect(paths(withLine({ ...line, verifiedBy: bad }))).toEqual([
        ['helplines', 0, 'verifiedBy'],
      ]);
    }
  });

  it('verifiedOn is a calendar date (YYYY-MM-DD)', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '19 Oct 2026', '2026-10-19T00:00:00Z']) {
      expect(paths(withLine({ ...line, verifiedOn: bad }))).toEqual([
        ['helplines', 0, 'verifiedOn'],
      ]);
    }
  });

  it('compliance.parentalConsentRequired is a required boolean', () => {
    const rest = omit(demoLocalePack.compliance, 'parentalConsentRequired');
    expect(paths(LocalePackSchema.safeParse({ ...demoLocalePack, compliance: rest }))).toEqual([
      ['compliance', 'parentalConsentRequired'],
    ]);
    expect(
      paths(
        LocalePackSchema.safeParse({
          ...demoLocalePack,
          compliance: { ...demoLocalePack.compliance, parentalConsentRequired: 'yes' },
        }),
      ),
    ).toEqual([['compliance', 'parentalConsentRequired']]);
  });

  it('reviewedBy and reviewedOn are optional, but come as a pair', () => {
    const unsigned = omit(omit(demoLocalePack, 'reviewedBy'), 'reviewedOn');
    expect(ok(LocalePackSchema.safeParse(unsigned))).toBe(true);
    expect(ok(LocalePackSchema.safeParse(demoLocalePack))).toBe(true);
    expect(paths(LocalePackSchema.safeParse({ ...unsigned, reviewedBy: 'Reviewer A' }))).toEqual([
      ['reviewedOn'],
    ]);
    expect(paths(LocalePackSchema.safeParse({ ...unsigned, reviewedOn: '2026-10-19' }))).toEqual([
      ['reviewedBy'],
    ]);
    expect(
      paths(LocalePackSchema.safeParse({ ...demoLocalePack, reviewedBy: 'a@b.example' })),
    ).toEqual([['reviewedBy']]);
    expect(
      paths(LocalePackSchema.safeParse({ ...demoLocalePack, reviewedOn: '2026-10-32' })),
    ).toEqual([['reviewedOn']]);
  });
});

describe('TurnContext cross-checks', () => {
  it('accepts the consistent fixtures', () => {
    expect(ok(TurnContextSchema.safeParse(demoTurnContext))).toBe(true);
    expect(ok(TurnContextSchema.safeParse(turnContextFull))).toBe(true);
  });

  it('reports each mismatch at its own path', () => {
    const r = TurnContextSchema.safeParse({
      ...turnContextFull,
      retrieved: [demoChunk, { ...demoChunk, moduleId: 'mod_test_04', teacherId: 'tch_test_02' }],
      entitlement: {
        ...turnContextFull.entitlement,
        packageId: 'pkg_test_free',
        packageVersion: 1,
        agentId: 'agt_test_02',
      },
    });
    expect(paths(r)).toEqual([
      ['retrieved', 1, 'moduleId'],
      ['retrieved', 1, 'teacherId'],
      ['entitlement', 'packageId'],
      ['entitlement', 'packageVersion'],
      ['entitlement', 'agentId'],
    ]);
  });
});

describe('entitlement fixtures match their packages', () => {
  const cases = [
    [demoEntitlementSubscription, demoPackagePaid],
    [demoEntitlementPreview, demoPackageFree],
    [demoEntitlementEval, demoPackageFree],
  ] as const;

  it.each(cases)('%#', (e, pkg) => {
    expect(e.packageId).toBe(pkg.id);
    expect(e.packageVersion).toBe(pkg.version);
    expect(e.agentId).toBe(pkg.agentId);
    expect(e.teacherId).toBe(pkg.teacherId);
    expect(e.allowedModuleIds).toEqual(pkg.moduleIds);
    expect(e.lockedModuleIds).toEqual(teacherModuleIds.filter((m) => !pkg.moduleIds.includes(m)));
    expect(e.skills).toEqual(pkg.skills);
  });
});
