/**
 * Reads the model pins, the life table and the personality seed from a parsed shard file and
 * compares the pins with what Ollama has (decision 0051). Pure: no files, no network.
 */

/** The digest placeholder in `shards/phase0.yaml` until `adam models --record` runs. */
export const PLACEHOLDER_DIGEST = 'sha256:RECORD_AT_DISPATCH';
/** The personality-seed placeholder: the owner must approve a seed before the first run. */
export const SEED_PLACEHOLDER = 'DRAFT_PENDING_OWNER_APPROVAL';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** One pinned model: a chat model from `model_pins` or the embedding model. */
export interface Pin {
  tag: string;
  digest: string;
  kind: 'model' | 'embedding';
}

export type PinState = 'ok' | 'missing' | 'placeholder' | 'mismatch' | 'invalid';

/** One line of `adam models`. */
export interface PinRow {
  tag: string;
  kind: Pin['kind'];
  pinned: string;
  /** The digest Ollama reports, or null when the model is not installed. */
  found: string | null;
  state: PinState;
}

export type Tier = 'strong' | 'fast';

function map(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is missing or is not a map`);
  }
  return value as Record<string, unknown>;
}

function text(from: Record<string, unknown>, key: string, where: string): string {
  const value = from[key];
  if (typeof value !== 'string' || value === '') throw new Error(`${where}.${key} is missing`);
  return value;
}

/** Every pin of the shard file: the `model_pins` entries, then the embedding model. */
export function readPins(doc: unknown): Pin[] {
  const root = map(doc, 'shard file');
  const pins = map(root.model_pins, 'model_pins');
  const out: Pin[] = Object.keys(pins).map((tag) => ({
    tag,
    digest: text(map(pins[tag], `model_pins.${tag}`), 'digest', `model_pins.${tag}`),
    kind: 'model' as const,
  }));
  const embedding = map(root.embedding, 'embedding');
  out.push({
    tag: text(embedding, 'model', 'embedding'),
    digest: text(embedding, 'digest', 'embedding'),
    kind: 'embedding',
  });
  return out;
}

/** The model tags of one tier (`models.strong` or `models.fast`). */
export function readTierTags(doc: unknown, tier: Tier): string[] {
  const models = map(map(doc, 'shard file').models, 'models');
  const tags = models[tier];
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    throw new Error(`models.${tier} is missing or is not a list of tags`);
  }
  return tags as string[];
}

/** The life id of each tier, from `mind.lives`. */
export function readLives(doc: unknown): Record<Tier, string> {
  const mind = map(map(doc, 'shard file').mind, 'mind');
  const lives = map(mind.lives, 'mind.lives');
  return { strong: text(lives, 'strong', 'mind.lives'), fast: text(lives, 'fast', 'mind.lives') };
}

/** `mind.agent.personality_seed`. */
export function readSeed(doc: unknown): string {
  const agent = map(map(map(doc, 'shard file').mind, 'mind').agent, 'mind.agent');
  return text(agent, 'personality_seed', 'mind.agent');
}

/** The pin digest form of what Ollama reports: `/api/tags` gives bare hex, pins carry `sha256:`. */
export function normalizeDigest(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.startsWith('sha256:') ? lower : `sha256:${lower}`;
}

/** The installed models by name, as `/api/tags` lists them. */
export function installedFromTags(body: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) throw new Error('Ollama /api/tags answered without a models list');
  for (const entry of models as { name?: unknown; digest?: unknown }[]) {
    if (typeof entry.name === 'string' && typeof entry.digest === 'string') {
      out.set(entry.name, normalizeDigest(entry.digest));
    }
  }
  return out;
}

/** The digest of `tag`, trying `tag:latest` for a tag with no version. */
export function lookup(installed: Map<string, string>, tag: string): string | null {
  const direct = installed.get(tag);
  if (direct !== undefined) return direct;
  return tag.includes(':') ? null : (installed.get(`${tag}:latest`) ?? null);
}

/** Compares every pin with the installed models. */
export function compare(pins: Pin[], installed: Map<string, string>): PinRow[] {
  return pins.map((pin) => {
    const found = lookup(installed, pin.tag);
    let state: PinState;
    if (found === null) state = 'missing';
    else if (pin.digest === PLACEHOLDER_DIGEST) state = 'placeholder';
    else if (!DIGEST.test(pin.digest)) state = 'invalid';
    else state = pin.digest === found ? 'ok' : 'mismatch';
    return { tag: pin.tag, kind: pin.kind, pinned: pin.digest, found, state };
  });
}

/** What the owner must do about a row that is not ok; null for an ok row. */
export function remedy(row: PinRow): string | null {
  switch (row.state) {
    case 'ok':
      return null;
    case 'missing':
      return `'${row.tag}' is not in Ollama: run \`ollama pull ${row.tag}\``;
    case 'placeholder':
      return `'${row.tag}' still has the digest placeholder ${PLACEHOLDER_DIGEST}: run \`./geldar.ps1 adam models --record\`, review the change to shards/phase0.yaml and commit it`;
    case 'invalid':
      return `'${row.tag}' has a malformed pinned digest '${row.pinned}': it must be sha256: and 64 hex digits`;
    case 'mismatch':
      return `'${row.tag}' differs from its pin (pinned ${row.pinned}, Ollama has ${row.found}): pull the pinned build, or, if you accept this build, edit the digest in shards/phase0.yaml`;
  }
}

/**
 * The reasons `adam up` must refuse: the pins of the tier's models and of the embedding model
 * that are not ok, and a personality seed that is still the placeholder.
 */
export function preflightProblems(rows: PinRow[], tierTags: string[], seed: string): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    if (row.kind === 'model' && !tierTags.includes(row.tag)) continue;
    const message = remedy(row);
    if (message !== null) problems.push(message);
  }
  if (seed === SEED_PLACEHOLDER) {
    problems.push(
      `mind.agent.personality_seed is the placeholder ${SEED_PLACEHOLDER}: the owner must approve a seed and write it into shards/phase0.yaml (decision 0051 item 2)`,
    );
  }
  return problems;
}
