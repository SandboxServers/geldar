import type { MintRequest, NewPlayerRequest, OwnerRecord, PlayerRow, Store } from '../src/store.ts';

/** An in-memory store that enforces what the database does: owner match, banned, cap of 3. */
export class FakeStore implements Store {
  owners = new Map<string, { ownerId: string; banned: boolean; createdAt: number }>();
  players = new Map<string, PlayerRow & { ownerId: string }>();
  /** Every write argument, serialised, so a test can assert on what reached the database. */
  writes: string[] = [];
  mints: MintRequest[] = [];
  readonly now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }

  async findOwner(hash: string): Promise<OwnerRecord | null> {
    return this.owners.get(hash) ?? null;
  }
  cameras = new Map<string, boolean>();
  async setPublicCamera(identityHash: string, playerId: string, value: boolean): Promise<boolean> {
    const who = this.owners.get(identityHash);
    const p = this.players.get(playerId);
    if (!who || who.banned || !p || p.ownerId !== who.ownerId) return false;
    this.cameras.set(playerId, value);
    return true;
  }
  async createOwner(
    identity: { identityHash: string; provider: string; display: string },
    ownerId: string,
  ): Promise<void> {
    this.writes.push(JSON.stringify({ identity, ownerId }));
    this.owners.set(identity.identityHash, { ownerId, banned: false, createdAt: this.now() });
  }
  async listPlayers(identityHash: string): Promise<PlayerRow[]> {
    const ownerId = this.owners.get(identityHash)?.ownerId;
    return [...this.players.values()].filter((p) => p.ownerId === ownerId);
  }
  async createPlayer(q: NewPlayerRequest): Promise<'ok' | 'cap' | 'limit' | 'taken'> {
    this.writes.push(JSON.stringify({ ...q, tokenHash: q.tokenHash.toString('hex') }));
    if (this.players.has(q.playerId)) return 'taken';
    // the lifetime cap counts retired players too (R36)
    if ([...this.players.values()].filter((p) => p.ownerId === q.ownerId).length >= 10)
      return 'limit';
    const live = [...this.players.values()].filter(
      (p) => p.ownerId === q.ownerId && p.status !== 'retired',
    );
    if (live.length >= 3) return 'cap';
    this.players.set(q.playerId, {
      ownerId: q.ownerId,
      playerId: q.playerId,
      name: q.name,
      harness: q.harness,
      status: 'active',
    });
    this.mints.push(q);
    return 'ok';
  }
  async mintToken(q: MintRequest): Promise<boolean> {
    this.writes.push(JSON.stringify({ ...q, tokenHash: q.tokenHash.toString('hex') }));
    const who = this.owners.get(q.identityHash);
    const p = this.players.get(q.playerId);
    if (!who || who.banned || !p || p.ownerId !== who.ownerId || p.status === 'retired')
      return false;
    this.mints.push(q);
    return true;
  }
  async retirePlayer(identityHash: string, playerId: string): Promise<boolean> {
    const who = this.owners.get(identityHash);
    const p = this.players.get(playerId);
    if (!who || who.banned || !p || p.ownerId !== who.ownerId || p.status === 'retired')
      return false;
    this.players.set(playerId, { ...p, status: 'retired' });
    return true;
  }
  ban(hash: string): void {
    const o = this.owners.get(hash);
    if (o) o.banned = true;
  }
}
