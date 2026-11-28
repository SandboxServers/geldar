# The NF per-shard NATS auth set: the live NeoForge shard (compose/nf-live.yml, compose project geldar-nf). geldar.ps1
# dot-sources this file only for `shard nats-auth nf`, then calls Initialize-NfNatsAuth. It is not a compose file, and
# nothing else reads it. It writes compose/secrets-nf/ (git-ignored), the directory nf-live.yml reads through
# NF_SECRETS_DIR (default ./secrets-nf, relative to compose/).
#
# Run it on the TRUSTED machine, in a clean export made with git archive (no .git), with --live, then copy the result to the
# node (the node has no pwsh and no node runtime). Without --live nothing is written.
# A git checkout (a .git entry) is refused unless --local is also given. --local is accepted in a clean export and changes
# nothing there; only the test harness needs it (tools/repo-checks/src/nats-auth-nf.test.ts). The password files are
# plaintext inside nats-auth.conf, as the colo config is (docs/runbooks/nf-live-project.md, section 4b).
# Each file (the config included) is created empty with CreateNew, so an existing file is never overwritten; its owner-only
# mode (Set-OwnerOnlyAcl, from geldar.ps1) is set while it is still empty, and only then is its text written. A re-run restricts
# an existing file again, and an existing empty secret file is refused. On Windows this script sets no ACL on the directory:
# it keeps its parent's ACL, and its files are owner-only from their creation.
#
# The allow lists are this shard's NATS only: every subject starts with geldar.nf., or is a JetStream API subject that
# names one of the two streams below or one of the two identity KV buckets. No user gets `>`, `geldar.*` or another shard.

