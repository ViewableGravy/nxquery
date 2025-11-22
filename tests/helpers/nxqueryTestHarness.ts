import { beforeEach, mock } from 'bun:test'
import { Volume, createFsFromVolume } from 'memfs'
import path from 'node:path'
import type { NXQueryPlugin, Options } from '../../vite/nxquery/NXQueryPlugin.ts'
import { FileInspector } from './fileInspector'
import { FilesystemAsserter } from './fsAssertions'
import { TemplateTester } from './templateTester'

const volume = new Volume()
const memfs = createFsFromVolume(volume)
const fsPromises = memfs.promises

mock.module('node:fs', () => ({
  ...memfs,
  promises: fsPromises,
  existsSync: memfs.existsSync.bind(memfs),
}))

const ROOT_DIR = '/workspace'

export const testPaths = {
  root: ROOT_DIR,
  queryDir: path.join(ROOT_DIR, 'src/query'),
}

export const resetVolume = () => {
  volume.reset()
  volume.mkdirSync(ROOT_DIR, { recursive: true })
}

export const writeFile = async (relPath: string, contents: string) => {
  const abs = path.join(ROOT_DIR, relPath)
  await fsPromises.mkdir(path.dirname(abs), { recursive: true })
  await fsPromises.writeFile(abs, contents, { encoding: 'utf8' })
}

export const readFile = async (relPath: string): Promise<string> => {
  const abs = path.join(ROOT_DIR, relPath)
  const contents = await fsPromises.readFile(abs, 'utf8')
  return typeof contents === 'string' ? contents : contents.toString('utf8')
}

export const removeFile = (relPath: string) => {
  const abs = path.join(ROOT_DIR, relPath)
  return fsPromises.unlink(abs)
}

export const pathExists = async (relPath: string) => {
  try {
    await fsPromises.stat(path.join(ROOT_DIR, relPath))
    return true
  } catch {
    return false
  }
}

export const getMtime = async (relPath: string) => {
  const stats = await fsPromises.stat(path.join(ROOT_DIR, relPath))
  return stats.mtimeMs
}

export const pathHelpers = {
  resolve: (relPath: string) => path.join(ROOT_DIR, relPath),
}

const importPlugin = async () => {
  const module = await import('../../vite/nxquery/NXQueryPlugin.ts')
  return module.NXQueryPlugin
}

export const createPluginInstance = async (options: Options = {}) => {
  const Plugin = await importPlugin()
  return new Plugin(options)
}

export const flushPlugin = async (plugin: NXQueryPlugin) => {
  const chain: Promise<void> = (plugin as any).syncChain ?? Promise.resolve()
  await chain
}

export class NXQueryTestHarness {
  #plugin!: NXQueryPlugin
  readonly fs: FilesystemAsserter
  readonly files: FileInspector
  readonly templates: TemplateTester

  private constructor(private readonly options: Options = {}) {
    this.fs = new FilesystemAsserter({
      root: ROOT_DIR,
      stat: (target) => fsPromises.stat(target),
      defaultCwd: 'src/query',
    })
    this.files = new FileInspector((relPath) => this.read(relPath))
    this.templates = new TemplateTester(this.files)
  }

  static async create(options: Options = {}) {
    const harness = new NXQueryTestHarness(options)
    await harness.setup()
    return harness
  }

  get plugin() {
    return this.#plugin
  }

  get rootDir() {
    return ROOT_DIR
  }

  async setup() {
    resetVolume()
    const Plugin = await importPlugin()
    this.#plugin = new Plugin(this.options)
    await this.#plugin.initialize(ROOT_DIR)
  }

  resolve(relPath: string) {
    return path.join(ROOT_DIR, relPath)
  }

  async read(relPath: string): Promise<string> {
    return readFile(relPath)
  }

  async write(relPath: string, contents: string) {
    const abs = this.resolve(relPath)
    await fsPromises.mkdir(path.dirname(abs), { recursive: true })
    await fsPromises.writeFile(abs, contents, { encoding: 'utf8' })
  }

  async exists(relPath: string) {
    try {
      await this.read(relPath)
      return true
    } catch {
      return false
    }
  }

  async seedOperation(
    kind: 'query' | 'mutation',
    namespace: string,
    name: string,
    contents?: string,
  ) {
    const scope = kind === 'query' ? 'queries' : 'mutations'
    const relPath = `src/query/${namespace}/${scope}/${name}.ts`
    await this.write(relPath, contents ?? '')
    await (this.#plugin as any).maybeSeedOperationFile(this.resolve(relPath))
  }

  async sync() {
    await (this.#plugin as any).syncProject()
  }
}

beforeEach(() => {
  resetVolume()
})
