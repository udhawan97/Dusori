import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export type AiEnv = Partial<Record<string, string>>;

export interface AiOptions {
  env?: AiEnv;
  fetchImpl?: typeof fetch;
}

export interface AiProviderConfig {
  id: 'anthropic' | 'ollama' | 'openai';
  model: string;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly reason: 'ai-failed' | 'not-configured',
  ) {
    super(message);
    this.name = 'AiError';
  }
}

const defaultModels = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o-mini',
} as const;

/**
 * Which AI provider this companion can use, from env alone. Local-first: an Ollama model wins
 * over cloud keys unless AI_PROVIDER says otherwise. Returns only id and model — never a key.
 */
export function aiConfig(env: AiEnv = process.env): AiProviderConfig | null {
  const candidates: (AiProviderConfig | null)[] = [
    env.OLLAMA_MODEL ? { id: 'ollama', model: env.OLLAMA_MODEL } : null,
    env.ANTHROPIC_API_KEY
      ? { id: 'anthropic', model: env.ANTHROPIC_MODEL ?? defaultModels.anthropic }
      : null,
    env.OPENAI_API_KEY ? { id: 'openai', model: env.OPENAI_MODEL ?? defaultModels.openai } : null,
  ];
  const configured = candidates.filter((entry): entry is AiProviderConfig => entry !== null);
  return configured.find((entry) => entry.id === env.AI_PROVIDER) ?? configured[0] ?? null;
}

const failedMessage =
  'The AI provider did not return a usable answer. Ranking stays deterministic.';

async function complete(prompt: string, options: AiOptions): Promise<string> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = aiConfig(env);
  if (!config) {
    throw new AiError(
      'No AI provider is configured. Set OLLAMA_MODEL, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
      'not-configured',
    );
  }

  // Failures are collapsed to one fixed message so an upstream error that echoes the request
  // (and therefore could carry a key) never leaves this module.
  try {
    if (config.id === 'ollama') {
      const base = (env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/u, '');
      const response = await fetchImpl(`${base}/api/generate`, {
        body: JSON.stringify({ model: config.model, prompt, stream: false }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('ollama request failed');
      const parsed = z.object({ response: z.string() }).safeParse(await response.json());
      if (!parsed.success) throw new Error('ollama returned an unfamiliar shape');
      return parsed.data.response;
    }

    if (config.id === 'openai') {
      const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        body: JSON.stringify({
          messages: [{ content: prompt, role: 'user' }],
          model: config.model,
        }),
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error('openai request failed');
      const parsed = z
        .object({
          choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
        })
        .safeParse(await response.json());
      const content = parsed.success ? parsed.data.choices[0]?.message.content : null;
      if (!content) throw new Error('openai returned an unfamiliar shape');
      return content;
    }

    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: options.fetchImpl });
    const message = await anthropic.messages.create({
      max_tokens: 4096,
      messages: [{ content: prompt, role: 'user' }],
      model: config.model,
    });
    if (message.stop_reason === 'refusal') throw new Error('anthropic declined the request');
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n');
    if (!text) throw new Error('anthropic returned no text');
    return text;
  } catch {
    throw new AiError(failedMessage, 'ai-failed');
  }
}

// Models wrap JSON in prose or fences more often than not; read the first array literal
// rather than demanding a perfectly bare response.
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

const RerankEntrySchema = z.object({
  key: z.string(),
  note: z.string().max(300).optional(),
  score: z.number().min(0).max(1),
});

export interface RerankCandidate {
  key: string;
  title: string;
  snippet: string;
  url: string;
  kind?: string;
}

export interface RerankedEntry {
  key: string;
  aiScore: number;
  note: string;
}

