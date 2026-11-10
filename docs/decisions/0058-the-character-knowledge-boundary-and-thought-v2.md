# 0058. The character knowledge boundary, and thought prompt v2

- Status: Accepted (owner, 2026-11-09)
- Date: 2026-11-09
- Spec: principle 1; Appendix B.1 (thought prompt) and Appendix D (template versioning); decision 0048
- Numbers 0053 to 0057 are reserved for Wave M.

## Decision

1. Characters honour the in-world knowledge of the character, not the model's training data about the game. Adam and the rangers know what they have seen, tried, or been told by people in the world. They do not know recipes, maps, coordinates, secrets or numbers from outside it, until they find them out.
2. The boundary is enforced in two parts:
   - Structurally: recipes are discovered, not granted (decision 0048). A locked recipe stays locked until its ingredients are acquired, so the Body cannot craft from knowledge the character lacks.
   - By the prompt: thought prompt `thought/v2.md` carries three rules in block 1 (the system text): the knowledge rule ("You know only what you have seen, tried, or been told by people here..."), the sleep rule (at night, find a bed and sleep in it, the routine named sleep; a night without sleep makes you tired and your thoughts shorter, matching the body API sleep summary) and the anti-loop rule (with no current intent, choose one; do not repeat something already said).
3. `thought/v2.md` is the default for new thoughts. `thought/v1.md` is unchanged and stays loadable (`createPromptLibrary({ thoughtVersion: 1 })`). Reflection and body-api stay at v1. A thought records `thought@2+sha256:<12 hex>`.
4. Leakage is a measured rate, not an assumed zero. The wave 6 exit runs scan the thoughts for meta-knowledge markers, such as "Y level", "crafting recipe", "F3", "wiki" and "the game". The rate is reported in the exit record, and a rate above zero is a finding to fix in the prompt or the world, not a reason to relax the boundary.
5. The same rule text goes to the Scriptorium for the rangers' kit prompt, so the rangers and Adam share one boundary.

## Why

- The character is the player. A model that knows the game's wiki would have Adam craft and navigate from knowledge Adam has never gained, and the benchmark would measure the model's memory rather than the character's learning.
- Structural enforcement covers the recipes that the server controls. The prompt rule covers what the server cannot control: the model's general knowledge of the world that leaks into reasoning.
- The anti-loop rule stops a character from repeating a greeting instead of acting on its own goals.

## Consequences

- Template changes are new `vN` files (`prompts/README.md`). v2 is a copy of v1 with the three rules added; the library's tests check v1's SHA-256 pin, the v2 version id, that v1 still loads, and that the rules render in block 1.
- The Scriptorium's rangers kit prompt receives the same rule text; the Scriptorium change is a separate packet.
- The wave 6 exit runs report the meta-knowledge leakage rate.
- Writing `thought@2` into the journal changes `prompt_template_version` for new thoughts; old thoughts keep `thought@1`.
