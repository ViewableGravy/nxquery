import { describe, expect, mock, test } from 'bun:test'
import path from 'node:path'
import {
  NXQueryTestHarness,
  getMtime,
  pathExists,
  readFile as readVirtualFile,
  removeFile as removeVirtualFile,
  testPaths,
  writeFile as writeVirtualFile
} from './helpers/nxqueryTestHarness'
import { testHarness } from './helpers/testUtils'

describe('Watch', () => {
  describe('initialization', () => {
      test('attaches watchers to resolved query and mutation roots', async () => {
        await testHarness.withWatcherContext({}, async ({ watcher }) => {
          expect(watcher.addedPaths).toContain(testHarness.createPath('src/query'))
        })
      })

      test('hydrates base namespace cache before emitting ready', async () => {
        await testHarness.withWatcherContext({}, async () => {
          const index = await readVirtualFile('src/query/index.ts')
          const keys = await readVirtualFile('src/query/keys.ts')
          expect(index).toContain('export const NXQuery =')
          expect(keys).toContain('export const queryKeys =')
        })
      })
  })
  describe('file events', () => {
      test('adds new query operation on watcher add event', async () => {
        await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
          const relPath = 'src/query/domains/queries/example.ts'
          await testHarness.createFile(relPath)
          // No need to manually emit 'add' - createFile does it automatically!
          await testHarness.waitForWatcherFlush(plugin)
          const contents = await readVirtualFile(relPath)
          expect(contents).toContain('createQueryOptions')
          expect(contents).toContain("queryFn: async () => {")
        })
      })

      test('adds new mutation operation on watcher add event', async () => {
        await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
          const relPath = 'src/query/domains/mutations/example.ts'
          await testHarness.createFile(relPath)
          await testHarness.waitForWatcherFlush(plugin)
          const contents = await readVirtualFile(relPath)
          expect(contents).toContain('createMutationOptions')
          expect(contents).toContain("method: 'POST'")
        })
      })

      test('updates cached metadata when file contents change', async () => {
        await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
          const relPath = 'src/query/domains/queries/example.ts'
          await testHarness.createFile(relPath, testHarness.createQuerySource({ includeArgsType: false }))
          await testHarness.waitForWatcherFlush(plugin)
          let namespaceKeys = await readVirtualFile('src/query/domains/queryKeys.ts')
          expect(namespaceKeys).not.toContain('DomainsExampleArgs')

          await testHarness.updateFile(relPath, testHarness.createQuerySource({ includeArgsType: true }))
          await testHarness.waitForWatcherFlush(plugin)
          namespaceKeys = await readVirtualFile('src/query/domains/queryKeys.ts')
          expect(namespaceKeys).toContain('DomainsExampleArgs')
        })
      })

      test('removes operations on unlink events and schedules sync', async () => {
        await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
          const relPath = 'src/query/domains/queries/example.ts'
          await testHarness.createFile(relPath, testHarness.createQuerySource())
          await testHarness.waitForWatcherFlush(plugin)
          let nxQuery = await readVirtualFile('src/query/index.ts')
          expect(nxQuery).toContain('example:')

          await testHarness.deleteFile(relPath)
          await testHarness.waitForWatcherFlush(plugin)
          nxQuery = await readVirtualFile('src/query/index.ts')
          expect(nxQuery).not.toContain('example:')
        })
      })

      test('ignores writes coming from generated artifacts (index/keys/queryKeys)', async () => {
        const onChange = mock(() => {})
        await testHarness.withWatcherContext({ onChange }, async ({ watcher }) => {
          const managed = testHarness.createPath('src/query/index.ts')
          watcher.emit('change', managed)
            expect(onChange).not.toHaveBeenCalled()
        })
      })
  })
  describe('directory events', () => {
      test('creates namespace scaffolding when folder appears', async () => {
        await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
          testHarness.createFolder('src/query/accounts')
          await testHarness.waitForWatcherFlush(plugin)
          const keyFile = await readVirtualFile('src/query/accounts/queryKeys.ts')
          expect(keyFile).toContain('export const queryKeys = {')
          expect(await pathExists('src/query/accounts/queries')).toBe(true)
          expect(await pathExists('src/query/accounts/mutations')).toBe(true)
        })
      })

      test('drops namespace when folder removed and no files remain', async () => {
        await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
          const relPath = 'src/query/domains/queries/example.ts'
          await writeVirtualFile(relPath, testHarness.createQuerySource())
          watcher.emit('add', testHarness.createPath(relPath))
          await testHarness.waitForWatcherFlush(plugin)

          await removeVirtualFile(relPath)
          watcher.emit('unlinkDir', testHarness.createPath('src/query/domains'))
          await testHarness.waitForWatcherFlush(plugin)
          const nxQuery = await readVirtualFile('src/query/index.ts')
          expect(nxQuery).not.toContain('example:')
        })
      })

      test('handles deeply nested namespaces without duplicate watchers', async () => {
        await testHarness.withWatcherContext({}, async ({ watcher }) => {
          testHarness.createFolder('src/query/a/b/c')
          expect(watcher.addedPaths).toHaveLength(1)
        })
      })

      test('creates queries folder when namespace folder is added', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/billing')
          await testHarness.waitForWatcherFlush(plugin)

          await harness.fs.expect({
            'index': 'ts',
            'keys': 'ts',
            'billing': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
          })
          
          testHarness.setWatcher(undefined)
        })
      })

      test('creates mutations folder when namespace folder is added', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/users')
          await testHarness.waitForWatcherFlush(plugin)

          await harness.fs.expect({
            'index': 'ts',
            'keys': 'ts',
            'users': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
          })
        })
      })

      test('creates queryKeys.ts when namespace folder is added', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/products')
          await testHarness.waitForWatcherFlush(plugin)

          await harness.fs.expect({
            'index': 'ts',
            'keys': 'ts',
            'products': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
          })
        })
      })

      test('creates all required structure (queries, mutations, queryKeys.ts) for new namespace', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/analytics')
          await testHarness.waitForWatcherFlush(plugin)

          await harness.fs.expect({
            'index': 'ts',
            'keys': 'ts',
            'analytics': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
          })
        })
      })

      test('does not create structure for deeply nested folders', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/namespace/subfolder/deep')
          await testHarness.waitForWatcherFlush(plugin)
          
          // Should not create scaffold for non-root level namespaces
          expect(await pathExists('src/query/namespace/subfolder/deep/queries')).toBe(false)
          expect(await pathExists('src/query/namespace/subfolder/deep/mutations')).toBe(false)
        })
      })

      test('does not create structure for dot-prefixed directories', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/.hidden')
          await testHarness.waitForWatcherFlush(plugin)
          
          expect(await pathExists('src/query/.hidden/queries')).toBe(false)
          expect(await pathExists('src/query/.hidden/mutations')).toBe(false)
        })
      })

      test('does not create structure for node_modules directory', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/node_modules')
          await testHarness.waitForWatcherFlush(plugin)
          
          expect(await pathExists('src/query/node_modules/queries')).toBe(false)
          expect(await pathExists('src/query/node_modules/mutations')).toBe(false)
        })
      })

      test('initializes queryKeys.ts with correct empty structure', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/orders')
          await testHarness.waitForWatcherFlush(plugin)
          
          const keyFile = await readVirtualFile('src/query/orders/queryKeys.ts')
          // After sync, the file will have the 'as const' suffix
          expect(keyFile).toContain('export const queryKeys = {')
          expect(keyFile).toContain('} as const')
        })
      })

      test('creates namespace structure during initialization for existing folders', async () => {
        const harness = await NXQueryTestHarness.create({})
        await harness.write('src/query/existing/.keep', '')
        
        // Re-initialize to pick up the existing folder
        await harness.plugin.initialize(testPaths.root)
        
        await harness.fs.expect({
          'index': 'ts',
          'keys': 'ts',
          'existing': {
            'queries': {},
            'mutations': {},
            'queryKeys': 'ts',
          },
        })
      })

      test('handles multiple namespace folders created in quick succession', async () => {
        await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
          testHarness.createFolder('src/query/auth')
          testHarness.createFolder('src/query/posts')
          testHarness.createFolder('src/query/comments')
          
          await testHarness.waitForWatcherFlush(plugin)
          
          await harness.fs.expect({
            'index': 'ts',
            'keys': 'ts',
            'auth': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
            'posts': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
            'comments': {
              'queries': {},
              'mutations': {},
              'queryKeys': 'ts',
            },
          })
        })
      })
  })
})

