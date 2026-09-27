import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  it('neutralises markup and attribute breakouts', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("Sam's & Alex's")).toBe('Sam&#39;s &amp; Alex&#39;s');
  });

  it('passes plain text through and stringifies non-strings', () => {
    expect(escapeHtml('Groceries')).toBe('Groceries');
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});
