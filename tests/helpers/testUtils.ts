import path from 'node:path'
import type { ViteDevServer } from 'vite'
import type { NXQueryPlugin, Options } from '../../vite/nxquery/NXQueryPlugin'
import {
  NXQueryTestHarness,
  createPluginInstance,
  flushPlugin,
  removeFile as removeVirtualFile,
  resetVolume,
  testPaths,
  writeFile as writeVirtualFile,
} from './nxqueryTestHarness'

export type WatcherEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export class FakeWatcher {
  readonly addedPaths: string[] = []
  private readonly listeners = new Map<WatcherEvent, Array<(target: string) => void>>()

  add(target: string) {
    this.addedPaths.push(target)
  }

  on(event: WatcherEvent, handler: (target: string) => void) {
    const existing = this.listeners.get(event) ?? []
    existing.push(handler)
    this.listeners.set(event, existing)
  }

  emit(event: WatcherEvent, target: string) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(target)
    }
  }
}

export class TestHarness {
  readonly root = testPaths.root
  private watcher?: FakeWatcher

  createFakeServer(watcher: FakeWatcher, send?: (...args: any[]) => void): ViteDevServer {
    return {
      config: { root: this.root } as any,
      watcher: watcher as any,
      ws: { send: send ?? (() => {}) } as any,
      hot: true,
    } as unknown as ViteDevServer
  }

  async waitForWatcherFlush(plugin: NXQueryPlugin): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPlugin(plugin)
  }

  createPath(relativePath: string): string {
    return path.join(this.root, relativePath)
  }

  async createFile(relativePath: string, content: string = ''): Promise<string> {
    await writeVirtualFile(relativePath, content)
    const absPath = this.createPath(relativePath)
    
    // Automatically emit watcher event if we're in a watcher context
    if (this.watcher) {
      this.watcher.emit('add', absPath)
    }
    
    return absPath
  }

  async updateFile(relativePath: string, content: string): Promise<string> {
    await writeVirtualFile(relativePath, content)
    const absPath = this.createPath(relativePath)
    
    // Automatically emit change event if we're in a watcher context
    if (this.watcher) {
      this.watcher.emit('change', absPath)
    }
    
    return absPath
  }

  async deleteFile(relativePath: string): Promise<string> {
    await removeVirtualFile(relativePath)
    const absPath = this.createPath(relativePath)
    
    // Automatically emit unlink event if we're in a watcher context
    if (this.watcher) {
      this.watcher.emit('unlink', absPath)
    }
    
    return absPath
  }

  createFolder(relativePath: string): string {
    const absPath = this.createPath(relativePath)
    
    // Automatically emit watcher event if we're in a watcher context
    if (this.watcher) {
      this.watcher.emit('addDir', absPath)
    }
    
    return absPath
  }

  /** 
   * Set the watcher for automatic event emission.
   * This is typically called by withWatcherContext.
   */
  setWatcher(watcher: FakeWatcher | undefined): void {
    this.watcher = watcher
  }

  async withWatcherContext(
    options: Options = {},
    cb: (ctx: { plugin: NXQueryPlugin; watcher: FakeWatcher }) => Promise<void>,
  ): Promise<void> {
    resetVolume()
    const plugin = await createPluginInstance(options)
    const originalInitialize = plugin.initialize.bind(plugin)
    let lastInitialize: Promise<void> = Promise.resolve()
    ;(plugin as any).initialize = ((...args: Parameters<NXQueryPlugin['initialize']>) => {
      const pending = originalInitialize(...args)
      lastInitialize = pending
      return pending
    }) as NXQueryPlugin['initialize']
    await plugin.initialize(this.root)
    const watcher = new FakeWatcher()
    const server = this.createFakeServer(watcher)
    plugin.attachDevServer(server)
    await lastInitialize
    await this.waitForWatcherFlush(plugin)
    
    // Set the watcher on the harness for automatic event emission
    this.setWatcher(watcher)
    try {
      await cb({ plugin, watcher })
    } finally {
      // Clean up watcher reference after context exits
      this.setWatcher(undefined)
    }
  }

  async withHarness(
    cb: (ctx: { harness: NXQueryTestHarness; plugin: NXQueryPlugin }) => Promise<void>,
    options: Options = {},
  ): Promise<void> {
    const harness = await NXQueryTestHarness.create(options)
    await cb({ harness, plugin: harness.plugin })
  }

  /**
   * Similar to withHarness but also sets up a watcher context for automatic event emission.
   * Use this when you need to test watcher events with the full harness.
   */
  async withHarnessWatcher(
    cb: (ctx: { harness: NXQueryTestHarness; plugin: NXQueryPlugin; watcher: FakeWatcher }) => Promise<void>,
    options: Options = {},
  ): Promise<void> {
    const harness = await NXQueryTestHarness.create(options)
    const watcher = new FakeWatcher()
    const server = this.createFakeServer(watcher)
    harness.plugin.attachDevServer(server)
    this.setWatcher(watcher)
    try {
      await cb({ harness, plugin: harness.plugin, watcher })
    } finally {
      this.setWatcher(undefined)
    }
  }

  private toPascal(value: string): string {
    return value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('')
  }

  createQuerySource(options: {
    namespace?: string
    name?: string
    factoryName?: string
    includeArgs?: boolean
    includeArgsType?: boolean
    argsTypeName?: string
    extra?: string
  } = {}): string {
    const namespace = options.namespace ?? 'domains'
    const name = options.name ?? 'example'
    const factoryName = options.factoryName ?? 'createQueryOptions'
    const includeArgs = options.includeArgs ?? true
    const includeArgsType = options.includeArgsType ?? true
    const namespacePascal = this.toPascal(namespace)
    const filePascal = this.toPascal(name)
    const argsType = options.argsTypeName ?? `${namespacePascal}${filePascal}Args`
    const argDecl = includeArgs ? `(args: ${argsType})` : '()'
    const key = includeArgs ? `['${namespace}', '${name}', args]` : `['${namespace}', '${name}']`
    return [
      "import { queryOptions } from '@tanstack/react-query'",
      includeArgsType ? `export type ${argsType} = { id: string }` : '',
      `export const ${factoryName} = ${argDecl} => queryOptions({ queryKey: ${key} })`,
      options.extra ?? '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  createMutationSource(options: {
    namespace?: string
    name?: string
    factoryName?: string
    includeArgsType?: boolean
    argsTypeName?: string
    extra?: string
  } = {}): string {
    const namespace = options.namespace ?? 'domains'
    const name = options.name ?? 'createUser'
    const factoryName = options.factoryName ?? 'createMutationOptions'
    const namespacePascal = this.toPascal(namespace)
    const filePascal = this.toPascal(name)
    const argsType = options.argsTypeName ?? `${namespacePascal}${filePascal}Args`
    return [
      "import { mutationOptions } from '@tanstack/react-query'",
      options.includeArgsType === false ? '' : `export type ${argsType} = { id: string }`,
      `export const ${factoryName} = () => mutationOptions({`,
      `  mutationKey: ['${namespace}', '${name}'],`,
      `  mutationFn: async (raw: ${argsType}) => raw,`,
      '})',
      options.extra ?? '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  async createPluginInstance(options: Options = {}): Promise<NXQueryPlugin> {
    return createPluginInstance(options)
  }
}

// Global instance
export const testHarness = new TestHarness()
