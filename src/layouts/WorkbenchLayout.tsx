import { Layout } from 'antd'
const { Content } = Layout
import { Outlet } from 'react-router-dom'
import AssignView from '@/components/AssignView'

/**
 * 工作台外壳（v2.57；v3.28 收敛为**只有一个全屏界面**）。
 *
 * ## 现在挂什么
 *
 * · `AssignView` —— 归属界面（切分与指定归属），上传后进入，点「确定」即回主界面。
 *
 * ## 摘掉了什么、为什么
 *
 * v2.57 起这里还挂着两个东西表达"识别进行中"：右下角常驻的 `FloatingProgress`
 * （悬浮进度卡，点「看识别过程」进全屏）与它点开的 `InsightView`（全屏「智能识别」界面）。
 * v3.28 用户判定识别过程必须**长在主页面**上 ——「上传函证以后，智能识别的过程，要放在主页面……
 * 并且要达到，用户知道哪个函证正在智能识别」，并且**没有**勾选"保留全屏『看识别过程』详情"。
 *
 * 于是两者**都不再挂载**，职责由列表页顶部的 `RecognitionProgressBoard` 接管（逐封一行）。
 * 组件文件与 `insightOpen` / `floatingVisible` / `OPEN_INSIGHT` 等状态**保留备用**
 * —— 与 v3.15 移除「来源卡」同一处置惯例（组件保留、无人挂载），
 * 将来若要恢复"点某一行看检测点卡与依据明细"，接回去即可。
 */
export default function WorkbenchLayout() {
  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Content>
        <Outlet />
      </Content>

      <AssignView />
    </Layout>
  )
}
