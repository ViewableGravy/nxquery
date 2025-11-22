import path from 'node:path'
import type { NamespaceInfo, OperationBucket, OperationInfo } from './FileSystemReader'

export class CodeGenerator {
  constructor(private readonly resolvedDir: string) {}

  renderNamespaceQueryKeys(namespace: NamespaceInfo): string {
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
    lines.push('} as const', '')

    return lines.join('\n')
  }

  renderRootQueryKeys(namespaces: ReadonlyArray<NamespaceInfo>): string {
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
    lines.push('} as const', '')

    return lines.join('\n')
  }

  renderNXQueryFile(namespaces: ReadonlyArray<NamespaceInfo>): string {
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

    body.push('} as const', '')

    const sections: string[] = []
    if (importLines.length) {
      sections.push(...importLines.sort(), '')
    }
    sections.push(...body)

    return sections.join('\n')
  }

  private renderNamespaceEntry(name: string, namespace: string, bucket: OperationBucket): string[] {
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
  ): string[] {
    const indent = '  '.repeat(indentLevel)
    const property = this.formatPropertyKey(propertyName)

    if (propertyName === 'mutation') {
      const keySegments = [`'${namespace}'`, `'${operationName}'`]
      if (includeKindSegment) keySegments.push(`'mutation'`)
      return [`${indent}${property}: [${keySegments.join(', ')}] as const,`]
    }

    const paramName = op.paramName ?? (op.hasParams ? 'args' : undefined)
    const preferredType = op.argsTypeName
    const signature = paramName ? (preferredType ? `${paramName}: ${preferredType}` : paramName) : ''
    const fnSignature = signature ? `(${signature})` : '()'
    const keySegments = [`'${namespace}'`, `'${operationName}'`]
    if (includeKindSegment) keySegments.push(`'query'`)
    if (paramName) keySegments.push(paramName)

    return [`${indent}${property}: ${fnSignature} => [${keySegments.join(', ')}] as const,`]
  }

  private normalizeImportPath(fromFile: string, toFile: string): string {
    let relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
    if (!relative.startsWith('.')) relative = `./${relative}`
    if (relative.endsWith('.ts')) relative = relative.slice(0, -3)
    return relative
  }

  private toCamelCase(value: string): string {
    const pascal = this.toPascalCase(value)
    return pascal.charAt(0).toLowerCase() + pascal.slice(1)
  }

  private toPascalCase(value: string): string {
    return value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('')
  }

  private formatPropertyKey(name: string): string {
    return this.isValidIdentifier(name) ? name : `[${JSON.stringify(name)}]`
  }

  private isValidIdentifier(value: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(value)
  }
}
