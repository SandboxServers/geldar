import type { OutputError } from '@geldar/player-core/src/ports/index.ts';
import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { DETAIL_MAX_CHARS, refusalOf, whereOf } from './refusal-detail.ts';

const error = (code: OutputError['code'], path: string, detail: string): OutputError => ({
  code,
  path,
  detail,
});

describe('whereOf', () => {
  it('names the place of each path in words', () => {
    expect(whereOf('')).toBe('the thought');
    expect(whereOf('/say')).toBe('say');
    expect(whereOf('/actions')).toBe('the action list');
    expect(whereOf('/actions/2')).toBe('action 2');
    expect(whereOf('/actions/2/target')).toBe('action 2.target');
    expect(whereOf('/intent/arguments/target/y')).toBe('intent.arguments.target.y');
  });
});

describe('refusalOf', () => {
  it('says which field is missing from an action', () => {
    expect(refusalOf(error('schema', '/actions/2', "must have required property 'block'"))).toEqual(
      { reason: 'schema', detail: 'action 2: block is missing' },
    );
  });

  it('says which key an action has that is not known, and shows a marker-word key as (name)', () => {
    expect(
      refusalOf(error('schema', '/actions/0', "must NOT have additional properties 'extra'"))
        .detail,
    ).toBe("action 0: 'extra' is not a known field");
    expect(
      refusalOf(error('schema', '/actions/0', "must NOT have additional property 'watcher'"))
        .detail,
    ).toBe("action 0: '(name)' is not a known field");
  });

  it('keeps the bounds and type messages, which hold constants only', () => {
    expect(
      refusalOf(error('schema', '/intent/arguments/target/y', 'must be an integer')).detail,
    ).toBe('intent.arguments.target.y: must be an integer');
    expect(refusalOf(error('out_of_bounds', '/say', 'must be at most 256 characters')).detail).toBe(
      'say: must be at most 256 characters',
    );
  });

  it('says a verb is not available without echoing it', () => {
    const refused = refusalOf(
      error('not_allowed', '/actions/1/do', 'the action fly is not available'),
    );
    expect(refused).toEqual({
      reason: 'not_allowed',
      detail: 'action 1.do: is not available in this phase',
    });
    expect(refused.detail).not.toContain('fly');
  });

  it('says the verb list is expected when the verb is not one of them', () => {
    const refused = refusalOf(error('schema', '/actions/0/do', 'valid verbs: goto, mine, eat'));
    expect(refused.detail).toBe('action 0.do: must be one of the listed verbs');
  });

  it('keeps every detail within the length cap and free of marker words', () => {
    const long = refusalOf(
      error(
        'schema',
        `/${'a'.repeat(40)}/${'b'.repeat(40)}/${'c'.repeat(40)}`,
        'must be an integer',
      ),
    );
    expect(long.detail?.length).toBeLessThanOrEqual(DETAIL_MAX_CHARS);
    for (const detail of [
      long.detail,
      refusalOf(error('schema', '/actions/0', "must NOT have additional properties 'harness'"))
        .detail,
      refusalOf(error('schema', '/intent', "must have required property 'observer'")).detail,
    ]) {
      expect(markedWords(detail ?? '')).toEqual([]);
    }
  });
});
