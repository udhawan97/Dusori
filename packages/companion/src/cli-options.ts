export type CompanionCliOptions =
  { kind: 'help' } | { kind: 'version' } | { kind: 'run'; root?: string };

export const companionHelp = `Dusori companion

Usage:
  npx dusori [--root /path/to/Dusori]

Example:
  npx dusori --root /path/to/Dusori

Options:
  --root <path>  Enable root-confined access to one Dusori workspace
  -h, --help     Show this help
  -v, --version  Print the installed version

The companion binds only to loopback, opens a session-scoped browser app, and stops with its terminal process.
`;

export function parseCompanionArguments(arguments_: readonly string[]): CompanionCliOptions {
  if (arguments_.includes('--help') || arguments_.includes('-h')) return { kind: 'help' };
  if (arguments_.includes('--version') || arguments_.includes('-v')) return { kind: 'version' };
  if (arguments_.length === 0) return { kind: 'run' };
  if (arguments_[0] === '--root') {
    const root = arguments_[1];
    if (!root) throw new Error('Provide a workspace path after --root.');
    if (arguments_.length > 2) throw new Error(`Unknown argument: ${arguments_[2]}`);
    return { kind: 'run', root };
  }
  throw new Error(`Unknown argument: ${arguments_[0]}`);
}
