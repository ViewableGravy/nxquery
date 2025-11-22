export type OperationKind = 'query' | 'mutation'

export type TemplateContext = {
  namespace: string
  name: string
}

const isValidIdentifier = (value: string) => /^[A-Za-z_$][\w$]*$/.test(value)

const toPascalCase = (value: string) =>
  value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')

const buildPropertyAccessor = (objectName: string, key: string) =>
  isValidIdentifier(key) ? `${objectName}.${key}` : `${objectName}[${JSON.stringify(key)}]`

const queryTemplate = ({ namespace, name }: TemplateContext) => {
  const namespacePascal = toPascalCase(namespace)
  const filePascal = toPascalCase(name)
  const argsType = `${namespacePascal}${filePascal}Args`
  const returnType = `${namespacePascal}${filePascal}Return`
  const accessor = `${buildPropertyAccessor('queryKeys', name)}.query`
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
    `      return parsed as ${returnType}`,
    '    },',
    '  })',
    '}',
    '',
  ].join('\n')
}

const mutationTemplate = ({ namespace, name }: TemplateContext) => {
  const namespacePascal = toPascalCase(namespace)
  const filePascal = toPascalCase(name)
  const argsType = `${namespacePascal}${filePascal}Args`
  const returnType = `${namespacePascal}${filePascal}Return`
  const accessor = `${buildPropertyAccessor('queryKeys', name)}.mutation`
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
    `      return parsed as ${returnType}`,
    '    },',
    '  })',
    '}',
    '',
  ].join('\n')
}

export const templates: Record<OperationKind, (ctx: TemplateContext) => string> = {
  query: queryTemplate,
  mutation: mutationTemplate,
}

export const operationRelativePath = (kind: OperationKind, ctx: TemplateContext) => {
  const scope = kind === 'query' ? 'queries' : 'mutations'
  return `src/query/${ctx.namespace}/${scope}/${ctx.name}.ts`
}
