import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The GitHub Pages project site lives at /<repo name>/. The build and `vite preview` use that path; the dev server uses the root.
const pagesBase = '/None-Curve/'

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  base: command === 'build' || isPreview ? pagesBase : '/',
  build: {
    rolldownOptions: {
      output: {
        // React in a chunk of its own: it keeps the app chunk under the 500 kB warning and stays cached
        // across deploys that change only the app.
        codeSplitting: {
          groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
}))
