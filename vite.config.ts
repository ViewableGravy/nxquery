import { defineConfig } from 'vite'
import { nxquery } from "./vite/nxquery/plugin"

export default defineConfig({
  // Vite configuration options

  plugins: [
    nxquery()
  ]
})