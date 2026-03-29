import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginRoot = path.resolve(import.meta.dirname, '..');

describe('opencli-plugin-webofscience structure', () => {
  it('has the required plugin metadata files', () => {
    expect(fs.existsSync(path.join(pluginRoot, 'opencli-plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'README.md'))).toBe(true);
  });

  it('keeps command files at plugin root for discovery', () => {
    expect(fs.existsSync(path.join(pluginRoot, 'smart-search.ts'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'basic-search.ts'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'author-search.ts'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'record.ts'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'shared.ts'))).toBe(false);
    expect(fs.existsSync(path.join(pluginRoot, 'errors.ts'))).toBe(false);
  });

  it('satisfies opencli plugin structure validation', () => {
    const files = fs.readdirSync(pluginRoot);
    const hasCommandFile = files.some((file) =>
      (file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'tsconfig.json')
      || file.endsWith('.yaml')
      || file.endsWith('.yml')
      || (file.endsWith('.js') && !file.endsWith('.d.js'))
    );

    expect(hasCommandFile).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'src', 'clis'))).toBe(false);
  });
});