# The JetStream streams this NATS may hold. GELDAR_EVENTS is the name the plugin and the sink use today; GELDAR_EVENTS_NF
# is the per-shard name of decision 0380. Remove the GELDAR_EVENTS default when the sink's per-shard config lands.
function Get-NfNatsUsers {
  $s = 'nf'
  $streams = 'GELDAR_EVENTS', 'GELDAR_EVENTS_NF'
  $buckets = 'geldar-life-registry', 'geldar-skins'
  # The human lane's own inbox prefix (GELDAR_NATS_INBOX_PREFIX in compose/nf-live-human.yml, the same value). Its client
  # sends and receives under this prefix only; the shared _INBOX.> is not granted to it.
  $humanInbox = '_INBOX.human.'
  $streamApi = @(foreach ($st in $streams) { "`$JS.API.STREAM.INFO.$st"; "`$JS.API.STREAM.CREATE.$st" })
  # The sink is the durable pull consumer 'eventsink' (eventsink/src/config.ts); it creates its stream if it starts first.
  # Its client (@nats-io/jetstream 3.4.0) sends the consumer create with the filter in the subject,
  # CONSUMER.CREATE.<stream>.<consumer>.<filter> (jsmconsumer_api.js:101), so the `.>` form is needed. Its first call is
  # $JS.API.INFO (jsclient.js:148), listed in the sink's publish list below.
  $sinkApi = @(foreach ($st in $streams) {
      "`$JS.API.STREAM.INFO.$st"; "`$JS.API.STREAM.CREATE.$st"
      "`$JS.API.CONSUMER.CREATE.$st.eventsink"; "`$JS.API.CONSUMER.CREATE.$st.eventsink.>"; "`$JS.API.CONSUMER.DURABLE.CREATE.$st.eventsink"
      "`$JS.API.CONSUMER.INFO.$st.eventsink"; "`$JS.API.CONSUMER.MSG.NEXT.$st.eventsink"; "`$JS.ACK.$st.eventsink.>"
    })
  # Velocity reads the two identity buckets (a watch and a get): the colo velocity set, for these buckets.
  $velocityApi = @(foreach ($b in $buckets) { "`$JS.API.STREAM.INFO.KV_$b"; "`$JS.API.CONSUMER.CREATE.KV_$b"; "`$JS.API.CONSUMER.CREATE.KV_$b.>"; "`$JS.API.CONSUMER.INFO.KV_$b.>"; "`$JS.API.CONSUMER.DELETE.KV_$b.>" })
  # The identity-seed one-shot creates, inspects and updates the two identity buckets and nothing else (the scratch seed).
  $seedApi = @(foreach ($b in $buckets) { "`$JS.API.STREAM.CREATE.KV_$b"; "`$JS.API.STREAM.INFO.KV_$b"; "`$JS.API.STREAM.UPDATE.KV_$b" })
  return [ordered]@{
    # The mod publishes core-common's NatsEventPublisher events: a JetStream publish (the ack comes back on the inbox) into
    # the stream, which it creates if missing (ensureStream: STREAM.INFO and STREAM.CREATE). Its subjects are geldar.nf.<type>
    # (EventEnvelope.subject). The export type list is not yet defined in neoforge/ (no mapping file), so the publish is one
    # token under nf; maintenance is denied because the deploy publishes it, and the dead letter because the sink does.
    neoforge = @{ Pub = @("geldar.$s.*") + $streamApi + @('_INBOX.>'); PubDeny = @("geldar.$s.maintenance", "geldar.$s.dlq"); Sub = @("geldar.$s.maintenance", '_INBOX.>') }
    # The eventsink (colo's table, narrowed): the dead letter and the state push, the proficiency request on the state subtree.
    sink = @{ Pub = @("geldar.$s.dlq", "geldar.$s.state.>", '$JS.API.INFO') + $sinkApi + @('_INBOX.>'); Sub = @("geldar.$s.state.*.proficiency", '_INBOX.>') }
    # Deploy (CD-1d): the operator's maintenance notice is published as this user and nothing else.
    deploy = @{ Pub = @("geldar.$s.maintenance"); Sub = @('_INBOX.>') }
    velocity = @{ Pub = $velocityApi + @('$JS.FC.>', '_INBOX.>'); Sub = @('_INBOX.>') }
    seed = @{ Pub = @('$JS.API.INFO') + $seedApi + @('_INBOX.>'); Sub = @('_INBOX.>') }
    # The body (the golem p0 probe, ag_nfprobe_01): it writes and reads that one key of the life registry bucket only. A KV
    # put, get and delete publish on $KV.<bucket>.<key>; the message get and the stream info are the JetStream calls the
    # probe's bound KV bucket makes (its verify reads by message get). It publishes nothing else: no event stream, no
    # geldar.nf.* subject, no other bucket, no other key, and no direct get. Real Bodies on geldar-nf will need their own
    # role and a later owner decision; this user is the probe's only.
    body = @{ Pub = @('$KV.geldar-life-registry.ag_nfprobe_01', '$JS.API.INFO', '$JS.API.STREAM.INFO.KV_geldar-life-registry', '$JS.API.STREAM.MSG.GET.KV_geldar-life-registry', '_INBOX.>'); Sub = @('_INBOX.>') }
    # The human lane (velocity-human, compose/nf-live-human.yml) has its own user, nats-human.txt. It watches the same two buckets
    # as velocity, read only: IdentityPlugin starts a registry client and a skin client whenever GELDAR_NATS_URL is set, in either
    # lane (plugin/velocity-identity IdentityPlugin.java:139-142), and reads the skin on each login (:259). Its flow control is
    # scoped to those two buckets. It publishes no $KV subject, no $JS.API wildcard, no create, update or purge, and no event subject.
    # Its inbox is _INBOX.human. only (never the shared _INBOX.>): a compromised proxy cannot read or forge another user's inbox.
    # The publish grant of _INBOX.human.> is kept until S1 proves the client never publishes to an inbox (UNVERIFIED until then).
    human = @{ Pub = $velocityApi + @(foreach ($b in $buckets) { "`$JS.FC.KV_$b.>" }) + @("$humanInbox>"); Sub = @("$humanInbox>") }
    # The MCP door (threshold/mcp on geldar-nf, compose/nf-live-rangers.yml): the colo mcp set with s=nf. It publishes the
    # sovereign calls and the presence record, and talks to the Bodies over NATS; it is denied the hearing subject by name.
    mcp = @{ Pub = @("geldar.$s.sovereign_call", "geldar.$s.body.>", '$KV.geldar-presence.>', '$JS.API.>', '$JS.ACK.>', '_INBOX.>'); PubDeny = @("geldar.$s.body.*.hearing"); Sub = @('_INBOX.>') }
    # The ranger Bodies (players-host, the five Turbo lives): the colo body set with s=nf, the same denies and subscribes.
    # The body's denies are copied from geldar.ps1 (Get-NatsUsers, body); a ranger may not forge a kino, control or life subject.
    ranger = @{ Pub = @("geldar.$s.>", '$JS.API.>', '$JS.ACK.>', '_INBOX.>') + @(foreach ($b in 'geldar-life-registry', 'geldar-checkpoints', 'geldar-body-generation', 'geldar-skins', 'geldar-plans', 'geldar-seen') { "`$KV.$b.>" });
      PubDeny = @("geldar.$s.kino.>", "geldar.$s.blockowner.changed", "geldar.$s.ctl.body.>", "geldar.$s.helper.body.>", "geldar.$s.state.*.level", "geldar.$s.body.*.hearing", "geldar.$s.provenance.>", "geldar.$s.life.>");
      Sub = @("geldar.$s.body.>", "geldar.$s.blockowner.changed", "geldar.$s.state.*.level", "geldar.$s.provenance.>", '_INBOX.>') }
  }
}

