// Composition root, part 1 (task 3.9 Phase A): builds one `AccessWorld` (@edmate/harness/testing's
// shape) over the real demo-teacher content, the real locale pack and the real prompt-pack set, so
// `edmate chat` previews the demo teacher's agent instead of a fixture world. No database: the demo
// has exactly one agent, two packages and one open session, so the in-memory ports are enough
// (lead answer Q2: prefer the real content, locale pack and prompt-pack set over fixtures).
import { fileURLToPath } from 'node:url';
import {
  loadDemoTeacherContent,
  loadLocalePacks,
  newestSignedSet,
  pickLocalePack,
  readPersonaLibrary,
  readPromptPackLibrary,
  type DemoTeacherContent,
} from '@edmate/content';
import {
  AgentConfigSchema,
  PackageConfigSchema,
  StyleCardSchema,
  type AgentConfig,
  type Entitlement,
  type LocalePack,
  type ModelPolicy,
  type PackageConfig,
  type StyleCard,
} from '@edmate/contracts';
import { demoLocalePack, localePackMinimal } from '@edmate/contracts/fixtures';
import { DEFAULT_MODEL_POLICY } from '@edmate/gateway';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackLibrary,
  type AccessOptions,
  type AccessWorld,
  type MemoryAgent,
} from '@edmate/harness/testing';
import type { PersonaLibrary, PromptPackLibrary } from '@edmate/harness';

/** Repo-root-relative content directories the CLI reads by default (read-only). */
export const CHAT_CONTENT_DIR = fileURLToPath(
  new URL('../../../../../content/demo-teacher/', import.meta.url),
);
export const CHAT_LOCALES_DIR = fileURLToPath(
  new URL('../../../../../content/locales/', import.meta.url),
);
export const CHAT_PROMPT_PACKS_DIR = fileURLToPath(
  new URL('../../../../../content/prompt-packs/', import.meta.url),
);

export const CHAT_PERSONAS_DIR = fileURLToPath(
  new URL('../../../../../content/skills/mock_interview/', import.meta.url),
);

/** Fixed ids the CLI's one-agent, one-teacher demo world owns. */
export const CHAT_IDS = {
  teacher: 'demo-teacher',
  agent: 'demo-agent',
  styleCard: 'demo-style-card',
  packageFree: 'demo-package-free',
  packagePaid: 'demo-package-paid',
  session: 'demo-session',
  evalStudent: 'demo-eval-student',
} as const;

export type ChatPackageId = 'free' | 'paid';

export interface ChatWorldOptions {
  market: string;
  /** Which of the demo teacher's two packages the session is entitled to. */
  packageId: ChatPackageId;
  source: Extract<Entitlement['source'], 'teacher_preview' | 'eval'>;
  /** The eval runner's student id; ignored for `teacher_preview` (student = the teacher). */
  evalStudentId?: string;
  /** Overrides `DEFAULT_MODEL_POLICY` (task 7.6: the live sweep picks a model per run). */
  modelPolicy?: ModelPolicy;
}

export interface ChatWorld {
  world: AccessWorld;
  accessOptions: AccessOptions;
  teacherId: string;
  agentId: string;
  studentId: string;
  sessionId: string;
  packageId: string;
}

/** Reads `content/demo-teacher`; throws `ContentLoadError` naming the first bad file. */
export function loadChatContent(dir: string = CHAT_CONTENT_DIR): DemoTeacherContent {
  return loadDemoTeacherContent(dir);
}

/**
 * The real prompt-pack library (`content/prompt-packs`) pinned to its newest signed set, picked
 * at run time (task 5.8a: manifest and every pinned pack signed, semver precedence), or the
 * harness's fixture set when the real one fails to load or has no signed set (lead answer Q2:
 * try real first, record which was used).
 */
export function loadChatPromptPacks(dir: string = CHAT_PROMPT_PACKS_DIR): {
  library: PromptPackLibrary;
  version: string;
  source: 'real' | 'fixture';
} {
  try {
    const library = readPromptPackLibrary(dir);
    const version = newestSignedSet(library)?.version;
    if (version === undefined) throw new Error(`${dir}: no signed prompt-pack set`);
    return { library, version, source: 'real' };
  } catch {
    return {
      library: fixturePromptPackLibrary,
      version: FIXTURE_PROMPT_PACK_VERSION,
      source: 'fixture',
    };
  }
}

