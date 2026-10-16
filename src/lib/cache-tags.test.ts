import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ updateTag: mocks.updateTag, revalidateTag: mocks.revalidateTag }));

import { invalidateTags, __resetInvalidateTagsWarningForTests } from './cache-tags';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  __resetInvalidateTagsWarningForTests();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('invalidateTags', () => {
  it('uses updateTag for every tag when inside a server action', () => {
    invalidateTags('a', 'b');
    expect(mocks.updateTag.mock.calls).toEqual([['a'], ['b']]);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to immediate-expiry revalidateTag when updateTag throws (route handler)', () => {
    mocks.updateTag.mockImplementation(() => {
      throw new Error('updateTag can only be called from within a Server Action');
    });
    invalidateTags('a', 'b');
    expect(mocks.revalidateTag.mock.calls).toEqual([
      ['a', { expire: 0 }],
      ['b', { expire: 0 }],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never throws without a request scope and warns once, without tag names', () => {
    mocks.updateTag.mockImplementation(() => {
      throw new Error('no store user:secret-id');
    });
    mocks.revalidateTag.mockImplementation(() => {
      throw new Error('Invariant: static generation store missing in revalidateTag user:secret-id');
    });
    expect(() => invalidateTags('user:secret-id:accounts', 'user:secret-id:debts')).not.toThrow();
    expect(() => invalidateTags('user:secret-id:accounts')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-id');
  });

  it('keeps invalidating the remaining tags after one fails', () => {
    mocks.updateTag.mockImplementation((tag: string) => {
      if (tag === 'a') throw new Error('x');
    });
    mocks.revalidateTag.mockImplementation(() => {
      throw new Error('y');
    });
    invalidateTags('a', 'b');
    expect(mocks.updateTag).toHaveBeenCalledWith('b');
  });
});
