/**
 * The decode schemas (decision 0049): what the Mind sends as the job's `response_format`. They are
 * simplified on purpose (only the Phase 0 verbs and programs, no regex patterns, no `oneOf`) so an
 * engine's constrained decoder can compile them. They steer the engine; the validators in
 * `../validate/` are the control and check every output against the full contract schema.
 */

const POSITION = {
  type: 'object',
  properties: {
    x: { type: 'integer' },
    y: { type: 'integer' },
    z: { type: 'integer' },
  },
  required: ['x', 'y', 'z'],
  additionalProperties: false,
};

/** The thought decode schema. A fresh object on every call. */
export function thoughtDecodeSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      reasoning: { type: 'string', maxLength: 600 },
      say: { anyOf: [{ type: 'string', maxLength: 256 }, { type: 'null' }] },
      intent: {
        type: 'object',
        properties: {
          goal: { type: 'string', maxLength: 64 },
          program: { enum: ['travel', 'gather', 'craft', 'rest', 'flee'] },
          arguments: { type: 'object' },
          wake_on: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 32 } },
          limits: {
            type: 'object',
            properties: {
              max_world_ticks: { type: 'integer', minimum: 1, maximum: 240000 },
              max_block_operations: { type: 'integer', minimum: 1, maximum: 10000 },
            },
            required: ['max_world_ticks', 'max_block_operations'],
            additionalProperties: false,
          },
        },
        required: ['goal', 'program', 'arguments', 'wake_on', 'limits'],
        additionalProperties: false,
      },
      actions: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            do: {
              enum: [
                'goto',
                'mine',
                'craft',
                'place',
                'eat',
                'sleep',
                'open',
                'deposit',
                'withdraw',
                'attack',
                'wait',
              ],
            },
            target: { anyOf: [POSITION, { type: 'string', maxLength: 64 }] },
            block: { type: 'string', maxLength: 64 },
            item: { type: 'string', maxLength: 64 },
            count: { type: 'integer', minimum: 1, maximum: 256 },
            at: { anyOf: [POSITION, { enum: ['feet'] }] },
            seconds: { type: 'integer', minimum: 1, maximum: 600 },
          },
          required: ['do'],
          additionalProperties: false,
        },
      },
    },
    required: ['reasoning'],
    additionalProperties: false,
  };
}

/**
 * The reflection decode schema. The degraded form allows at most two memories and empty lists
 * elsewhere (see `../validate/reflection-output.ts`).
 */
export function reflectionDecodeSchema(degraded: boolean): Record<string, unknown> {
  const list = (items: Record<string, unknown>, max: number) => ({
    type: 'array',
    maxItems: degraded ? 0 : max,
    items,
  });
  return {
    type: 'object',
    properties: {
      memories_to_keep: {
        type: 'array',
        maxItems: degraded ? 2 : 8,
        items: { type: 'string', maxLength: 280 },
      },
      relationship_updates: list(
        {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 32 },
            impression: { type: 'string', maxLength: 280 },
            trust: { type: 'integer', minimum: 0, maximum: 100 },
          },
          required: ['name', 'impression', 'trust'],
          additionalProperties: false,
        },
        16,
      ),
      beliefs_add: list(
        {
          type: 'object',
          properties: {
            belief: { type: 'string', maxLength: 280 },
            kind: {
              enum: [
                'observation',
                'report',
                'interpretation',
                'prediction',
                'commitment',
                'preference',
              ],
            },
          },
          required: ['belief', 'kind'],
          additionalProperties: false,
        },
        16,
      ),
      beliefs_remove: list({ type: 'string', maxLength: 280 }, 16),
      goals: list(
        {
          type: 'object',
          properties: {
            goal: { type: 'string', maxLength: 120 },
            why: { type: 'string', maxLength: 280 },
          },
          required: ['goal', 'why'],
          additionalProperties: false,
        },
        8,
      ),
      day_summary: { type: 'string', maxLength: 1200 },
    },
    required: [
      'memories_to_keep',
      'relationship_updates',
      'beliefs_add',
      'beliefs_remove',
      'goals',
      'day_summary',
    ],
    additionalProperties: false,
  };
}
