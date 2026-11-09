import { validateThought } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ollamaChat } from '../src/ollama.ts';

// Needs a running Ollama with qwen3:8b: `GELDAR_IT=1 GELDAR_OLLAMA=1`. Not run in `check` or CI.
const enabled = process.env.GELDAR_IT === '1' && process.env.GELDAR_OLLAMA === '1';

describe.skipIf(!enabled)('Ollama (live)', () => {
  it('serves one thought-schema job to qwen3:8b with JSON that validates', async () => {
    const config = loadConfig({ allowPlaceholders: true });
    const pin = config.pins.find((p) => p.name === 'qwen3:8b');
    if (pin === undefined) throw new Error('qwen3:8b is not pinned in shards/phase0.yaml');
    const schema = {
      type: 'object',
      properties: {
        reasoning: { type: 'string', maxLength: 600 },
        say: { type: 'string', maxLength: 256 },
      },
      required: ['reasoning', 'say'],
      additionalProperties: false,
    };
    const started = Date.now();
    const result = await ollamaChat(config.ollamaUrl)(
      {
        pin,
        messages: [
          { role: 'system', content: 'Reply with one JSON object and nothing else.' },
          {
            role: 'user',
            content:
              'You are Adam, standing next to an oak tree. Think briefly, then say hello aloud.',
          },
        ],
        maxTokens: 300,
        temperature: 0.7,
        stop: null,
        schema,
        think: false,
      },
      AbortSignal.timeout(60_000),
    );
    console.log(
      `latency ${Date.now() - started} ms, prompt tokens ${result.promptTokens}, completion tokens ${result.completionTokens}`,
    );
    const parsed: unknown = JSON.parse(result.text);
    const checked = validateThought(parsed);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    // A cold model load takes a minute or more; vitest's default of 5 s would end the test early.
  }, 180_000);
});
