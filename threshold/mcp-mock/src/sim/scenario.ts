import { z } from 'zod';

/** A name that lands in a typed field: an identifier, never prose. */
const identifier = z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'must match ^[A-Za-z0-9_]{3,16}$');
const position = z.strictObject({ x: z.int(), y: z.int(), z: z.int() });
const atTick = z.int().min(1);

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
    .default([]),
  facts: z.array(z.string()).default([]),
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
    from: z.string(),
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
    rule: z.string(),
  }),
  z.strictObject({ type: z.literal('set_fact'), at_tick: atTick, fact: z.string() }),
  z.strictObject({ type: z.literal('clear_fact'), at_tick: atTick, fact: z.string() }),
]);

const scenarioSchema = z.strictObject({
  name: z.string(),
  day_length_seconds: z.number().gt(0).default(2400),
  character,
  neighbours: z.array(z.strictObject({ name: identifier, position })).default([]),
  books: z.array(book).default([]),
  events: z
    .array(event)
    .default([])
    .superRefine((events, ctx) => {
      for (let i = 1; i < events.length; i++) {
        if ((events[i]?.at_tick ?? 0) < (events[i - 1]?.at_tick ?? 0)) {
          ctx.addIssue({ code: 'custom', path: [i], message: 'events must be sorted by at_tick' });
          return;
        }
      }
    }),
  wake: z
    .strictObject({
      min_spacing_seconds: z.number().min(0).default(20),
      intent_run_too_long_seconds: z.number().gt(0).default(300),
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
    .array(z.strictObject({ rule: z.string().min(1).max(256), value: z.string() }))
    .max(20)
    .default([]),
});

/** A parsed scenario file with every default filled in. */
export type Scenario = z.output<typeof scenarioSchema>;

/** Parses scenario JSON text; throws `scenario: <path>: <message>` for the first problem. */
export function parseScenario(text: string): Scenario {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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

/** Returns a copy of `s` with the given overrides applied. */
export function applyOverrides(s: Scenario, o: ScenarioOverrides): Scenario {
  return {
    ...s,
    day_length_seconds: o.dayLengthSeconds ?? s.day_length_seconds,
    wake: {
      min_spacing_seconds: o.minWakeSpacingSeconds ?? s.wake.min_spacing_seconds,
      intent_run_too_long_seconds: o.intentRunTooLongSeconds ?? s.wake.intent_run_too_long_seconds,
    },
  };
}
