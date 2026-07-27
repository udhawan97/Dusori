import { describe, expect, it } from 'vitest';

import {
  AiError,
  aiConfig,
  rerankWithAi,
  writeBriefWithAi,
  writeRecallPromptsWithAi,
} from './ai.js';

const candidates = [
  { key: 'a', kind: 'article', snippet: 'Intro to generics', title: 'Generics', url: 'https://a' },
  { key: 'b', kind: 'repo', snippet: 'Type challenges', title: 'Challenges', url: 'https://b' },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('aiConfig', () => {
  it('reports nothing when no provider is configured', () => {
    expect(aiConfig({})).toBeNull();
  });

  it('prefers local ollama over cloud keys', () => {
    const config = aiConfig({
      ANTHROPIC_API_KEY: 'sk-x',
      OLLAMA_MODEL: 'gemma3:4b',
      OPENAI_API_KEY: 'sk-y',
    });
    expect(config).toEqual({ id: 'ollama', model: 'gemma3:4b' });
  });

  it('prefers anthropic over openai when both keys are set', () => {
    const config = aiConfig({ ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-y' });
    expect(config?.id).toBe('anthropic');
    expect(config?.model).toBe('claude-opus-4-8');
  });

  it('honors an explicit AI_PROVIDER choice', () => {
    const config = aiConfig({
      AI_PROVIDER: 'openai',
      ANTHROPIC_API_KEY: 'sk-x',
      OPENAI_API_KEY: 'sk-y',
    });
    expect(config?.id).toBe('openai');
  });

  it('ignores an explicit choice whose credentials are missing', () => {
    expect(aiConfig({ AI_PROVIDER: 'openai', OLLAMA_MODEL: 'gemma3:4b' })?.id).toBe('ollama');
  });

  it('lets env vars override the default models', () => {
    const config = aiConfig({ ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_MODEL: 'claude-haiku-4-5' });
    expect(config?.model).toBe('claude-haiku-4-5');
  });
});

describe('rerankWithAi', () => {
  it('asks ollama and maps the JSON it returns', async () => {
    const seen: { body: string; url: string }[] = [];
    const fetchImpl = async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      seen.push({ body: String(init?.body), url: String(input) });
      return jsonResponse({
        response:
          'Here you go:\n[{"key":"b","note":"Hands-on practice","score":0.9},{"key":"a","score":0.4,"note":"Broad intro"}]',
      });
    };

    const ranked = await rerankWithAi('typescript generics', candidates, {
      env: { OLLAMA_MODEL: 'gemma3:4b' },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(seen[0]?.url).toBe('http://127.0.0.1:11434/api/generate');
    expect(seen[0]?.body).toContain('"stream":false');
    expect(ranked).toEqual([
      { aiScore: 0.9, key: 'b', note: 'Hands-on practice' },
      { aiScore: 0.4, key: 'a', note: 'Broad intro' },
    ]);
  });

  it('asks openai through its chat endpoint', async () => {
    const fetchImpl = async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(input)).toBe('https://api.openai.com/v1/chat/completions');
      expect(String(init?.headers && new Headers(init.headers).get('Authorization'))).toContain(
        'sk-test',
      );
      return jsonResponse({
        choices: [{ message: { content: '[{"key":"a","score":1,"note":"Best"}]' } }],
      });
    };

    const ranked = await rerankWithAi('q', candidates, {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(ranked[0]).toEqual({ aiScore: 1, key: 'a', note: 'Best' });
  });

  it('asks anthropic through the official SDK', async () => {
    const fetchImpl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      expect(String(input)).toContain('api.anthropic.com');
      return jsonResponse({
        content: [{ text: '[{"key":"b","score":0.7,"note":"Practical"}]', type: 'text' }],
        id: 'msg_1',
        model: 'claude-opus-4-8',
        role: 'assistant',
        stop_reason: 'end_turn',
        type: 'message',
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };

    const ranked = await rerankWithAi('q', candidates, {
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(ranked[0]).toEqual({ aiScore: 0.7, key: 'b', note: 'Practical' });
  });

  it('drops entries for keys that were never offered', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ response: '[{"key":"evil","score":1,"note":"x"},{"key":"a","score":0.5}]' });

    const ranked = await rerankWithAi('q', candidates, {
      env: { OLLAMA_MODEL: 'gemma3:4b' },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(ranked).toEqual([{ aiScore: 0.5, key: 'a', note: '' }]);
  });

  it('reports not-configured without touching the network', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('must not be called');
    };
    await expect(
      rerankWithAi('q', candidates, { env: {}, fetchImpl: fetchImpl as typeof fetch }),
    ).rejects.toMatchObject({ reason: 'not-configured' });
  });

  it('turns unparseable model output into a friendly failure without the key', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ choices: [{ message: { content: 'I cannot help with that.' } }] });

    const failure = await rerankWithAi('q', candidates, {
      env: { OPENAI_API_KEY: 'sk-secret-value' },
      fetchImpl: fetchImpl as typeof fetch,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiError);
    expect((failure as AiError).reason).toBe('ai-failed');
    expect((failure as AiError).message).not.toContain('sk-secret-value');
  });
});

describe('writeBriefWithAi', () => {
  it('returns the model text as the brief body', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ response: '## Reading order\n\nStart with Generics.' });

    const brief = await writeBriefWithAi(
      'typescript generics',
      [{ kind: 'article', reasons: ['312 points'], title: 'Generics', url: 'https://a' }],
      { env: { OLLAMA_MODEL: 'gemma3:4b' }, fetchImpl: fetchImpl as typeof fetch },
    );
    expect(brief).toContain('Reading order');
  });

  it('rejects an empty model response', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ response: '   ' });
    await expect(
      writeBriefWithAi('q', [{ reasons: [], title: 'T', url: 'https://a' }], {
        env: { OLLAMA_MODEL: 'gemma3:4b' },
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({ reason: 'ai-failed' });
  });
});

describe('writeRecallPromptsWithAi', () => {
  const excerpts = [
    { excerpt: 'Generics carry a type through a function.', heading: 'Generics', title: 'Docs' },
    { excerpt: 'Constraints narrow what a parameter accepts.', heading: 'Limits', title: 'Docs' },
  ];

  it('returns one rewritten prompt per excerpt and sends only what it was given', async () => {
    let sent = '';
    const fetchImpl = async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      sent = String(init?.body);
      return jsonResponse({
        response: 'Sure:\n["Where does a type parameter travel?", "What does a constraint forbid?"]',
      });
    };

    const prompts = await writeRecallPromptsWithAi('Understand generics', excerpts, {
      env: { OLLAMA_MODEL: 'gemma3:4b' },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(prompts).toEqual([
      'Where does a type parameter travel?',
      'What does a constraint forbid?',
    ]);
    expect(sent).toContain('Understand generics');
    expect(sent).toContain('Generics carry a type through a function.');
  });

  it('fails when the model returns the wrong number of prompts', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ response: '["only one"]' });
    await expect(
      writeRecallPromptsWithAi('q', excerpts, {
        env: { OLLAMA_MODEL: 'gemma3:4b' },
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({ reason: 'ai-failed' });
  });

  it('fails on prose instead of prompts, without echoing the key', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ choices: [{ message: { content: 'I would rather not.' } }] });

    const failure = await writeRecallPromptsWithAi('q', excerpts, {
      env: { OPENAI_API_KEY: 'sk-secret-value' },
      fetchImpl: fetchImpl as typeof fetch,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiError);
    expect((failure as AiError).message).not.toContain('sk-secret-value');
  });
});
