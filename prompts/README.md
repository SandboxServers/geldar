# prompts

Versioned prompt templates for the Mind (`animus/`). The renderer is `animus/src/prompts/`; the output validators are `animus/src/validate/`.

```
prompts/
  thought/v1.md       the thought prompt (spec Appendix B.1): blocks 1 to 6
  reflection/v1.md    the sleep reflection prompt (Appendix B.2), with a degraded variant section
  body-api/v1.json    the Phase 0 allow-list of verbs and programs, one valid example each
```

## Rules

- **Immutable once used.** A template that has produced a thought is never edited. A change is a new file (`thought/v2.md`); the old one stays. The same holds for `body-api/vN.json`.
- **The version id** of a template is `<kind>@<n>+sha256:<12 hex>`, for example `thought@1+sha256:0123456789ab`: the number from the file name and the first 12 hex characters of the SHA-256 of the file's bytes. The library computes it when it loads the file and records it on every thought (`prompt_template_version`). An edit that forgets to bump the file name changes the hash, which shows up in the journal.
- **Slots** are `{{name}}`. The library refuses a template with a slot the renderer does not know, and a render that leaves a slot unfilled. Values are inserted once and never re-scanned, so a value cannot open another slot.
- **File layout.** `<<block N>>` on its own line starts block N. In `thought`, the system message is blocks 1 to 4 (the same for every thought of an agent; no times, no counts) and the user message is blocks 5 and 6. In `reflection`, the system message is blocks 1 and 2 and the user message is block 3. `<<variant degraded>>` starts the degraded section, used when the Mind is tired.
- **In-world text** (speech, signs, names, the overheard digest) never appears in a template or in the system message. It is rendered as JSON-escaped strings, one per line, inside the one section headed `QUOTED WORLD TEXT` at the end of the user message.
- **No model identity.** Templates never say what the agent runs on, and never describe the agent as a tool or a program.

## Degraded reflection

When the Mind is on the degraded path the reflection keeps all six fields (the contract requires them), but `memories_to_keep` holds at most 2 entries and `relationship_updates`, `beliefs_add`, `beliefs_remove` and `goals` must be empty lists. The validator rejects anything else.

## Running with these templates

The templates are read from this directory by the Mind (`animus/src/prompts/library.ts`) when it starts; there is nothing to build or serve. Start the Mind with `./geldar.ps1 adam up` (see [../animus/README.md](../animus/README.md)); its log is `.geldar/adam/animus.log`. Every thought the Mind records in the `thoughts` table carries the `prompt_template_version` (`<kind>@<n>+sha256:<12 hex>`) of the template it used, and the complete messages it sent in `model_input`, so a run can be checked against the files here. A template change is a new `vN` file and takes effect on the next `adam up`; the running Mind keeps the version it loaded.

What the run needs from this directory: `thought/v1.md`, `reflection/v1.md` and `body-api/v1.json` must exist and pass the library's slot check, or the Mind stops at start-up with the file name in the error. No port, no secret and no network access are involved.