# Refuses before anything is written. An unknown flag, a missing --live, or a checkout without --local each throw.
# The flags are matched case-sensitively: --LIVE is an unknown flag.
function Assert-NfNatsIntent([string[]] $Flags) {
  $unknown = @($Flags | Where-Object { $_ -cnotin '--live', '--local' })
  if ($unknown.Count -gt 0) { throw "shard nats-auth nf: unknown flag $($unknown -join ', ') (the flags are --live and --local). Nothing was written." }
  if ($Flags -cnotcontains '--live') {
    throw 'shard nats-auth nf writes the live NeoForge secrets to compose/secrets-nf/. Run it on the trusted machine, in a clean export, with --live, then copy the result to the node. Nothing was written.'
  }
  if ((Test-Path -LiteralPath (Join-Path $Root '.git')) -and $Flags -cnotcontains '--local') {
    throw 'shard nats-auth nf --live is refused in a git checkout (a .git entry exists). Generate in a clean export made with git archive, never in a checkout. --local is for the test harness only. Nothing was written.'
  }
}

# Reads one password file. An empty file, or one with a double quote or a line break (either would break the conf), throws
# before the conf is written, so nothing is written.
function Get-NfNatsPassword([string] $Dir, [string] $User) {
  $raw = Get-Content -LiteralPath (Join-Path $Dir "nats-$User.txt") -Raw
  $pass = if ($null -eq $raw) { '' } else { $raw.Trim() }
  if ($pass -eq '') { throw "compose/secrets-nf/nats-$User.txt is empty. Nothing was written. Restore the password, or delete the file and run again before any start." }
  if ($pass -match '["\x00-\x1f]') { throw "compose/secrets-nf/nats-$User.txt holds a double quote or a line break, which would break nats-auth.conf. Nothing was written." }
  return $pass
}

# Creates one secret file or the config: CreateNew, so an existing file is never overwritten, and the owner-only mode is set
# while the file is still empty. Set-OwnerOnlyAcl and Assert-OwnerOnlyMode come from geldar.ps1 (loaded before this file).
function Write-NfSecretFile([string] $Path, [string] $Text) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  try {
    Set-OwnerOnlyAcl $Path
    $data = [Text.Encoding]::ASCII.GetBytes($Text)
    $stream.Write($data, 0, $data.Length)
  } finally {
    $stream.Dispose()
  }
  Assert-OwnerOnlyMode $Path '600'
}

