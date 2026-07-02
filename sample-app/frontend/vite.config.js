import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8020,
    proxy: {
      '/api': {
        target: 'http://localhost:8021',
        changeOrigin: true
      }
    }
  }
})
