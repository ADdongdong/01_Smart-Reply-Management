import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // AntD 的 rc-resize-observer 无条件 import 这个 polyfill，导致本项目从未用到浏览器原生
      // ResizeObserver；而该 polyfill 内部自行调用 getBoundingClientRect，元素卸载竞态会抛
      // 「Cannot read properties of null (reading 'getBoundingClientRect')」。
      // 目标环境（Chromium）原生支持，故整体换成原生实现 —— 详见 src/utils/nativeResizeObserver.ts
      'resize-observer-polyfill': fileURLToPath(
        new URL('./src/utils/nativeResizeObserver.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    // pdf.js 的构建产物是打包好的自包含 ESM，不能再被 esbuild 预构建转换 ——
    // 转换后内部模块会出现方法丢失（如 hashOriginal.toHex is not a function），解析 PDF 直接报错
    exclude: ['pdfjs-dist'],
  },
  server: {
    // 刻意取在 Windows 动态端口范围（本机 1024–15000）之外：Hyper-V / WSL 会从动态范围里
    // 划走若干「保留区间」（每次开机重分配、会漂移），落在里面的端口 bind 直接 EACCES。
    // 历史上 8012、5178 都栽在这上面；改端口时记得同步 src/config/preview.ts 的 DEV_SERVER_PORT。
    port: 15178,
    // 监听所有网卡：KKFileView 运行在 Docker 容器内，需要经 host.docker.internal 回访本机的
    // dev server 来拉取 public/samples 下的样例文件。仅监听 127.0.0.1 时容器访问不到。
    host: true,
    // Vite 会校验请求的 Host 头以防 DNS rebinding，默认白名单不含 host.docker.internal，
    // 不加这行时容器拉取样例文件会被拒（403）。仅开发环境使用。
    allowedHosts: ['host.docker.internal', 'localhost', '127.0.0.1'],
  },
})
