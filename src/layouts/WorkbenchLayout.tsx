import { Layout } from 'antd'
import { Outlet } from 'react-router-dom'
import RecognitionDrawer from '@/components/RecognitionDrawer'
import FloatingProgress from '@/components/FloatingProgress'
import OnboardingGuide from '@/components/OnboardingGuide'

const { Content } = Layout

/**
 * 工作台外壳。
 *
 * **为什么这里没有顶部导航条**（2026-09-21，用户决定）：
 * 本原型后续要集成进真实系统，而真实系统自身已带导航与品牌区；
 * 这里的横向导航（10 项里 9 项是占位）既挤占纵向空间、又与外层重复。
 * 「我在哪」的线索改由各页面自己的**页面头**（面包屑 + 标题）承担 ——
 * 这与参照的 Ant Design Pro 详情页一致。
 *
 * 三个浮层组件挂在这里而不是挂在页面里：它们要**跨页面存活**
 * （识别过程可以离开列表页、引导与进度卡需要全站可达）。
 */
export default function WorkbenchLayout() {
  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Content>
        <Outlet />
      </Content>

      <RecognitionDrawer />
      <FloatingProgress />
      <OnboardingGuide />
    </Layout>
  )
}
