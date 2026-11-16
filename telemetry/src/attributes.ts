// Attribute allow-list for traces, logs and metrics (decision 0350 section 1; amends 0088).
// Keys are compared after a leading `geldar.` is removed, so `geldar.life_id` and `life_id` are the same key.

export type TelemetryScope = 'trace' | 'log' | 'metric';
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
  'mcp.method.name',
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

// Any key with one of these words as a segment (split on `.`, `_`, `-`) is dropped in every scope,
// including content fields such as `geldar.content.password`.
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  'token',
  'secret',
  'password',
  'cookie',
  'authorization',
  'email',
]);

let droppedTotal = 0;

/** How many attributes the allow-list has dropped in this process. */
export function attributeDropCount(): number {
  return droppedTotal;
}

export function hasForbiddenSegment(key: string): boolean {
  return key
    .toLowerCase()
    .split(/[._-]/)
    .some((segment) => FORBIDDEN_SEGMENTS.has(segment));
}

function classify(key: string, name: string, scope: TelemetryScope): DropReason | undefined {
  if (scope === 'metric' && (IDENTITY_KEYS.has(name) || IDENTITY_KEYS.has(key))) return 'identity';
  if (hasForbiddenSegment(key)) return 'forbidden';
  if (scope === 'metric') return METRIC_KEYS.has(name) ? undefined : 'unknown';
  // Content fields (`geldar.content.*`) are allowed; contentAttributes() caps their size.
  if (name.startsWith('content.')) return undefined;
  return TRACE_LOG_KEYS.has(name) ? undefined : 'unknown';
}

function isScalar(value: unknown): value is AttrValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Keeps only allow-listed scalar attributes for a scope; everything else is dropped and counted. */
export function filterAttributes(
  input: Record<string, unknown>,
  scope: TelemetryScope,
): FilteredAttributes {
  const attributes: Record<string, AttrValue> = {};
  const dropped: DroppedAttribute[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const name = key.startsWith('geldar.') ? key.slice('geldar.'.length) : key;
    const reason = isScalar(value) ? classify(key, name, scope) : 'unknown';
    if (reason !== undefined) {
      dropped.push({ key, reason });
      continue;
    }
    if (isScalar(value)) attributes[key] = value;
  }
  droppedTotal += dropped.length;
  return { attributes, dropped };
}
