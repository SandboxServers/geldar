# Request 05: GitHub tag ruleset for `telemetry-v*`

Status: DRAFT, owner follow-up (RESUME.md "Held": no tag or release of `@geldar/telemetry` until told; the tag ruleset is the owner's step). This is a repository setting, not a node change. Nothing has been applied. Needs a repository admin.

## Ruleset

| Field | Value |
|---|---|
| Name | `telemetry-release-tags` |
| Target | Tags |
| Enforcement | Active |
| Tag pattern (include) | `telemetry-v*` (ref pattern `refs/tags/telemetry-v*`) |
| Exclude | none |
| Rules | Restrict creations; Restrict updates; Restrict deletions |
| Bypass list | Repository admin role only, bypass mode Always. No teams, apps or other roles |

Effect: only a repository admin can create, move or delete a tag matching `telemetry-v*`. Everyone else, including a maintainer-role account and any agent token without the admin role, is refused. "Restrict updates" blocks moving an existing tag. Other tag names are not affected.

## Apply (UI)

Settings, Rules, Rulesets, New ruleset, New tag ruleset. Set the name and Enforcement status Active; add the target `telemetry-v*` by Add target, Include by pattern; under Bypass list add Repository admin (Always); tick Restrict creations, Restrict updates, Restrict deletions; Create.

## Apply (API, template; run by an admin, no token in a file or argv history)

```
gh api -X POST repos/<owner>/<repo>/rulesets --input - <<'EOF'
{
  "name": "telemetry-release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/telemetry-v*"], "exclude": [] } },
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "rules": [ { "type": "creation" }, { "type": "update" }, { "type": "deletion" } ]
}
EOF
```
`actor_id` 5 is the built-in repository Admin role id in the rulesets API (UNVERIFIED here: confirm in the UI or with `gh api repos/<owner>/<repo>/rulesets/<id>` after creating it).

## Verify

1. `gh api repos/<owner>/<repo>/rulesets` lists it with `enforcement` `active`, target `tag`.
2. As a non-admin account: `git push origin HEAD:refs/tags/telemetry-v0.0.0-probe` is refused (rule violation); a tag `probe-not-telemetry` is accepted and then deleted by its creator.
3. As admin: create then delete the same probe tag; both work (bypass). Delete the probe tag at once. No release is made.

## Rollback

Disable (Enforcement Disabled) or delete the ruleset in Settings, Rules, Rulesets. Existing tags are unaffected.

## Open facts

Repository slug (placeholder above); whether the admin role id is 5 in this org; whether an org-level ruleset already covers tags; who holds the admin role (owner only).
