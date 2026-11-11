import { describe, expect, it, vi } from 'vitest';
import { ensureSkinsBucket, SKINS_BUCKET } from './ensure-skins-bucket.ts';

describe('ensureSkinsBucket (C2-07j)', () => {
  it('creates the geldar-skins bucket through the KV manager', async () => {
    const create = vi.fn().mockResolvedValue({});
    expect(await ensureSkinsBucket({ create })).toBe('geldar-skins');
    expect(create).toHaveBeenCalledExactlyOnceWith(SKINS_BUCKET);
  });

  it('passes a creation failure on to the caller', async () => {
    const create = vi.fn().mockRejectedValue(new Error('permissions violation'));
    await expect(ensureSkinsBucket({ create })).rejects.toThrow('permissions violation');
  });
});
