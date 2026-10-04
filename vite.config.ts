import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so production assets need that base.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/None-Curve/' : '/',
}))
