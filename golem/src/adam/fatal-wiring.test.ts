import { describe, expect, it, vi } from 'vitest';
import { installEntryHandlers } from './main.ts';

describe('adam host entry', () => {
  it('registers the fatal handlers for an uncaught exception and an unhandled rejection', () => {
    const on = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    try {
      installEntryHandlers();
      expect(on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    } finally {
      on.mockRestore();
    }
  });
});
