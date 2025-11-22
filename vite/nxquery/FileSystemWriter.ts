import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

export class FileSystemWriter {
  constructor(private readonly resolvedDir: string) {}

  async ensureDirectory(target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true })
  }

  async ensureFile(target: string, fallback: () => string): Promise<void> {
    if (existsSync(target)) return
    await fs.writeFile(target, fallback(), 'utf8')
  }

  async writeFileIfChanged(target: string, content: string): Promise<void> {
    try {
      const existing = await fs.readFile(target, 'utf8')
      if (existing === content) return
    } catch {
      // File doesn't exist, ensure parent directory exists
      await fs.mkdir(path.dirname(target), { recursive: true })
    }
    await fs.writeFile(target, content, 'utf8')
  }

  async ensureBaseStructure(): Promise<void> {
    await this.ensureDirectory(this.resolvedDir)
    await this.ensureFile(path.join(this.resolvedDir, 'index.ts'), () => 'export const NXQuery = {}\n')
    await this.ensureFile(path.join(this.resolvedDir, 'keys.ts'), () => 'export const queryKeys = {}\n')

    const entries = await fs.readdir(this.resolvedDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue
      await this.ensureNamespaceSkeleton(path.join(this.resolvedDir, entry.name))
    }
  }

  async ensureNamespaceSkeleton(namespacePath: string): Promise<void> {
    const rel = path.relative(this.resolvedDir, namespacePath)
    if (!rel || rel.startsWith('..')) return
    if (rel.split(path.sep).length !== 1) return

    // Skip dot-prefixed directories and node_modules
    const namespaceName = path.basename(namespacePath)
    if (namespaceName.startsWith('.')) return
    if (namespaceName === 'node_modules') return

    const queriesDir = path.join(namespacePath, 'queries')
    const mutationsDir = path.join(namespacePath, 'mutations')
    const keyFile = path.join(namespacePath, 'queryKeys.ts')

    await this.ensureDirectory(namespacePath)
    await this.ensureDirectory(queriesDir)
    await this.ensureDirectory(mutationsDir)
    await this.ensureFile(keyFile, () => 'export const queryKeys = {}\n')
  }

  async maybeSeedOperationFile(filePath: string): Promise<void> {
    if (!filePath.endsWith('.ts')) return

    const relative = path.relative(this.resolvedDir, filePath)
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
    const template =
      scope === 'queries'
        ? this.buildQueryTemplate(namespace, baseName)
        : this.buildMutationTemplate(namespace, baseName)

    await fs.writeFile(absPath, template, 'utf8')
  }

  private buildQueryTemplate(namespace: string, fileName: string): string {
    const namespacePascal = this.toPascalCase(namespace)
    const filePascal = this.toPascalCase(fileName)
    const argsType = `${namespacePascal}${filePascal}Args`
    const returnType = `${namespacePascal}${filePascal}Return`
    const accessor = `${this.buildPropertyAccessor('queryKeys', fileName)}.query`

    return [
      "import { queryOptions } from '@tanstack/react-query'",
      "import { z } from 'zod'",
      "import { queryKeys } from '../queryKeys'",
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

  private buildMutationTemplate(namespace: string, fileName: string): string {
    const namespacePascal = this.toPascalCase(namespace)
    const filePascal = this.toPascalCase(fileName)
    const argsType = `${namespacePascal}${filePascal}Args`
    const returnType = `${namespacePascal}${filePascal}Return`
    const accessor = `${this.buildPropertyAccessor('queryKeys', fileName)}.mutation`

    return [
      "import { mutationOptions } from '@tanstack/react-query'",
      "import { z } from 'zod'",
      "import { queryKeys } from '../queryKeys'",
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
      '/***** MUTATION OPTIONS *****/',
      'export const createMutationOptions = () => {',
      '  return mutationOptions({',
      `    mutationKey: ${accessor},`,
      `    mutationFn: async (rawArgs: ${argsType}) => {`,
      '      const args = argsSchema.parse(rawArgs)',
      '      const response = await fetch(endpoint, {',
      "        method: 'POST',",
      "        headers: { 'Content-Type': 'application/json' },",
      '        body: JSON.stringify(args),',
      '      })',
      '      const json = await response.json()',
      '      const parsed = responseSchema.parse(json)',
      '      return parsed as ' + returnType,
      '    },',
      '  })',
      '}',
      '',
    ].join('\n')
  }

  private buildPropertyAccessor(objectName: string, key: string): string {
    return this.isValidIdentifier(key) ? `${objectName}.${key}` : `${objectName}[${JSON.stringify(key)}]`
  }

  private isValidIdentifier(value: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(value)
  }

  private toPascalCase(value: string): string {
    return value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('')
  }
}
