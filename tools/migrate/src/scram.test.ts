import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scramVerifier } from './scram.ts';

// RFC 7677, section 3: user "user", password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, 4096.
// The AuthMessage is client-first-bare, server-first and client-final-without-proof joined by ','.
const SALT = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
const AUTH_MESSAGE =
  'n=user,r=rOprNGfwEbeRWgbNEkqO,' +
  'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,' +
  'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

describe('scramVerifier', () => {
  // The RFC's published proof and server signature check the keys derived here.
  const salted = pbkdf2Sync('pencil', SALT, 4096, 32, 'sha256');
  const clientKey = hmac(salted, 'Client Key');
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = hmac(salted, 'Server Key');

  it('derives the keys the RFC 7677 exchange proves', () => {
    const signature = hmac(serverKey, AUTH_MESSAGE);
    expect(signature.toString('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    const storedSignature = hmac(storedKey, AUTH_MESSAGE);
    const proof = Buffer.from(clientKey.map((byte, i) => byte ^ (storedSignature[i] ?? 0)));
    expect(proof.toString('base64')).toBe('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
  });

  it('builds the Postgres verifier from the StoredKey and ServerKey', () => {
    expect(scramVerifier('pencil', SALT)).toBe(
      `SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$${storedKey.toString('base64')}:${serverKey.toString('base64')}`,
    );
  });

  it('draws a fresh 16-byte salt when none is given', () => {
    const first = scramVerifier('pencil');
    const second = scramVerifier('pencil');
    expect(first).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$/);
    expect(first).not.toBe(second);
  });

  it('refuses a password that is not printable ASCII', () => {
    expect(() => scramVerifier('pénce')).toThrow('printable ASCII');
  });
});
