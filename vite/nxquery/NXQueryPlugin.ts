import type { Program, TSTypeAnnotation } from '@oxc-project/types'
import type { Dirent } from 'node:fs'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'
import type { ViteDevServer } from 'vite'

export type OnFileChangeCallback = (event: 'add' | 'change' | 'unlink', file: string) => void

export type Options = {
  directory?: string
  onChange?: OnFileChangeCallback
}

export const defaultOptions: Options = {
  directory: './src/query',
}

type OperationKind = 'query' | 'mutation'

type OperationInfo = {
  kind: OperationKind
  namespace: string
  name: string
  filePath: string
  importPath: string
  factoryName: string
  aliasName: string
  paramName?: string
  paramType?: string
  hasParams: boolean
  argsTypeName?: string
}

type OperationBucket = Partial<Record<OperationKind, OperationInfo>>

type NamespaceInfo = {
  name: string
  absolutePath: string
  operations: Map<string, OperationBucket>
}

export class NXQueryPlugin {
  private resolvedDir?: string
  private devServer?: ViteDevServer
  private subscribers: OnFileChangeCallback[] = []
  private syncChain: Promise<void> = Promise.resolve()
  private syncPending = false

  constructor(private readonly options: Options) {}

  public async initialize(root?: string) {
    const dir = this.resolveDirectory(root)
    this.resolvedDir = dir
    await this.ensureBaseStructure(dir)
    await this.syncProject()
  }

  public attachDevServer(server: ViteDevServer) {
    this.devServer = server
    const dir = this.resolveDirectory(server.config.root)
    this.resolvedDir = dir

    server.watcher.add(dir)

    const handleAdd = (file: string) => {
      if (!this.shouldProcess(file, dir)) return
      void this.handleFileAdded(file)
    }
    const handleChange = (file: string) => {
      if (!this.shouldProcess(file, dir)) return
      this.emit('change', file)
      this.scheduleSync()
    }
    const handleUnlink = (file: string) => {
      if (!this.shouldProcess(file, dir)) return
      this.emit('unlink', file)
      this.scheduleSync()
    }
    const handleAddDir = (directory: string) => {
      if (!this.isInDir(directory, dir)) return
      void this.handleDirectoryAdded(directory)
    }
    const handleUnlinkDir = (directory: string) => {
      if (!this.isInDir(directory, dir)) return
      this.scheduleSync()
    }

    ;(this as any)._onAdd = handleAdd
    ;(this as any)._onChange = handleChange
    ;(this as any)._onUnlink = handleUnlink
    ;(this as any)._onAddDir = handleAddDir
    ;(this as any)._onUnlinkDir = handleUnlinkDir

    server.watcher.on('add', handleAdd)
    server.watcher.on('change', handleChange)
    server.watcher.on('unlink', handleUnlink)
    server.watcher.on('addDir', handleAddDir)
    server.watcher.on('unlinkDir', handleUnlinkDir)

    if (this.options.onChange) {
      this.on(this.options.onChange)
    }

    void this.initialize(server.config.root)
  }

  public async handleHotUpdate(ctx: { file: string; server: ViteDevServer }) {
    const dir = this.resolvedDir ?? this.resolveDirectory(ctx.server.config.root)
    if (!this.shouldProcess(ctx.file, dir)) return
    this.emit('change', ctx.file)
    this.scheduleSync()
    ctx.server.ws.send({ type: 'full-reload' })
    return []
  }

  public on(cb: OnFileChangeCallback) {
    this.subscribers.push(cb)
  }

  public off(cb: OnFileChangeCallback) {
    this.subscribers = this.subscribers.filter((listener) => listener !== cb)
  }

  private emit(event: 'add' | 'change' | 'unlink', file: string) {
    if (this.options.onChange) {
      this.options.onChange(event, file)
    }
    for (const subscriber of this.subscribers) {
      subscriber(event, file)
    }
  }

  private resolveDirectory(root?: string) {
    const dir = this.options.directory ?? defaultOptions.directory ?? './src/query'
    const base = root ?? process.cwd()
    return path.resolve(base, dir)
  }

  private shouldProcess(file: string, dir: string) {
    return this.isInDir(file, dir) && !this.isManagedArtifact(file)
  }

  private isInDir(file: string, dir: string) {
    const resolvedFile = path.resolve(file)
    const resolvedDir = path.resolve(dir)
    if (resolvedFile === resolvedDir) return true
    const withSep = resolvedDir.endsWith(path.sep) ? resolvedDir : `${resolvedDir}${path.sep}`
    return resolvedFile.startsWith(withSep)
  }