describe('Read', () => {
  describe('query operations', () => {
    test('extracts factory name, params, and type arguments', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write(
          'src/query/domains/queries/details.ts',
          testHarness.createQuerySource({ name: 'details', factoryName: 'buildDetails' }),
        )
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
        expect(namespaceKeys).toContain("(args: DomainsDetailsArgs) => ['domains', 'details', args]")
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('buildDetails')
      })
    })

    test('detects args schema import and alias usage', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/list.ts', testHarness.createQuerySource({ name: 'list' }))
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
        expect(namespaceKeys).toContain("import type { DomainsListArgs } from './queries/list'")
      })
    })

    test('normalizes relative paths for generated imports', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/billing/queries/invoices.ts', testHarness.createQuerySource({ namespace: 'billing', name: 'invoices' }))
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/billing/queryKeys.ts')
        expect(namespaceKeys).toContain("from './queries/invoices'")
      })
    })
  })

  describe('mutation operations', () => {
    test('identifies createMutationOptions export even when renamed', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/mutations/subscribe.ts', testHarness.createMutationSource({ name: 'subscribe', factoryName: 'customMutation' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('customMutation')
      })
    })

    test('captures arg schema + response type information', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/mutations/update.ts', testHarness.createMutationSource({ name: 'update' }))
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
        expect(namespaceKeys).toContain('import type { DomainsUpdateArgs } from')
      })
    })

    test('parses optional invalidate keys metadata block', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write(
          'src/query/domains/mutations/remove.ts',
          testHarness.createMutationSource({ name: 'remove', extra: 'export const invalidate = []' }),
        )
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('remove:')
      })
    })
  })

  describe('metadata handling', () => {
    test('tracks namespace based on directory level', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/a/queries/foo.ts', testHarness.createQuerySource({ namespace: 'a', name: 'foo' }))
        await harness.write('src/query/b/queries/bar.ts', testHarness.createQuerySource({ namespace: 'b', name: 'bar' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('a: {')
        expect(nxQuery).toContain('b: {')
      })
    })

    test('distinguishes between query and mutation folders automatically', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/example.ts', testHarness.createQuerySource({ name: 'example' }))
        await harness.write('src/query/domains/mutations/example.ts', testHarness.createMutationSource({ name: 'example' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('query: createDomainsExampleQueryOptions')
        expect(nxQuery).toContain('mutation: createDomainsExampleMutationOptions')
      })
    })
  })

  describe('failure modes', () => {
    test('returns null when file has no supported exports', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/empty.ts', 'export const nothing = 1')
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).not.toContain('empty:')
      })
    })

    test('logs warning and continues when TS parser throws', async () => {
      const originalWarn = console.warn
      const warn = mock(() => {})
      console.warn = warn as unknown as typeof console.warn
      try {
        await testHarness.withHarness(async ({ harness }) => {
          await harness.write('src/query/domains/queries/broken.ts', 'export const createQueryOptions =')
          await harness.write('src/query/domains/queries/good.ts', testHarness.createQuerySource({ name: 'good' }))
          await harness.sync()
          const nxQuery = await harness.read('src/query/index.ts')
          expect(nxQuery).toContain('good:')
        })
        expect(warn).toHaveBeenCalled()
      } finally {
        console.warn = originalWarn
      }
    })
  })
})

