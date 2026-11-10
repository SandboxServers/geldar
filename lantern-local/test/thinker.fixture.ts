import { ollamaChat, ollamaWarm } from '../src/ollama.ts';
import { LocalThinker, type ThinkerOptions } from '../src/thinker.ts';
import { FakeMind, FakeOllama, pin } from './thinker.fakes.ts';

/** One test's rig: a fake Mind, a fake Ollama, the log lines, and every Thinker it launched. */
export interface Rig {
  mind: FakeMind;
  ollama: FakeOllama;
  logs: string[];
  launch(overrides?: Partial<ThinkerOptions>): LocalThinker;
  launchWarm(overrides?: Partial<ThinkerOptions>): LocalThinker;
  /** Stops every Thinker the rig launched, then the fake Mind and the fake Ollama. */
  close(): Promise<void>;
}

/** A one-shot Ollama chat answer whose text is `{"ok":true}`. */
export const answer = { message: { content: '{"ok":true}' }, prompt_eval_count: 12, eval_count: 5 };

/** Starts a fresh fake Mind and fake Ollama for one test. Each test file calls this in beforeEach. */
export async function startRig(): Promise<Rig> {
  const mind = new FakeMind();
  const ollama = new FakeOllama();
  const logs: string[] = [];
  const thinkers: LocalThinker[] = [];
  await Promise.all([mind.start(), ollama.start()]);

  const launch = (overrides: Partial<ThinkerOptions> = {}): LocalThinker => {
    const thinker = new LocalThinker({
      wsUrl: mind.url,
      models: [pin()],
      chat: ollamaChat(ollama.url),
      version: '1.2.3',
      backoffInitialMs: 30,
      backoffMaxMs: 120,
      log: (line) => logs.push(line),
      ...overrides,
    });
    thinkers.push(thinker);
    thinker.start();
    return thinker;
  };

  return {
    mind,
    ollama,
    logs,
    launch,
    launchWarm: (overrides = {}) => launch({ warm: ollamaWarm(ollama.url), ...overrides }),
    async close() {
      for (const thinker of thinkers) await thinker.stop();
      await Promise.all([mind.stop(), ollama.stop()]);
    },
  };
}
