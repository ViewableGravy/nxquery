import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { queryKeys } from '../queryKeys'

/***** TYPE DEFINITIONS *****/
export type DomainsExample2Args = z.infer<typeof argsSchema>
export type DomainsExample2Return = z.infer<typeof responseSchema>

/***** SCHEMAS *****/
export const argsSchema = z.never()
export const responseSchema = z.never()

/***** CONSTS *****/
export const endpoint = '/todo'

/***** QUERY OPTIONS *****/
export const createQueryOptions = (rawArgs: DomainsExample2Args) => {
  const args = argsSchema.parse(rawArgs)

  return queryOptions({
    queryKey: queryKeys.example2.query(args),
    queryFn: async () => {
      const response = await fetch(endpoint)
      const json = await response.json()
      const parsed = responseSchema.parse(json)
      return parsed as DomainsExample2Return
    },
  })
}
