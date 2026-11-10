import { describe, expect, it } from 'vitest';
import { type FetchFn, MAX_RESPONSE_BYTES, SigningError, uploadSkin } from './mineskin.ts';

const KEY = `msk_${'Q'.repeat(24)}`;
const PNG = Buffer.from('fake-png-bytes');

/** Base64 of a profile whose SKIN url is `url`, as Mojang's texture property carries it. */
function textureValue(url: string): string {
  return Buffer.from(JSON.stringify({ textures: { SKIN: { url } } })).toString('base64');
}

const GOOD_URL = 'http://textures.minecraft.net/texture/0123abcd';
const SIGNATURE = Buffer.from('signed-by-mojang').toString('base64');

/** A fake fetch that answers with the given status and body, and records the request it was sent. */
function fakeFetch(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status, headers });
  };
  return { fetchFn, calls };
}

function reply(value: string, signature = SIGNATURE): string {
  return JSON.stringify({ id: 'x', data: { texture: { value, signature } } });
}

describe('uploadSkin', () => {
  it('returns the signed texture from a well-formed reply, with the key only in the request header', async () => {
    const { fetchFn, calls } = fakeFetch(200, reply(textureValue(GOOD_URL)));
    const texture = await uploadSkin({ png: PNG, model: 'slim', apiKey: KEY, fetchFn });
    expect(texture).toEqual({ value: textureValue(GOOD_URL), signature: SIGNATURE, model: 'slim' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.init.headers)).toContain(KEY);
    expect(calls[0]?.url).toBe('https://api.mineskin.org/v2/generate/upload');
  });

  it('refuses a texture hosted anywhere but the Mojang texture domain', async () => {
    for (const url of [
      'https://evil.example/texture/x',
      'http://textures.minecraft.net.evil.example/x',
    ]) {
      const { fetchFn } = fakeFetch(200, reply(textureValue(url)));
      await expect(
        uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn }),
      ).rejects.toThrow('Mojang texture domain');
    }
  });

  it('refuses a reply without a signed texture, a non-JSON reply, and a malformed value', async () => {
    const cases = [
      '{"data":{}}',
      'not json',
      reply('not base64 !!'),
      reply(textureValue(GOOD_URL), 'x'.repeat(3000)),
      reply(Buffer.from('{"nope":1}').toString('base64')),
    ];
    for (const body of cases) {
      const { fetchFn } = fakeFetch(200, body);
      await expect(
        uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn }),
      ).rejects.toBeInstanceOf(SigningError);
    }
  });

  it('refuses an oversized reply before parsing it', async () => {
    const { fetchFn } = fakeFetch(200, 'x'.repeat(MAX_RESPONSE_BYTES + 1));
    await expect(uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn })).rejects.toThrow(
      'too large',
    );
  });

  it('reports a refusal by status only: the key and the body never appear in the message', async () => {
    const { fetchFn } = fakeFetch(401, `bad key ${KEY}`);
    const error = await uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SigningError);
    expect((error as Error).message).toBe('the signing service refused the upload (HTTP 401)');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('reports an unreachable service with a fixed message', async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error(`connect failed for ${KEY}`);
    };
    const error = await uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn }).catch(
      (e: unknown) => e,
    );
    expect((error as Error).message).toBe('the signing service could not be reached');
  });
});
