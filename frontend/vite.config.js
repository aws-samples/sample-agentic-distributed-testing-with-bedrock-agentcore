import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Vite 5's Host-header check rejects anything but localhost by default
    // (DNS-rebinding protection) — VS Code Remote-SSH's port-forwarding
    // proxy sends its own forwarding domain as Host, so without this every
    // forwarded request gets a silent 403 "Blocked request" response.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:4010',
      '/ws': { target: 'ws://localhost:4010', ws: true },
    }
  }
})
