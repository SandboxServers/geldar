# AN-28c worknote: plugin provenance setup and the Body's provenance ACL

Branch `phase1/an-28c-provenance-setup-acl`. Base for the first squash: `689ff117` (origin/main when the session started).
Review fix pass 1 (AN-28c-review-1) squashes onto the packet commit `245f6b0f`.
Paper-only; do not enable on NeoForge until the human-handling question is decided.

## What changed

- `BlockOwnerSetup.java`: the `provenance` field is replaced by a `ProvenanceGate gate`. `static boolean provenanceEnabled(FileConfiguration)`
  reads `provenance.enabled` with default false (no config.yml key added); `reload` calls `gate.reload(config)`. `register` builds
  `BlockChangeListener` with the six-argument constructor (sink = the NATS link, `setup.gate::on`, `Bukkit::getCurrentTick`) and
  registers `PickupProvenanceListener(link, setup.gate::on, Bukkit::getCurrentTick, Bukkit::getPlayer)`. Both compile against the
  pinned Paper API (JDK 25 build passed).
- `ProvenanceGate.java` (new, package-private): `enabled` (default true) and `provenance` (default false) volatile fields; `reload`
  sets both from the config; `on()` is `enabled && provenance`. Off until the first reload. Both listeners get the same `gate::on`.
- Not registered (AN-50a): `CombatFactListener`, `ContainerTakeListener`.
- `geldar.ps1` `Get-NatsUsers`, `body` entry only: `geldar.$s.provenance.>` appended to `Sub` and to `PubDeny`, with one
  comment line.
- `tools/repo-checks/src/nats-auth-fixtures.ts`: `expectedTable` body `sub` gains `geldar.<s>.provenance.>`.
- `tools/repo-checks/src/nats-auth-generator.test.ts`: the exact body `deny` list gains the provenance entry.
  The two fixture files are outside the card's may-edit list; the exact-list assertions fail without them (review 1, note 7a).
- `tools/repo-checks/src/nats-auth.test.ts`: a `provenance routing` describe with three cases (the card's case, the body's
  previous lists unchanged apart from the two new entries, every other role unchanged) and a source-text check that
  `Get-NatsUsers` reads no overlay or config file. The earlier "no overlay switch" case compared two renders of the same
  generator; no table change could make them differ, so it is gone.
- `threshold/mcp/test/nats-auth.it.test.ts`: `roleAllows` body gains the two entries; a live case
  `provenance routing: the body subscribes and cannot publish; mind, eventsink and mcp cannot subscribe`. It now defines
  `shard` (it used an undefined name). NOT RUN (needs NATS; ops).
- Docs (review 1, note 4d): `docs/runbooks/nats-auth-inplace.md` (the provenance line, which said "not in the generator"),
  and the body rows of `docs/reference/nats-subjects.md`, `docs/architecture/nats-topology.md`, `docs/security/authn-authz-map.md`
  (Sub and deny gain `geldar.<s>.provenance.>`).
- `plugin/core/src/test/resources/jar-contents.golden`: `dev/geldar/core/blockowner/ProvenanceGate.class` added.
- `plugin/core/src/test/java/dev/geldar/core/blockowner/ProvenanceSetupTest.java` (new): off when absent, off when false,
  on when true (the static helper); and on `ProvenanceGate`: off before any reload, on after a reload with the flag true,
  off when a reload finds the key removed, off with `blockowner.enabled: false`.

## Operator step: where it lives

The card cites `docs/analysis/sheet/RESUME.md` for the live NATS conf change. RESUME has no such item (its only NATS text is
"Per-life NATS ACL scoping", under open wording), so the card's pointer is dangling. The step is not recorded in RESUME. The
owner decides where it lives. Until then the step is in this worknote and in `docs/runbooks/nats-auth-inplace.md`, which the
operator follows by hand.

## Per-break and per-pickup cost with the flag off

- Per break (`BlockChangeListener.onBreak`): `onBreak` reads `enabled` (pre-existing), the provenance supplier `gate::on` reads
  `gate.enabled` and `gate.provenance` (two volatile reads, new), and `record` reads `enabled` as before (pre-existing). The
  break path adds two volatile reads. No `sendBreakProvenance`, no JsonObject, no allocation. `sink` and `tick` are not touched.
- Per pickup (`PickupProvenanceListener.onPickup`): Bukkit dispatches the event to this listener whatever the flag. The first line
  is `if (sink == null || !enabled.getAsBoolean()) return;`, where `enabled` is `gate::on`: two volatile reads, then return. No
  `instanceof`, no thrower lookup, no publish, no allocation. (The earlier "one read" was wrong; the pickup path reads two fields.)
