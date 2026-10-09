import { Navigate, Route, Routes } from 'react-router-dom'
import WorkbenchLayout from '@/layouts/WorkbenchLayout'
import ReplyList from '@/pages/ReplyList'

/**
 * 回函管理按**函证类型拆成两条路由**（v3.05，用户要求）。
 *
 * **为什么拆**：往来函证与银行函证在真实系统里是**两张不同的控制表、两个菜单**，
 * 不会有"同一个列表页里混着两类"的形态。原型此前把两类混在一个列表、并在主操作行
 * 并列两个上传入口，与真实菜单结构对不上，故按类型拆页：
 * · `/reply/wanglai` —— 往来函证回函（带二维码的拼接件，需切分与归属）；
 * · `/reply/bank`    —— 银行函证回函（只需回函件，无二维码）。
 * 每页**只出现本类函证**，主操作行**只有一个上传入口**。
 *
 * 四个业务明细（查看 / AI 核验 / 资料录入 / 结果填写）仍是全屏弹窗，不占独立路由。
 */
export default function App() {
  return (
    <Routes>
      <Route element={<WorkbenchLayout />}>
        <Route path="/" element={<Navigate to="/reply/wanglai" replace />} />
        <Route path="/reply" element={<Navigate to="/reply/wanglai" replace />} />
        <Route path="/reply/wanglai" element={<ReplyList type="往来函证" />} />
        <Route path="/reply/bank" element={<ReplyList type="银行函证" />} />
        <Route path="*" element={<Navigate to="/reply/wanglai" replace />} />
      </Route>
    </Routes>
  )
}
