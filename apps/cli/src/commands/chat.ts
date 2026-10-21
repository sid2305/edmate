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
import { defaultSteps, runTurn } from '@edmate/harness';
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
      `Type a message and press Enter. Ctrl+D or "exit" ends the session.\n\n> `,
  );

  const rl = createInterface({ input: stdin, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') {
      io.stdout('> ');
      continue;
    }
    if (trimmed === 'exit') break;

    const input: TurnInput = {
      agentId: setup.agentId,
      sessionId: setup.sessionId,
      studentId: setup.studentId,
      kind: 'message',
      text: trimmed,
      lang: 'en',
      clientTs: new Date().toISOString(),
    };
    const run = runTurn(input, { deps: setup.deps, steps: defaultSteps });
    for await (const event of run.events) renderEvent(event, io);
    await run.finished;
    io.stdout('\n> ');
  }
  rl.close();
  io.stdout('\nbye\n');
  return 0;
}
