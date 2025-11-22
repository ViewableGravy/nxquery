import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { CodeGenerator } from './CodeGenerator'
import { FileSystemReader } from './FileSystemReader'
import { FileSystemWriter } from './FileSystemWriter'
import { FileWatcher, type OnFileChangeCallback } from './FileWatcher'

export type { OnFileChangeCallback } from './FileWatcher'

export type Options = {
  directory?: string
  onChange?: OnFileChangeCallback
}

export const defaultOptions: Options = {
  directory: './src/query',
}

export class NXQueryPlugin {
  private resolvedDir?: string
  private devServer?: ViteDevServer
  private syncChain: Promise<void> = Promise.resolve()
  private syncPending = false

  private reader?: FileSystemReader
  private writer?: FileSystemWriter
  private watcher?: FileWatcher
  private generator?: CodeGenerator

  constructor(private readonly options: Options) {}

  async initialize(root?: string): Promise<void> {
    const dir = this.resolveDirectory(root)
    this.resolvedDir = dir

    this.reader = new FileSystemReader(dir)
    this.writer = new FileSystemWriter(dir)
    this.watcher = new FileWatcher(dir, this.options.onChange)
    this.generator = new CodeGenerator(dir)

    await this.writer.ensureBaseStructure()
    await this.syncProject()
  }

  attachDevServer(server: ViteDevServer): void {
    this.devServer = server
    const dir = this.resolveDirectory(server.config.root)
    this.resolvedDir = dir

    if (!this.watcher || !this.writer) {
      this.reader = new FileSystemReader(dir)
      this.writer = new FileSystemWriter(dir)
      this.watcher = new FileWatcher(dir, this.options.onChange)
      this.generator = new CodeGenerator(dir)
    }

    this.watcher.attachDevServer(server, {
      onAdd: (file) => this.handleFileAdded(file),
      onChange: () => this.scheduleSync(),
      onUnlink: () => this.scheduleSync(),
      onAddDir: (directory) => this.handleDirectoryAdded(directory),
      onUnlinkDir: () => this.scheduleSync(),
    })

    void this.initialize(server.config.root)
  }

  async handleHotUpdate(ctx: { file: string; server: ViteDevServer }): Promise<any[]> {
    const dir = this.resolvedDir ?? this.resolveDirectory(ctx.server.config.root)
    if (!this.watcher?.shouldProcess(ctx.file)) return []

    this.watcher.emit('change', ctx.file)
    this.scheduleSync()
    ctx.server.ws.send({ type: 'full-reload' })
    return []
  }

  on(cb: OnFileChangeCallback): void {
    this.watcher?.on(cb)
  }

  off(cb: OnFileChangeCallback): void {
    this.watcher?.off(cb)
  }

  // Exposed for testing
  async maybeSeedOperationFile(filePath: string): Promise<void> {
    if (!this.writer) return
    await this.writer.maybeSeedOperationFile(filePath)
  }

  async writeFileIfChanged(target: string, content: string): Promise<void> {
    if (!this.writer) return
    await this.writer.writeFileIfChanged(target, content)
  }

  normalizeImportPath(fromFile: string, toFile: string): string {
    // Create temporary reader if not initialized
    const reader = this.reader ?? new FileSystemReader(this.resolvedDir ?? process.cwd())
    return (reader as any).normalizeImportPath(fromFile, toFile)
  }

  formatPropertyKey(name: string): string {
    // Create temporary generator if not initialized
    const generator = this.generator ?? new CodeGenerator(this.resolvedDir ?? process.cwd())
    return (generator as any).formatPropertyKey(name)
  }

  toCamelCase(value: string): string {
    // Create temporary generator if not initialized
    const generator = this.generator ?? new CodeGenerator(this.resolvedDir ?? process.cwd())
    return (generator as any).toCamelCase(value)
  }

  toPascalCase(value: string): string {
    // Create temporary reader if not initialized
    const reader = this.reader ?? new FileSystemReader(this.resolvedDir ?? process.cwd())
    return (reader as any).toPascalCase(value)
  }

  async syncProject(): Promise<void> {
    if (!this.resolvedDir || !this.reader || !this.writer || !this.generator) return

    await this.writer.ensureBaseStructure()
    const namespaces = await this.reader.collectNamespaces()

    await Promise.all(
      namespaces.map((ns) => {
        const content = this.generator!.renderNamespaceQueryKeys(ns)
        const filePath = path.join(ns.absolutePath, 'queryKeys.ts')
        return this.writeFileIfChanged(filePath, content)
      }),
    )

    const rootKeysContent = this.generator.renderRootQueryKeys(namespaces)
    await this.writeFileIfChanged(path.join(this.resolvedDir, 'keys.ts'), rootKeysContent)

    const nxQueryContent = this.generator.renderNXQueryFile(namespaces)
    await this.writeFileIfChanged(path.join(this.resolvedDir, 'index.ts'), nxQueryContent)
  }

  private resolveDirectory(root?: string): string {
    const dir = this.options.directory ?? defaultOptions.directory ?? './src/query'
    const base = root ?? process.cwd()
    return path.resolve(base, dir)
  }

  private async handleFileAdded(file: string): Promise<void> {
    if (!this.writer) return
    await this.writer.maybeSeedOperationFile(file)
    this.watcher?.emit('add', file)
    this.scheduleSync()
  }

  private async handleDirectoryAdded(directory: string): Promise<void> {
    if (!this.writer) return
    await this.writer.ensureNamespaceSkeleton(directory)
    this.scheduleSync()
  }

  private scheduleSync(): void {
    if (this.syncPending) return

    this.syncPending = true
    this.syncChain = this.syncChain
      .catch((error) => {
        this.reportSyncError('previous sync failed. Fix the reported issue and save again.', error)
      })
      .then(() => this.runSync())
      .catch(() => {
        // Already logged in runSync, swallow to keep chain alive
      })
  }

  private async runSync(): Promise<void> {
    try {
      await this.syncProject()
    } catch (error) {
      this.reportSyncError('sync failed. Fix the reported issue and save again.', error)
    } finally {
      this.syncPending = false
    }
  }

  private reportSyncError(message: string, error: unknown): void {
    console.error(`[nxquery] ${message}`, error)
  }
}
