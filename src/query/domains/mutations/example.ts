import { mutationOptions } from '@tanstack/react-query'
import { z } from 'zod'
import queryKeys from '../queryKeys'

/***** TYPE DEFINITIONS *****/
export type DomainsExampleReturn = z.infer<typeof responseSchema>

/***** SCHEMAS *****/
export const responseSchema = z.never()

/***** CONSTS *****/
export const endpoint = '/todo'

/***** MUTATION OPTIONS *****/
export const createMutationOptions = () => {
  return mutationOptions({
    mutationKey: queryKeys.example.mutation,
    mutationFn: async () => {
      const response = await fetch(endpoint)
      const json = await response.json()
      const parsed = responseSchema.parse(json)
      return parsed as DomainsExampleReturn
    },
  })
}
