// The context every `pre`-phase guard shares (task 4.3). The chain passes one `ctx` to every guard
// in a phase, so distressDetect (4.3), moderationIn and jailbreak (4.4) all read this type; 4.4
// extends it rather than defining another one.
import type {
  Entitlement,
  Lang,
  LocalePack,
  ModelGateway,
  SafetyAlert,
  SafetyEventCode,
  SafetyEventSink,
} from '@edmate/contracts';
import type { Clock, IdSource } from '../pipeline/clock.js';

/**
 * What a blocking pre guard leaves for preGuard (task 4.4): the code that picks the student's
 * reply and, for `harm_to_others`, `threat` and `weapons`, the critical misuse alert to raise
 * (B-50 and its lead amendment, 7.2m). The chain keeps no reason, so this is how the code reaches
 * the step. Never text beyond the alert's redacted excerpt.
 */
export interface PreGuardBlock {
  code: Exclude<SafetyEventCode, 'self_harm'>;
  alert?: SafetyAlert;
}

export interface PreGuardCtx {
  locale: LocalePack;
  /** studentId and teacherId for an alert; resolved server-side, never from the client. */
  entitlement: Entitlement;
  sessionId: string;
  lang: Lang;
  /** For small-tier classifier calls. */
  gateway: ModelGateway;
  /** For a SafetyAlert's id. */
  ids: IdSource;
  /** For a SafetyAlert's createdAt and classifier deadlines. */
  clock: Clock;
  /**
   * The student's earlier messages this session (scrubbed when they were saved), oldest first,
   * at most a few. Empty when there are none or the history could not be read in time. A promise
   * when preGuard starts the read concurrently with the guards (a guard awaits it only if needed).
   */
  recentStudentTurns: readonly string[] | Promise<readonly string[]>;
  /** The turn's id: with the guard name, the dedupe key of a safety event (ADR-0006). */
  turnId: string;
  /** Where moderationIn and jailbreak record a block (ADR-0006). Awaited: a throw fails the chain. */
  safetyEvents: SafetyEventSink;
  /**
   * All of the teacher's package names, from the server (fix round MEDIUM 5), for "pretend I'm
   * on <package>" and "I'm on <another package>" claims. A promise when preGuard reads them
   * concurrently; at least the student's own package name.
   */
  packageNames: readonly string[] | Promise<readonly string[]>;
  /** The student's own package name: the course the classifier is told about; claiming it is no claim. */
  currentPackageName: string;
  /** Filled by a blocking guard, keyed by guard name; read by preGuard for the reply. Per turn. */
  blocks: Map<string, PreGuardBlock>;
}
