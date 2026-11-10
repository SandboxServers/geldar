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

/** A V2 reply, shaped as docs.mineskin.org's V2 Changes page shows it (fields the tool does not read are trimmed). */
function reply(value: string, signature = SIGNATURE): string {
  return JSON.stringify({
    success: true,
    skin: {
      uuid: '9c7b6f5f285c4c5b9b1ca4be73fa857b',
      visibility: 'public',
      variant: 'slim',
      texture: { data: { value, signature }, url: { skin: GOOD_URL } },
    },
    rateLimit: { limit: { limit: 20, remaining: 19 } },
    warnings: [],
    messages: [],
  });
}

describe('uploadSkin', () => {
  it('returns the signed texture from a well-formed reply, with the key only in the request header', async () => {
    const { fetchFn, calls } = fakeFetch(200, reply(textureValue(GOOD_URL)));
    const texture = await uploadSkin({ png: PNG, model: 'slim', apiKey: KEY, fetchFn });
    expect(texture).toEqual({ value: textureValue(GOOD_URL), signature: SIGNATURE, model: 'slim' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.init.headers)).toContain(KEY);
    expect(calls[0]?.url).toBe('https://api.mineskin.org/v2/generate');
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
      JSON.stringify({
        id: 'x',
        data: { texture: { value: textureValue(GOOD_URL), signature: SIGNATURE } },
      }),
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

  it('sends the request with redirect set to error, so no redirect is followed', async () => {
    const { fetchFn, calls } = fakeFetch(200, reply(textureValue(GOOD_URL)));
    await uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn });
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('stops reading a reply with no content-length once it passes the byte cap', async () => {
    let pulls = 0;
    const chunk = new Uint8Array(16 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 100) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const fetchFn: FetchFn = async () => new Response(body, { status: 200 });
    await expect(
      uploadSkin({ png: PNG, model: 'classic', apiKey: KEY, fetchFn }),
    ).rejects.toThrow('too large');
    expect(pulls).toBeLessThan(10);
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
