import { beforeEach, describe, test } from 'bun:test'
import { NXQueryTestHarness } from './helpers/nxqueryTestHarness'

describe('NXQueryPlugin (memfs)', () => {
  let harness: NXQueryTestHarness

  beforeEach(async () => {
    harness = await NXQueryTestHarness.create()
  })

  test('initializes the base NXQuery artifacts', async () => {
    await harness.fs.expect({
      index: 'ts',
      keys: 'ts',
    })
    await harness.files.expectContains('src/query/index.ts', 'export const NXQuery = {')
    await harness.files.expectContains('src/query/keys.ts', 'export const queryKeys = {')
  })

  test('generates query keys and NXQuery entries for overlapping query/mutation names', async () => {
    await harness.seedOperation('query', 'domains', 'example')
    await harness.seedOperation('mutation', 'domains', 'example')
    await harness.sync()

    await harness.files.expectContains(
      'src/query/domains/queryKeys.ts',
      "query: (rawArgs: DomainsExampleArgs) => ['domains', 'example', 'query', rawArgs] as const,",
    )
    await harness.files.expectContains(
      'src/query/domains/queryKeys.ts',
      "mutation: ['domains', 'example', 'mutation'] as const,",
    )

    await harness.files.expectContains('src/query/index.ts', 'example: {')
    await harness.files.expectContains('src/query/index.ts', 'query: createDomainsExampleQueryOptions')
    await harness.files.expectContains('src/query/index.ts', 'mutation: createDomainsExampleMutationOptions')
  });

  test('uses bracket notation for non-identifier operation names', async () => {
    await harness.seedOperation('query', 'domains', 'user-profile')
    await harness.sync()

    await harness.files.expectContains('src/query/domains/queryKeys.ts', '"user-profile"')
    await harness.files.expectContains('src/query/index.ts', '"user-profile"')
  });

  test('seeds mutation files with args schema and POST body', async () => {
    await harness.seedOperation('mutation', 'domains', 'createUser')
    await harness.templates.expectSeededOperation({
      kind: 'mutation',
      namespace: 'domains',
      name: 'createUser',
    })
  });
})