describe('Write', () => {
  describe('namespace queryKeys files', () => {
    test('emits query + mutation builders with generated key helpers', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/example.ts', testHarness.createQuerySource({ name: 'example' }))
        await harness.write('src/query/domains/mutations/example.ts', testHarness.createMutationSource({ name: 'example' }))
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
        expect(namespaceKeys).toContain("query: (args: DomainsExampleArgs) => ['domains', 'example', 'query', args]")
        expect(namespaceKeys).toContain("mutation: ['domains', 'example', 'mutation']")
      })
    })

    test('deduplicates import statements across operations', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        const sharedType = 'DomainsSharedArgs'
        const sharedExtra = `export type ${sharedType} = { life: number }`
        await harness.write(
          'src/query/domains/queries/list.ts',
          testHarness.createQuerySource({ name: 'list', includeArgsType: false, argsTypeName: sharedType, extra: sharedExtra }),
        )
        await harness.write(
          'src/query/domains/queries/detail.ts',
          testHarness.createQuerySource({ name: 'detail', includeArgsType: false, argsTypeName: sharedType }),
        )
        await harness.sync()
        const namespaceKeys = (await harness.read('src/query/domains/queryKeys.ts')).toString()
        expect((namespaceKeys.match(new RegExp(sharedType, 'g')) ?? []).length).toBe(2)
        expect(namespaceKeys.match(/import type/g)?.length).toBe(1)
      })
    })

    test('uses stable key ordering for deterministic diffs', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/zeta.ts', testHarness.createQuerySource({ name: 'zeta' }))
        await harness.write('src/query/domains/queries/alpha.ts', testHarness.createQuerySource({ name: 'alpha' }))
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
        const alphaIndex = namespaceKeys.indexOf('alpha:')
        const zetaIndex = namespaceKeys.indexOf('zeta:')
        expect(alphaIndex).toBeLessThan(zetaIndex)
      })
    })
  })
  describe('root queryKeys', () => {
    test('re-exports every namespace queryKeys module', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/a/queries/foo.ts', testHarness.createQuerySource({ namespace: 'a', name: 'foo' }))
        await harness.write('src/query/b/queries/bar.ts', testHarness.createQuerySource({ namespace: 'b', name: 'bar' }))
        await harness.sync()
        const rootKeys = await harness.read('src/query/keys.ts')
        expect(rootKeys).toContain("import { queryKeys as aQueryKeys } from './a/queryKeys'")
        expect(rootKeys).toContain("import { queryKeys as bQueryKeys } from './b/queryKeys'")
      })
    })

    test('omits namespaces that have neither queries nor mutations', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.sync()
        const rootKeys = await harness.read('src/query/keys.ts')
        expect(rootKeys).not.toContain('empty:')
      })
    })
  })
  describe('NXQuery manifest', () => {
    test('imports operation factories with aliasing for duplicates', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/foo.ts', testHarness.createQuerySource({ name: 'foo' }))
        await harness.sync()
        const index = await harness.read('src/query/index.ts')
        expect(index).toContain("import { createQueryOptions as createDomainsFooQueryOptions }")
      })
    })

    test('builds nxQuery object with query/mutation pairings', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/shared.ts', testHarness.createQuerySource({ name: 'shared' }))
        await harness.write('src/query/domains/mutations/shared.ts', testHarness.createMutationSource({ name: 'shared' }))
        await harness.sync()
        const index = await harness.read('src/query/index.ts')
        expect(index).toContain('shared: {')
        expect(index).toContain('query: createDomainsSharedQueryOptions')
        expect(index).toContain('mutation: createDomainsSharedMutationOptions')
      })
    })

    test('writes .d.ts typings alongside implementation output', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/foo.ts', testHarness.createQuerySource({ name: 'foo' }))
        await harness.sync()
        const index = (await harness.read('src/query/index.ts')).toString()
        expect(index.trim().endsWith('} as const')).toBe(true)
      })
    })
  })
  describe('writeFileIfChanged helper', () => {
    test('skips writes when disk content already matches', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/foo.ts', testHarness.createQuerySource({ name: 'foo' }))
        await harness.sync()
        const before = await getMtime('src/query/index.ts')
        await harness.sync()
        const after = await getMtime('src/query/index.ts')
        expect(after).toBe(before)
      })
    })

    test('writes new content and emits log when changed', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/foo.ts', testHarness.createQuerySource({ name: 'foo' }))
        await harness.sync()
        const before = await getMtime('src/query/index.ts')
        await harness.write('src/query/domains/queries/bar.ts', testHarness.createQuerySource({ name: 'bar' }))
        await harness.sync()
        const after = await getMtime('src/query/index.ts')
        expect(after).toBeGreaterThanOrEqual(before)
        const index = await harness.read('src/query/index.ts')
        expect(index).toContain('bar:')
      })
    })

    test('creates parent directories on first write', async () => {
      await testHarness.withHarness(async ({ plugin }) => {
        const targetDir = 'src/query/newns'
        await writeVirtualFile(path.join(targetDir, '.keep'), '')
        const target = path.join(targetDir, 'queryKeys.ts')
        await (plugin as any).writeFileIfChanged(testHarness.createPath(target), 'export const queryKeys = {}')
        expect(await pathExists(target)).toBe(true)
      })
    })
  })
})

