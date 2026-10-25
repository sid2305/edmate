// `edmate chat [--agent <id>] [--package free|paid] [--source teacher_preview|eval] [--student <id>]`
// (task 3.9 Phase B): a line-at-a-time REPL over the real turn pipeline (`defaultSteps`/`runTurn`),
// composed by Phase A's `buildChatDeps` (`./chat/deps.js`) over the real demo-teacher content. No
// database. The real `ANTHROPIC_API_KEY`/`EDMATE_ANTHROPIC_API_KEY` is loaded only when no test
// gateway is injected (`ChatCommandDeps.gateway`, rule 4); `buildChatDeps`'s key-loading error never
// carries a value, only the variable name (see gateway.ts), so this command's own catch never needs
// to redact anything further.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import type { ModelGateway, TurnEvent, TurnInput } from '@edmate/contracts';
import { defaultSteps, PersonaStartPayloadSchema, runTurn } from '@edmate/harness';
import type { CliIo } from '../cli.js';
import { buildChatDeps, type ChatDepsOptions, type ChatSetup } from './chat/deps.js';
import type { Env } from './chat/gateway.js';
import { CHAT_IDS, type ChatPackageId } from './chat/world.js';

export const CHAT_USAGE = `Usage: edmate chat [--agent <id>] [--package free|paid] [--source teacher_preview|eval] [--student <id>]

Starts an interactive session with the demo teacher's agent (content/demo-teacher), driven by the
real turn pipeline (admit -> entitle -> ... -> done). No database; one in-memory session per run.

  --agent <id>     the agent to preview (default: ${CHAT_IDS.agent}; this demo has only one)
  --package <id>   free or paid (default: free)
  --source <kind>  teacher_preview or eval (default: teacher_preview)
  --student <id>   the eval student id (ignored for teacher_preview)
  -h, --help       show this help

Type a message and press Enter; Ctrl+D or "exit" ends the session.
"/roleplay <persona-id>" starts a practice role-play (paid package; e.g. job-interview or viva);
every line after it is a role-play turn (/pause, stop) until "/leave".
Needs ANTHROPIC_API_KEY (or EDMATE_ANTHROPIC_API_KEY) in the environment; a key is never logged.
`;

export interface ChatCommandDeps {
  env: Env;
  cwd: string;
  /** Test injection only (rule 4): replaces the real Anthropic gateway. Never a real model call. */
  gateway?: ModelGateway;
  /** Test injection: replaces `buildChatDeps` itself. */
  buildDeps?: (opts: ChatDepsOptions) => Promise<ChatSetup>;
  contentDir?: string;
}

/** The REPL's client-side mode (task 5.8a): normal chat, or a role-play with a started persona. */
export type ChatMode = { mode: 'normal' } | { mode: 'roleplay'; persona: string };

const ROLEPLAY_USAGE = 'usage: /roleplay <persona-id> (a bare id, e.g. job-interview; no version)';

/**
 * Maps one typed line to the turn it sends, if any, and the next mode. `/roleplay <id>` sends a
 * start carrying only the bare persona id (the server picks the version and counts questions);
 * in role-play mode every other line, `/pause` and `stop` included, is a `mock_interview` message;
 * `/leave` sends nothing and returns to normal chat. A bad start is refused here, and no turn goes.
 */
export function chatTurnInput(
  state: ChatMode,
  line: string,
  ids: Pick<TurnInput, 'agentId' | 'sessionId' | 'studentId'>,
  now: () => string = () => new Date().toISOString(),
): { input?: TurnInput; state: ChatMode; notice?: string } {
  const base = { ...ids, lang: 'en' as const, clientTs: now() };
  const [command, ...rest] = line.split(/\s+/u);
  if (command === '/roleplay') {
    const payload = PersonaStartPayloadSchema.safeParse({ persona: rest[0] });
    if (rest.length !== 1 || !payload.success) return { state, notice: ROLEPLAY_USAGE };
    const persona = payload.data.persona;
    return {
      input: { ...base, kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona } },
      state: { mode: 'roleplay', persona },
    };
  }
  if (command === '/leave') {
    return state.mode === 'roleplay'
      ? { state: { mode: 'normal' }, notice: 'left the role-play; back to normal chat' }
      : { state, notice: 'not in a role-play' };
  }
  const input: TurnInput =
    state.mode === 'roleplay'
      ? { ...base, kind: 'message', skill: 'mock_interview', text: line }
      : { ...base, kind: 'message', text: line };
  return { input, state };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Renders one `TurnEvent` to stdout. Exported for its own direct test. */