function Initialize-NfNatsAuth([string[]] $Flags = @()) {
  Assert-NfNatsIntent $Flags
  $dir = Join-Path $Root 'compose/secrets-nf'
  $conf = Join-Path $dir 'nats-auth.conf'
  $users = Get-NfNatsUsers
  # A config that exists with a password file missing would not match its passwords: refuse, and write nothing.
  $missing = @($users.Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dir "nats-$_.txt")) })
  if ((Test-Path -LiteralPath $conf) -and $missing.Count -gt 0) {
    $names = ($missing | ForEach-Object { "nats-$_.txt" }) -join ', '
    throw "compose/secrets-nf/nats-auth.conf exists but $names is missing, so the config would not match the passwords. Nothing was written."
  }
  New-Item -ItemType Directory -Force $dir | Out-Null
  if (-not $IsWindows) {
    # The directory is owner-only too (700), as compose/secrets is (Initialize-ShardSecrets): its listing is no more public.
    & chmod 700 $dir
    if ($LASTEXITCODE -ne 0) { throw "chmod could not restrict $dir to its owner" }
    Assert-OwnerOnlyMode $dir '700'
  }
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  # The NATS passwords, then the Postgres password, the Velocity forwarding secret and the RCON password (nf-live.yml declares
  # them; rcon is read by the neoforge service's RCON_PASSWORD_FILE). Each is 32 symbols from $alphabet (the neoforge entrypoint
  # accepts [A-Za-z0-9_-] only), no trailing newline, never overwritten. The MCP pepper is 64 symbols (the MCP refuses a shorter one).
  # Fifteen files in all with the conf (nats-body.txt is the probe's, nats-human.txt the human lane's, the mcp and ranger ones the rangers').
  $names = @($users.Keys | ForEach-Object { "nats-$_" }) + 'postgres', 'velocity-forwarding', 'rcon', 'postgres-mcp', 'mcp-token-pepper'
  foreach ($name in $names) {
    $path = Join-Path $dir "$name.txt"
    if (Test-Path -LiteralPath $path) {
      # An empty file is what a crash between create and write leaves behind: refuse it by name (Initialize-ShardSecrets does too).
      if ((Get-Item -LiteralPath $path).Length -eq 0) { throw "compose/secrets-nf/$name.txt is empty; delete it and run again before any start." }
      Set-OwnerOnlyAcl $path
      continue
    }
    $length = if ($name -eq 'mcp-token-pepper') { 64 } else { 32 }
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes($length)
    $secret = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    Write-NfSecretFile $path $secret
    Write-Host "created compose/secrets-nf/$name.txt"
  }
  if (Test-Path -LiteralPath $conf) { Set-OwnerOnlyAcl $conf; Write-Host 'kept compose/secrets-nf/nats-auth.conf (it exists; never overwritten)'; return }
  $lines = @('# Generated by ./geldar.ps1 shard nats-auth nf --live. Git-ignored. Plaintext passwords, as the colo config is.',
    'port: 4222', 'http: "127.0.0.1:8222"', 'jetstream: enabled', 'accounts {', '  GELDAR {', '    jetstream: enabled', '    users = [')
  $entries = foreach ($user in $users.Keys) {
    $pass = Get-NfNatsPassword $dir $user
    $pub = ($users[$user].Pub | ForEach-Object { "`"$_`"" }) -join ', '
    $sub = ($users[$user].Sub | ForEach-Object { "`"$_`"" }) -join ', '
    $deny = ''
    if ($users[$user].ContainsKey('PubDeny')) {
      $denyQuoted = ($users[$user].PubDeny | ForEach-Object { "`"$_`"" }) -join ', '
      $deny = ", deny: [$denyQuoted]"
    }
    "      { user: `"$user`", password: `"$pass`", permissions: { publish: { allow: [$pub]$deny }, subscribe: { allow: [$sub] }, allow_responses: true } }"
  }
  $lines += ($entries -join ",`n")
  $lines += @('    ]', '  }', '}')
  Write-NfSecretFile $conf (($lines -join "`n") + "`n")
  Write-Host 'created compose/secrets-nf/nats-auth.conf'
}