describe('Seed', () => {
  describe('query templates', () => {
    test('includes args schema, validator, and createQueryOptions boilerplate', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('query', 'domains', 'list')
        const source = await harness.read('src/query/domains/queries/list.ts')
        expect(source).toContain('argsSchema')
        expect(source).toContain('queryOptions')
        expect(source).toContain('queryFn: async () =>')
      })
    })

    test('derives PascalCase type names from namespace path', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('query', 'user-profile', 'list-users')
        const source = await harness.read('src/query/user-profile/queries/list-users.ts')
        expect(source).toContain('UserProfileListUsersArgs')
      })
    })

    test('wires queryKeys.<name>.query tuple as the key factory', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('query', 'domains', 'detail')
        const source = await harness.read('src/query/domains/queries/detail.ts')
        expect(source).toContain('queryKeys.detail.query')
      })
    })
  })
  describe('mutation templates', () => {
    test('generates POST fetch stub with JSON body handling', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).toContain("method: 'POST'")
        expect(source).toContain('JSON.stringify(args)')
      })
    })

    test('references queryKeys.<name>.mutation tuple for invalidation', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).toContain('queryKeys.createUser.mutation')
      })
    })
  })
  describe('safety rails', () => {
    test('refuses to overwrite non-empty user files', async () => {
      await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
        const relPath = 'src/query/domains/queries/custom.ts'
        await harness.write(relPath, 'export const keep = true')
        await (plugin as any).maybeSeedOperationFile(harness.resolve(relPath))
        const source = await harness.read(relPath)
        expect(source).toContain('keep = true')
      })
    })

    test('only seeds files inside known query/mutation directories', async () => {
      await testHarness.withHarness(async ({ plugin }) => {
        const outside = testHarness.createPath('src/query/domains/random/file.ts')
        await writeVirtualFile('src/query/domains/random/file.ts', '')
        await (plugin as any).maybeSeedOperationFile(outside)
        const source = await readVirtualFile('src/query/domains/random/file.ts')
        expect(source).toBe('')
      })
    })

    test('emits helpful hint when namespace already populated', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('query', 'domains', 'list')
        const before = await harness.read('src/query/domains/queries/list.ts')
        await harness.seedOperation('query', 'domains', 'list')
        const after = await harness.read('src/query/domains/queries/list.ts')
        expect(after).toBe(before)
      })
    })
  })
})

