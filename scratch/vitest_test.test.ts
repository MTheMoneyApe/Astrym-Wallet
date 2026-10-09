import { expect, it } from 'vitest';

it('matches error', async () => {
  const p = (async () => {
    throw new Error('StorageCorruptionError: Accounts metadata is corrupt');
  })();
  await expect(p).rejects.toThrow(/StorageCorruptionError/);
});
