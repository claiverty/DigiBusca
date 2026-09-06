import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/http/worker.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(import.meta.dirname, '../worker-dist'),
    target: 'es2022',
  },
})
