// CAP-2: unit tests for the pure parts of the scratch-shard capture (no server). The runbook test reads the run sheet
// and checks that its case names and the case table are the same set.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOT_A,
  BOT_B,
  CAPTURE_CASES,
  findCase,
  isLifeId,
  parseRunArgs,
  refuseShard,
  renderList,
  renderPlan,
  resolveCases,
} from './capture-cases.ts';

const RUNBOOK = new URL('../../../../docs/runbooks/capture-real-payloads.md', import.meta.url);
const CASE_KINDS = ['break', 'pickup', 'take', 'combat', 'combat_fact'];

describe('the case table', () => {
  it('names the fifteen cases once each, in the runbook order', () => {
    const ids = CAPTURE_CASES.map((c) => c.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
    expect(ids[0]).toBe('toss');
    expect(ids[14]).toBe('player-2x2');
  });

  it('gives every case a validator spec with a known kind and a count', () => {
    // A spec is one or more comma-separated `kind=N` parts (kill and survived also assert combat=1).
    for (const c of CAPTURE_CASES) {
      for (const part of c.expect.split(',')) {
        const [kind, count] = part.split('=');
        expect(CASE_KINDS, c.id).toContain(kind);
        expect(Number.isInteger(Number(count)) && Number(count) >= 0, c.id).toBe(true);
      }
    }
  });

  it('marks exactly the four send-nothing cases as take=0; furnace and brewing stand send a take', () => {
    const none = CAPTURE_CASES.filter((c) => c.expect === 'take=0').map((c) => c.id);
    expect(none).toEqual(['crafting-table', 'anvil', 'enchanting-table', 'player-2x2']);
    expect(findCase('furnace')?.expect).toBe('take=1');
    expect(findCase('brewing-stand')?.expect).toBe('take=1');
  });

  it('gives the break cases their CoreProtect state', () => {
    expect(findCase('break-coreprotect-absent')?.coreprotect).toBe('absent');
    expect(findCase('break-coreprotect-present')?.coreprotect).toBe('present');
  });
});

describe('life ids and the capture bots', () => {
  it('accepts the capture bot names and rejects the names the listeners ignore', () => {
    expect(isLifeId(BOT_A)).toBe(true);
    expect(isLifeId(BOT_B)).toBe(true);
    expect(isLifeId('GolemCombat')).toBe(false);
    expect(isLifeId('ag_capa_1')).toBe(false);
    expect(isLifeId('ag_CAPA_01')).toBe(false);
    expect(isLifeId('ag_capa_01x')).toBe(false);
  });
});

describe('the scratch-shard refusal', () => {
  it('allows phase0 without the flag', () => {
    expect(refuseShard('phase0', false)).toBeNull();
  });

  it('refuses any other shard without the flag, and allows it with the flag', () => {
    expect(refuseShard('phase1', false)).toContain('refused');
    expect(refuseShard('phase1', true)).toBeNull();
  });

  it('refuses colo and live names even with the flag', () => {
    expect(refuseShard('colo', true)).toContain('refused');
    expect(refuseShard('live-main', true)).toContain('refused');
  });
});

describe('argument parsing', () => {
  it('runs all cases with the defaults', () => {
    const args = parseRunArgs(['--case', 'all']);
    expect(args.mode).toBe('run');
    expect(args.cases).toHaveLength(15);
    expect(args.shard).toBe('phase0');
    expect(args.natsUrl).toBe('nats://127.0.0.1:4222');
    expect(args.out).toBe('.capture');
  });

  it('needs --case unless --list is given', () => {
    expect(() => parseRunArgs([])).toThrow('usage');
    expect(parseRunArgs(['--list']).mode).toBe('list');
  });

  it('turns --dry-run into the dry-run mode', () => {
    expect(parseRunArgs(['--case', 'kill', '--dry-run']).mode).toBe('dry-run');
  });

  it('rejects an unknown case, so a typo never runs a partial set', () => {
    expect(() => resolveCases('toss,nope')).toThrow('unknown case "nope"');
  });

  it('rejects an unknown flag', () => {
    expect(() => parseRunArgs(['--case', 'toss', '--bogus'])).toThrow();
  });
});

describe('the renderers connect to nothing', () => {
  it('lists every case', () => {
    const text = renderList();
    for (const c of CAPTURE_CASES) expect(text).toContain(`${c.id} |`);
  });

  it('prints the subjects, the bots, the READY wait and the ops privileges for the plan', () => {
    const plan = renderPlan(
      CAPTURE_CASES.filter((c) => c.id === 'break-coreprotect-present'),
      {
        shard: 'phase0',
        natsUrl: 'nats://127.0.0.1:4222',
        out: '.capture',
      },
    );
    expect(plan).toContain('geldar.phase0.provenance.>');
    expect(plan).toContain(BOT_A);
    expect(plan).toContain(BOT_B);
    expect(plan).toContain('WAIT for READY');
    expect(plan).toContain('RCON');
    expect(plan).toContain('needs CoreProtect present');
    expect(plan).toContain('NOT checked by the script');
    expect(plan).toContain('blockowner.query');
    expect(plan).toContain('30 s or more');
  });

  it('prints no CoreProtect precondition for a case that does not need it', () => {
    const plan = renderPlan(
      CAPTURE_CASES.filter((c) => c.id === 'chest-double'),
      { shard: 'phase0', natsUrl: 'nats://127.0.0.1:4222', out: '.capture' },
    );
    expect(plan).not.toContain('NOT checked by the script');
    expect(plan).not.toContain('blockowner.query');
  });

  it('describes the double chest as a two-chest case in the table', () => {
    expect(findCase('chest-double')?.summary).toContain('double chest');
  });
});

describe('the runbook run sheet and the case table', () => {
  it('name the same set of cases', () => {
    const text = readFileSync(RUNBOOK, 'utf8');
    const named = new Set(
      [...text.matchAll(/--case ([a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => n !== 'all'),
    );
    const table = new Set(CAPTURE_CASES.map((c) => c.id));
    expect([...named].sort()).toEqual([...table].sort());
  });
});
