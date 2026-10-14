import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const server = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:8080'
export default defineConfig({
  base: '/command-center/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // server.py serves /command-center/ from this folder, next to the generated config.js.
  build: { outDir: '../command-center', emptyOutDir: true },
  server: { proxy: { '/api': server, '/command-center/config.js': server } },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], testTimeout: 20_000 },
})
