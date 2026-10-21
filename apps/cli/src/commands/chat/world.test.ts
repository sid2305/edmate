import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  EntitlementSchema,
  LocalePackSchema,
  PackageConfigSchema,
} from '@edmate/contracts';
import { memoryEntitlementStore, memoryTurnConfigStore } from '@edmate/harness/testing';
import {
  buildChatWorld,
  CHAT_CONTENT_DIR,
  CHAT_IDS,
  loadChatContent,
  CHAT_PERSONAS_DIR,
  loadChatLocalePack,
  loadChatPersonas,
  loadChatPromptPacks,
} from './world.js';

const CONTENT = loadChatContent(CHAT_CONTENT_DIR);

describe('loadChatContent', () => {
  it('loads the real demo-teacher content tree', () => {
    expect(CONTENT.course.id).toBe('python-basics-demo');
    expect(CONTENT.course.modules.length).toBeGreaterThan(0);
  });
});

describe('loadChatPromptPacks', () => {
  it('loads the real prompt-pack set', () => {
    const { library, version, source } = loadChatPromptPacks();
    expect(source).toBe('real');
    expect(library.get(version)).toBeDefined();
  });
});

describe('loadChatPersonas (5.8a)', () => {
  it('reads the real signed personas from content/skills/mock_interview', () => {
    expect(CHAT_PERSONAS_DIR.replaceAll('\\', '/')).toMatch(/content\/skills\/mock_interview\/?$/);
    const { personas, source } = loadChatPersonas();
    expect(source).toBe('real');
    expect([...(personas?.keys() ?? [])].sort()).toEqual(['job-interview', 'viva']);
    expect(personas?.get('job-interview')?.endAfterQuestions).toBe(6);
  });

  it('gives no personas (role-play off) when the directory does not load', () => {
    expect(loadChatPersonas('/no/such/dir')).toEqual({ personas: undefined, source: 'none' });
  });
});

describe('loadChatLocalePack', () => {
  it('loads the real default locale pack for an unknown market', () => {
    const { pack, source } = loadChatLocalePack('zz-unknown');
    expect(source).toBe('real');
    expect(LocalePackSchema.safeParse(pack).success).toBe(true);
    expect(pack.market).toBe('global');
  });

  it('falls back to the contracts fixture pack when the directory does not load', () => {
    const { pack, source } = loadChatLocalePack('global', '/no/such/dir');
    expect(source).toBe('fixture');
    expect(LocalePackSchema.safeParse(pack).success).toBe(true);
  });
});

describe('buildChatWorld', () => {
  it('builds a valid agent, two valid packages and one open teacher_preview session', () => {
    const { world, accessOptions, teacherId, agentId, studentId, sessionId, packageId } =
      buildChatWorld(CONTENT, { market: 'global', packageId: 'free', source: 'teacher_preview' });

    expect(teacherId).toBe(CHAT_IDS.teacher);
    expect(agentId).toBe(CHAT_IDS.agent);
    expect(studentId).toBe(teacherId); // teacher_preview: student id = teacher id
    expect(sessionId).toBe(CHAT_IDS.session);
    expect(packageId).toBe(CHAT_IDS.packageFree);

    const [agent] = world.agents;
    expect(agent?.versions.length).toBe(1);
    expect(AgentConfigSchema.safeParse(agent?.versions[0]).success).toBe(true);
    for (const pkg of world.packages) {
      expect(PackageConfigSchema.safeParse(pkg).success).toBe(true);
    }
    expect(world.sessions).toHaveLength(1);
    expect(world.sessions[0]?.endedAt).toBeNull();
    expect(accessOptions.preview).toEqual({ packageId });
  });

  it('resolves a real teacher_preview entitlement through memoryEntitlementStore', async () => {
    const { world, accessOptions, teacherId, agentId, studentId } = buildChatWorld(CONTENT, {
      market: 'global',
      packageId: 'paid',
      source: 'teacher_preview',
    });
    const store = memoryEntitlementStore(world, accessOptions);
    const entitlement = await store.resolve(
      { studentId, agentId, source: 'teacher_preview' },
      new Date().toISOString(),
    );
    expect(EntitlementSchema.safeParse(entitlement).success).toBe(true);
    expect(entitlement?.teacherId).toBe(teacherId);
    expect(entitlement?.packageId).toBe(CHAT_IDS.packagePaid);
    // The paid package unlocks every module; nothing is locked.
    expect(entitlement?.lockedModuleIds).toEqual([]);
  });

  it('resolves a free-package entitlement that locks the modules outside it', async () => {
    const setup = buildChatWorld(CONTENT, {
      market: 'global',
      packageId: 'free',
      source: 'teacher_preview',
    });
    const store = memoryEntitlementStore(setup.world, setup.accessOptions);
    const entitlement = await store.resolve(
      { studentId: setup.studentId, agentId: setup.agentId, source: 'teacher_preview' },
      new Date().toISOString(),
    );
    expect(entitlement?.lockedModuleIds.length).toBeGreaterThan(0);
  });

  it('builds an eval entitlement for a distinct eval student', async () => {
    const setup = buildChatWorld(CONTENT, {
      market: 'global',
      packageId: 'paid',
      source: 'eval',
      evalStudentId: 'demo-eval-student-2',
    });
    expect(setup.studentId).toBe('demo-eval-student-2');
    const store = memoryEntitlementStore(setup.world, setup.accessOptions);
    const entitlement = await store.resolve(
      { studentId: setup.studentId, agentId: setup.agentId, source: 'eval' },
      new Date().toISOString(),
    );
    expect(entitlement?.source).toBe('eval');
    expect(entitlement?.studentId).toBe('demo-eval-student-2');
  });

  it('loads a turn config through memoryTurnConfigStore for the open session', async () => {
    const setup = buildChatWorld(CONTENT, {
      market: 'global',
      packageId: 'free',
      source: 'teacher_preview',
    });
    const entStore = memoryEntitlementStore(setup.world, setup.accessOptions);
    const entitlement = await entStore.resolve(
      { studentId: setup.studentId, agentId: setup.agentId, source: 'teacher_preview' },
      new Date().toISOString(),
    );
    const cfgStore = memoryTurnConfigStore(setup.world);
    const cfg = entitlement && (await cfgStore.load(entitlement, setup.sessionId));
    expect(cfg).not.toBeNull();
    expect(cfg?.agent.id).toBe(setup.agentId);
    expect(cfg?.pkg.id).toBe(CHAT_IDS.packageFree);
  });
});
