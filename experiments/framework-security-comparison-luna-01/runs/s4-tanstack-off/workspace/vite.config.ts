import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

const port = Number(process.env.PORT) || 3000

export default defineConfig({
  server: { port },
  preview: { port },
  plugins: [
    tanstackStart({
      srcDirectory: 'app',
      server: {
        entry: './ssr.tsx',
      },
    }),
  ],
})
