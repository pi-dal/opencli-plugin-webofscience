import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

describe('opencli-plugin-webofscience commands', () => {
  it('registers the core Web of Science commands', async () => {
    await import('../smart-search.ts');
    await import('../basic-search.ts');
    await import('../author-search.ts');
    await import('../author-record.ts');
    await import('../record.ts');
    await import('../references.ts');
    await import('../citing-articles.ts');

    for (const name of [
      'smart-search',
      'basic-search',
      'author-search',
      'author-record',
      'record',
      'references',
      'citing-articles',
    ]) {
      expect(getRegistry().has(`webofscience/${name}`)).toBe(true);
    }
  });
});