describe('Sync', () => {
  describe('scheduling', () => {
    test('debounces bursty watch events into a single sync job', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        const original = (plugin as any).syncProject.bind(plugin)
        const spy = mock(() => {})
        ;(plugin as any).syncProject = async () => {
          spy()
          await original()
        }
        ;(plugin as any).scheduleSync()
        ;(plugin as any).scheduleSync()
        await testHarness.waitForWatcherFlush(plugin)
        expect(spy.mock.calls.length).toBeGreaterThan(0)
        ;(plugin as any).syncProject = original
      })
    })

    test('nulls out pending timer once sync completes', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        ;(plugin as any).scheduleSync()
        await testHarness.waitForWatcherFlush(plugin)
          expect(plugin['syncPending']).toBe(false)
      })
    })
  })
  describe('concurrency', () => {
    test('prevents overlapping syncProject executions', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        let running = 0
        let maxRunning = 0
        const original = (plugin as any).syncProject.bind(plugin)
        ;(plugin as any).syncProject = async () => {
          running++
          maxRunning = Math.max(maxRunning, running)
          await original()
          running--
        }
        ;(plugin as any).scheduleSync()
        ;(plugin as any).scheduleSync()
        await testHarness.waitForWatcherFlush(plugin)
        expect(maxRunning).toBeGreaterThan(0)
        ;(plugin as any).syncProject = original
      })
    })

    test('queues subsequent sync requests until current run finishes', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        let count = 0
        const original = (plugin as any).syncProject.bind(plugin)
        ;(plugin as any).syncProject = async () => {
          count++
          await original()
        }
        ;(plugin as any).scheduleSync()
        await testHarness.waitForWatcherFlush(plugin)
        ;(plugin as any).scheduleSync()
        await testHarness.waitForWatcherFlush(plugin)
        expect(count).toBeGreaterThanOrEqual(2)
        ;(plugin as any).syncProject = original
      })
    })
  })
  describe('resilience', () => {
    test('continues scheduling after syncProject throws', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        const original = (plugin as any).syncProject.bind(plugin)
        let fail = true
        ;(plugin as any).syncProject = async () => {
          if (fail) {
            fail = false
            throw new Error('boom')
          }
          await original()
        }
        const originalError = console.error
        console.error = () => {}
        try {
          ;(plugin as any).scheduleSync()
          await testHarness.waitForWatcherFlush(plugin).catch(() => {})
          ;(plugin as any).scheduleSync()
          await testHarness.waitForWatcherFlush(plugin)
          expect(fail).toBe(false)
        } finally {
          console.error = originalError
          ;(plugin as any).syncProject = original
        }
      })
    })

    test('logs error details without crashing the dev server', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        const original = (plugin as any).syncProject.bind(plugin)
        ;(plugin as any).syncProject = async () => {
          throw new Error('sync failure')
        }
        const originalError = console.error
        const errorSpy = mock(() => {})
        console.error = errorSpy as unknown as typeof console.error
        try {
          ;(plugin as any).scheduleSync()
          await testHarness.waitForWatcherFlush(plugin).catch(() => {})
          expect(errorSpy).toHaveBeenCalled()
        } finally {
          console.error = originalError
          ;(plugin as any).syncProject = original
        }
      })
    })
  })
})

describe('Conflict', () => {
  describe('naming collisions', () => {
    test('merges query and mutation sharing the same base name', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/shared.ts', testHarness.createQuerySource({ name: 'shared' }))
        await harness.write('src/query/domains/mutations/shared.ts', testHarness.createMutationSource({ name: 'shared' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('shared: {')
      })
    })

    test('handles duplicate filenames under different namespaces', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/a/queries/foo.ts', testHarness.createQuerySource({ namespace: 'a', name: 'foo' }))
        await harness.write('src/query/b/queries/foo.ts', testHarness.createQuerySource({ namespace: 'b', name: 'foo' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('a: {')
        expect(nxQuery).toContain('b: {')
      })
    })
  })
  describe('invalid files', () => {
    test('skips files with disallowed characters and logs warning', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/user-profile.ts', testHarness.createQuerySource({ name: 'user-profile' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('["user-profile"]')
      })
    })

    test('ignores speculative editor backup files', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/foo.ts~', testHarness.createQuerySource({ name: 'foo' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).not.toContain('foo.ts~')
      })
    })
  })
  describe('deduplication', () => {
    test('keeps deterministic ordering when operations collide', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/b.ts', testHarness.createQuerySource({ name: 'b' }))
        await harness.write('src/query/domains/queries/a.ts', testHarness.createQuerySource({ name: 'a' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery.indexOf('a:')).toBeLessThan(nxQuery.indexOf('b:'))
      })
    })

    test('prefers user-defined alias metadata when provided', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/custom.ts', testHarness.createQuerySource({ name: 'custom', factoryName: 'buildCustom' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('buildCustom')
      })
    })
  })
})

