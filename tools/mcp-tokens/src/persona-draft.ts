/**
 * The owner-approved ranger persona drafts (docs/analysis/phase0/worknotes/ranger-personas-draft.md):
 * one `## <Name>: <title>` block per ranger, with Identity, Quirk and Goals bullets. The identity
 * file takes the Identity, then the Quirk under its own heading (the character's own traits, which
 * `player add` stores as part of the identity); the goals file takes the Goals.
 */

/** One ranger's approved text, as the draft gives it. */
export interface Persona {
  name: string;
  identity: string;
  quirk: string;
  goals: string;
}

/** The two files a launcher reads for a persona, as text. */
export interface PersonaFiles {
  identity: string;
  goals: string;
}

interface Block {
  heading: string;
  fields: Map<string, string>;
}

const HEADING = /^## (.+)$/;
const FIELD = /^- \*\*(Identity|Quirk|Goals):\*\* (.+)$/;
const LIFE_ID = /^ag_([a-z]+)_\d+$/;

/** The blocks of a draft, in order, each with the bullets under its heading. */
function blocksOf(draft: string): Block[] {
  const blocks: Block[] = [];
  for (const line of draft.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({ heading: heading[1] ?? '', fields: new Map() });
      continue;
    }
    const field = FIELD.exec(line);
    const current = blocks.at(-1);
    if (field !== null && current !== undefined) {
      current.fields.set(field[1] ?? '', (field[2] ?? '').trim());
    }
  }
  return blocks;
}

/** The names a heading answers to: `jason` from `Jason: the Red Ranger`, and `red ranger`. */
function namesOf(heading: string): string[] {
  const [name = '', ...rest] = heading.split(':');
  const title = rest
    .join(':')
    .trim()
    .replace(/^the\s+/i, '');
  return [name.trim().toLowerCase(), title.toLowerCase()];
}

/**
 * The persona a query names in the draft. The query is a character name (`jason`, `Red Ranger`) or
 * a life id (`ag_jason_01`). Refuses an unknown or ambiguous name, and a block missing a field.
 */
export function findPersona(draft: string, query: string): Persona {
  const wanted = query.trim().toLowerCase();
  const key = LIFE_ID.exec(wanted)?.[1] ?? wanted;
  const found = blocksOf(draft.replace(/\r\n/g, '\n')).filter((block) =>
    namesOf(block.heading).includes(key),
  );
  const [block] = found;
  if (block === undefined) throw new Error(`no persona named ${query} in the draft`);
  if (found.length > 1) throw new Error(`${query} matches more than one persona in the draft`);
  const need = (field: string): string => {
    const value = block.fields.get(field);
    if (value === undefined || value === '') {
      throw new Error(`the ${block.heading} block has no ${field.toLowerCase()}`);
    }
    return value;
  };
  return {
    name: block.heading.split(':')[0]?.trim() ?? block.heading,
    identity: need('Identity'),
    quirk: need('Quirk'),
    goals: need('Goals'),
  };
}

/** The identity file (Identity, then Quirk under its heading) and the goals file, each ending in LF. */
export function personaFiles(persona: Persona): PersonaFiles {
  return {
    identity: `${persona.identity}\n\n## Quirk\n\n${persona.quirk}\n`,
    goals: `${persona.goals}\n`,
  };
}
