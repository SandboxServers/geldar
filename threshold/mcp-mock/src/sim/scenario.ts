import { z } from 'zod';

/** A name that lands in a typed field: an identifier, never prose. */
const identifier = z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'must match ^[A-Za-z0-9_]{3,16}$');
const position = z.strictObject({ x: z.int(), y: z.int(), z: z.int() });
const atTick = z.int().min(1);
/** Bounds for every duration in seconds, shared by the schema and the command-line overrides. */
const MIN_SECONDS = 0.001;
const MAX_SECONDS = 10_000_000;
/** The most entries any scenario list may hold. */
const MAX_ITEMS = 1000;
/** The largest scenario text parseScenario reads, in bytes. */
const MAX_TEXT_BYTES = 1024 * 1024;

/** Nesting depth of a JSON value: scalars are 0, each array or object level adds one. */
function jsonDepth(v: unknown): number {
  if (typeof v !== 'object' || v === null) return 0;
  const kids: unknown[] = Array.isArray(v) ? v : Object.values(v);
  return 1 + Math.max(0, ...kids.map(jsonDepth));
}

/** True if any string in the value (keys excluded) is longer than `max` characters. */
function hasLongString(v: unknown, max: number): boolean {
  if (typeof v === 'string') return v.length > max;
  if (typeof v !== 'object' || v === null) return false;
  const kids: unknown[] = Array.isArray(v) ? v : Object.values(v);
  return kids.some((k) => hasLongString(k, max));
}

/** A law value: any JSON value (contract ProposeInput.value), at most depth 4 and 1 KiB serialised. */
const lawValue = z.json().superRefine((v, ctx) => {
  if (jsonDepth(v) > 4) ctx.addIssue({ code: 'custom', message: 'must nest at most 4 deep' });
  else if (JSON.stringify(v).length > 1024)
    ctx.addIssue({ code: 'custom', message: 'must serialise to at most 1024 characters' });
  else if (hasLongString(v, 256))
    ctx.addIssue({ code: 'custom', message: 'strings must be at most 256 characters' });
});

const character = z.strictObject({
  name: identifier,
  life_id: z.string().regex(/^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/, 'must match the LifeId pattern'),
  born_day: z.int().min(0).default(0),
  seed: z.string().min(1).default('mock-seed-0001'),
  position,
  food: z.int().min(0).max(20).default(20),
  inventory: z
    .array(
      z.strictObject({
        item: z.string().regex(/^[a-z0-9_]{1,64}$/, 'must match ^[a-z0-9_]{1,64}$'),
        count: z.int().min(1).max(64),
        book_id: z.string().min(1).max(64).optional(),
      }),
    )
    .max(MAX_ITEMS)
    .default([]),
  facts: z.array(z.string().max(256)).max(MAX_ITEMS).default([]),
  budget: z.int().min(0).default(100),
});

const book = z.strictObject({
  id: z.string().regex(/^bk_[a-z0-9_]{1,32}$/),
  title: z.string().max(32),
  kind: z.enum(['text', 'skill']),
  text: z.string().max(8192),
  skill_id: z.string().min(1).max(64).optional(),
});

const event = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('speech'),
    at_tick: atTick,
    from: z.string().max(64),
    to: z.string().nullable(),
    text: z.string().max(512),
  }),
  z.strictObject({ type: z.literal('damage'), at_tick: atTick, amount: z.int().min(1).max(20) }),
  z.strictObject({
    type: z.literal('agent_approaches'),
    at_tick: atTick,
    name: identifier,
    distance: z.int().min(1).max(64),
  }),
  z.strictObject({
    type: z.literal('proposal'),
    at_tick: atTick,
    id: z.string().regex(/^pr_/),
    rule: z.string().max(256),
  }),
  z.strictObject({ type: z.literal('set_fact'), at_tick: atTick, fact: z.string().max(256) }),
  z.strictObject({ type: z.literal('clear_fact'), at_tick: atTick, fact: z.string().max(256) }),
]);

