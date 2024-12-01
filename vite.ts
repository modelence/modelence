import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export const defineViteConfig = () => defineConfig({
  plugins: [react()],
  root: process.cwd(),
  build: {
    outDir: '.modelence/client',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
})
