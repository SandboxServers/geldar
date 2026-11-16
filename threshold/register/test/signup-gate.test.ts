import { describe, expect, it } from 'vitest';
import { APPROVED_TERMS_VERSIONS, termsApproved } from '../src/signup-gate.ts';

describe('termsApproved (C7-11 sign-up gate)', () => {
  it('accepts a terms version the owner has approved', () => {
    expect(termsApproved('v1', ['v1'])).toBe(true);
  });

  it('refuses a version not in the list, an empty list and an empty version (fail closed)', () => {
    expect(termsApproved('v2', ['v1'])).toBe(false);
    expect(termsApproved('v1', [])).toBe(false);
    expect(termsApproved('', [''])).toBe(false);
  });

  it('refuses a version that differs only by case or spacing', () => {
    expect(termsApproved('V1', ['v1'])).toBe(false);
    expect(termsApproved(' v1', ['v1'])).toBe(false);
  });

  it('ships with version 1 approved (decision 0155)', () => {
    expect(APPROVED_TERMS_VERSIONS).toContain('v1');
  });
});
