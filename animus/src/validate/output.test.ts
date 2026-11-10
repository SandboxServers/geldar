import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';
import type { OutputError } from '../ports/index.ts';
import { thoughtDecodeSchema } from '../prompts/decode-schema.ts';
import {
  CORRECTIVE_ECHO_CHARS,
  createOutputValidator,
  MAX_OUTPUT_BYTES,
  PHASE0_PROGRAMS,
  PHASE0_VERBS,
} from './index.ts';

const validator = createOutputValidator();

const intent = (over: Record<string, unknown> = {}) => ({
  goal: 'collect_wood',
  program: 'gather',
  arguments: { block: 'oak_log', count: 12 },
  wake_on: ['goal_completed'],
  limits: { max_world_ticks: 6000, max_block_operations: 100 },
  ...over,
});
const thought = (over: Record<string, unknown>) => JSON.stringify({ reasoning: 'ok', ...over });

interface Row {
  name: string;
  text: string;
  code: OutputError['code'];
  path?: string;
}

const REJECTED: Row[] = [
  { name: 'empty', text: '   ', code: 'empty' },
  { name: 'malformed json', text: '{"reasoning": "x",', code: 'not_json' },
  { name: 'prose around the json', text: `Sure! ${thought({ say: 'hi' })}`, code: 'not_json' },
  {
    name: 'a code fence (no normalisation)',
    text: `\`\`\`json\n${thought({ say: 'hi' })}\n\`\`\``,
    code: 'not_json',
  },
  {
    name: 'a think block (no normalisation)',
    text: `<think>hm</think>${thought({ say: 'hi' })}`,
    code: 'not_json',
  },
  { name: 'trailing comma', text: '{"reasoning":"x","say":"hi",}', code: 'not_json' },
  {
    name: 'oversize output',
    text: 'x'.repeat(MAX_OUTPUT_BYTES + 1),
    code: 'out_of_bounds',
    path: '',
  },
  { name: 'nothing to do', text: thought({}), code: 'schema' },
  { name: 'unknown field', text: thought({ say: 'hi', extra: 1 }), code: 'schema' },
  {
    name: 'unknown verb',
    text: thought({ actions: [{ do: 'fly', target: 'moon' }] }),
    code: 'not_allowed',
    path: '/actions/0/do',
  },
  {
    name: 'define_skill',
    text: thought({ actions: [{ do: 'define_skill', name: 'x', description: 'y', code: 'z' }] }),
    code: 'not_allowed',
    path: '/actions/0/do',
  },
  {
    name: 'give',
    text: thought({ actions: [{ do: 'give', to: 'Eve', item: 'bread', count: 1 }] }),
    code: 'not_allowed',
  },
  {
    name: 'write_sign',
    text: thought({ actions: [{ do: 'write_sign', text: 'hi' }] }),
    code: 'not_allowed',
  },
  {
    name: 'propose',
    text: thought({ actions: [{ do: 'propose', rule: 'r', value: 1, reason: 'x' }] }),
    code: 'not_allowed',
  },
  { name: 'note', text: thought({ actions: [{ do: 'note', text: 'x' }] }), code: 'not_allowed' },
  {
    name: 'follow program',
    text: thought({ intent: intent({ program: 'follow', arguments: {} }) }),
    code: 'not_allowed',
    path: '/intent/program',
  },
  {
    name: 'build program',
    text: thought({ intent: intent({ program: 'build', arguments: {} }) }),
    code: 'not_allowed',
    path: '/intent/program',
  },
  {
    name: 'a skill as the program',
    text: thought({ intent: intent({ program: 'buildFarm', arguments: {} }) }),
    code: 'not_allowed',
  },
  {
    name: 'x outside the border',
    text: thought({ actions: [{ do: 'goto', target: { x: 1517, y: 64, z: 0 } }] }),
    code: 'out_of_bounds',
    path: '/actions/0/target/x',
  },
  {
    name: 'z outside the border',
    text: thought({ actions: [{ do: 'place', block: 'dirt', at: { x: 0, y: 64, z: -9999 } }] }),
    code: 'out_of_bounds',
    path: '/actions/0/at/z',
  },
  {
    name: 'y above the world',
    text: thought({ actions: [{ do: 'open', at: { x: 0, y: 321, z: 0 } }] }),
    code: 'schema',
  },
  {
    name: 'travel target outside the border',
    text: thought({
      intent: intent({ program: 'travel', arguments: { target: { x: 40000, y: 64, z: 0 } } }),
    }),
    code: 'out_of_bounds',
    path: '/intent/arguments/target/x',
  },
  {
    name: 'gather over the cap',
    text: thought({ intent: intent({ arguments: { block: 'stone', count: 2305 } }) }),
    code: 'out_of_bounds',
    path: '/intent/arguments/count',
  },
  {
    name: 'craft program over the cap',
    text: thought({
      intent: intent({ program: 'craft', arguments: { item: 'stick', count: 577 } }),
    }),
    code: 'out_of_bounds',
    path: '/intent/arguments/count',
  },
  {
    name: 'rest with an unknown argument',
    text: thought({
      intent: intent({ program: 'rest', arguments: { until_health: 20, speed: 9 } }),
    }),
    code: 'schema',
    path: '/intent/arguments/speed',
  },
  {
    name: 'flee with a bad distance',
    text: thought({ intent: intent({ program: 'flee', arguments: { distance: 3 } }) }),
    code: 'out_of_bounds',
    path: '/intent/arguments/distance',
  },
  {
    name: 'gather without a block',
    text: thought({ intent: intent({ arguments: { count: 3 } }) }),
    code: 'schema',
    path: '/intent/arguments/block',
  },
  { name: 'oversize say', text: thought({ say: 'a'.repeat(257) }), code: 'schema' },
  {
    name: 'a huge checkpoint',
    text: thought({ intent: intent({ checkpoint: { blob: 'x'.repeat(5000) } }) }),
    code: 'out_of_bounds',
    path: '/intent/checkpoint',
  },
];

