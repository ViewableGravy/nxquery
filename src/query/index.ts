import { createMutationOptions as createDomainsExampleMutationOptions } from './domains/mutations/example'
import { createMutationOptions as createDomainsExample3MutationOptions } from './domains/mutations/example3'
import { createQueryOptions as createDomainsExampleQueryOptions } from './domains/queries/example'
import { createQueryOptions as createDomainsExample2QueryOptions } from './domains/queries/example2'

export const NXQuery = {
  domains: {
    example: {
      query: createDomainsExampleQueryOptions,
      mutation: createDomainsExampleMutationOptions,
    },
    example2: createDomainsExample2QueryOptions,
    example3: createDomainsExample3MutationOptions,
  },
} as const
