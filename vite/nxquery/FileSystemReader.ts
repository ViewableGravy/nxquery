import type { Program, TSTypeAnnotation } from '@oxc-project/types'
import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'

export type OperationKind = 'query' | 'mutation'

export type OperationInfo = {
  readonly kind: OperationKind
  readonly namespace: string
  readonly name: string
  readonly filePath: string
  readonly importPath: string
  readonly factoryName: string
  readonly aliasName: string
  readonly paramName?: string
  readonly paramType?: string
  readonly hasParams: boolean
  readonly argsTypeName?: string
}

export type OperationBucket = Partial<Record<OperationKind, OperationInfo>>

export type NamespaceInfo = {
  readonly name: string
  readonly absolutePath: string
  readonly operations: ReadonlyMap<string, OperationBucket>
}

export class FileSystemReader {
  constructor(private readonly resolvedDir: string) {}

  async safeReadDir(dir: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }

  async collectNamespaces(): Promise<ReadonlyArray<NamespaceInfo>> {
    const entries = await fs.readdir(this.resolvedDir, { withFileTypes: true })
    const namespaces: NamespaceInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue

      const namespacePath = path.join(this.resolvedDir, entry.name)
      const operations = await this.collectOperations(entry.name, namespacePath)
      namespaces.push({ name: entry.name, absolutePath: namespacePath, operations })
    }

    namespaces.sort((a, b) => a.name.localeCompare(b.name))
    return namespaces
  }

  async collectOperations(namespace: string, namespacePath: string): Promise<ReadonlyMap<string, OperationBucket>> {
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

  async parseOperationFile(namespace: string, kind: OperationKind, filePath: string): Promise<OperationInfo | null> {
    let code: string
    try {
      code = await fs.readFile(filePath, 'utf8')
    } catch {
      return null
    }

    let program: Program
    try {
      const result = parseSync(filePath, code, { lang: 'ts', sourceType: 'module', astType: 'ts' }) as {
        program: Program
        errors?: Array<{ message?: string; codeframe?: string }>
      }

      if (result.errors && result.errors.length > 0) {
        for (const diagnostic of result.errors) {
          const details = diagnostic.codeframe ?? diagnostic.message ?? 'Unknown parser error'
          console.warn('[nxquery] Failed to parse', filePath, details)
        }
        return null
      }

      program = result.program
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
    const importPath = this.normalizeImportPath(path.join(this.resolvedDir, 'index.ts'), filePath)
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

  private extractParamName(param: any): string | undefined {
    if (!param) return undefined
    if (param.type === 'Identifier' && param.name) return param.name
    return 'args'
  }

  private extractTypeAnnotation(param: any, source: string): string | undefined {
    const annotation = param?.typeAnnotation as TSTypeAnnotation | undefined
    if (!annotation) return undefined
    const raw = source.slice(annotation.start, annotation.end)
    return raw.replace(/^:\s*/, '').trim() || undefined
  }

  private findArgsTypeName(program: Program): string | undefined {
    for (const node of program.body) {
      if (node.type !== 'ExportNamedDeclaration') continue
      const declaration = node.declaration
      if (!declaration) continue

      if (declaration.type === 'TSTypeAliasDeclaration' || declaration.type === 'TSInterfaceDeclaration') {
        const identifier = declaration.id?.name
        if (identifier && identifier.endsWith('Args')) {
          return identifier
        }
      }
    }
    return undefined
  }

  private findOperationFactory(program: Program): any | null {
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
      (declarator) =>
        declarator.id?.type === 'Identifier' &&
        (declarator.id.name === 'createQueryOptions' || declarator.id.name === 'createMutationOptions'),
    )

    return preferred ?? candidates[0]
  }

  private buildAlias(namespace: string, exportName: string, kind: OperationKind, filePath: string): string {
    const namespacePascal = this.toPascalCase(namespace)
    const filePascal = this.toPascalCase(path.basename(filePath, '.ts'))
    const suffix = kind === 'query' ? 'QueryOptions' : 'MutationOptions'
    const prefix = exportName === 'createQueryOptions' || exportName === 'createMutationOptions' ? 'create' : ''
    return `${prefix}${namespacePascal}${filePascal}${suffix}`
  }

  private normalizeImportPath(fromFile: string, toFile: string): string {
    let relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
    if (!relative.startsWith('.')) relative = `./${relative}`
    if (relative.endsWith('.ts')) relative = relative.slice(0, -3)
    return relative
  }

  private toPascalCase(value: string): string {
    return value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('')
  }
}