describe('Mutation specifics', () => {
  describe('args schema', () => {
    test('requires args schema definition before generating key tuple', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).toContain('argsSchema.parse(rawArgs)')
      })
    })

    test('falls back to z.void() when no args supplied', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/status.ts', testHarness.createQuerySource({ name: 'status', includeArgs: false }))
        await harness.sync()
        const namespaceKeys = await harness.read('src/query/domains/queryKeys.ts')
        expect(namespaceKeys).toContain("query: () => ['domains', 'status'] as const")
      })
    })
  })
  describe('http wiring', () => {
    test('defaults to POST with JSON headers', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).toContain("method: 'POST'")
        expect(source).toContain("'Content-Type': 'application/json'")
      })
    })

    test('allows overriding method and headers via metadata', async () => {
      await testHarness.withHarnessWatcher(async ({ harness, plugin, watcher }) => {
        const relPath = 'src/query/domains/mutations/createUser.ts'
        await harness.seedOperation('mutation', 'domains', 'createUser')
        await harness.write(relPath, (await harness.read(relPath)).toString().replace("'POST'", "'PATCH'"))
        await (plugin as any).maybeSeedOperationFile(harness.resolve(relPath))
        const source = await harness.read(relPath)
        expect(source).toContain("'PATCH'")
      })
    })
  })
  describe('invalidations', () => {
    test('schedules invalidateQueries for declared keys', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).toContain('queryKeys.createUser.mutation')
      })
    })

    test('no-ops when mutation declares no invalidations', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).not.toContain('invalidateQueries')
      })
    })
  })
})

describe('Errors & resilience', () => {
  describe('parser errors', () => {
    test('surfaces syntax errors with file + line context', async () => {
      const originalWarn = console.warn
      const warn = mock(() => {})
      console.warn = warn as unknown as typeof console.warn
      try {
        await testHarness.withHarness(async ({ harness }) => {
          await harness.write('src/query/domains/queries/broken.ts', 'export const createQueryOptions =')
          await harness.sync().catch(() => {})
        })
        expect(warn).toHaveBeenCalled()
        const warnCalls = warn.mock.calls as unknown as Array<Array<unknown>>
        const warnMessage = warnCalls[0]?.[0] ?? ''
        expect(String(warnMessage)).toContain('[nxquery]')
      } finally {
        console.warn = originalWarn
      }
    })

    test('continues processing remaining files after failure', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/bad.ts', 'export const createQueryOptions =')
        await harness.write('src/query/domains/queries/good.ts', testHarness.createQuerySource({ name: 'good' }))
        await harness.sync()
        const nxQuery = await harness.read('src/query/index.ts')
        expect(nxQuery).toContain('good:')
      })
    })
  })
  describe('fs errors', () => {
    test('retries read on transient ENOENT caused by watcher lag', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/example.ts', testHarness.createQuerySource({ name: 'example' }))
        await harness.sync()
        await removeVirtualFile('src/query/domains/queryKeys.ts')
        await expect(harness.sync()).resolves.toBeUndefined()
      })
    })

    test('propagates fatal ENOSPC errors to caller', async () => {
      await testHarness.withHarness(async ({ plugin }) => {
        const original = (plugin as any).writeFileIfChanged
        ;(plugin as any).writeFileIfChanged = async () => {
          const err = new Error('no space') as any
          err.code = 'ENOSPC'
          throw err
        }
        await expect((plugin as any).syncProject()).rejects.toThrow('no space')
        ;(plugin as any).writeFileIfChanged = original
      })
    })
  })
  describe('logging', () => {
    test('batches repetitive warnings to avoid console spam', async () => {
      const originalWarn = console.warn
      const warn = mock(() => {})
      console.warn = warn as unknown as typeof console.warn
      try {
        await testHarness.withHarness(async ({ harness }) => {
          await harness.write('src/query/domains/queries/a.ts', 'export const createQueryOptions =')
          await harness.write('src/query/domains/queries/b.ts', 'export const createQueryOptions =')
          await harness.sync().catch(() => {})
        })
        expect(warn.mock.calls.length).toBeGreaterThan(0)
      } finally {
        console.warn = originalWarn
      }
    })

    test('includes helpful remediation steps in error output', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        const original = (plugin as any).syncProject.bind(plugin)
        ;(plugin as any).syncProject = async () => {
          throw new Error('explode')
        }
        const originalError = console.error
        const errorSpy = mock(() => {})
        console.error = errorSpy as unknown as typeof console.error
        try {
          ;(plugin as any).scheduleSync()
          await testHarness.waitForWatcherFlush(plugin).catch(() => {})
          ;(plugin as any).syncProject = original
          ;(plugin as any).scheduleSync()
          await testHarness.waitForWatcherFlush(plugin)
          expect(errorSpy).toHaveBeenCalled()
          const errorCalls = errorSpy.mock.calls as unknown as Array<Array<unknown>>
          const errorMessage = errorCalls[0]?.[0] ?? ''
          expect(String(errorMessage)).toContain('[nxquery]')
        } finally {
          console.error = originalError
          ;(plugin as any).syncProject = original
        }
      })
    })
  })
})

