SC-61b: five corpus scenarios MB-01 to MB-05 added; corpus.json file names for MB-04 and MB-05 aligned to the card. Corpus cases pass (31 passed, 22 skipped for MB-06 to MB-09); revert check (MB-03 canary removed) failed its case and was restored; geldar check passed. Note: corpus.test.ts still looks for mb-04-exfiltrate-say.json in the fake-secret case, so that case stays skipped; it is outside this packet's files.

## Fix: corpus test takes file names from the index
The fake-secrets block now reads the MB-04 and MB-08 file names from corpus.json entries. Vitest: 32 passed, 21 skipped (MB-06..MB-09 cases and the MB-08 secret case only). MB-01..MB-05 run. Revert-check on the MB-04 secret failed as expected, then restored. geldar check passed.
