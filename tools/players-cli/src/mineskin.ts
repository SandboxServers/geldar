/** The signing service: it uploads a skin to Mojang's texture servers and returns a signed texture property. */
export const MINESKIN_ENDPOINT = 'https://api.mineskin.org/v2/generate/upload';

/** The only host a skin texture may point at (the Mojang texture domain). */
export const TEXTURE_HOST = 'textures.minecraft.net';

/** Size limits on what the signing service returns. Anything bigger is refused, not stored. */
export const MAX_VALUE_CHARS = 4096;
export const MAX_SIGNATURE_CHARS = 2048;
export const MAX_RESPONSE_BYTES = 64 * 1024;

const UPLOAD_TIMEOUT_MS = 30_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A signed texture property, as Velocity and Paper read it. */
export interface SignedTexture {
  value: string;
  signature: string;
  model: 'classic' | 'slim';
}

/** A refusal or failure with a fixed message. It never carries the API key, the request or the response body. */
export class SigningError extends Error {}

/** The fetch the tool calls; tests pass a fake, the CLI passes the global fetch. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface UploadOptions {
  png: Buffer;
  model: 'classic' | 'slim';
  apiKey: string;
  fetchFn?: FetchFn | undefined;
  endpoint?: string | undefined;
}

/**
 * Uploads a validated skin PNG to the signing service and returns the signed texture. Every part of the reply is
 * untrusted: its shape, its sizes, the base64 and the texture host are checked before the texture is returned.
 */
export async function uploadSkin(options: UploadOptions): Promise<SignedTexture> {
  const fetchFn = options.fetchFn ?? fetch;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(options.png)], { type: 'image/png' }), 'skin.png');
  form.append('variant', options.model);
  let response: Response;
  try {
    response = await fetchFn(options.endpoint ?? MINESKIN_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'User-Agent': 'geldar-players-cli' },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new SigningError('the signing service could not be reached');
  }
  if (!response.ok) {
    throw new SigningError(`the signing service refused the upload (HTTP ${response.status})`);
  }
  const reply = parseReply(await readLimited(response));
  return validateTexture(reply.value, reply.signature, options.model);
}

/** Reads a body up to {@link MAX_RESPONSE_BYTES}; a longer reply is refused before it is parsed. */
async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) {
    throw new SigningError('the signing service reply is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new SigningError('the signing service reply is too large');
  }
  return text;
}

/** Takes `data.texture.value` and `data.texture.signature` out of the reply; any other shape is refused. */
function parseReply(text: string): { value: string; signature: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SigningError('the signing service reply is not JSON');
  }
  const texture = (
    parsed as { data?: { texture?: { value?: unknown; signature?: unknown } } } | null
  )?.data?.texture;
  if (typeof texture?.value !== 'string' || typeof texture.signature !== 'string') {
    throw new SigningError('the signing service reply has no signed texture');
  }
  return { value: texture.value, signature: texture.signature };
}

/**
 * Checks a signed texture: base64 within the size limits, a decoded profile whose SKIN url is an http(s) URL on
 * the Mojang texture host. Returns the texture or throws {@link SigningError}.
 */
export function validateTexture(
  value: string,
  signature: string,
  model: 'classic' | 'slim',
): SignedTexture {
  if (value.length === 0 || value.length > MAX_VALUE_CHARS || !BASE64.test(value)) {
    throw new SigningError('the signed texture value is malformed');
  }
  if (signature.length === 0 || signature.length > MAX_SIGNATURE_CHARS || !BASE64.test(signature)) {
    throw new SigningError('the texture signature is malformed');
  }
  const url = skinUrl(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SigningError('the skin texture URL is not http or https');
  }
  if (url.hostname !== TEXTURE_HOST) {
    throw new SigningError('the skin texture is not hosted on the Mojang texture domain');
  }
  return { value, signature, model };
}

/** Decodes the texture value and returns the SKIN url inside it; anything else is refused. */
function skinUrl(value: string): URL {
  let profile: unknown;
  try {
    profile = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    throw new SigningError('the signed texture value does not decode');
  }
  const raw = (profile as { textures?: { SKIN?: { url?: unknown } } } | null)?.textures?.SKIN?.url;
  if (typeof raw !== 'string') {
    throw new SigningError('the signed texture has no skin URL');
  }
  try {
    return new URL(raw);
  } catch {
    throw new SigningError('the skin texture URL does not parse');
  }
}
