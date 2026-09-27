import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every destructive prompt must use the one global ConfirmDialog (confirmDialog helper). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('no native confirm()', () => {
  it('never calls window.confirm / confirm() in app code', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src')).filter((file) => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (not URLs)
      return /(^|[^\w.])(window\.)?confirm\s*\(/m.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
