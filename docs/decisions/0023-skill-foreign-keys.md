# 0023. Books and the skill library point at one edition of a skill

- Status: Accepted
- Date: 2026-11-08
- Spec: Appendix D (`skills`, `skill_library`, `books`)

## Decision

`skills` is keyed by `(skill_id, edition)`. `skill_library` and `books` each carry an `edition` column and a composite `FOREIGN KEY (skill_id, edition) REFERENCES skills (skill_id, edition)`. The `skill_library` primary key becomes `(agent_id, skill_id, edition)`. A book's `skill_id` and `edition` are both null or both set.

## Why

Appendix D writes `REFERENCES skills` on a single `skill_id` column, which Postgres rejects because `skills` has no unique key on `skill_id` alone. Dropping the references would let a book or library entry name a skill that does not exist. A book teaches one edition of a skill, so the composite key says what is meant. The owner chose this at the P0-05 review.

## Consequences

- `sql/0001_init.sql` differs from Appendix D here and says so in comments.
- Neither table is used before later phases; the shape is settled now so the first migration needs no rework.