  private isManagedArtifact(file: string) {
    if (!this.resolvedDir) return false
    const relative = path.relative(this.resolvedDir, file)
    if (relative === 'index.ts' || relative === 'keys.ts') return true
    const segments = relative.split(path.sep)
    return segments.length === 2 && segments[1] === 'queryKeys.ts'
  }

  private async handleFileAdded(file: string) {
    await this.maybeSeedOperationFile(file)
    this.emit('add', file)
    this.scheduleSync()
  }

  private async handleDirectoryAdded(directory: string) {
    await this.ensureNamespaceSkeleton(directory)
    this.scheduleSync()
  }

  private async ensureBaseStructure(dir: string) {
    await this.ensureDirectory(dir)
    await this.ensureFile(path.join(dir, 'index.ts'), () => ['export const NXQuery = {}', '', 'export default NXQuery', ''].join('\n'))
    await this.ensureFile(path.join(dir, 'keys.ts'), () => ['export const queryKeys = {}', '', 'export default queryKeys', ''].join('\n'))

    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue
      await this.ensureNamespaceSkeleton(path.join(dir, entry.name))
    }
  }

  private async ensureNamespaceSkeleton(namespacePath: string) {
    if (!this.resolvedDir) return
    const rel = path.relative(this.resolvedDir, namespacePath)
    if (!rel || rel.startsWith('..')) return
    if (rel.split(path.sep).length !== 1) return

    const queriesDir = path.join(namespacePath, 'queries')
    const mutationsDir = path.join(namespacePath, 'mutations')
    const keyFile = path.join(namespacePath, 'queryKeys.ts')

    await this.ensureDirectory(namespacePath)
    await this.ensureDirectory(queriesDir)
    await this.ensureDirectory(mutationsDir)
    await this.ensureFile(keyFile, () => ['export const queryKeys = {}', '', 'export default queryKeys', ''].join('\n'))
  }

  private async ensureDirectory(target: string) {
    await fs.mkdir(target, { recursive: true })
  }

  private async ensureFile(target: string, fallback: () => string) {
    if (existsSync(target)) return
    await fs.writeFile(target, fallback(), 'utf8')
  }

  private async maybeSeedOperationFile(file: string) {
    if (!this.resolvedDir || !file.endsWith('.ts')) return
    const relative = path.relative(this.resolvedDir, file)
    const segments = relative.split(path.sep)
    if (segments.length !== 3) return
    const [namespace, scope, filename] = segments
    if (scope !== 'queries' && scope !== 'mutations') return

    const absPath = path.join(this.resolvedDir, namespace, scope, filename)
    let existing = ''
    try {
      existing = await fs.readFile(absPath, 'utf8')
    } catch {
      return
    }
    if (existing.trim().length > 0) return

    const baseName = filename.replace(/\.ts$/, '')
    const template = scope === 'queries'
      ? this.buildQueryTemplate(namespace, baseName)
      : this.buildMutationTemplate(namespace, baseName)
    await fs.writeFile(absPath, template, 'utf8')
  }

  private buildQueryTemplate(namespace: string, fileName: string) {
    const namespacePascal = this.toPascalCase(namespace)
    const filePascal = this.toPascalCase(fileName)
    const argsType = `${namespacePascal}${filePascal}Args`
    const returnType = `${namespacePascal}${filePascal}Return`
    const accessor = `${this.buildPropertyAccessor('queryKeys', fileName)}.query`
    return [
      "import { queryOptions } from '@tanstack/react-query'",
      "import { z } from 'zod'",
      "import queryKeys from '../queryKeys'",
      '',
      '/***** TYPE DEFINITIONS *****/',
      `export type ${argsType} = z.infer<typeof argsSchema>`,
      `export type ${returnType} = z.infer<typeof responseSchema>`,
      '',
      '/***** SCHEMAS *****/',
      'export const argsSchema = z.never()',
      'export const responseSchema = z.never()',
      '',
      '/***** CONSTS *****/',
      "export const endpoint = '/todo'",
      '',
      '/***** QUERY OPTIONS *****/',
      `export const createQueryOptions = (rawArgs: ${argsType}) => {`,
      '  const args = argsSchema.parse(rawArgs)',
      '',
      '  return queryOptions({',
      `    queryKey: ${accessor}(args),`,
      '    queryFn: async () => {',
      '      const response = await fetch(endpoint)',
      '      const json = await response.json()',
      '      const parsed = responseSchema.parse(json)',
      '      return parsed as ' + returnType,
      '    },',
      '  })',
      '}',
      '',
    ].join('\n')
  }

  private buildMutationTemplate(namespace: string, fileName: string) {
    const namespacePascal = this.toPascalCase(namespace)
    const filePascal = this.toPascalCase(fileName)
    const returnType = `${namespacePascal}${filePascal}Return`
    const accessor = `${this.buildPropertyAccessor('queryKeys', fileName)}.mutation`
    return [
      "import { mutationOptions } from '@tanstack/react-query'",
      "import { z } from 'zod'",
      "import queryKeys from '../queryKeys'",
      '',
      '/***** TYPE DEFINITIONS *****/',
      `export type ${returnType} = z.infer<typeof responseSchema>`,
      '',
      '/***** SCHEMAS *****/',
      'export const responseSchema = z.never()',
      '',
      '/***** CONSTS *****/',
      "export const endpoint = '/todo'",
      '',
      '/***** MUTATION OPTIONS *****/',
      'export const createMutationOptions = () => {',
      '  return mutationOptions({',
      `    mutationKey: ${accessor},`,
      '    mutationFn: async () => {',
      '      const response = await fetch(endpoint)',
      '      const json = await response.json()',
      '      const parsed = responseSchema.parse(json)',
      '      return parsed as ' + returnType,
      '    },',
      '  })',
      '}',
      '',
    ].join('\n')
  }

  private buildPropertyAccessor(objectName: string, key: string) {
    return this.isValidIdentifier(key)
      ? `${objectName}.${key}`
      : `${objectName}[${JSON.stringify(key)}]`
  }

  private scheduleSync() {
    if (this.syncPending) return
    this.syncPending = true
    this.syncChain = this.syncChain
      .catch((error) => {
        console.error('[nxquery] previous sync failed', error)
      })
      .then(async () => {
        try {
          await this.syncProject()
        } finally {
          this.syncPending = false
        }
      })
  }

  private async syncProject() {
    if (!this.resolvedDir) return
    await this.ensureBaseStructure(this.resolvedDir)
    const namespaces = await this.collectNamespaces(this.resolvedDir)
    await Promise.all(namespaces.map((ns) => this.writeNamespaceQueryKeys(ns)))
    await this.writeRootQueryKeys(namespaces)
    await this.writeNXQueryFile(namespaces)
  }

  private async collectNamespaces(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const namespaces: NamespaceInfo[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue
      const namespacePath = path.join(dir, entry.name)
      const operations = await this.collectOperations(entry.name, namespacePath)
      namespaces.push({ name: entry.name, absolutePath: namespacePath, operations })
    }
    namespaces.sort((a, b) => a.name.localeCompare(b.name))
    return namespaces
  }

  private async collectOperations(namespace: string, namespacePath: string) {
    const map = new Map<string, OperationBucket>()
    const visit = async (kind: OperationKind, folder: 'queries' | 'mutations') => {
      const targetDir = path.join(namespacePath, folder)
      const entries = await this.safeReadDir(targetDir)
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
        const filePath = path.join(targetDir, entry.name)
        const info = await this.parseOperationFile(namespace, kind, filePath)
        if (!info) continue
        const bucket = map.get(info.name) ?? {}
        bucket[kind] = info
        map.set(info.name, bucket)
      }
    }

    await visit('query', 'queries')
    await visit('mutation', 'mutations')
    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))
  }

  private async safeReadDir(dir: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }

  private async parseOperationFile(namespace: string, kind: OperationKind, filePath: string): Promise<OperationInfo | null> {
    let code: string
    try {
      code = await fs.readFile(filePath, 'utf8')
    } catch {
      return null
    }

    let program: Program
    try {
      program = parseSync(filePath, code, { lang: 'ts', sourceType: 'module', astType: 'ts' }).program
    } catch (error) {
      console.warn('[nxquery] Failed to parse', filePath, error)
      return null
    }

    const declarator = this.findOperationFactory(program)
    if (!declarator || declarator.id.type !== 'Identifier') {
      return null
    }

    const init = declarator.init as { type?: string; params?: any[] } | undefined
    if (!init || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) {
      return null
    }

    const firstParam = kind === 'mutation' ? undefined : init.params?.[0]
    const paramName = kind === 'mutation' ? undefined : this.extractParamName(firstParam)
    const paramType = kind === 'mutation' ? undefined : this.extractTypeAnnotation(firstParam, code)
    const argsTypeName = this.findArgsTypeName(program)
    const importPath = this.normalizeImportPath(path.join(this.resolvedDir ?? path.dirname(filePath), 'index.ts'), filePath)
    const aliasName = this.buildAlias(namespace, declarator.id.name, kind, filePath)

    return {
      kind,
      namespace,
      name: path.basename(filePath, '.ts'),
      filePath,
      importPath,
      factoryName: declarator.id.name,
      aliasName,
      paramName,
      paramType,
      hasParams: kind === 'mutation' ? false : Boolean(firstParam),
      argsTypeName,
    }
  }

  private extractParamName(param: any) {
    if (!param) return undefined
    if (param.type === 'Identifier' && param.name) return param.name
    return 'args'
  }

  private extractTypeAnnotation(param: any, source: string) {
    const annotation = param?.typeAnnotation as TSTypeAnnotation | undefined
    if (!annotation) return undefined
    const raw = source.slice(annotation.start, annotation.end)
    return raw.replace(/^:\s*/, '').trim() || undefined
  }

  private findArgsTypeName(program: Program) {
    for (const node of program.body) {
      if (node.type !== 'ExportNamedDeclaration') continue
      const declaration = node.declaration
      if (!declaration) continue
      if (
        declaration.type === 'TSTypeAliasDeclaration' ||
        declaration.type === 'TSInterfaceDeclaration'
      ) {
        const identifier = declaration.id?.name
        if (identifier && identifier.endsWith('Args')) {
          return identifier
        }
      }
    }
    return undefined
  }

  private findOperationFactory(program: Program) {
    const candidates: any[] = []
    for (const node of program.body) {
      if (node.type !== 'ExportNamedDeclaration') continue
      const declaration = node.declaration
      if (!declaration || declaration.type !== 'VariableDeclaration') continue
      for (const declarator of declaration.declarations) {
        if (!declarator || declarator.id?.type !== 'Identifier') continue
        const init = declarator.init as { type?: string } | undefined
        if (!init) continue
        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          candidates.push(declarator)
        }
      }
    }

    if (!candidates.length) return null
    const preferred = candidates.find(
      (declarator) => declarator.id?.type === 'Identifier' &&
        (declarator.id.name === 'createQueryOptions' || declarator.id.name === 'createMutationOptions'),
    )
    return preferred ?? candidates[0]
  }

  private buildAlias(namespace: string, exportName: string, kind: OperationKind, filePath: string) {
    const namespacePascal = this.toPascalCase(namespace)
    const filePascal = this.toPascalCase(path.basename(filePath, '.ts'))
    const suffix = kind === 'query' ? 'QueryOptions' : 'MutationOptions'
    const prefix = exportName === 'createQueryOptions' || exportName === 'createMutationOptions' ? 'create' : ''
    return `${prefix}${namespacePascal}${filePascal}${suffix}`
  }

  private normalizeImportPath(fromFile: string, toFile: string) {
    let relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
    if (!relative.startsWith('.')) relative = `./${relative}`
    if (relative.endsWith('.ts')) relative = relative.slice(0, -3)
    return relative
  }

  private async writeNamespaceQueryKeys(namespace: NamespaceInfo) {
    const filePath = path.join(namespace.absolutePath, 'queryKeys.ts')
    const content = this.renderNamespaceQueryKeys(namespace)
    await this.writeFileIfChanged(filePath, content)
  }

  private renderNamespaceQueryKeys(namespace: NamespaceInfo) {
    const lines: string[] = []
    const queryKeysFile = path.join(namespace.absolutePath, 'queryKeys.ts')
    const importMap = new Map<string, Set<string>>()
    for (const bucket of namespace.operations.values()) {
      for (const op of Object.values(bucket)) {
        if (!op || !op.argsTypeName) continue
        const importPath = this.normalizeImportPath(queryKeysFile, op.filePath)
        const existing = importMap.get(importPath) ?? new Set<string>()
        existing.add(op.argsTypeName)
        importMap.set(importPath, existing)
      }
    }

    const importLines = [...importMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([importPath, names]) => `import type { ${[...names].sort().join(', ')} } from '${importPath}'`)

    if (importLines.length > 0) {
      lines.push(...importLines, '')
    }

    lines.push('export const queryKeys = {')
    for (const [name, bucket] of namespace.operations.entries()) {
      lines.push(...this.renderNamespaceEntry(name, namespace.name, bucket))
    }
    lines.push('} as const', '', 'export default queryKeys', '')
    return lines.join('\n')
  }

  private renderNamespaceEntry(name: string, namespace: string, bucket: OperationBucket) {
    const property = this.formatPropertyKey(name)
    const hasQuery = Boolean(bucket.query)
    const hasMutation = Boolean(bucket.mutation)
    if (!hasQuery && !hasMutation) {
      return []
    }
    const includeKindSegment = hasQuery && hasMutation
    const lines: string[] = []
    lines.push(`  ${property}: {`)
    if (bucket.query) {
      lines.push(...this.renderOperationFunction('query', bucket.query, namespace, name, 2, includeKindSegment))
    }
    if (bucket.mutation) {
      lines.push(...this.renderOperationFunction('mutation', bucket.mutation, namespace, name, 2, includeKindSegment))
    }
    lines.push('  },')
    return lines
  }

  private renderOperationFunction(
    propertyName: 'query' | 'mutation',
    op: OperationInfo,
    namespace: string,
    operationName: string,
    indentLevel: number,
    includeKindSegment: boolean,
  ) {
    const indent = '  '.repeat(indentLevel)
    const property = this.formatPropertyKey(propertyName)
    if (propertyName === 'mutation') {
      const keySegments = [`'${namespace}'`, `'${operationName}'`]
      if (includeKindSegment) keySegments.push(`'mutation'`)
      return [`${indent}${property}: [${keySegments.join(', ')}] as const,`]
    }
    const paramName = op.paramName ?? (op.hasParams ? 'args' : undefined)
    const preferredType = op.argsTypeName ?? op.paramType
    const signature = paramName ? (preferredType ? `${paramName}: ${preferredType}` : paramName) : ''
    const fnSignature = signature ? `(${signature})` : '()'
    const keySegments = [`'${namespace}'`, `'${operationName}'`]
    if (includeKindSegment) keySegments.push(`'query'`)
    if (paramName) keySegments.push(paramName)
    return [`${indent}${property}: ${fnSignature} => [${keySegments.join(', ')}] as const,`]
  }

  private async writeRootQueryKeys(namespaces: NamespaceInfo[]) {
    if (!this.resolvedDir) return
    const filePath = path.join(this.resolvedDir, 'keys.ts')
    const imports = namespaces.map(
      (ns) => `import { queryKeys as ${this.toCamelCase(ns.name)}QueryKeys } from './${ns.name}/queryKeys'`,
    )
    const lines: string[] = []
    if (imports.length) {
      lines.push(...imports, '')
    }
    lines.push('export const queryKeys = {')
    for (const ns of namespaces) {
      lines.push(`  ${this.formatPropertyKey(ns.name)}: ${this.toCamelCase(ns.name)}QueryKeys,`)
    }
    lines.push('} as const', '', 'export default queryKeys', '')
    await this.writeFileIfChanged(filePath, lines.join('\n'))
  }

  private async writeNXQueryFile(namespaces: NamespaceInfo[]) {
    if (!this.resolvedDir) return
    const filePath = path.join(this.resolvedDir, 'index.ts')

    const importLines: string[] = []
    for (const ns of namespaces) {
      for (const bucket of ns.operations.values()) {
        for (const op of Object.values(bucket)) {
          if (!op) continue
          importLines.push(`import { ${op.factoryName} as ${op.aliasName} } from '${op.importPath}'`)
        }
      }
    }

    const body: string[] = []
    body.push('export const NXQuery = {')
    for (const ns of namespaces) {
      body.push(`  ${this.formatPropertyKey(ns.name)}: {`)
      if (ns.operations.size) {
        for (const [name, bucket] of ns.operations.entries()) {
          const property = this.formatPropertyKey(name)
          if (bucket.query && bucket.mutation) {
            body.push(`    ${property}: {`)
            body.push(`      query: ${bucket.query.aliasName},`)
            body.push(`      mutation: ${bucket.mutation.aliasName},`)
            body.push('    },')
          } else {
            const op = bucket.query ?? bucket.mutation!
            body.push(`    ${property}: ${op.aliasName},`)
          }
        }
      }
      body.push('  },')
    }
    body.push('} as const', '', 'export default NXQuery', '')

    const sections: string[] = []
    if (importLines.length) {
      sections.push(...importLines.sort(), '')
    }
    sections.push(...body)

    await this.writeFileIfChanged(filePath, sections.join('\n'))
  }

  private toPascalCase(value: string) {
    return value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('')
  }

  private toCamelCase(value: string) {
    const pascal = this.toPascalCase(value)
    return pascal.charAt(0).toLowerCase() + pascal.slice(1)
  }

  private formatPropertyKey(name: string) {
    return this.isValidIdentifier(name) ? name : `[${JSON.stringify(name)}]`
  }

  private isValidIdentifier(value: string) {
    return /^[A-Za-z_$][\w$]*$/.test(value)
  }

  private async writeFileIfChanged(target: string, content: string) {
    try {
      const existing = await fs.readFile(target, 'utf8')
      if (existing === content) return
    } catch {
      // ignore
    }
    await fs.writeFile(target, content, 'utf8')
  }
}
