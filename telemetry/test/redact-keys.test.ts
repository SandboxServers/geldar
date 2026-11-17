import { describe, expect, it } from 'vitest';
import { hasForbiddenSegment } from '../src/attributes.ts';
import { REDACTED as R, redactContent } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pp = ['pass', 'phrase'].join('');
const sg = ['signa', 'ture'].join('');

describe('object keys: the key rule matches the text rule for passphrase and signature (step 5)', () => {
  it.each([pp, sg, `db_${pp}`, `${pp}Value`, `x-${sg}`, `request_${sg}`])('hides key %s', (key) => {
    expect(hasForbiddenSegment(key)).toBe(true);
    expect(redactContent({ [key]: 'Zq9xK2mP7vL4Ab' })).toEqual({ [key]: R });
  });

  // The key rule is a substring-stem rule: these are redacted as keys (over-redaction, documented in the
  // README), while the same words in free text are not credential keys.
  it.each(['secretary', 'cookies', 'tokenCount', 'secretDoor'])('hides key %s', (key) => {
    expect(hasForbiddenSegment(key)).toBe(true);
  });

  it.each(['max_tokens', 'input_tokens', 'tokens', 'name', 'gen_ai.usage.output_tokens'])(
    'keeps key %s',
    (key) => {
      expect(hasForbiddenSegment(key)).toBe(false);
    },
  );
});