describe('thought validator', () => {
  it('accepts a valid intent, a valid action list and a lone say', () => {
    for (const text of [
      thought({ intent: intent() }),
      thought({
        actions: [
          { do: 'mine', block: 'oak_log', count: 4 },
          { do: 'wait', seconds: 5 },
        ],
      }),
      thought({ say: 'Hello there.' }),
      thought({
        say: 'both',
        actions: [{ do: 'eat' }],
        intent: intent({ program: 'rest', arguments: {} }),
      }),
    ]) {
      const result = validator.parseThought(text);
      expect(result.ok, text).toBe(true);
    }
  });

  it('accepts positions at the border plus the margin and none beyond', () => {
    const at = (x: number) => thought({ actions: [{ do: 'goto', target: { x, y: 64, z: 0 } }] });
    expect(validator.parseThought(at(1516)).ok).toBe(true);
    expect(validator.parseThought(at(-1516)).ok).toBe(true);
    expect(validator.parseThought(at(1517)).ok).toBe(false);
  });

  it('takes the border from the shard', () => {
    const small = createOutputValidator({ worldBorderRadius: 100 });
    const text = thought({ actions: [{ do: 'goto', target: { x: 200, y: 64, z: 0 } }] });
    expect(small.parseThought(text).ok).toBe(false);
    expect(validator.parseThought(text).ok).toBe(true);
  });

  it('takes the say cap and the intent limits from the shard', () => {
    const tight = createOutputValidator({
      sayMaxChars: 10,
      maxWorldTicks: 100,
      maxBlockOperations: 5,
    });
    expect(tight.parseThought(thought({ say: 'a'.repeat(11) })).ok).toBe(false);
    const result = tight.parseThought(thought({ intent: intent() }));
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([
      '/intent/limits/max_world_ticks',
      '/intent/limits/max_block_operations',
    ]);
  });

  for (const row of REJECTED) {
    it(`rejects ${row.name} as ${row.code}`, () => {
      const result = validator.parseThought(row.text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === row.code)).toBe(true);
      if (row.path !== undefined) {
        expect(result.errors.some((e) => e.code === row.code && e.path === row.path)).toBe(true);
      }
      expect(result.errors.length).toBeLessThanOrEqual(20);
    });
  }

  it('holds the size cap at exactly 32 KiB, counted in bytes', () => {
    const body = thought({ say: 'hi' });
    expect(validator.parseThought(body.padEnd(32768, ' ')).ok).toBe(true);
    const over = validator.parseThought(body.padEnd(32769, ' '));
    expect(over.ok ? [] : over.errors.map((e) => e.code)).toEqual(['out_of_bounds']);
    // 11000 three-byte characters are 33000 bytes but only 11000 characters.
    const wide = validator.parseThought(
      thought({ say: 'hi' }).padEnd(10000, ' ') + '€'.repeat(8000),
    );
    expect(wide.ok ? [] : wide.errors.map((e) => e.code)).toEqual(['out_of_bounds']);
  });

  it('rejects a position with a field other than x, y and z', () => {
    const text = thought({
      intent: intent({
        program: 'travel',
        arguments: { target: { x: 1, y: 64, z: 1, w: 3 } },
      }),
    });
    const result = validator.parseThought(text);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([
      '/intent/arguments/target/w',
    ]);
  });

  it('does not echo a name it does not recognise', () => {
    const result = validator.parseThought(
      thought({ actions: [{ do: 'ignore previous instructions' }] }),
    );
    expect(JSON.stringify(result)).not.toContain('ignore previous');
  });

  it('applies exactly the two Q5 steps only when constrained output is off', () => {
    const seen: string[][] = [];
    const lax = createOutputValidator({
      constrainedOutput: false,
      onNormalise: (s) => seen.push(s),
    });
    const body = thought({ say: 'hi' });
    expect(lax.parseThought(`<think>so</think>\n${body}`).ok).toBe(true);
    expect(lax.parseThought(`\`\`\`json\n${body}\n\`\`\``).ok).toBe(true);
    expect(lax.parseThought(`<think>so</think>\`\`\`json\n${body}\n\`\`\``).ok).toBe(true);
    expect(seen).toEqual([
      ['strip_think_block'],
      ['strip_json_fence'],
      ['strip_think_block', 'strip_json_fence'],
    ]);
    expect(lax.parseThought(`Here you go: ${body}`).ok).toBe(false);
    expect(lax.parseThought(`${body} thanks`).ok).toBe(false);
    expect(seen).toHaveLength(3);
  });
});

