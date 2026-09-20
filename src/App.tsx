import { Navigate, Route, Routes } from 'react-router-dom'
import WorkbenchLayout from '@/layouts/WorkbenchLayout'
import ReplyList from '@/pages/ReplyList'

/**
 * 回函管理是单页工作台：查看 / AI 核验 / 资料录入 / 结果填写
 * 四类明细都以全屏弹窗承载，不再占用独立路由。
 */
export default function App() {
  return (
    <Routes>
      <Route element={<WorkbenchLayout />}>
        <Route path="/" element={<Navigate to="/reply" replace />} />
        <Route path="/reply" element={<ReplyList />} />
        <Route path="*" element={<Navigate to="/reply" replace />} />
      </Route>
    </Routes>
  )
}
