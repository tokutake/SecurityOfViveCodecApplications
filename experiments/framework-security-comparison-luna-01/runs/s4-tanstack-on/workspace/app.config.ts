import { defineConfig } from '@tanstack/start/config'

export default defineConfig({
  server: {
    preset: 'node-server',
    port: Number(process.env.PORT) || 3000,
  },
  routers: {
    ssr: {
      vite: {
        ssr: {
          external: ['better-sqlite3', 'openid-client'],
        },
      },
    },
    server: {
      vite: {
        ssr: {
          external: ['better-sqlite3', 'openid-client'],
        },
      },
    },
  },
})
