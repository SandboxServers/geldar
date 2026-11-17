// The telemetry profiles mounted into the live NeoForge shard: the agent profile and the ledger config.
// Key names are checked against the neoforge-ledger README table; no secret, no address except the gateway service name.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const agentText = readFileSync(`${ROOT}compose/neoforge/otel-agent.properties`, 'utf8');
const ledgerText = readFileSync(`${ROOT}compose/neoforge/ledger.properties`, 'utf8');
const readme = readFileSync(`${ROOT}neoforge-ledger/README.md`, 'utf8');

/** `key=value` lines and `#` comments; the value is everything after the first `=`. A duplicate key fails. */
function parseProperties(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    expect(eq, `line without "=": ${line}`).toBeGreaterThan(0);
    const key = line.slice(0, eq).trim();
    expect(out.has(key), `duplicate key ${key}`).toBe(false);
    out.set(key, line.slice(eq + 1).trim());
  }
  return out;
}

const RESOURCE_PROVIDERS = [
  'HostResourceProvider',
  'HostIdResourceProvider',
  'OsResourceProvider',
  'ProcessResourceProvider',
  'ProcessRuntimeResourceProvider',
  'ContainerResourceProvider',
]
  .map((c) => `io.opentelemetry.instrumentation.resources.${c}`)
  .join(',');

const agent = parseProperties(agentText);
const ledger = parseProperties(ledgerText);

/** Collector ids the README documents as `collector.<id>.enabled` (also inside a pair like `a`, `b`). */
function readmeCollectorKeys(): Set<string> {
  return new Set(
    [...readme.matchAll(/`(collector\.[a-z]+\.enabled)`/g)].map((m) => m[1] as string),
  );
}

describe('compose/neoforge/otel-agent.properties', () => {
  it('holds exactly the expected keys and values (agent 2.33.1 key names)', () => {
    expect(Object.fromEntries(agent)).toEqual({
      'otel.instrumentation.common.default-enabled': 'false',
      'otel.instrumentation.opentelemetry-api.enabled': 'true',
      'otel.instrumentation.runtime-telemetry.enabled': 'true',
      'otel.instrumentation.log4j-appender.enabled': 'false',
      'otel.instrumentation.logback-appender.enabled': 'false',
      'otel.instrumentation.java-util-logging.enabled': 'false',
      'otel.java.disabled.resource.providers': RESOURCE_PROVIDERS,
      'otel.experimental.resource.disabled.keys':
        'host.name,host.id,host.arch,os.type,os.description,process.pid,process.command_line,process.command_args,process.executable.path,process.owner,container.id',
      'otel.propagators': 'tracecontext',
      'otel.exporter.otlp.protocol': 'http/protobuf',
      'otel.exporter.otlp.endpoint': 'http://geldar-gateway:4318',
      'otel.service.name': 'geldar-neoforge',
      'otel.resource.attributes': 'service.namespace=geldar,geldar.shard=nf',
      'otel.sdk.disabled': 'false',
      'otel.metrics.exporter': 'otlp',
      'otel.logs.exporter': 'otlp',
      'otel.traces.exporter': 'none',
      'otel.metric.export.interval': '15000',
      'otel.blrp.max.queue.size': '2048',
    });
  });

  it('disables the identity resource providers (host, host id, os, process, runtime, container)', () => {
    const disabled = (agent.get('otel.java.disabled.resource.providers') ?? '').split(',').sort();
    expect(
      disabled.map((c) => c.replace('io.opentelemetry.instrumentation.resources.', '')),
    ).toEqual([
      'ContainerResourceProvider',
      'HostIdResourceProvider',
      'HostResourceProvider',
      'OsResourceProvider',
      'ProcessResourceProvider',
      'ProcessRuntimeResourceProvider',
    ]);
    const keys = (agent.get('otel.experimental.resource.disabled.keys') ?? '').split(',');
    for (const k of [
      'host.name',
      'process.command_line',
      'process.command_args',
      'process.owner',
      'os.type',
      'container.id',
    ]) {
      expect(keys, k).toContain(k);
    }
  });

  it('keeps every log appender off (the console log holds human names and chat)', () => {
    const appenders = [...agent.keys()].filter((k) => /appender|java-util-logging/.test(k));
    expect(appenders.sort()).toEqual([
      'otel.instrumentation.java-util-logging.enabled',
      'otel.instrumentation.log4j-appender.enabled',
      'otel.instrumentation.logback-appender.enabled',
    ]);
    for (const k of appenders) expect(agent.get(k), k).toBe('false');
  });

  it('enables no instrumentation besides the API bridge and the runtime metrics', () => {
    const on = [...agent.entries()]
      .filter(([k, v]) => /^otel\.instrumentation\.[^.]+\.enabled$/.test(k) && v === 'true')
      .map(([k]) => k.split('.')[2]);
    expect(on.sort()).toEqual(['opentelemetry-api', 'runtime-telemetry']);
  });
});

describe('compose/neoforge/ledger.properties', () => {
  const known = readmeCollectorKeys();

  it('uses only keys the neoforge-ledger README documents, apart from the chat switch', () => {
    for (const key of ledger.keys()) {
      if (key === 'enabled' || key === 'collector.chat.enabled') continue;
      expect(known.has(key), `${key} is not in the neoforge-ledger README table`).toBe(true);
    }
  });

  it('turns the master and the live collectors on', () => {
    expect(Object.fromEntries(ledger)).toEqual({
      enabled: 'true',
      'collector.tick.enabled': 'true',
      'collector.world.enabled': 'true',
      'collector.server.enabled': 'true',
      'collector.connections.enabled': 'true',
      'collector.snapshot.enabled': 'true',
      'collector.progress.enabled': 'true',
      'collector.curated.enabled': 'true',
      'collector.audit.enabled': 'true',
      'collector.combat.enabled': 'true',
      'collector.operator.enabled': 'true',
      'collector.chat.enabled': 'false',
    });
  });

  it('keeps chat export off and lists no Paper-only collector', () => {
    expect(ledger.get('collector.chat.enabled')).toBe('false');
    for (const id of ['cadence', 'spark', 'census', 'bridge', 'container', 'disk']) {
      expect(ledger.has(`collector.${id}.enabled`), id).toBe(false);
    }
    expect([...ledger.keys()].some((k) => k.startsWith('jfr.'))).toBe(false);
  });
});

describe('both profiles', () => {
  it('hold no secret and no address except the gateway service name', () => {
    const ipv4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;
    for (const [name, text] of [
      ['otel-agent.properties', agentText],
      ['ledger.properties', ledgerText],
    ] as const) {
      expect(ipv4.test(text), `${name} holds an IPv4 literal`).toBe(false);
      expect(/\[[0-9a-f:]{2,}\]/i.test(text), `${name} holds an IPv6 literal`).toBe(false);
      const urls = text.match(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi) ?? [];
      for (const url of urls) expect(url, `${name} holds a URL`).toBe('http://geldar-gateway:4318');
      for (const line of text.split('\n')) {
        const key = line.split('=')[0] ?? '';
        if (line.trim().startsWith('#') || !line.includes('=')) continue;
        expect(/header|token|secret|password|authorization|credential/i.test(key), key).toBe(false);
      }
    }
  });

  it('use LF line endings and no control characters', () => {
    for (const text of [agentText, ledgerText]) {
      expect(text.includes('\r')).toBe(false);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the point of the check
      expect(/[\u0000-\u0008\u000b-\u001f]/.test(text)).toBe(false);
    }
  });
});