export async function rerankWithAi(
  query: string,
  candidates: RerankCandidate[],
  options: AiOptions = {},
): Promise<RerankedEntry[]> {
  const listing = candidates
    .map(
      (candidate) =>
        `- key: ${candidate.key}\n  kind: ${candidate.kind ?? 'unknown'}\n  title: ${candidate.title}\n  summary: ${candidate.snippet.slice(0, 300)}\n  url: ${candidate.url}`,
    )
    .join('\n');
  const prompt = [
    'You judge learning resources for reliability and usefulness. The learner is working on:',
    query,
    '',
    'Candidates:',
    listing,
    '',
    'Score each candidate from 0 to 1 for how much it would help this learner, considering how',
    'reliable and current the source looks. Respond with ONLY a JSON array of objects shaped',
    '{"key": string, "score": number, "note": string} where note is one short sentence on',
    'reliability or fit. Use exactly the keys given above.',
  ].join('\n');

  const raw = extractJsonArray(await complete(prompt, options));
  const parsed = z.array(RerankEntrySchema).safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) throw new AiError(failedMessage, 'ai-failed');

  const offered = new Set(candidates.map((candidate) => candidate.key));
  const entries = parsed.data
    .filter((entry) => offered.has(entry.key))
    .map((entry) => ({ aiScore: entry.score, key: entry.key, note: entry.note ?? '' }));
  if (entries.length === 0) throw new AiError(failedMessage, 'ai-failed');
  return entries;
}

export interface RecallExcerptInput {
  excerpt: string;
  heading: string;
  title: string;
}

const maxRecallPromptCharacters = 400;

/**
 * Rewrites a review session's prompts, one per excerpt, in the order given. The caller keeps its
 * deterministic prompts unless exactly that many usable questions come back, so a model that
 * drifts, refuses, or invents extra prompts changes nothing the learner sees.
 */
export async function writeRecallPromptsWithAi(
  objective: string,
  excerpts: RecallExcerptInput[],
  options: AiOptions = {},
): Promise<string[]> {
  const listing = excerpts
    .map(
      (item, index) =>
        `${index + 1}. source: ${item.title} — section: ${item.heading}\n   excerpt: ${item.excerpt}`,
    )
    .join('\n');
  const prompt = [
    'You write active-recall questions for a learner revising this objective:',
    objective,
    '',
    'Each numbered item below is the excerpt the learner will see after answering:',
    listing,
    '',
    `Write exactly ${excerpts.length} questions, one per numbered item, in the same order. Each`,
    'question must be answerable from the objective and that excerpt, must ask the learner to',
    'recall or explain rather than to pick an option, and must not contain the answer. Respond',
    'with ONLY a JSON array of strings, each under 300 characters.',
  ].join('\n');

  const raw = extractJsonArray(await complete(prompt, options));
  const parsed = z.array(z.string().min(1).max(maxRecallPromptCharacters)).safeParse(raw);
  if (!parsed.success || parsed.data.length !== excerpts.length) {
    throw new AiError(failedMessage, 'ai-failed');
  }
  return parsed.data.map((text) => text.trim());
}

export interface BriefSourceInput {
  title: string;
  url: string;
  reasons: string[];
  kind?: string;
}

export async function writeBriefWithAi(
  query: string,
  sources: BriefSourceInput[],
  options: AiOptions = {},
): Promise<string> {
  const listing = sources
    .map(
      (source) =>
        `- ${source.title} (${source.kind ?? 'source'}) — ${source.url}${
          source.reasons.length > 0 ? ` — signals: ${source.reasons.join(', ')}` : ''
        }`,
    )
    .join('\n');
  const prompt = [
    'You are a rigorous tutor. A learner working on the objective below approved these sources:',
    query,
    '',
    listing,
    '',
    'Write a short Markdown research brief: a suggested reading order with one sentence on why',
    'each source earned its place, then a short "Gaps to watch" section naming what these sources',
    'do not cover. Mention only the sources listed — never invent others. No frontmatter, no',
    'top-level heading; start directly with "## Reading order".',
  ].join('\n');

  const text = (await complete(prompt, options)).trim();
  if (!text) throw new AiError(failedMessage, 'ai-failed');
  return text;
}
