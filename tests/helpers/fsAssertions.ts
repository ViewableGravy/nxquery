import { expect } from 'bun:test'
import path from 'node:path'

export type FsShape = {
  [key: string]: string | FsShape
}

type FileStat = {
  isFile(): boolean
  isDirectory(): boolean
}

export type FilesystemAsserterOptions = {
  root: string
  stat: (target: string) => Promise<FileStat>
  defaultCwd?: string
}

export class FilesystemAsserter {
  private readonly root: string
  private readonly stat: (target: string) => Promise<FileStat>
  private readonly defaultCwd: string

  constructor(options: FilesystemAsserterOptions) {
    this.root = options.root
    this.stat = options.stat
    this.defaultCwd = options.defaultCwd ?? '.'
  }

  async expect(shape: FsShape, options?: { cwd?: string }) {
    const cwd = options?.cwd ?? this.defaultCwd
    const abs = path.join(this.root, cwd)
    await this.assertDirectory(abs)
    await this.walk(abs, shape)
  }

  private async walk(currentDir: string, shape: FsShape) {
    for (const [name, node] of Object.entries(shape)) {
      if (typeof node === 'string') {
        await this.assertFile(currentDir, name, node)
      } else {
        const target = path.join(currentDir, name)
        await this.assertDirectory(target)
        await this.walk(target, node)
      }
    }
  }

  private async assertFile(currentDir: string, key: string, descriptor: string) {
    const target = path.join(currentDir, this.resolveFileName(key, descriptor))
    let stats: FileStat
    try {
      stats = await this.stat(target)
    } catch {
      throw new Error(`Expected file ${this.relative(target)} to exist`)
    }
    expect(stats.isFile()).toBe(true)
  }

  private async assertDirectory(target: string) {
    let stats: FileStat
    try {
      stats = await this.stat(target)
    } catch {
      throw new Error(`Expected directory ${this.relative(target)} to exist`)
    }
    expect(stats.isDirectory()).toBe(true)
  }

  private resolveFileName(key: string, descriptor: string) {
    const simpleExtension = /^[A-Za-z0-9]+$/.test(descriptor)
    return simpleExtension ? `${key}.${descriptor}` : descriptor
  }

  private relative(target: string) {
    return path.relative(this.root, target) || '.'
  }
}
