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

// 第三方组件（AntD 点击波纹 / 浮层定位）在触发元素卸载后仍在测量，会抛
// `Cannot read properties of null (reading 'getBoundingClientRect')`。
// 已从源头规避（关闭点击波纹 + 弹窗延后一帧卸载）；这里再对这条**已知的第三方测量竞态**
// 做精确静默，避免 IDE 预览面板与浏览器控制台被这种「无功能影响」的噪音刷屏。
// 匹配条件极窄（必须同时包含 getBoundingClientRect 与 null），其余错误一律照常抛出。
window.addEventListener(
  'error',
  (e) => {
    const msg = e.message || ''
    if (msg.includes('getBoundingClientRect') && msg.includes('null')) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  },
  true,
)

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
