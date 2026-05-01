import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Evita que Safari (y otros) reusen transforms viejos de Vite tras guardar cambios.
    headers: { 'Cache-Control': 'no-store' },
  },
})
