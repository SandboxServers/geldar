/** The register service's database port. The real one is pg-store.ts; tests use a fake. */
export interface OwnerRecord {
  readonly ownerId: string;
  readonly banned: boolean;
}

export interface PlayerRow {
  readonly playerId: string;
  readonly name: string;
  readonly harness: string;
  readonly status: string;
}

export interface NewPlayerRequest {
  readonly identityHash: string;
  readonly ownerId: string;
  readonly playerId: string;
  readonly lifeId: string;
  readonly name: string;
  readonly harness: string;
  readonly tokenId: string;
  /** HMAC of the token (0054). The token value itself never reaches the store. */
  readonly tokenHash: Buffer;
}

export interface MintRequest {
  readonly identityHash: string;
  readonly playerId: string;
  readonly tokenId: string;
  readonly tokenHash: Buffer;
}

export interface Store {
  /** The owner behind an identity hash, or null when the identity never registered. */
  findOwner(identityHash: string): Promise<OwnerRecord | null>;
  /** How many identities were created at or after `sinceMs` (epoch ms). */
  countNewOwnersSince(sinceMs: number): Promise<number>;
  createOwner(
    identity: { identityHash: string; provider: string; display: string },
    ownerId: string,
  ): Promise<void>;
  listPlayers(identityHash: string): Promise<PlayerRow[]>;
  /** Creates the life, player, budget and first token in register_create_player; limit is the lifetime cap of 10 (R36). */
  createPlayer(request: NewPlayerRequest): Promise<'ok' | 'cap' | 'limit' | 'taken'>;
  /** Mints a token through register_mint_token; false when the function refuses (not the owner's). */
  mintToken(request: MintRequest): Promise<boolean>;
  /** Retires the owner's own player and revokes its tokens; false when it is not theirs or not live. The database checks the owner by identity. */
  retirePlayer(identityHash: string, playerId: string): Promise<boolean>;
}
