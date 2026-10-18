import { readFileSync } from 'node:fs';
import { runEvalCommand, unwiredAgent } from './commands/eval.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: edmate <command>

Commands:
  eval <dir>     run eval cases offline from recorded fixtures (see edmate eval --help)

Options:
  -v, --version  print the edmate version
  -h, --help     show this help
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
      return runEvalCommand(rest, io, {
        agent: unwiredAgent,
        env: process.env,
        cwd: process.cwd(),
      });
    case undefined:
      io.stderr(USAGE);
      return 1;
    default:
      io.stderr(`edmate: unknown command '${first}'\n\n${USAGE}`);
      return 1;
  }
}
