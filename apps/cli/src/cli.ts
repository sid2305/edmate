import { readFileSync } from 'node:fs';
import { runChatCommand } from './commands/chat.js';
import { runContentCommand } from './commands/content.js';
import { runEvalCommand } from './commands/eval.js';
import { buildLiveEvalAgent } from './commands/eval/liveAgent.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: edmate <command>

Commands:
  eval <dir>                run eval cases offline from recorded fixtures (see edmate eval --help)
  content validate [dir]    check a content tree's files, licences and rules
                            (default dir: content/demo-teacher; see edmate content --help)
  chat                      an interactive session with the demo teacher's agent
                            (see edmate chat --help)

Options:
  -v, --version             print the edmate version
  -h, --help                show this help
`;

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Reads the version from apps/cli/package.json (works from src/ and dist/). */
function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

/** Runs the CLI for the given arguments and resolves to the process exit code. */
export async function run(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  const [first, ...rest] = argv;
  switch (first) {
    case '-v':
    case '--version':
      io.stdout(`${version()}\n`);
      return 0;
    case '-h':
    case '--help':
      io.stdout(USAGE);
      return 0;
    case 'eval':
      // Lazy: `buildLiveEvalAgent` only builds the real pipeline (and loads a key) on the first
      // `.reply()` call, so replay (fixtures only, no --record) never needs ANTHROPIC_API_KEY.
      return runEvalCommand(rest, io, {
        agent: buildLiveEvalAgent({ env: process.env }),
        env: process.env,
        cwd: process.cwd(),
        // `--models` sweep (task 7.6 Phase B): one fresh agent per (model, suite) run, sharing
        // that run's own usage meter so its cost-per-turn covers the whole suite.
        liveAgentFor: ({ modelPolicy, usage, onUnmetered, baseURL }) =>
          buildLiveEvalAgent({
            env: process.env,
            modelPolicy,
            usage,
            onUnmetered,
            ...(baseURL === undefined ? {} : { baseURL }),
          }),
      });
    case 'content':
      return runContentCommand(rest, io, { cwd: process.cwd() });
    case 'chat':
      return runChatCommand(rest, io, { env: process.env, cwd: process.cwd() });
    case undefined:
      io.stderr(USAGE);
      return 1;
    default:
      io.stderr(`edmate: unknown command '${first}'\n\n${USAGE}`);
      return 1;
  }
}