export function renderEvent(e: TurnEvent, io: Pick<CliIo, 'stdout'>): void {
  switch (e.type) {
    case 'token':
      io.stdout(e.text);
      break;
    case 'replace':
      io.stdout(e.text === '' ? '\n[reply withdrawn]\n' : `\n${e.text}`);
      break;
    case 'sources':
      io.stdout(`\n[sources: ${e.items.map((s) => `${s.title} (${s.locator})`).join(', ')}]\n`);
      break;
    case 'hint_rung':
      io.stdout(`\n[hint rung ${e.rung}]\n`);
      break;
    case 'locked':
      io.stdout(`\n[locked${e.packageName === undefined ? '' : `: ${e.packageName}`}]\n`);
      break;
    case 'teacher_question':
      io.stdout(`\n[question sent to the teacher: ${e.questionId}]\n`);
      break;
    case 'skill':
      io.stdout(`\n[skill: ${e.skill}]\n`);
      break;
    case 'safety':
      io.stdout(`\n[safety: ${e.level}]\n`);
      break;
    case 'error':
      io.stdout(`\n[error: ${e.code}${e.retryable ? ', retryable' : ''}]\n`);
      break;
    case 'done':
      io.stdout('\n');
      break;
  }
}

function parseFlags(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: false,
    strict: true,
    options: {
      agent: { type: 'string' },
      package: { type: 'string', default: 'free' },
      source: { type: 'string', default: 'teacher_preview' },
      student: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

export async function runChatCommand(
  args: readonly string[],
  io: CliIo,
  deps: ChatCommandDeps,
  stdin: NodeJS.ReadableStream = process.stdin,
): Promise<number> {
  let values: ReturnType<typeof parseFlags>['values'];
  try {
    ({ values } = parseFlags(args));
  } catch (e) {
    io.stderr(`edmate chat: ${message(e)}\n\n${CHAT_USAGE}`);
    return 1;
  }
  if (values.help) {
    io.stdout(CHAT_USAGE);
    return 0;
  }
  const agentId = values.agent ?? CHAT_IDS.agent;
  if (agentId !== CHAT_IDS.agent) {
    io.stderr(`edmate chat: unknown agent '${agentId}' (this demo has only '${CHAT_IDS.agent}')\n`);
    return 1;
  }
  if (values.package !== 'free' && values.package !== 'paid') {
    io.stderr(`edmate chat: --package must be 'free' or 'paid'\n\n${CHAT_USAGE}`);
    return 1;
  }
  if (values.source !== 'teacher_preview' && values.source !== 'eval') {
    io.stderr(`edmate chat: --source must be 'teacher_preview' or 'eval'\n\n${CHAT_USAGE}`);
    return 1;
  }
  const packageId: ChatPackageId = values.package;
  const source = values.source;

  let setup: ChatSetup;
  try {
    const opts: ChatDepsOptions = {
      env: deps.env,
      market: 'global',
      packageId,
      source,
      ...(values.student === undefined ? {} : { evalStudentId: values.student }),
      ...(deps.gateway === undefined ? {} : { gateway: deps.gateway }),
      ...(deps.contentDir === undefined ? {} : { contentDir: deps.contentDir }),
    };
    setup = await (deps.buildDeps ?? buildChatDeps)(opts);
  } catch (e) {
    io.stderr(`edmate chat: ${message(e)}\n`);
    return 1;
  }

  io.stdout(
    `edmate chat -- ${setup.content.course.title} (package: ${packageId}, source: ${source})\n` +
      `Type a message and press Enter. Ctrl+D or "exit" ends the session.\n` +
      `"/roleplay <persona-id>" starts a role-play (/pause, stop inside it); "/leave" ends it.\n` +
      `Prompt pack: ${setup.promptPackSource === 'fixture' ? 'fixture fallback' : 'signed set'}\n` +
      (setup.personasSource === 'none'
        ? `Role-play is unavailable: the persona templates did not load (${setup.personasReason ?? 'did not load'}).\n`
        : '') +
      `\n> `,
  );

  let mode: ChatMode = { mode: 'normal' };
  const rl = createInterface({ input: stdin, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') {
      io.stdout('> ');
      continue;
    }
    if (trimmed === 'exit') break;

    const next = chatTurnInput(mode, trimmed, setup);
    mode = next.state;
    if (next.notice !== undefined) io.stdout(`[${next.notice}]\n`);
    const input = next.input;
    if (input === undefined) {
      io.stdout('> ');
      continue;
    }
    const run = runTurn(input, { deps: setup.deps, steps: defaultSteps });
    for await (const event of run.events) renderEvent(event, io);
    await run.finished;
    io.stdout('\n> ');
  }
  rl.close();
  io.stdout('\nbye\n');
  return 0;
}