- The card asks for "one boolean read per break and one early-return per pickup". That is not met literally. One read per
  path needs a single volatile flag set in `reload` as `enabled && provenance`, and for the break path it also needs an edit to
  `BlockChangeListener`, which the card forbids. Operator call; not done in this pass.
- Nothing is added to the server tick path. The `provenance` read is the only new field access.

## Where this role table is used

Get-NatsUsers (geldar.ps1) is called only by `Initialize-NatsAuth`, which writes `compose/secrets/nats-auth.conf` for
`./geldar.ps1 shard nats-auth <name>`. The scratch seed user and the colo table come from the same function.
`deploy/nats-auth-nf.ps1` has its own `Get-NfNatsUsers`, which is NOT generated from geldar.ps1 and is NOT changed by this packet.

Per environment (whether its deployed auth file CHANGES on merge, and who regenerates it):

- **phase0 scratch** (`shard nats-auth phase0 --local` or `--scratch`, `docs/runbooks/scratch-stack.md`): the conf is
  generated per run in a temp or export directory. A new run after merge gets the new body entry. An existing conf
  is not regenerated (Initialize-NatsAuth writes it only when missing), so an old scratch conf keeps the old body entry
  until it is deleted. Regenerated by the operator or the scratch runbook.
- **colo** (`shard nats-auth colo`, `compose/nats-auth.yml` overlay, `docs/runbooks/colo-deploy.md`): the live file
  `compose/secrets/nats-auth.conf` on the node is NOT changed by merge. The generator writes it only when missing.
  `deploy/colo-cd-plan.sh` sets its NATS line only for `nats/*` and `*/nats*.conf`; this merge changes neither, so the deploy
  prints no NATS line. For this merge it prints `manual plugin jar or plugin config changed (plugin/): not applied`, and it
  refreshes `geldar.ps1` into the node's src extract without running it. So the Colo gets neither the new plugin jar nor the
  new conf until the operator applies both. The conf is applied by hand under `docs/runbooks/nats-auth-inplace.md` (SIGHUP,
  backup first). colo-deploy.md (lines 86 to 93) describes a NATS config change as manual; it does not say this merge prints no NATS line.
- **nf-live** (`deploy/nats-auth-nf.ps1`, `compose/secrets-nf/nats-auth.conf`, `compose/nf-live.yml`): NO change. Its
  table is `Get-NfNatsUsers` in deploy/nats-auth-nf.ps1, which does not read geldar.ps1, and the nf conf is never
  overwritten (`kept ... never overwritten`). The nf body user has no provenance grant; provenance is Paper-only.
- **Other places that restate the table** (review 1, finding 4; checked by reading, not edited in this pass except the docs
  rows above): `deploy/README.md` (the "existing nodes must regenerate nats-auth.conf" procedure, around lines 311 to 317),
  `deploy/scratch/scratch.sh` (copies `nats-auth.conf` from the export), and the body rows of the three docs listed above.
  The first two are outside the card's file list and are a follow-up to check for grant lists.
- The repo-checks fixtures (`nats-auth-fixtures.ts`) and the live test are mirrors, not deployed files.

Main-versus-branch render (review 1, finding 4, confirmed): for `phase0` and `colo`, the only differing line in each rendered
conf is the `body` user; every other user line is byte-identical.

## Overlay switch

There is no switch in the generator: Initialize-NatsAuth does not read `compose/nats-auth.yml`, `colo.yml` or `config.yml`.
The test `Get-NatsUsers reads no overlay or config file` checks that by source text only. The claim that the table is the same
with the overlay off rests on the main-versus-branch render above, not on a test.

## Revert-checks

Run on the review fix pass (base 245f6b0f; each mutation on one line, restored from a copy in the scratchpad).

1. `provenanceEnabled` default set to `true`: `ProvenanceSetupTest > provenance is off when the key is absent` FAILED
   (AssertionFailedError at ProvenanceSetupTest.java:18). Restored; `git diff --stat` empty.
2. `geldar.ps1` body `PubDeny` entry `geldar.$s.provenance.>` removed: `provenance routing` FAILED (expected deny/sub
   to include `geldar.phase0.provenance.>`), and `the body keeps every earlier subject` FAILED. Restored; `git diff --stat` empty.
