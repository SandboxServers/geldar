import { createHmac } from 'node:crypto';

export type ProviderName = 'github' | 'discord';

/** What the service keeps of a signed-in account. No email, no raw id, no provider token. */
export interface Identity {
  readonly provider: ProviderName;
  /** HMAC-SHA256(pepper, provider + ":" + provider_user_id), hex. */
  readonly identityHash: string;
  /** The provider login handle; stored only as `mcp_owners.display`, operator-only. */
  readonly display: string;
}

export function identityHash(
  pepper: string,
  provider: ProviderName,
  providerUserId: string,
): string {
  return createHmac('sha256', pepper).update(`${provider}:${providerUserId}`).digest('hex');
}
