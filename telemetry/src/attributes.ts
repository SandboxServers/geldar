// Attribute allow-list for traces, logs and metrics (decision 0350 section 1; amends 0088).
// Keys are compared after a leading `geldar.` is removed, so `geldar.life_id` and `life_id` are the same key.
// The SDK processors (sdk-processors.ts) run this on every span, log record and metric, so raw
// OpenTelemetry API calls are filtered too.

import { capText } from './cap-text.ts';

// `stdout` is the JSON stdout line: every caller field except forbidden names is kept.
export type TelemetryScope = 'trace' | 'log' | 'metric' | 'stdout';
export type AttrValue = string | number | boolean;
export type DropReason = 'unknown' | 'forbidden' | 'identity';
export interface DroppedAttribute {
  key: string;
  reason: DropReason;
}
export interface FilteredAttributes {
  attributes: Record<string, AttrValue>;
  dropped: DroppedAttribute[];
}

const TRACE_LOG_KEYS: ReadonlySet<string> = new Set([
  'life_id',
  'player_id',
  'thought_id',
  'intent_id',
  'action_id',
  'run_id',
  'turn_id',
  'event_id',
  'agent_name',
  'source_event_id',
  'receipt_id',
  'body_generation',
  'shard',
  'outcome',
  'reason',
  'error.type',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.tool.name',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.total_tokens',
  'mcp.method.name',
  // Log record envelope fields that createLogger stamps after filtering.
  'event',
  'trace_id',
  'span_id',
]);

const METRIC_KEYS: ReadonlySet<string> = new Set([
  'outcome',
  'reason',
  'tool',
  'route',
  'error.type',
  'state',
  'kind',
  'harness',
  'result',
  'type',
  'tier',
  'end',
  'direction',
  'gen_ai.request.model',
]);

// Metrics refuse these outright: no series may be keyed by a life, a player, an agent or a token.
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'life_id',
  'player_id',
  'agent_name',
  'agent.name',
  'body_generation',
  'token',
]);

// Any key that names a credential is dropped in every scope, including content fields such as
// `geldar.content.password`. `token` must be a whole word, so `gen_ai.usage.input_tokens` stays allowed.
// The other stems also match inside joined names (`authtoken`, `apiKey`, `emailAddress`).
const FORBIDDEN_WORD = 'token';
const FORBIDDEN_STEMS: readonly string[] = [
  'apikey',
  'authtoken',
  'accesstoken',
  'passwd',
  'password',
  'secret',
  'cookie',
  'authorization',
  'bearer',
  'credential',
  'jwt',
  'privatekey',
  'sessionid',
  'email',
];

// Per-service log keys (createLogger extraKeys). Process-wide: one service runs one SDK.
const extraLogKeys = new Set<string>();

let droppedTotal = 0;

/** How many attributes the allow-list has dropped in this process. */
export function attributeDropCount(): number {
  return droppedTotal;
}

/** Adds per-service keys to the log allow-list. */
export function allowLogKeys(keys: readonly string[]): void {
  for (const key of keys) extraLogKeys.add(key);
}

/** True when a key names a credential or an email, in camelCase, snake_case or joined spelling. */
export function hasForbiddenSegment(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[._-]/);
  if (words.includes(FORBIDDEN_WORD)) return true;
  const joined = words.join('');
  return FORBIDDEN_STEMS.some((stem) => joined.includes(stem));
}

function classify(key: string, name: string, scope: TelemetryScope): DropReason | undefined {
  if (scope === 'metric' && (IDENTITY_KEYS.has(name) || IDENTITY_KEYS.has(key))) return 'identity';
  if (hasForbiddenSegment(key)) return 'forbidden';
  // Stdout lines keep every other caller field; only the forbidden check above applies.
  if (scope === 'stdout') return undefined;
  if (scope === 'metric') return METRIC_KEYS.has(name) ? undefined : 'unknown';
  // Content fields (`geldar.content.*`) are allowed; their size is capped in filterAttributes.
  if (name.startsWith('content.')) return undefined;
  if (TRACE_LOG_KEYS.has(name)) return undefined;
  return scope === 'log' && extraLogKeys.has(name) ? undefined : 'unknown';
}

function isScalar(value: unknown): value is AttrValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Keeps only allow-listed scalar attributes for a scope; everything else is dropped and counted.
 * A string under `geldar.content.*` is capped at 32 KiB, and its `.bytes` and `.truncated` siblings are set.
 */
export function filterAttributes(
  input: Record<string, unknown>,
  scope: TelemetryScope,
): FilteredAttributes {
  const attributes: Record<string, AttrValue> = {};
  const dropped: DroppedAttribute[] = [];
  const cut = new Map<string, number>();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const name = key.startsWith('geldar.') ? key.slice('geldar.'.length) : key;
    const reason = isScalar(value) ? classify(key, name, scope) : 'unknown';
    if (reason !== undefined) {
      dropped.push({ key, reason });
      continue;
    }
    if (!isScalar(value)) continue;
    if (typeof value === 'string' && name.startsWith('content.')) {
      const capped = capText(value);
      attributes[key] = capped.text;
      if (capped.truncated) cut.set(key, capped.bytes);
    } else {
      attributes[key] = value;
    }
  }
  for (const [key, bytes] of cut) {
    attributes[`${key}.bytes`] = bytes;
    attributes[`${key}.truncated`] = true;
  }
  // Stdout drops are forbidden names only; they are not allow-list drops, so they are not counted.
  if (scope !== 'stdout') droppedTotal += dropped.length;
  return { attributes, dropped };
}
