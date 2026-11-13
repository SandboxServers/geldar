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
