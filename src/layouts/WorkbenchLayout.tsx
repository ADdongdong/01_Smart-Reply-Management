import { Layout } from 'antd'
const { Content } = Layout
import { Outlet } from 'react-router-dom'
import AssignView from '@/components/AssignView'
import InsightView from '@/components/InsightView'
import FloatingProgress from '@/components/FloatingProgress'
import OnboardingGuide from '@/components/OnboardingGuide'

/**
 * 工作台外壳（v2.57）。
 *
 * **两个独立全屏界面并行挂载**（各自按 store 开关决定是否渲染）：
 * · `AssignView` —— 归属界面，上传后进入，点「确定」即回主界面；
 * · `InsightView` —— 智能识别界面，由右下角进度卡主动点入。
 *
 * 二者在 store 层面**互斥**（`OPEN_ASSIGN` 会收掉 `insightOpen`，反之亦然），
 * 故同一时刻最多只有一个全屏界面在 DOM 里 —— 既省内存（pdf.js 实例），
 * 也避免两层遮罩叠在一起。
 *
 * 拆出两个界面前，这里挂的是单个 `RecognitionDrawer`（已删除）。
 */
export default function WorkbenchLayout() {
  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Content>
        <Outlet />
      </Content>

      <AssignView />
      <InsightView />
      <FloatingProgress />
      <OnboardingGuide />
    </Layout>
  )
}
