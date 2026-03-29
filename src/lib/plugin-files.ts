const PLUGIN_COMMAND_SOURCE_FILES = [
  'smart-search.ts',
  'basic-search.ts',
  'author-search.ts',
  'author-record.ts',
  'record.ts',
  'references.ts',
  'citing-articles.ts'
] as const

export function getPluginCommandSourceFiles(): string[] {
  return [...PLUGIN_COMMAND_SOURCE_FILES]
}

export function getPluginCommandBuildEntries() {
  return PLUGIN_COMMAND_SOURCE_FILES.map((input) => ({
    input,
    output: input.replace(/\.ts$/, '.js')
  }))
}