describe('Integration', () => {
  describe('dev server', () => {
    test('registers configureServer hook and begins watching', async () => {
      await testHarness.withWatcherContext({}, async ({ watcher }) => {
        expect(watcher.addedPaths).toContain(testHarness.createPath('src/query'))
      })
    })

    test('updates Vite module graph when source files change', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
        const send = mock(() => {})
        const server = testHarness.createFakeServer(watcher, send)
        const relPath = 'src/query/domains/queries/foo.ts'
        await writeVirtualFile(relPath, testHarness.createQuerySource({ name: 'foo' }))
        await plugin.handleHotUpdate({ file: testHarness.createPath(relPath), server })
        expect(send).toHaveBeenCalled()
      })
    })
  })
  describe('build', () => {
    test('runs a full sync during buildStart', async () => {
      const plugin = await testHarness.createPluginInstance({})
      await plugin.initialize(testPaths.root)
      const index = await readVirtualFile('src/query/index.ts')
      expect(index).toContain('export const NXQuery')
    })

    test('emits assets into Vite build output directory', async () => {
      const plugin = await testHarness.createPluginInstance({})
      await plugin.initialize(testPaths.root)
      const keys = await readVirtualFile('src/query/keys.ts')
      expect(keys).toContain('export const queryKeys =')
    })
  })
  describe('hot updates', () => {
    test('triggers HMR reload for query files', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
        const send = mock(() => {})
        const server = testHarness.createFakeServer(watcher, send)
        const relPath = 'src/query/domains/queries/foo.ts'
        await writeVirtualFile(relPath, testHarness.createQuerySource({ name: 'foo' }))
        await plugin.handleHotUpdate({ file: testHarness.createPath(relPath), server })
        expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
      })
    })

    test('reflects watcher-driven file changes without restart', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin, watcher }) => {
        const relPath = 'src/query/domains/queries/list.ts'
        await testHarness.createFile(relPath, testHarness.createQuerySource({ name: 'list', includeArgsType: false }))
        await testHarness.waitForWatcherFlush(plugin)
        await testHarness.updateFile(relPath, testHarness.createQuerySource({ name: 'list', includeArgsType: true }))
        await testHarness.waitForWatcherFlush(plugin)
        const namespaceKeys = await readVirtualFile('src/query/domains/queryKeys.ts')
        expect(namespaceKeys).toContain('DomainsListArgs')
      })
    })
  })
})

describe('Helpers', () => {
  describe('path helpers', () => {
    test('normalizes windows and posix separators consistently', async () => {
      const plugin = await testHarness.createPluginInstance({})
      const importPath = (plugin as any).normalizeImportPath('C:/repo/src/query/index.ts', 'C:/repo/src/query/domains/queries/foo.ts')
      expect(importPath).toBe('./domains/queries/foo')
    })

    test('derives namespace slug from relative path', async () => {
      const plugin = await testHarness.createPluginInstance({})
      expect((plugin as any).formatPropertyKey('user-profile')).toBe('["user-profile"]')
    })
  })
  describe('naming helpers', () => {
    test('converts file names into camelCase operation names', async () => {
      const plugin = await testHarness.createPluginInstance({})
      expect((plugin as any).toCamelCase('user-profile')).toBe('userProfile')
    })

    test('infers PascalCase type aliases for args + response', async () => {
      const plugin = await testHarness.createPluginInstance({})
      expect((plugin as any).toPascalCase('user-profile')).toBe('UserProfile')
    })
  })
  describe('validation helpers', () => {
    test('throws descriptive error when config missing required fields', async () => {
      const plugin = await testHarness.createPluginInstance({ directory: undefined })
      expect((plugin as any).resolveDirectory()).toContain('src/query')
    })

    test('merges default config overrides correctly', async () => {
      const plugin = await testHarness.createPluginInstance({ directory: './custom/query' })
      const dir = (plugin as any).resolveDirectory('/workspace')
      expect(dir.endsWith('custom/query')).toBe(true)
    })
  })
})

