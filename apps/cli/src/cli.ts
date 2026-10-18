import { readFileSync } from 'node:fs';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: edmate <command>

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

/** Runs the CLI for the given arguments and returns the process exit code. */
export function run(argv: readonly string[], io: CliIo = defaultIo): number {
  const [first] = argv;
  switch (first) {
    case '-v':
    case '--version':
      io.stdout(`${version()}\n`);
      return 0;
    case '-h':
    case '--help':
      io.stdout(USAGE);
      return 0;
    case undefined:
      io.stderr(USAGE);
      return 1;
    default:
      io.stderr(`edmate: unknown command '${first}'\n\n${USAGE}`);
      return 1;
  }
}
