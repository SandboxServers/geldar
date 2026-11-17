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

describe('compose/paper/otel-agent.properties', () => {
  it('turns every instrumentation off by default and enables exactly three', () => {
    expect(props.get('otel.instrumentation.common.default-enabled')).toBe('false');
    const enabled = [...props.entries()]
      .filter(([k, v]) => /^otel\.instrumentation\.[^.]+\.enabled$/.test(k) && v === 'true')
      .map(([k]) => k.split('.')[2])
      .sort();
    expect(enabled).toEqual(['log4j-appender', 'opentelemetry-api', 'runtime-telemetry']);
    expect(props.get('otel.instrumentation.java-util-logging.enabled')).toBe('false');
    expect(props.get('otel.instrumentation.runtime-telemetry.emit-experimental-telemetry')).toBe(
      'true',
    );
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
    expect(props.get('otel.exporter.otlp.endpoint')).toBe('http://otel-gateway:4318');
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
