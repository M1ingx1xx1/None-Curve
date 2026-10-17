import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站点路径为 /<仓库名>/。构建与 `vite preview` 使用该路径，开发服务器使用根路径。
const pagesBase = '/None-Curve/'

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  base: command === 'build' || isPreview ? pagesBase : '/',
}))
