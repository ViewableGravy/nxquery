import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Volume, createFsFromVolume } from 'memfs'
import path from 'node:path'
import type { NXQueryPlugin } from '../vite/nxquery/NXQueryPlugin.ts'

const volume = new Volume()
const memfs = createFsFromVolume(volume)
const fsPromises = memfs.promises

mock.module('node:fs', () => ({
  ...memfs,
  promises: fsPromises,
  existsSync: memfs.existsSync.bind(memfs),
}))

class NXQueryTestHarness {
  #rootDir = '/workspace'
  #plugin!: NXQueryPlugin

  private constructor() {}

  static async create() {
    const harness = new NXQueryTestHarness()
    await harness.setup()
    return harness
  }

  async setup() {
    volume.reset()
    volume.mkdirSync(this.#rootDir, { recursive: true })
    const module = await import('../vite/nxquery/NXQueryPlugin.ts')
    this.#plugin = new module.NXQueryPlugin({})
    await this.#plugin.initialize(this.#rootDir)
  }

  async seedOperation(kind: 'query' | 'mutation', namespace: string, name: string) {
    const scope = kind === 'query' ? 'queries' : 'mutations'
    const relPath = `src/query/${namespace}/${scope}/${name}.ts`
    const absPath = this.resolve(relPath)
    await fsPromises.mkdir(path.dirname(absPath), { recursive: true })
    await fsPromises.writeFile(absPath, '', { encoding: 'utf8' })
    await (this.#plugin as any).maybeSeedOperationFile(absPath)
  }

  async syncProject() {
    await (this.#plugin as any).syncProject()
  }

  async read(relPath: string) {
    const absPath = this.resolve(relPath)
    return fsPromises.readFile(absPath, { encoding: 'utf8' })
  }

  resolve(relPath: string) {
    return path.join(this.#rootDir, relPath)
  }
}

describe('NXQueryPlugin (memfs)', () => {
  let harness: NXQueryTestHarness

  beforeEach(async () => {
    harness = await NXQueryTestHarness.create()
  })

  test('initializes the base NXQuery artifacts', async () => {
    const index = await harness.read('src/query/index.ts')
    const keys = await harness.read('src/query/keys.ts')
    expect(index).toContain('export const NXQuery = {')
    expect(keys).toContain('export const queryKeys = {')
  });

  test('generates query keys and NXQuery entries for overlapping query/mutation names', async () => {
    await harness.seedOperation('query', 'domains', 'example')
    await harness.seedOperation('mutation', 'domains', 'example')
    await harness.syncProject()

    const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
    expect(namespaceKeys).toContain("query: (rawArgs: DomainsExampleArgs) => ['domains', 'example', 'query', rawArgs] as const,")
    expect(namespaceKeys).toContain("mutation: ['domains', 'example', 'mutation'] as const,")

    const nxQuery = await harness.read('src/query/index.ts')
    expect(nxQuery).toContain('example: {')
    expect(nxQuery).toContain('query: createDomainsExampleQueryOptions')
    expect(nxQuery).toContain('mutation: createDomainsExampleMutationOptions')
  });

  test('uses bracket notation for non-identifier operation names', async () => {
    await harness.seedOperation('query', 'domains', 'user-profile')
    await harness.syncProject()

    const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
    expect(namespaceKeys).toContain('["user-profile"]')

    const nxQuery = await harness.read('src/query/index.ts')
    expect(nxQuery).toContain('["user-profile"]')
  });

  test('seeds mutation files with args schema and POST body', async () => {
    await harness.seedOperation('mutation', 'domains', 'createUser')
    const mutationSource = await harness.read('src/query/domains/mutations/createUser.ts')
    expect(mutationSource).toContain('export const argsSchema = z.never()')
    expect(mutationSource).toContain("method: 'POST'")
    expect(mutationSource).toContain('JSON.stringify(args)')
    expect(mutationSource).toContain('mutationFn: async (rawArgs: DomainsCreateUserArgs) =>')
  });
})
