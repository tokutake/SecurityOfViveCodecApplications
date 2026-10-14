import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
export default defineConfig({ plugins: [tanstackStart(), viteReact()], server: { port: Number(process.env.PORT || 3000), host: '127.0.0.1' } })