/**
 * The real signed persona library (`content/skills/mock_interview`, task 5.8a), or none when it
 * fails to load: then no turn has a persona and a role-play falls back to coach (the harness's
 * `resolvePersona`). Same rule as the prompt packs (3.9 lead answer Q2: try real, record which);
 * there are no fixture personas, so the fallback is `none`.
 */
export function loadChatPersonas(dir: string = CHAT_PERSONAS_DIR): {
  personas: PersonaLibrary | undefined;
  source: 'real' | 'none';
  reason?: string;
} {
  try {
    return { personas: readPersonaLibrary(dir), source: 'real' };
  } catch (e) {
    return { personas: undefined, source: 'none', reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The real locale pack for `market` (`content/locales`), or the contracts fixture pack when the
 * real directory fails to load (lead answer Q2).
 */
export function loadChatLocalePack(
  market: string,
  dir: string = CHAT_LOCALES_DIR,
): { pack: LocalePack; source: 'real' | 'fixture' } {
  try {
    const loaded = loadLocalePacks(dir);
    return { pack: pickLocalePack(market, loaded.packs), source: 'real' };
  } catch {
    return {
      pack: market === demoLocalePack.market ? demoLocalePack : localePackMinimal,
      source: 'fixture',
    };
  }
}

function buildStyleCard(content: DemoTeacherContent): StyleCard {
  return StyleCardSchema.parse({
    id: CHAT_IDS.styleCard,
    teacherId: CHAT_IDS.teacher,
    version: 1,
    ...content.styleCard,
  });
}

function buildAgentConfig(
  content: DemoTeacherContent,
  promptPackVersion: string,
  modelPolicy: ModelPolicy = DEFAULT_MODEL_POLICY,
): AgentConfig {
  return AgentConfigSchema.parse({
    id: CHAT_IDS.agent,
    version: 1,
    teacherId: CHAT_IDS.teacher,
    courseId: content.course.id,
    styleCardId: CHAT_IDS.styleCard,
    promptPackVersion,
    languages: ['en'],
    modelPolicy,
  });
}

function buildPackageConfig(
  id: string,
  content: DemoTeacherContent,
  which: ChatPackageId,
): PackageConfig {
  return PackageConfigSchema.parse({
    ...content.packages[which],
    id,
    version: 1,
    teacherId: CHAT_IDS.teacher,
    agentId: CHAT_IDS.agent,
  });
}

/** Builds the one-teacher `AccessWorld` a `edmate chat` run needs, from loaded content. */
export function buildChatWorld(content: DemoTeacherContent, opts: ChatWorldOptions): ChatWorld {
  const teacherId = CHAT_IDS.teacher;
  const agentId = CHAT_IDS.agent;
  const studentId = opts.source === 'teacher_preview' ? teacherId : (opts.evalStudentId ?? CHAT_IDS.evalStudent);
  const sessionId = CHAT_IDS.session;
  const { pack: locale } = loadChatLocalePack(opts.market);
  const { version: promptPackVersion } = loadChatPromptPacks();

  const styleCard = buildStyleCard(content);
  const agentConfig = buildAgentConfig(content, promptPackVersion, opts.modelPolicy);
  const free = buildPackageConfig(CHAT_IDS.packageFree, content, 'free');
  const paid = buildPackageConfig(CHAT_IDS.packagePaid, content, 'paid');
  const chosen = opts.packageId === 'free' ? free : paid;

  const agent: MemoryAgent = { id: agentId, teacherId, status: 'live', versions: [agentConfig] };

  const world: AccessWorld = {
    agents: [agent],
    packages: [free, paid],
    styleCards: [styleCard],
    modules: content.course.modules.map((m) => ({ id: m.id, teacherId })),
    subscriptions: [],
    sessions: [
      {
        id: sessionId,
        studentId,
        teacherId,
        agentId,
        agentVersion: 1,
        packageId: chosen.id,
        packageVersion: chosen.version,
        endedAt: null,
      },
    ],
    locales: [locale],
  };

  const accessOptions: AccessOptions =
    opts.source === 'teacher_preview'
      ? { market: opts.market, preview: { packageId: chosen.id } }
      : {
          market: opts.market,
          eval: { teacherId, packageId: chosen.id, version: chosen.version, market: opts.market },
        };

  return { world, accessOptions, teacherId, agentId, studentId, sessionId, packageId: chosen.id };
}
