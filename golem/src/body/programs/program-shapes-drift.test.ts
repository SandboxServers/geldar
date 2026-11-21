// The arguments the Body's programs take (contract/schemas/program-shapes.schema.json, AN-44) and the bounds the validators
// check (PROGRAM_ARGS in player-core) are written twice. This test keeps them equal, so a changed bound cannot reach one
// side only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROGRAM_ARGS } from '../../../../player-core/src/validate/bounds.ts';
import { repoRoot } from '../../config.ts';

interface Prop {
  type?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}
interface Def {
  properties: Record<string, Prop>;
  required?: string[];
}
const defs = (
  JSON.parse(
    readFileSync(join(repoRoot(), 'contract', 'schemas', 'program-shapes.schema.json'), 'utf8'),
  ) as { $defs: Record<string, Def> }
).$defs;

const PROGRAMS = { explore: 'ExploreArguments', farm: 'FarmArguments', patrol: 'PatrolArguments' };

describe('program argument shapes: the schema and PROGRAM_ARGS agree', () => {
  for (const [program, defName] of Object.entries(PROGRAMS)) {
    const def = defs[defName] as Def;
    const rules = PROGRAM_ARGS[program] ?? {};
    const keys = Object.keys(def.properties).filter((k) => k !== 'program');

    it(`${program}: the same argument names`, () => {
      expect([...keys].sort()).toEqual(Object.keys(rules).sort());
    });

    it(`${program}: the same bounds, kinds and required flags`, () => {
      for (const key of keys) {
        const prop = def.properties[key] as Prop;
        const rule = rules[key] as (typeof rules)[string];
        expect(rule.required, `${key} required`).toBe(def.required?.includes(key) ?? false);
        if (rule.kind === 'int') {
          expect(prop.type, key).toBe('integer');
          expect(prop.minimum, `${key} minimum`).toBe(rule.min);
          expect(prop.maximum, `${key} maximum`).toBe(rule.max);
        } else if (rule.kind === 'bool') {
          expect(prop.type, key).toBe('boolean');
        } else if (rule.kind === 'route') {
          expect(prop.type, key).toBe('array');
          expect(prop.minItems, `${key} minItems`).toBe(rule.min);
          expect(prop.maxItems, `${key} maxItems`).toBe(rule.max);
        } else {
          throw new Error(`${program}.${key}: kind ${rule.kind} has no schema counterpart here`);
        }
      }
    });
  }
});
