# G2-04 OIDC binding: open item for the repo owner

Status: open. The federated credential is not bound to the GitHub repository id.

What the credential binds to
- Its subject is `repo:<owner>/<name>:environment:<env>`. Azure matches the token's subject claim against that
  string only.
- The subject carries the repository name, not its numeric id. `oidc-identities.sh --repository-id` is printed for
  the record and is NOT ENFORCED. It is not written into the credential.

Risk
- If the repository is renamed or deleted and a different repository takes the same name, that repository's
  workflows can obtain a token for `environment:<env>`, and so the Azure roles of that environment.

Mitigation (owner decision)
- Choose one: a custom subject claim that carries the repository id, or a claims-matching expression that
  includes `repository_id`.
- Verify its syntax at the first owner run. The syntax was not verified offline and is not written in this repo.

Interim control
- Required reviewers on each GitHub Environment (`github-environments.sh --reviewer-id`) gate every job that
  requests the environment token. Keep them set until the mitigation is in place.
