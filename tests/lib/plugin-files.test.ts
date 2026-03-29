import { describe, expect, it } from 'vitest'

import {
  getPluginCommandBuildEntries,
  getPluginCommandSourceFiles
} from '../../src/lib/plugin-files'

describe('plugin runtime file selection', () => {
  it('only treats the Web of Science command adapters as plugin runtime sources', () => {
    expect(getPluginCommandSourceFiles()).toEqual([
      'smart-search.ts',
      'basic-search.ts',
      'author-search.ts',
      'author-record.ts',
      'record.ts',
      'references.ts',
      'citing-articles.ts'
    ])
  })

  it('maps runtime source files to root-level js outputs', () => {
    expect(getPluginCommandBuildEntries()).toEqual([
      { input: 'smart-search.ts', output: 'smart-search.js' },
      { input: 'basic-search.ts', output: 'basic-search.js' },
      { input: 'author-search.ts', output: 'author-search.js' },
      { input: 'author-record.ts', output: 'author-record.js' },
      { input: 'record.ts', output: 'record.js' },
      { input: 'references.ts', output: 'references.js' },
      { input: 'citing-articles.ts', output: 'citing-articles.js' }
    ])
  })
})
