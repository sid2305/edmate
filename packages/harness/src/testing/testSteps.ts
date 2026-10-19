// Happy-path step doubles and dependencies for pipeline tests, built on the contracts fixtures and
// the scripted gateway. Every step (including overrides) is logged with its virtual start/end time.
import {
  demoAgentConfig,
  demoChunk,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoPedagogyDecision,
  demoStyleCard,
  learnerProfileNew,
} from '@edmate/contracts/fixtures';
import type { ModelGateway, PedagogyDecision, Usage } from '@edmate/contracts';
import { copyHelp, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { createTurnLimits } from '../pipeline/limits.js';
import type {
  CommitRecord,
  DecideResult,
  PipelineDeps,
  StepEnv,
  Steps,
} from '../pipeline/types.js';
import { sequentialIds, type SequentialIds } from './ids.js';
import {
  type MemoryAlertSink,
  memoryAlertSink,
  type MemoryTraceSink,
  memoryTraceSink,
  type MemoryUsageMeter,
  memoryUsageMeter,
  unusedPort,
} from './memoryPorts.js';
import { scriptedStreamText } from './gatewayFixtures.js';
import { fixturePromptPackLibrary } from './promptPackFixtures.js';
import { type GatewayScript, ScriptedGateway } from './scriptedGateway.js';
import { type VirtualClock, virtualClock } from './virtualClock.js';

export type LoggedStep =
  | Exclude<keyof Steps, 'route' | 'decide'>
  | 'route'
  | 'route.onFailure'
  | 'decide'
  | 'decide.fallback';

export interface StepLogEntry {
  step: LoggedStep;
  phase: 'start' | 'end' | 'fail';
  /** Virtual time. */
  at: number;
  /** generate's attempt, when the step is generate. */
  attempt?: 'primary' | 'fallback';
  /** The input text the step saw (synthetic fixtures only). */
  text?: string;
}

export interface TestSteps extends Steps {
  readonly log: StepLogEntry[];
  readonly commits: CommitRecord[];
}

export type StepOverrides = Partial<Omit<Steps, 'route' | 'decide'>> & {
  route?: Partial<Steps['route']>;
  decide?: Partial<Steps['decide']>;
};

/** The decision fallback the doubles use: move `ask`, like the spec requires. */
export const testAskDecision: PedagogyDecision = {
  ...demoPedagogyDecision,
  move: 'ask',
  rung: 0,
  mustNotReveal: [],
};

/** A DecideResult around `decision`: help state unchanged, no sources, a test pack ref. */
export function testDecideResult(
  decision: PedagogyDecision,
  o: Partial<Omit<DecideResult, 'decision'>> = {},
): DecideResult {
  return {
    decision,
    next: { rung: decision.rung, help: copyHelp(INITIAL_HELP_STATE) },
    reason: 'step',
    promptPack: { set: 'test', packs: {} },
    sources: [],
    ...o,
  };
}

/** Synthetic fallback texts for `FallbackReplies`. */
export const TEST_SAFE_REPLY = 'Let us try that a different way.';
export const TEST_DISTRESS_REPLY = 'You are not alone. Please reach out to a helpline.';
export const TEST_CARING_REPLY = 'I am here with you. Here are people you can talk to now.';

function happySteps(commits: CommitRecord[]): Steps {
  return {
    admit: () => Promise.resolve(),
    entitle: () =>
      Promise.resolve({
        entitlement: demoEntitlementSubscription,
        agent: demoAgentConfig,
        pkg: demoPackagePaid,
        locale: demoLocalePack,
        styleCard: demoStyleCard,
      }),
    scrub: (env) =>
      Promise.resolve({
        ...(env.input.text === undefined ? {} : { text: env.input.text }),
        guards: [{ name: 'piiScrub', ok: true }],
      }),
    preGuard: () =>
      Promise.resolve({ result: 'ok', guards: [{ name: 'moderationIn', ok: true }], usage: [] }),
    route: {
      run: () => Promise.resolve({ intent: 'on_task', attempt: 'none', usage: [] }),
      onFailure: () => ({ intent: 'on_task', attempt: 'none' }),
    },
    buildContext: () =>
      Promise.resolve({
        profile: learnerProfileNew,
        history: [],
        retrieved: [demoChunk],
        lockedHit: false,
        helpRung: 0,
        helpState: copyHelp(INITIAL_HELP_STATE),
      }),
    escalate: () => Promise.resolve({ replyText: TEST_CARING_REPLY }),
    decide: {
      run: () => Promise.resolve(testDecideResult(demoPedagogyDecision)),
      fallback: () => testDecideResult(testAskDecision),
    },
    async generate(env, { decision }, emit) {
      let draft = '';
      const usage: Usage[] = [];
      const stream = env.deps.gateway.stream({
        tier: 'main',
        system: decision.systemPrompt,
        messages: [{ role: 'user', content: env.input.text ?? '' }],
        maxOutputTokens: decision.maxOutputTokens,
      });
      for await (const chunk of stream) {
        if (env.cancel.cancelled) break;
        if (chunk.type === 'text') {
          draft += chunk.text;
          emit({ type: 'token', text: chunk.text });
        } else if (chunk.type === 'usage') {
          usage.push(chunk.usage);
        }
      }
      return { draft, usage };
    },
    postGuard: () =>
      Promise.resolve({ result: 'ok', guards: [{ name: 'answerLeak', ok: true }], usage: [] }),
    async meter(env, { usage, entitlement }) {
      for (const u of usage) {
        await env.deps.usage.record(u, {
          teacherId: entitlement.teacherId,
          packageId: entitlement.packageId,
          studentId: entitlement.studentId,
          turnId: env.turnId,
          source: entitlement.source,
        });
      }
    },
    commit: (_env, record) => {
      commits.push(record);
      return Promise.resolve();
    },
  };
}

/** Wraps an async step so its start, end or failure is logged on the virtual clock. */
function logged<A extends unknown[], R>(
  log: StepLogEntry[],
  step: LoggedStep,
  fn: (env: StepEnv, ...args: A) => Promise<R>,
): (env: StepEnv, ...args: A) => Promise<R> {
  return async (env, ...args) => {
    const extra: Partial<StepLogEntry> = {};
    if (env.input.text !== undefined) extra.text = env.input.text;
    const a = args[0];
    if (step === 'generate' && typeof a === 'object' && a !== null && 'attempt' in a) {
      extra.attempt = (a as { attempt: 'primary' | 'fallback' }).attempt;
    }
    log.push({ step, phase: 'start', at: env.deps.clock.now(), ...extra });
    try {
      const r = await fn(env, ...args);
      log.push({ step, phase: 'end', at: env.deps.clock.now(), ...extra });
      return r;
    } catch (e) {
      log.push({ step, phase: 'fail', at: env.deps.clock.now(), ...extra });
      throw e;
    }
  };
}

/** Happy-path steps with `overrides` applied; every call is logged in `log`. */
export function testSteps(overrides: StepOverrides = {}): TestSteps {
  const log: StepLogEntry[] = [];
  const commits: CommitRecord[] = [];
  const h = happySteps(commits);
  const { route: routeO, decide: decideO, ...rest } = overrides;
  const s: Steps = { ...h, ...rest };
  const onFailure = routeO?.onFailure ?? h.route.onFailure;
  const fallback = decideO?.fallback ?? h.decide.fallback;
  return {
    log,
    commits,
    admit: logged(log, 'admit', s.admit),
    entitle: logged(log, 'entitle', s.entitle),
    scrub: logged(log, 'scrub', s.scrub),
    preGuard: logged(log, 'preGuard', s.preGuard),
    route: {
      run: logged(log, 'route', routeO?.run ?? h.route.run),
      onFailure: (env, e) => {
        log.push({ step: 'route.onFailure', phase: 'start', at: env.deps.clock.now() });
        return onFailure(env, e);
      },
    },
    buildContext: logged(log, 'buildContext', s.buildContext),
    escalate: logged(log, 'escalate', s.escalate),
    decide: {
      run: logged(log, 'decide', decideO?.run ?? h.decide.run),
      fallback: (env, x) => {
        log.push({ step: 'decide.fallback', phase: 'start', at: env.deps.clock.now() });
        return fallback(env, x);
      },
    },
    generate: logged(log, 'generate', s.generate),
    postGuard: logged(log, 'postGuard', s.postGuard),
    meter: logged(log, 'meter', s.meter),
    commit: logged(log, 'commit', s.commit),
  };
}

export interface TestDeps {
  deps: PipelineDeps;
  clock: VirtualClock;
  ids: SequentialIds;
  gateway: ModelGateway;
  traces: MemoryTraceSink;
  usage: MemoryUsageMeter;
  alerts: MemoryAlertSink;
  /** Calls to ports the happy path never uses (stores); should stay empty. */
  portCalls: string[];
}

/**
 * Dependencies on a virtual clock with sequential ids, a scripted gateway (default: one text
 * stream), in-memory trace/usage/alert sinks, `unusedPort` stores, source `subscription`,
 * fresh in-memory limits and the fixture prompt-pack library.
 */
export function testDeps(
  opts: {
    script?: GatewayScript;
    clock?: VirtualClock;
    traces?: MemoryTraceSink;
    usage?: MemoryUsageMeter;
    alerts?: MemoryAlertSink;
    /** Anything else (a failing gateway, other fallback texts, ...). */
    overrides?: Partial<PipelineDeps>;
  } = {},
): TestDeps {
  const clock = opts.clock ?? virtualClock();
  const ids = sequentialIds();
  const gateway = new ScriptedGateway(opts.script ?? { stream: [scriptedStreamText] }, clock);
  const traces = opts.traces ?? memoryTraceSink();
  const usage = opts.usage ?? memoryUsageMeter();
  const alerts = opts.alerts ?? memoryAlertSink();
  const portCalls: string[] = [];
  const deps: PipelineDeps = {
    clock,
    ids,
    gateway,
    entitlements: unusedPort('entitlements', portCalls),
    turnConfig: unusedPort('turnConfig', portCalls),
    entitlementSource: 'subscription',
    limits: createTurnLimits(clock),
    profiles: unusedPort('profiles', portCalls),
    transcripts: unusedPort('transcripts', portCalls),
    sessionState: unusedPort('sessionState', portCalls),
    retrieval: unusedPort('retrieval', portCalls),
    teacherQuestions: unusedPort('teacherQuestions', portCalls),
    usage,
    traces,
    alerts,
    fallbackReplies: {
      safeReply: () => TEST_SAFE_REPLY,
      distress: () => TEST_DISTRESS_REPLY,
    },
    distressCheck: () => false,
    promptPacks: fixturePromptPackLibrary,
    ...opts.overrides,
  };
  return {
    deps,
    clock,
    ids,
    gateway: deps.gateway,
    traces,
    usage,
    alerts,
    portCalls,
  };
}