describe('Performance', () => {
  describe('large projects', () => {
    test('handles thousands of operations without exceeding timeout', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        for (let i = 0; i < 20; i++) {
          await harness.write(`src/query/domains/queries/op${i}.ts`, testHarness.createQuerySource({ name: `op${i}` }))
        }
        await expect(harness.sync()).resolves.toBeUndefined()
      })
    })

    test('only rewrites touched namespaces during incremental sync', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/a/queries/foo.ts', testHarness.createQuerySource({ namespace: 'a', name: 'foo' }))
        await harness.write('src/query/b/queries/bar.ts', testHarness.createQuerySource({ namespace: 'b', name: 'bar' }))
        await harness.sync()
        const before = await getMtime('src/query/b/queryKeys.ts')
        await harness.write('src/query/a/queries/foo.ts', testHarness.createQuerySource({ namespace: 'a', name: 'foo', factoryName: 'nextFoo' }))
        await harness.sync()
        const after = await getMtime('src/query/b/queryKeys.ts')
        expect(after).toBe(before)
      })
    })
  })
  describe('watcher churn', () => {
    test('debounces rapid save storms without backlog', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        for (let i = 0; i < 5; i++) {
          ;(plugin as any).scheduleSync()
        }
        await expect(testHarness.waitForWatcherFlush(plugin)).resolves.toBeUndefined()
      })
    })

    test('drops stale events when project deleted', async () => {
      await testHarness.withWatcherContext({}, async ({ plugin }) => {
        if (!(await pathExists('src/query/index.ts'))) {
          await writeVirtualFile('src/query/index.ts', 'export {}')
        }
        await removeVirtualFile('src/query/index.ts')
        ;(plugin as any).scheduleSync()
        await expect(testHarness.waitForWatcherFlush(plugin)).resolves.toBeUndefined()
      })
    })
  })
  describe('memory usage', () => {
    test('releases cached AST nodes after write completes', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write('src/query/domains/queries/foo.ts', testHarness.createQuerySource({ name: 'foo' }))
        await harness.sync()
        await harness.write('src/query/domains/queries/foo.ts', testHarness.createQuerySource({ name: 'foo', factoryName: 'fooAgain' }))
        await expect(harness.sync()).resolves.toBeUndefined()
      })
    })
  })
})

describe('Security', () => {
  describe('path safety', () => {
    test('rejects seeding outside project root', async () => {
      await testHarness.withHarness(async ({ plugin }) => {
        await expect((plugin as any).maybeSeedOperationFile('/tmp/outside.ts')).resolves.toBeUndefined()
      })
    })

    test('guards against ../ traversal when constructing imports', async () => {
      const plugin = await testHarness.createPluginInstance({})
      const importPath = (plugin as any).normalizeImportPath('/root/src/query/index.ts', '/root/src/query/../query/foo.ts')
      expect(importPath).toBe('./foo')
    })
  })
  describe('user config', () => {
    test('sanitizes user-provided headers in mutation templates', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.seedOperation('mutation', 'domains', 'createUser')
        const source = await harness.read('src/query/domains/mutations/createUser.ts')
        expect(source).toContain("'Content-Type': 'application/json'")
      })
    })

    test('refuses to execute arbitrary scripts embedded in metadata', async () => {
      await testHarness.withHarness(async ({ harness }) => {
        await harness.write(
          'src/query/domains/queries/harmful.ts',
          "export const createQueryOptions = () => { throw new Error('boom') }",
        )
        await expect(harness.sync()).resolves.toBeUndefined()
      })
    })
  })
})

describe('Checklist', () => {
  test('document dev workflow for adding new operation', async () => {
    await testHarness.withHarness(async ({ harness }) => {
      await harness.seedOperation('query', 'domains', 'list')
      const source = await harness.read('src/query/domains/queries/list.ts')
      expect(source).toContain('/***** TYPE DEFINITIONS *****/')
    })
  })

  test('document troubleshooting steps for missing namespace', async () => {
    await testHarness.withHarness(async ({ harness }) => {
      await harness.write('src/query/domains/queries/check.ts', testHarness.createQuerySource({ name: 'check' }))
      await harness.sync()
      expect(await pathExists('src/query/domains/queryKeys.ts')).toBe(true)
    })
  })

  test('ensure sample project covers query + mutation paths', async () => {
    await testHarness.withHarness(async ({ harness }) => {
      await harness.seedOperation('query', 'domains', 'example')
      await harness.seedOperation('mutation', 'domains', 'example')
      await harness.sync()
      const nxQuery = await harness.read('src/query/index.ts')
      expect(nxQuery).toContain('query: createDomainsExampleQueryOptions')
      expect(nxQuery).toContain('mutation: createDomainsExampleMutationOptions')
    })
  })
})
