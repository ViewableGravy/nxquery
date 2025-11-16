import type { DomainsExampleArgs } from './queries/example'
import type { DomainsExample2Args } from './queries/example2'

export const queryKeys = {
  example: {
    query: (rawArgs: DomainsExampleArgs) => ['domains', 'example', 'query', rawArgs] as const,
    mutation: ['domains', 'example', 'mutation'] as const,
  },
  example2: {
    query: (rawArgs: DomainsExample2Args) => ['domains', 'example2', rawArgs] as const,
  },
  example3: {
    mutation: ['domains', 'example3'] as const,
  },
} as const

export default queryKeys
