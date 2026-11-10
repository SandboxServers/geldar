import { describe, expect, it } from 'vitest';
import { classifyShardEdit } from './shard-edit.ts';

const COMMITTED = `# the shard file
mind:
  run_tier: strong               # models.* tier for this run
  agent:
    username: ag_adam_01
    tier: strong
  lives: { strong: ag_adam_01, fast: ag_adam_02 }
model_pins:
  qwen3:32b:
    digest: sha256:aaa
`;

/** The text `adam-cli select --model fast` writes: the three select keys, nothing else. */
const SELECTED = COMMITTED.replace('run_tier: strong ', 'run_tier: fast   ')
  .replace('username: ag_adam_01', 'username: ag_adam_02')
  .replace('    tier: strong', '    tier: fast');

describe('classifyShardEdit', () => {
  it('reports no edit when the working copy equals the committed copy', () => {
    expect(classifyShardEdit(COMMITTED, COMMITTED)).toEqual({ kind: 'none' });
  });

  it('accepts the three keys the tier select writes, with their values', () => {
    const edit = classifyShardEdit(COMMITTED, SELECTED);
    expect(edit).toEqual({
      kind: 'select',
      changes: [
        { key: 'mind.agent.tier', from: '"strong"', to: '"fast"' },
        { key: 'mind.agent.username', from: '"ag_adam_01"', to: '"ag_adam_02"' },
        { key: 'mind.run_tier', from: '"strong"', to: '"fast"' },
      ],
    });
  });

  it('refuses a change to a pinned digest, even alongside a select', () => {
    const edit = classifyShardEdit(COMMITTED, SELECTED.replace('sha256:aaa', 'sha256:bbb'));
    expect(edit).toMatchObject({ kind: 'refused', keys: ['model_pins.qwen3:32b.digest'] });
  });

  it('refuses a changed life table', () => {
    const edit = classifyShardEdit(
      COMMITTED,
      SELECTED.replace('fast: ag_adam_02', 'fast: ag_adam_03'),
    );
    expect(edit).toMatchObject({ kind: 'refused', keys: ['mind.lives.fast'] });
  });

  it('refuses a run_tier edit that select would not have written (no matching username)', () => {
    const edit = classifyShardEdit(
      COMMITTED,
      COMMITTED.replace('run_tier: strong ', 'run_tier: fast   '),
    );
    expect(edit).toMatchObject({ kind: 'refused', keys: ['mind.run_tier'] });
  });

  it('refuses a comment or layout change that moves no key', () => {
    const edit = classifyShardEdit(COMMITTED, `${COMMITTED}# an extra note\n`);
    expect(edit).toEqual({ kind: 'refused', keys: [], reason: 'only comments or layout differ' });
  });
});
