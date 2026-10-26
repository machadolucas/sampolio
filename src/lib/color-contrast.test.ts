import { describe, expect, it } from 'vitest';
import { contrastTextColor } from './color-contrast';
describe('category foreground contrast', () => {
  it('retains white on dark swatches and selects black for bright colors', () => {
    expect(contrastTextColor('#153224')).toBe('#ffffff');
    expect(contrastTextColor('#22c55e')).toBe('#000000');
    expect(contrastTextColor('#3b82f6')).toBe('#000000');
    expect(contrastTextColor('#f59e0b')).toBe('#000000');
  });
});

it('chooses contrasting text for bright and dark HSL avatar hues', () => {
  expect(contrastTextColor('hsl(60, 65%, 42%)')).toBe('#000000');
  expect(contrastTextColor('hsl(120, 65%, 42%)')).toBe('#000000');
  expect(contrastTextColor('hsl(240, 65%, 42%)')).toBe('#ffffff');
});
