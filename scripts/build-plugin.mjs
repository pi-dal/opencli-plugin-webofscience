import { rmSync } from 'node:fs'
import { build } from 'esbuild'

const commandEntries = [
  ['smart-search.ts', 'smart-search.js'],
  ['basic-search.ts', 'basic-search.js'],
  ['author-search.ts', 'author-search.js'],
  ['author-record.ts', 'author-record.js'],
  ['record.ts', 'record.js'],
  ['references.ts', 'references.js'],
  ['citing-articles.ts', 'citing-articles.js']
]

for (const [input, output] of commandEntries) {
  await build({
    bundle: true,
    entryPoints: [input],
    external: ['@jackwener/opencli/registry'],
    format: 'esm',
    outfile: output,
    packages: 'external',
    platform: 'node',
    target: 'node20'
  })
}

rmSync('pnpm-lock.yaml', { force: true })
