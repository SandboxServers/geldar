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
#
# The allow lists are this shard's NATS only: every subject starts with geldar.nf., or is a JetStream API subject that
# names one of the two streams below or one of the two identity KV buckets. No user gets `>`, `geldar.*` or another shard.

# The JetStream streams this NATS may hold. GELDAR_EVENTS is the name the plugin and the sink use today; GELDAR_EVENTS_NF
# is the per-shard name of decision 0380. Remove the GELDAR_EVENTS default when the sink's per-shard config lands.
function Get-NfNatsUsers {
  $s = 'nf'
  $streams = 'GELDAR_EVENTS', 'GELDAR_EVENTS_NF'
  $buckets = 'geldar-life-registry', 'geldar-skins'
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
  # The NATS passwords, then the Postgres password and the Velocity forwarding secret (nf-live.yml declares both). Each is 32
  # symbols from $alphabet (the neoforge entrypoint accepts [A-Za-z0-9_-] only), no trailing newline, never overwritten.
  $names = @($users.Keys | ForEach-Object { "nats-$_" }) + 'postgres', 'velocity-forwarding'
  foreach ($name in $names) {
    $path = Join-Path $dir "$name.txt"
    if (Test-Path -LiteralPath $path) { continue }
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $secret = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    [IO.File]::WriteAllText($path, $secret, [Text.Encoding]::ASCII)
    Restrict-OwnerOnly $path
    Write-Host "created compose/secrets-nf/$name.txt"
  }
  if (Test-Path -LiteralPath $conf) { Write-Host 'kept compose/secrets-nf/nats-auth.conf (it exists; never overwritten)'; return }
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
  [IO.File]::WriteAllText($conf, (($lines -join "`n") + "`n"), [Text.Encoding]::ASCII)
  Restrict-OwnerOnly $conf
  Write-Host 'created compose/secrets-nf/nats-auth.conf'
}