const scenarioSchema = z
  .strictObject({
    name: z.string().max(64),
    day_length_seconds: z.number().min(MIN_SECONDS).max(MAX_SECONDS).default(2400),
    character,
    neighbours: z
      .array(z.strictObject({ name: identifier, position }))
      .max(MAX_ITEMS)
      .default([]),
    books: z.array(book).max(MAX_ITEMS).default([]),
    events: z
      .array(event)
      .max(MAX_ITEMS)
      .default([])
      .superRefine((events, ctx) => {
        for (let i = 1; i < events.length; i++) {
          if ((events[i]?.at_tick ?? 0) < (events[i - 1]?.at_tick ?? 0)) {
            ctx.addIssue({
              code: 'custom',
              path: [i],
              message: 'events must be sorted by at_tick',
            });
            return;
          }
        }
      }),
    wake: z
      .strictObject({
        min_spacing_seconds: z.number().min(0).max(MAX_SECONDS).default(20),
        intent_run_too_long_seconds: z.number().min(MIN_SECONDS).max(MAX_SECONDS).default(300),
      })
      .prefault({}),
    intent: z.strictObject({ default_ticks: z.int().min(1).default(600) }).prefault({}),
    reflex: z
      .strictObject({
        hunger_interval_ticks: z.int().min(1).default(1200),
        eat_below: z.int().min(0).max(20).default(14),
      })
      .prefault({}),
    shard_rules: z.strictObject({ chat_radius: z.int().min(1).default(32) }).prefault({}),
    laws: z
      .array(z.strictObject({ rule: z.string().min(1).max(256), value: lawValue }))
      .max(20)
      .default([]),
  })
  .superRefine((s, ctx) => {
    const bookIds = new Set<string>();
    s.books.forEach((b, i) => {
      if (bookIds.has(b.id))
        ctx.addIssue({ code: 'custom', path: ['books', i, 'id'], message: 'duplicate book id' });
      bookIds.add(b.id);
    });
    s.character.inventory.forEach((entry, i) => {
      if (entry.book_id !== undefined && !bookIds.has(entry.book_id))
        ctx.addIssue({
          code: 'custom',
          path: ['character', 'inventory', i, 'book_id'],
          message: 'no book with this id',
        });
    });
    const names = new Set<string>([s.character.name]);
    s.neighbours.forEach((n, i) => {
      if (names.has(n.name))
        ctx.addIssue({
          code: 'custom',
          path: ['neighbours', i, 'name'],
          message:
            n.name === s.character.name ? "is the character's own name" : 'duplicate neighbour',
        });
      names.add(n.name);
    });
  });

/** A parsed scenario file with every default filled in. */
export type Scenario = z.output<typeof scenarioSchema>;

/** Parses scenario JSON text; throws `scenario: <path>: <message>` for the first problem. */
export function parseScenario(text: string): Scenario {
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('scenario: (file): too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('scenario: (file): not valid JSON');
  }
  const result = scenarioSchema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
  throw new Error(`scenario: ${path}: ${issue?.message ?? 'invalid'}`);
}

/** Command-line flags that beat the file. */
export interface ScenarioOverrides {
  dayLengthSeconds?: number;
  minWakeSpacingSeconds?: number;
  intentRunTooLongSeconds?: number;
}

function checkSeconds(name: string, value: number | undefined, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < min || value > MAX_SECONDS) {
    const lower = min > 0 ? '> 0' : '>= 0';
    throw new Error(`scenario: ${name}: must be ${lower} and finite, at most ${MAX_SECONDS}`);
  }
  return value;
}

/** Returns a deep copy of `s` with the given overrides applied; throws on an out-of-range override. */
export function applyOverrides(s: Scenario, o: ScenarioOverrides): Scenario {
  const copy = structuredClone(s);
  copy.day_length_seconds =
    checkSeconds('day_length_seconds', o.dayLengthSeconds, MIN_SECONDS) ?? copy.day_length_seconds;
  copy.wake.min_spacing_seconds =
    checkSeconds('wake.min_spacing_seconds', o.minWakeSpacingSeconds, 0) ??
    copy.wake.min_spacing_seconds;
  copy.wake.intent_run_too_long_seconds =
    checkSeconds('wake.intent_run_too_long_seconds', o.intentRunTooLongSeconds, MIN_SECONDS) ??
    copy.wake.intent_run_too_long_seconds;
  return copy;
}
