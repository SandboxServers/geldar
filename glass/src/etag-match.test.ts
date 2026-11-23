import { describe, expect, it } from 'vitest';
import { etagMatches } from './static-files.ts';

/** The If-None-Match check of a static file (decision 0410, RFC 9110 13.1.2): weak and list forms match too. */
const ETAG = '"abcDEF123_-xyz"';

describe('etagMatches', () => {
  it('matches the same strong tag', () => {
    expect(etagMatches(ETAG, ETAG)).toBe(true);
  });

  it('matches a weak tag (W/ prefix) with the strong tag of the file', () => {
    expect(etagMatches(`W/${ETAG}`, ETAG)).toBe(true);
  });

  it('matches when the tag is one entry of a comma list, first, middle or last', () => {
    expect(etagMatches(`${ETAG}, "other"`, ETAG)).toBe(true);
    expect(etagMatches(`"a", ${ETAG}, "b"`, ETAG)).toBe(true);
    expect(etagMatches(`"a",W/${ETAG}`, ETAG)).toBe(true);
  });

  it('matches * (any current representation)', () => {
    expect(etagMatches('*', ETAG)).toBe(true);
    expect(etagMatches(' * ', ETAG)).toBe(true);
  });

  it('does not match another tag, a list without it, or no header', () => {
    expect(etagMatches('"other"', ETAG)).toBe(false);
    expect(etagMatches(`W/"other", "more"`, ETAG)).toBe(false);
    expect(etagMatches('', ETAG)).toBe(false);
    expect(etagMatches(undefined, ETAG)).toBe(false);
  });

  it('does not match a tag that only contains the file tag as a substring', () => {
    expect(etagMatches(`"x${ETAG}"`, ETAG)).toBe(false);
  });
});
