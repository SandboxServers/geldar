# SC-61d progress

- Added threshold/mcp-mock/src/corpus/world.test.ts (16 cases: nine per-entry world cases, five speech cases, file-existence case, dockerignore case) and one README paragraph.
- Corpus folder: 69 passed, 0 skipped (corpus.test.ts per-entry cases all run).
- Revert checks done and restored: book text in a top-level field (9 per-entry cases fail); speech text in event text (speech cases fail); scenarios/malicious exclusion in Dockerfile.dockerignore (ignore case fails).
- check passed; one earlier full-run failure did not reproduce (re-run clean).
