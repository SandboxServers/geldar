// PT-02b: the OpenTelemetry agent profile for Paper. Inert, minimal, no secrets, no addresses (S4, S5, S12).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const text = readFileSync(`${ROOT}compose/paper/otel-agent.properties`, 'utf8');

/** Java .properties subset used here: `key=value` lines, `#` comments; the value is everything after the first `=`. */
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

const props = parseProperties(text);

/**
 * Exact allow-list of keys. Any extra key (a second endpoint, an extension, an exporter switch, a
 * misspelling) fails. Every name here was verified against the OpenTelemetry Java agent 2.33.1
 * documentation (agent configuration; log4j-appender README; SDK configuration).
 */
const VERIFIED_KEYS = [
  'otel.bsp.max.queue.size',
  'otel.blrp.max.queue.size',
  'otel.exporter.otlp.endpoint',
  'otel.exporter.otlp.protocol',
  'otel.instrumentation.common.default-enabled',
  'otel.instrumentation.java-util-logging.enabled',
  'otel.instrumentation.log4j-appender.enabled',
  'otel.instrumentation.log4j-appender.experimental-log-attributes',
  'otel.instrumentation.opentelemetry-api.enabled',
  'otel.instrumentation.runtime-telemetry.enabled',
  'otel.metric.export.interval',
  'otel.propagators',
  'otel.resource.attributes',
  'otel.sdk.disabled',
  'otel.service.name',
].sort();

const EXPECTED_VALUES: Record<string, string> = {
  'otel.bsp.max.queue.size': '2048',
  'otel.blrp.max.queue.size': '2048',
  'otel.exporter.otlp.endpoint': 'http://geldar-gateway:4318',
  'otel.exporter.otlp.protocol': 'http/protobuf',
  'otel.instrumentation.common.default-enabled': 'false',
  'otel.instrumentation.java-util-logging.enabled': 'false',
  'otel.instrumentation.log4j-appender.enabled': 'true',
  'otel.instrumentation.log4j-appender.experimental-log-attributes': 'true',
  'otel.instrumentation.opentelemetry-api.enabled': 'true',
  'otel.instrumentation.runtime-telemetry.enabled': 'true',
  'otel.metric.export.interval': '15000',
  'otel.propagators': 'tracecontext',
  'otel.resource.attributes': 'service.namespace=geldar',
  'otel.sdk.disabled': 'true',
  'otel.service.name': 'geldar-paper',
};

describe('compose/paper/otel-agent.properties', () => {
  it('holds exactly the verified key set and no other key', () => {
    expect([...props.keys()].sort()).toEqual(VERIFIED_KEYS);
  });

  it('pins the key names to the 2.33.1 documentation list, separate from the values', () => {
    expect(Object.keys(EXPECTED_VALUES).sort()).toEqual(VERIFIED_KEYS);
    for (const key of props.keys()) expect(VERIFIED_KEYS, `unverified key ${key}`).toContain(key);
  });

  it('holds exactly the expected value for every key', () => {
    expect(Object.fromEntries(props)).toEqual(EXPECTED_VALUES);
  });

  it('has no extension, second endpoint, other exporter or JFR/deprecated key', () => {
    for (const key of props.keys()) {
      expect(key.startsWith('otel.javaagent.'), `${key}`).toBe(false);
      expect(/exporter\.otlp\.(logs|traces|metrics)\./.test(key), `${key}`).toBe(false);
      expect(/\.exporter$/.test(key), `${key}`).toBe(false);
      expect(/jfr|emit-experimental/.test(key), `${key}`).toBe(false);
    }
    expect([...props.keys()].filter((k) => k.endsWith('.endpoint'))).toEqual([
      'otel.exporter.otlp.endpoint',
    ]);
  });

  it('turns every instrumentation off by default and enables exactly three', () => {
    expect(props.get('otel.instrumentation.common.default-enabled')).toBe('false');
    const enabled = [...props.entries()]
      .filter(([k, v]) => /^otel\.instrumentation\.[^.]+\.enabled$/.test(k) && v === 'true')
      .map(([k]) => k.split('.')[2])
      .sort();
    expect(enabled).toEqual(['log4j-appender', 'opentelemetry-api', 'runtime-telemetry']);
    expect(props.get('otel.instrumentation.java-util-logging.enabled')).toBe('false');
    expect(props.get('otel.instrumentation.log4j-appender.experimental-log-attributes')).toBe(
      'true',
    );
  });

  it('adds no other instrumentation (no nats, jdbc, netty)', () => {
    const named = new Set(
      [...props.keys()]
        .filter((k) => k.startsWith('otel.instrumentation.'))
        .map((k) => k.split('.')[2]),
    );
    expect([...named].sort()).toEqual([
      'common',
      'java-util-logging',
      'log4j-appender',
      'opentelemetry-api',
      'runtime-telemetry',
    ]);
  });

  it('propagates trace context only (no Baggage)', () => {
    expect(props.get('otel.propagators')).toBe('tracecontext');
  });

  it('exports OTLP over HTTP to the gateway by name', () => {
    expect(props.get('otel.exporter.otlp.protocol')).toBe('http/protobuf');
    expect(props.get('otel.exporter.otlp.endpoint')).toBe('http://geldar-gateway:4318');
  });

  it('sets the resource attributes and the service name', () => {
    expect(props.get('otel.resource.attributes')).toBe('service.namespace=geldar');
    expect(props.get('otel.service.name')).toBe('geldar-paper');
    expect([...props.values()].join('\n')).not.toContain('deployment.environment');
  });

  it('ships disabled and with bounded, regular export (S12, S6)', () => {
    expect(props.get('otel.sdk.disabled')).toBe('true');
    expect(props.get('otel.metric.export.interval')).toBe('15000');
    expect(props.get('otel.bsp.max.queue.size')).toBe('2048');
    expect(props.get('otel.blrp.max.queue.size')).toBe('2048');
  });

  it('holds no address and no credential key (S4, S5)', () => {
    const ipv4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;
    const ipv6 = /(^|[^\w])([0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?![\w])/i;
    for (const [key, value] of props) {
      // Strip the scheme before the IPv6 look: "http://host" has "//" but no hex groups.
      const bare = value.replace(/^[a-z]+:\/\//i, '');
      expect(ipv4.test(value), `${key} holds an IPv4 literal`).toBe(false);
      expect(ipv6.test(bare), `${key} holds an IPv6 literal`).toBe(false);
      expect(/header|token|authorization/i.test(key), `${key} looks like a credential`).toBe(false);
    }
  });
});
