import { describe, expect, it } from 'vitest';
import { adamEnv, loopbackProblems, parseComposePs, parseEnvFile, shardProblems } from './env.ts';

describe('env file', () => {
  it('parses KEY=value lines, comments and quotes', () => {
    const parsed = parseEnvFile(
      '# c\nOLLAMA_URL="http://127.0.0.1:11434"\n\nPOSTGRES_DB=geldar\r\nbad line\n',
    );
    expect(parsed).toEqual({ OLLAMA_URL: 'http://127.0.0.1:11434', POSTGRES_DB: 'geldar' });
  });

  it('keeps only the known keys, and the process environment wins', () => {
    const env = adamEnv(
      { POSTGRES_DB: 'file', SECRET_TOKEN: 'x' },
      { POSTGRES_DB: 'proc', PATH: '/bin' },
    );
    expect(env).toEqual({ POSTGRES_DB: 'proc' });
  });
});

describe('loopback check', () => {
  it('accepts loopback addresses', () => {
    expect(
      loopbackProblems({ GELDAR_NATS_URL: 'nats://127.0.0.1:4222', POSTGRES_HOST: 'localhost' }),
    ).toEqual([]);
  });

  it('refuses a non-loopback URL or host', () => {
    expect(loopbackProblems({ OLLAMA_URL: 'http://ollama.example:11434' })).toHaveLength(1);
    expect(loopbackProblems({ GELDAR_NATS_URL: 'nats://0.0.0.0:4222' })).toHaveLength(1);
    expect(loopbackProblems({ POSTGRES_HOST: 'db.internal' })).toHaveLength(1);
    expect(loopbackProblems({ OLLAMA_URL: 'not a url' })).toHaveLength(1);
  });
});

describe('shard health', () => {
  const line = (service: string, state: string, health = ''): string =>
    JSON.stringify({ Service: service, State: state, Health: health });
  const all = ['postgres', 'nats', 'paper', 'velocity', 'eventsink'];

  it('parses one object per line and a JSON array', () => {
    const ndjson = [line('nats', 'running', 'healthy'), line('paper', 'exited')].join('\n');
    expect(parseComposePs(ndjson)).toEqual([
      { service: 'nats', state: 'running', health: 'healthy' },
      { service: 'paper', state: 'exited', health: '' },
    ]);
    expect(parseComposePs(`[${line('nats', 'running')}]`)).toHaveLength(1);
    expect(parseComposePs('')).toEqual([]);
  });

  it('passes when every required service is running and healthy', () => {
    const rows = parseComposePs(
      all.map((s) => line(s, 'running', s === 'eventsink' ? '' : 'healthy')).join('\n'),
    );
    expect(shardProblems(rows, 'phase0')).toEqual([]);
  });

  it('names missing, stopped and unhealthy services and the command that starts the shard', () => {
    const rows = parseComposePs(
      [
        line('postgres', 'running', 'healthy'),
        line('nats', 'exited'),
        line('paper', 'running', 'starting'),
        line('velocity', 'running', 'healthy'),
      ].join('\n'),
    );
    const problems = shardProblems(rows, 'phase0').join('\n');
    expect(problems).toContain('nats is exited');
    expect(problems).toContain('paper is starting');
    expect(problems).toContain('eventsink is not part of the running shard');
    expect(problems).toContain('./geldar.ps1 shard up phase0');
  });
});
