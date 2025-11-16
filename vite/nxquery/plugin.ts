import type { PluginOption } from 'vite'
import { NXQueryPlugin, defaultOptions, type Options } from './NXQueryPlugin'

export const nxquery = (options: Options = defaultOptions): PluginOption => {
  const instance = new NXQueryPlugin(options)

  return {
    name: 'vite-plugin-nxquery',
    async buildStart() {
      await instance.initialize()
    },
    configureServer(server) {
      instance.attachDevServer(server)
    },
    async handleHotUpdate(ctx) {
      return instance.handleHotUpdate(ctx)
    },
  }
}
