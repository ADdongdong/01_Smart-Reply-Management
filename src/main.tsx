import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { themeConfig } from './theme'
import { AppProvider } from './store/AppStore'
import './styles/global.css'
/* 智能识别界面的 AI 原生视觉（深色点阵场域 / 像素网格 / 扫过式微光）——
   单独一份，且**只在 .insight-stage 作用域内生效**，不干扰站内浅色基调（见该文件头注释） */
import './styles/insight.css'

// 说明：原先这里挂了一个针对「第三方测量竞态」的全局静默（getBoundingClientRect of null）。
// 它有两个问题，已在 2026-09-20 修掉：
//   ① 只监听 `error`，漏了 AntD 大量使用的 `Promise.resolve().then(...)` 延后测量（那是 unhandledrejection）；
//   ② 挂在 main.tsx 里，任何比它更早执行的脚本抛错都覆盖不到。
// 现在这条守卫内联在 index.html 中、且同时覆盖 error 与 unhandledrejection —— 见 index.html 内的注释。
// 另外从源头换掉了 `resize-observer-polyfill`（vite alias → src/utils/nativeResizeObserver.ts）。

dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={zhCN}
    theme={themeConfig}
    // 点击波纹会在「按钮随弹窗卸载」时测量已被移除的元素并报错（getBoundingClientRect of null）；
    // 它又是纯装饰性动效，与项目「克制、少动效」的基调不符 —— 直接关闭
    wave={{ disabled: true }}
  >
    <AntApp>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </AntApp>
  </ConfigProvider>,
)
