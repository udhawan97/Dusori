export type CompanionCliOptions =
  { kind: 'help' } | { kind: 'version' } | { kind: 'run'; root?: string };

export const companionHelp = `Dusori companion

Usage:
  npx @udhawan97/dusori [--root /path/to/Dusori]

Example:
  npx @udhawan97/dusori --root /path/to/Dusori

Options:
  --root <path>  Enable root-confined access to one Dusori workspace
  -h, --help     Show this help
  -v, --version  Print the installed version

Optional environment variables:
  RESEARCH_WEB_SEARCH  Web search upstream: brave | tavily | searxng
  BRAVE_API_KEY        Brave Search key (free tier works)
  TAVILY_API_KEY       Tavily key (free tier works)
  SEARXNG_URL          A SearXNG instance for keyless, open-source web search
  INVIDIOUS_URL        An Invidious instance for keyless YouTube search, captions,
                       and thumbnails (self-host it for a fully private path)
  REDDIT_CLIENT_ID     Reddit "script" app id from reddit.com/prefs/apps; Reddit no
  REDDIT_CLIENT_SECRET longer answers anonymous clients, so both are required
  OLLAMA_MODEL         Enable local AI ranking with this Ollama model (e.g. gemma3:4b)
  OLLAMA_URL           Ollama address, default http://127.0.0.1:11434
  ANTHROPIC_API_KEY    Enable cloud AI ranking via Anthropic (ANTHROPIC_MODEL overrides)
  OPENAI_API_KEY       Enable cloud AI ranking via OpenAI (OPENAI_MODEL overrides)
  AI_PROVIDER          Force one of ollama | anthropic | openai when several are set

Keys never leave this process; the browser app only learns which provider is active.
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
