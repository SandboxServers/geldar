import { describe, expect, it } from 'vitest';
import { validateThought, validateToolInput } from '../src/index.ts';

describe('mcp world tools: no drift from the Action schema', () => {
  const longText = 'x'.repeat(8192);
  const cases: Record<string, unknown[]> = {
    write_book: [
      { title: 'T', text: 'hello' },
      { title: 'T', skill_id: 'sk_1' },
      { title: 'x'.repeat(32), text: longText },
      { title: 'x'.repeat(33), text: 'a' },
      { title: 'T', text: `${longText}x` },
      { title: 'T', skill_id: 'x'.repeat(65) },
      { title: 'T', skill_id: 'sk_1', text: 'a' },
      { title: 'T' },
    ],
    define_skill: [
      { name: 'harvest', description: 'd', code: 'c' },
      { name: 'a', description: 'x'.repeat(256), code: longText },
      { name: 'a1_B', description: '', code: '' },
      { name: 'Bad', description: 'd', code: 'c' },
      { name: 'harvest', description: 'x'.repeat(257), code: 'c' },
      { name: 'harvest', description: 'd', code: `${longText}x` },
    ],
    use_skill: [
      { name: 'harvest', args: {} },
      { name: 'harvest', args: { a: [1, 2], b: null } },
      { name: 'x'.repeat(64), args: {} },
      { name: 'harvest' },
      { name: '1abc', args: {} },
      { name: 'harvest', args: 'north' },
    ],
    offer: [
      { item: 'wheat', count: 1 },
      { item: 'wheat', count: 64 },
      { item: 'oak_log', count: 10 },
      { item: 'wheat', count: 0 },
      { item: 'wheat', count: 65 },
      { item: 'Wheat', count: 5 },
    ],
    propose: [
      { rule: 'r', value: { a: 1 }, reason: '' },
      { rule: 'r', value: null, reason: 'why' },
      { rule: 'r', value: 'v', reason: 'x'.repeat(256) },
      { rule: '', value: 1, reason: 'why' },
      { rule: 'r', value: 1 },
      { rule: 'r', value: 1, reason: 'x'.repeat(257) },
    ],
    vote: [
      { proposal_id: 'pr_1', vote: 'yes' },
      { proposal_id: 'pr_abc', vote: 'no' },
      { proposal_id: 'pr_', vote: 'yes' },
      { proposal_id: 'p1', vote: 'yes' },
      { proposal_id: 'pr_1', vote: 'maybe' },
      { proposal_id: 'pr_1' },
    ],
  };

  for (const [tool, argsList] of Object.entries(cases)) {
    it(`${tool}: the tool and the Action agree on ${argsList.length} argument objects`, () => {
      for (const args of argsList) {
        const asTool = validateToolInput(tool, args).ok;
        const asAction = validateThought({
          reasoning: 'x',
          actions: [{ do: tool, ...(args as object) }],
        }).ok;
        expect(asTool, JSON.stringify(args)).toBe(asAction);
      }
    });
  }
});