3. Gate mutations (on `ProvenanceGate.java`, `:core:test --tests ProvenanceSetupTest`, 7 tests): `on()` returns `enabled` only:
   FAILED (`the gate is off before any reload`, `the gate goes off when a reload finds the key removed`). `reload` sets
   `provenance = true`: FAILED (`the gate goes off when a reload finds the key removed`). `reload` sets `provenance = false`:
   FAILED (`the gate is on after a reload with provenance.enabled true`). Each restored from a scratchpad copy; `git diff --stat` empty.
4. Wiring mutation: superseded by pass 2 (below). Before pass 2 the listeners were built inline in `register`, and this
   mutation passed every unit test.

Review fix pass 2 (base b53dc86b). The listeners are now built by package-private seams, `BlockOwnerSetup.breakListener`
and `pickupListener`, which `register` calls with the real gate. `ProvenanceWiringTest` (5 tests) drives them. The
`setup.gate::on` lines sit inside the seams, so the mutations below are on the seam lines (`setup` is not in scope there;
the break mutation uses the blockowner switch the old line mutation named, the pickup one uses `() -> true`).

5. Break seam, `gate::on` replaced by `() -> enabled.getAsBoolean()`: `./gradlew :core:test --tests ...ProvenanceWiringTest`
   FAILED: `a break sends nothing before the first reload` (ProvenanceWiringTest.java:94) and `a break sends nothing when
   provenance.enabled is false, with blockowner.enabled true` (:74). 2 of 5 failed. Restored from a scratchpad copy.
6. Pickup seam, `gate::on` replaced by `() -> true`: FAILED `a pickup reads no event and sends nothing when provenance.enabled
   is false` (`NullPointerException` at ProvenanceWiringTest.java:105, because the null event is read). 1 of 5 failed.
   Restored from a scratchpad copy. `git diff --stat` empty after each restore.
   Residual: a pickup-only mis-wire that keeps the pickup gate off forever is not caught. `EntityPickupItemEvent` needs an
   `ItemStack`, which cannot be built outside a server, so a pickup with provenance on is not driven through `onPickup`.
   The break path with the same gate is driven on and off.
7. `geldar.ps1` is 696 of 700 lines: any further change to it needs a split first.

## Checks

- `(cd plugin; ./gradlew :core:test --tests ...ProvenanceSetupTest)`: pass.
- `(cd plugin; ./gradlew :core:verifyJarContents)`: BUILD SUCCESSFUL (golden lists `ProvenanceGate.class`).
- `(cd plugin; ./gradlew build)` with the JDK 25 Eclipse Adoptium Temurin build (`JAVA_HOME` set to it): `build --rerun-tasks` BUILD SUCCESSFUL.
- `pnpm test tools/repo-checks/src/nats-auth`: 10 files, 81 passed, 9 skipped.
- `pnpm test tools/repo-checks` (whole folder): the failures in `nats-human-grants-nf.test.ts` and `nf-live-compose.test.ts`
  (docker compose on this host reports the `!override` YAML tag as unresolved) are the same on origin/main (verified in
  review 1: 26 failed on main and on the branch for those two files). Not caused by this packet.
- `pnpm check:repo`: the only `error:` line was the JDK path (a dotted digit string read as an IPv4 literal); it is
  removed. The rest are `TAG_RESOLVE_FAILED ... !override` warnings from the host tooling, the same on main.
- `threshold/mcp/test/nats-auth.it.test.ts`: NOT RUN (live: needs a real NATS; ops). `tsc` on the file is clean after the `shard` fix.
- `./geldar.ps1 check`: not run on this pass; the narrower checks above were run instead, as the review brief asked.

Review fix pass 2 checks:

- `(cd plugin; ./gradlew :core:test --tests "dev.geldar.core.blockowner.*")`: pass; `ProvenanceWiringTest` 5 of 5.
- `(cd plugin; ./gradlew :core:verifyJarContents)`: BUILD SUCCESSFUL (no golden change; the seams add no class).
- `(cd plugin; ./gradlew build --rerun-tasks)` with the JDK 25 Adoptium `JAVA_HOME`: BUILD SUCCESSFUL.
- `./geldar.ps1 pnpm check:repo`: `repo checks: ok`, no `error:` line.
- `git diff --check`: clean.

Fix pass 3:

- typecheck of tools/repo-checks was not run in review; ops found TS2532; fixed (`nats-auth.test.ts` body pub assertion narrowed).
- `ProvenanceSetupTest.java` is intentionally in the diff: it is this card's new test for the plugin provenance setup.
