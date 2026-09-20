import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // pdf.js 的构建产物是打包好的自包含 ESM，不能再被 esbuild 预构建转换 ——
    // 转换后内部模块会出现方法丢失（如 hashOriginal.toHex is not a function），解析 PDF 直接报错
    exclude: ['pdfjs-dist'],
  },
  server: {
    port: 5178,
    // 监听所有网卡：KKFileView 运行在 Docker 容器内，需要经 host.docker.internal 回访本机的
    // dev server 来拉取 public/samples 下的样例文件。仅监听 127.0.0.1 时容器访问不到。
    host: true,
    // Vite 会校验请求的 Host 头以防 DNS rebinding，默认白名单不含 host.docker.internal，
    // 不加这行时容器拉取样例文件会被拒（403）。仅开发环境使用。
    allowedHosts: ['host.docker.internal', 'localhost', '127.0.0.1'],
  },
})
