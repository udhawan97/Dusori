export type CompanionCliOptions =
  | { kind: 'help' }
  | { kind: 'version' }
  | { allowedOrigins: string[]; apiOnly: boolean; kind: 'run'; root?: string };

export const companionHelp = `Dusori companion

Usage:
  npx @udhawan97/dusori [--root /path/to/Dusori]
  DUSORI_SESSION_TOKEN=... npx @udhawan97/dusori --api-only --origin tauri://localhost

Example:
  npx @udhawan97/dusori --root /path/to/Dusori

Options:
  --root <path>  Enable root-confined access to one Dusori workspace
  --api-only     Serve only the authenticated loopback API; requires DUSORI_SESSION_TOKEN
  --origin <url> Permit one exact browser/webview origin (repeatable with --api-only)
  -h, --help     Show this help
  -v, --version  Print the installed version

Optional environment variables:
  RESEARCH_WEB_SEARCH  Web search upstream: brave | tavily | searxng
  BRAVE_API_KEY        Brave Search key (free tier works)
  TAVILY_API_KEY       Tavily key (free tier works)
  SEARXNG_URL          A SearXNG instance for keyless, open-source web search
  YOUTUBE_API_KEY      Official YouTube Data API key for metadata/reference search
  INVIDIOUS_URL        Optional self-hosted fallback for YouTube metadata/reference
                       search and thumbnails (Dusori does not harvest captions)
  REDDIT_CLIENT_ID     Reddit "script" app id from reddit.com/prefs/apps; Reddit no
  REDDIT_CLIENT_SECRET longer answers anonymous clients, so both are required
  OLLAMA_MODEL         Enable local AI ranking with this Ollama model (e.g. gemma3:4b)
  OLLAMA_URL           Ollama address, default http://127.0.0.1:11434
  ANTHROPIC_API_KEY    Enable cloud AI ranking via Anthropic (ANTHROPIC_MODEL overrides)
  OPENAI_API_KEY       Enable cloud AI ranking via OpenAI (OPENAI_MODEL overrides)
  AI_PROVIDER          Force one of ollama | anthropic | openai when several are set
  DUSORI_SESSION_TOKEN Session bearer token for --api-only (32-512 non-space characters)

Keys never leave this process; the browser app only learns which provider is active.
The companion binds only to loopback, opens a session-scoped browser app, and stops with its terminal process.
`;

export function parseCompanionArguments(arguments_: readonly string[]): CompanionCliOptions {
  if (arguments_.includes('--help') || arguments_.includes('-h')) return { kind: 'help' };
  if (arguments_.includes('--version') || arguments_.includes('-v')) return { kind: 'version' };
  let apiOnly = false;
  let root: string | undefined;
  const allowedOrigins: string[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--api-only') {
      apiOnly = true;
      continue;
    }
    if (argument === '--root') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('Provide a workspace path after --root.');
      if (root !== undefined) throw new Error('Provide --root only once.');
      root = value;
      index += 1;
      continue;
    }
    if (argument === '--origin') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('Provide an exact origin after --origin.');
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error('The allowed origin is not a valid absolute URL.');
      }
      if (
        !parsed.host ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (parsed.pathname !== '' && parsed.pathname !== '/')
      ) {
        throw new Error('The allowed origin must contain only a scheme, host, and optional port.');
      }
      const origin = `${parsed.protocol}//${parsed.host}`;
      if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    allowedOrigins,
    apiOnly,
    kind: 'run',
    ...(root === undefined ? {} : { root }),
  };
}