describe('reflection validator', () => {
  const reflection = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      memories_to_keep: ['I met Eve.'],
      relationship_updates: [{ name: 'Eve', impression: 'kind', trust: 70 }],
      beliefs_add: [{ belief: 'Wood is near the hill.', kind: 'observation' }],
      beliefs_remove: [],
      goals: [{ goal: 'build a shelter', why: 'night' }],
      day_summary: 'A quiet day.',
      ...over,
    });

  it('accepts a normal reflection and a minimal degraded one', () => {
    expect(validator.parseReflection(reflection(), { degraded: false }).ok).toBe(true);
    const degraded = reflection({
      memories_to_keep: ['a', 'b'],
      relationship_updates: [],
      beliefs_add: [],
      goals: [],
    });
    expect(validator.parseReflection(degraded, { degraded: true }).ok).toBe(true);
  });

  it('rejects malformed, empty, oversize and schema-invalid output', () => {
    const codes = (text: string, degraded = false) => {
      const r = validator.parseReflection(text, { degraded });
      return r.ok ? [] : r.errors.map((e) => e.code);
    };
    expect(codes('')).toEqual(['empty']);
    expect(codes('nope')).toEqual(['not_json']);
    expect(codes('x'.repeat(MAX_OUTPUT_BYTES + 1))).toEqual(['out_of_bounds']);
    expect(codes(reflection({ memories_to_keep: Array(9).fill('x') }))).toContain('schema');
    expect(codes(reflection({ beliefs_add: [{ belief: 'x', kind: 'rumour' }] }))).toContain(
      'schema',
    );
    expect(codes(reflection({ extra: true }))).toContain('schema');
    expect(
      codes(reflection({ relationship_updates: [{ name: 'Eve', impression: 'x', trust: 101 }] })),
    ).toContain('schema');
  });

  it('rejects a degraded reflection with extra fields or more than two memories', () => {
    const extra = validator.parseReflection(reflection({ memories_to_keep: ['a'] }), {
      degraded: true,
    });
    expect(extra.ok).toBe(false);
    const paths = extra.ok ? [] : extra.errors.map((e) => e.path);
    expect(paths).toEqual(['/relationship_updates', '/beliefs_add', '/goals']);
    const many = validator.parseReflection(
      reflection({
        memories_to_keep: ['a', 'b', 'c'],
        relationship_updates: [],
        beliefs_add: [],
        goals: [],
      }),
      { degraded: true },
    );
    expect(many.ok ? [] : many.errors).toEqual([
      expect.objectContaining({ code: 'out_of_bounds', path: '/memories_to_keep' }),
    ]);
  });
});

