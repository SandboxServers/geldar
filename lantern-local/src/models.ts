import type { ModelPin } from './config.ts';

/** A model the Thinker will advertise: a pin whose digest matches what Ollama holds. */
export type AdvertisedModel = ModelPin;

export interface ModelSelection {
  advertised: AdvertisedModel[];
  /** One line per pinned model that is not advertised, with the reason (digests only, no text). */
  rejected: string[];
}

interface TagsResponse {
  models?: { name?: string; model?: string; digest?: string }[];
}

/** Ollama reports a bare hex digest; the pins carry the `sha256:` prefix. */
function bare(digest: string): string {
  return digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
}

/**
 * Pure part of the start-up check: keeps a pin only if Ollama lists the tag with the same digest.
 * A missing tag or a different digest means the model is not advertised (decision 0051).
 */
export function selectModels(pins: ModelPin[], tags: TagsResponse): ModelSelection {
  const held = new Map<string, string>();
  for (const entry of tags.models ?? []) {
    const name = entry.name ?? entry.model;
    if (name !== undefined && entry.digest !== undefined) held.set(name, entry.digest);
  }
  const advertised: AdvertisedModel[] = [];
  const rejected: string[] = [];
  for (const pin of pins) {
    const actual = held.get(pin.name);
    if (actual === undefined) {
      rejected.push(`${pin.name}: not present in Ollama`);
    } else if (bare(actual) !== bare(pin.digest)) {
      rejected.push(`${pin.name}: digest ${bare(actual)} differs from the pin ${bare(pin.digest)}`);
    } else {
      advertised.push(pin);
    }
  }
  return { advertised, rejected };
}

/** Asks Ollama `/api/tags` and applies {@link selectModels}. Throws if Ollama cannot be reached. */
export async function discoverModels(
  ollamaUrl: string,
  pins: ModelPin[],
  signal?: AbortSignal,
): Promise<ModelSelection> {
  const res = await fetch(new URL('/api/tags', ollamaUrl), signal ? { signal } : {});
  if (!res.ok) throw new Error(`Ollama /api/tags answered ${res.status}`);
  return selectModels(pins, (await res.json()) as TagsResponse);
}
