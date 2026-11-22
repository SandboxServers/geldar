# Third-party notices

## Mindcraft

`golem/src/actions/pickup.ts` follows the behaviour of Mindcraft's `pickupNearbyItems` and its
`item_collecting` mode. `golem/src/actions/craft-spare.ts` adapts the approach of Mindcraft's
`craftRecipe` skill (`src/agent/library/skills.js`): placing a carried crafting table beside the bot,
crafting with it and picking it back up, and crafting what the materials allow for a partial count.
The code is written for Geldar; no Mindcraft source is copied. Mindcraft is licensed under the MIT
License:

MIT License

Copyright (c) 2024 Kolby Nottingham

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Instrument Serif and DM Mono (typefaces)

The Thought Stream page (`glass/public/`) sets its title and thought text in Instrument Serif and
everything else in DM Mono. The font files under `glass/public/fonts/` are served from the Glass
origin; nothing is loaded from a font service. They are unmodified WOFF2 files (the Latin and Latin
Extended subsets) taken from the npm packages `@fontsource/instrument-serif` 5.3.0 and
`@fontsource/dm-mono` 5.3.0 (both published 2026-07-19), which repackage the Google Fonts releases.
The packages are not dependencies of this repository: only the font files and their licence texts
are copied.

- Instrument Serif: Copyright 2022 The Instrument Serif Project Authors
  (https://github.com/Instrument/instrument-serif). Files: `instrument-serif-latin-400-normal.woff2`,
  `instrument-serif-latin-400-italic.woff2`, `instrument-serif-latin-ext-400-normal.woff2`,
  `instrument-serif-latin-ext-400-italic.woff2`. Licence text: `glass/public/fonts/OFL-instrument-serif.txt`.
- DM Mono: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono).
  Files: `dm-mono-latin-400-normal.woff2`, `dm-mono-latin-500-normal.woff2`,
  `dm-mono-latin-ext-400-normal.woff2`, `dm-mono-latin-ext-500-normal.woff2`. Licence text:
  `glass/public/fonts/OFL-dm-mono.txt`.

Both are licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org). The
licence lets the fonts be used, embedded and redistributed with software, provided the copyright
notice and the licence travel with them and the fonts are not sold by themselves. The two licence
files above carry the full text.

SHA-256 of the files, as copied:

```
e1896b13b2b1bb112fac2f9571bd6c40e118746e77a4511edbf43fbb41bf3e1e  dm-mono-latin-400-normal.woff2
9964608a849396bd00c4bfd7034afe03486469dcf20b4f6b8cbdfdd310369951  dm-mono-latin-500-normal.woff2
a52e19ebe0398c9c0f8fa28a0c5e9a6bc324f35d9f0881c9aa407d10af447175  dm-mono-latin-ext-400-normal.woff2
8711f938c3f04f91e35ae64ebc7f2eecd800d2ae1c3542f6c837c758a50422f5  dm-mono-latin-ext-500-normal.woff2
5a51946dfffa82972bc98745359c46761515641fda557c25116459a9f83da4a7  instrument-serif-latin-400-italic.woff2
5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31  instrument-serif-latin-400-normal.woff2
d0014821252a8a770bf7551641572f239a8ede83d75652d84fef0c3627751baf  instrument-serif-latin-ext-400-italic.woff2
290e6267dd833bf5f899eba4c29ad0a9b09dbe53f6075b18af38057159e1ff20  instrument-serif-latin-ext-400-normal.woff2
```
