import { loadConfig, thinkerVersion } from './config.ts';
import { discoverModels } from './models.ts';
import { ollamaChat, ollamaWarm } from './ollama.ts';
import { LocalThinker } from './thinker.ts';

const log = (line: string): void => {
  console.log(`${new Date().toISOString()} lantern-local ${line}`);
};

async function main(): Promise<number> {
  const config = loadConfig();
  const { advertised, rejected } = await discoverModels(config.ollamaUrl, config.pins);
  for (const line of rejected) log(`not advertised: ${line}`);
  if (advertised.length === 0) {
    log('no pinned model is available in Ollama; exiting');
    return 1;
  }
  const thinker = new LocalThinker({
    wsUrl: config.wsUrl,
    models: advertised,
    chat: ollamaChat(config.ollamaUrl),
    warm: ollamaWarm(config.ollamaUrl),
    version: thinkerVersion(),
    heartbeatMs: config.heartbeatMs,
    warmTimeoutMs: config.warmTimeoutMs,
    log,
  });
  const shutdown = (): void => {
    void thinker.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  thinker.start();
  log(`serving ${advertised.map((m) => m.name).join(', ')} to ${config.wsUrl}`);
  return await new Promise<number>(() => {});
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
