import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    proxy: {
      '/api/knowledge/domains': 'http://127.0.0.1:28085',
      '/api/graph/aggregation/views': 'http://127.0.0.1:28085',
      '/api/graph/overview': 'http://127.0.0.1:28085',
      '/api/graph/instances': 'http://127.0.0.1:28085',
      '/api/graph/aggregate': 'http://127.0.0.1:28085',
      '/api': {
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
    },
  },
})
