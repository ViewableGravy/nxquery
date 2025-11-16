import { defineConfig } from 'vite'
import { nxquery } from './vite/nxquery/plugin'

export const viteConfig = defineConfig({
  // Vite configuration options
  plugins: [nxquery()],
})

export default viteConfig