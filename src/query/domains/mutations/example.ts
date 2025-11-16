import { mutationOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { queryKeys } from '../queryKeys'

/***** TYPE DEFINITIONS *****/
export type DomainsExampleArgs = z.infer<typeof argsSchema>
export type DomainsExampleReturn = z.infer<typeof responseSchema>

/***** SCHEMAS *****/
export const argsSchema = z.never()
export const responseSchema = z.never()

/***** CONSTS *****/
export const endpoint = '/todo'

/***** MUTATION OPTIONS *****/
export const createMutationOptions = () => {
  return mutationOptions({
    mutationKey: queryKeys.example.mutation,
    mutationFn: async (rawArgs: DomainsExampleArgs) => {
      const args = argsSchema.parse(rawArgs)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      })
      const json = await response.json()
      const parsed = responseSchema.parse(json)
      return parsed as DomainsExampleReturn
    },
  })
}
