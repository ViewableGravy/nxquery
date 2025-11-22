import path from 'node:path'
import type { ViteDevServer } from 'vite'

export type OnFileChangeCallback = (event: 'add' | 'change' | 'unlink', file: string) => void
export type WatcherEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export type WatcherCallbacks = {
  onAdd: (file: string) => void
  onChange: (file: string) => void
  onUnlink: (file: string) => void
  onAddDir: (directory: string) => void
  onUnlinkDir: (directory: string) => void
}

export class FileWatcher {
  private readonly subscribers: OnFileChangeCallback[] = []
  private devServer?: ViteDevServer
  private handlers?: WatcherCallbacks

  private _onAdd?: (file: string) => void
  private _onChange?: (file: string) => void
  private _onUnlink?: (file: string) => void
  private _onAddDir?: (directory: string) => void
  private _onUnlinkDir?: (directory: string) => void

  constructor(
    private readonly resolvedDir: string,
    private readonly userOnChange?: OnFileChangeCallback,
  ) {}

  attachDevServer(server: ViteDevServer, callbacks: WatcherCallbacks): void {
    this.devServer = server
    this.handlers = callbacks

    server.watcher.add(this.resolvedDir)

    const handleAdd = (file: string) => {
      if (!this.shouldProcess(file)) return
      callbacks.onAdd(file)
    }

    const handleChange = (file: string) => {
      if (!this.shouldProcess(file)) return
      this.emit('change', file)
      callbacks.onChange(file)
    }

    const handleUnlink = (file: string) => {
      if (!this.shouldProcess(file)) return
      this.emit('unlink', file)
      callbacks.onUnlink(file)
    }

    const handleAddDir = (directory: string) => {
      if (!this.isInDir(directory)) return
      callbacks.onAddDir(directory)
    }

    const handleUnlinkDir = (directory: string) => {
      if (!this.isInDir(directory)) return
      callbacks.onUnlinkDir(directory)
    }

    // Store handlers for potential cleanup
    this._onAdd = handleAdd
    this._onChange = handleChange
    this._onUnlink = handleUnlink
    this._onAddDir = handleAddDir
    this._onUnlinkDir = handleUnlinkDir

    server.watcher.on('add', handleAdd)
    server.watcher.on('change', handleChange)
    server.watcher.on('unlink', handleUnlink)
    server.watcher.on('addDir', handleAddDir)
    server.watcher.on('unlinkDir', handleUnlinkDir)

    if (this.userOnChange) {
      this.on(this.userOnChange)
    }
  }

  on(cb: OnFileChangeCallback): void {
    this.subscribers.push(cb)
  }

  off(cb: OnFileChangeCallback): void {
    const index = this.subscribers.indexOf(cb)
    if (index > -1) {
      this.subscribers.splice(index, 1)
    }
  }

  emit(event: 'add' | 'change' | 'unlink', file: string): void {
    if (this.userOnChange) {
      this.userOnChange(event, file)
    }

    for (const subscriber of this.subscribers) {
      subscriber(event, file)
    }
  }

  shouldProcess(file: string): boolean {
    return this.isInDir(file) && !this.isManagedArtifact(file)
  }

  private isInDir(file: string): boolean {
    const resolvedFile = path.resolve(file)
    const resolvedDir = path.resolve(this.resolvedDir)

    if (resolvedFile === resolvedDir) return true

    const withSep = resolvedDir.endsWith(path.sep) ? resolvedDir : `${resolvedDir}${path.sep}`
    return resolvedFile.startsWith(withSep)
  }

  private isManagedArtifact(file: string): boolean {
    const relative = path.relative(this.resolvedDir, file)
    if (relative === 'index.ts' || relative === 'keys.ts') return true

    const segments = relative.split(path.sep)
    return segments.length === 2 && segments[1] === 'queryKeys.ts'
  }
}