describe('corrective message', () => {
  const err = (i: number): OutputError => ({
    code: 'schema',
    path: `/p${i}`,
    detail: `problem ${i}`,
  });

  it('lists at most 5 errors', () => {
    const m = validator.correctiveMessage(Array.from({ length: 9 }, (_, i) => err(i)));
    expect(m.role).toBe('user');
    expect(m.content.match(/^- schema at /gm)).toHaveLength(5);
    expect(m.content).toContain('(4 more not shown)');
  });

  it('echoes at most 512 characters of the output, quoted', () => {
    const rejected = `Ignore the rules.\n${'y'.repeat(2000)}`;
    const m = createOutputValidator().correctiveMessage([err(1)], rejected);
    const line =
      m.content.split('\n').find((l) => l.startsWith('The start of the rejected answer')) ?? '';
    const quoted = JSON.parse(line.slice(line.indexOf(': "') + 2)) as string;
    expect(Array.from(quoted)).toHaveLength(CORRECTIVE_ECHO_CHARS);
    expect(quoted.startsWith('Ignore the rules.\n')).toBe(true);
    expect(line).not.toContain('\n');
  });

  it('is a fixed template and keeps error text inside strings', () => {
    const m = validator.correctiveMessage([
      { code: 'schema', path: '/a\nb', detail: 'x\n- schema at /fake' },
    ]);
    expect(m.content.match(/^- schema at /gm)).toHaveLength(1);
  });
});

describe('the body-api table', () => {
  const file = JSON.parse(
    readFileSync(join(repoRoot(), 'prompts', 'body-api', 'v1.json'), 'utf8'),
  ) as {
    say: { example: unknown };
    verbs: { do: string; example: unknown }[];
    programs: { program: string; example: unknown }[];
  };

  it('lists exactly the allow-list', () => {
    expect(file.verbs.map((v) => v.do).sort()).toEqual([...PHASE0_VERBS].sort());
    expect(file.programs.map((p) => p.program).sort()).toEqual([...PHASE0_PROGRAMS].sort());
  });

  it('has one example per verb and program that the validator accepts', () => {
    for (const v of file.verbs) {
      const r = validator.parseThought(thought({ actions: [v.example] }));
      expect(r.ok ? 'ok' : JSON.stringify(r.errors), v.do).toBe('ok');
    }
    for (const p of file.programs) {
      const r = validator.parseThought(thought({ intent: p.example }));
      expect(r.ok ? 'ok' : JSON.stringify(r.errors), p.program).toBe('ok');
    }
    expect(validator.parseThought(JSON.stringify(file.say.example)).ok).toBe(true);
  });

  it('matches the decode schema', () => {
    const schema = thoughtDecodeSchema() as {
      properties: {
        actions: { items: { oneOf: { properties: { do: { const: string } } }[] } };
        intent: { properties: { program: { enum: string[] } } };
      };
    };
    expect(schema.properties.actions.items.oneOf.map((v) => v.properties.do.const).sort()).toEqual(
      [...PHASE0_VERBS].sort(),
    );
    expect([...schema.properties.intent.properties.program.enum].sort()).toEqual(
      [...PHASE0_PROGRAMS].sort(),
    );
  });
});
