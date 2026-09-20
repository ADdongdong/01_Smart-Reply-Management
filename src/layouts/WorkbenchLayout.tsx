import { Layout, Tooltip, Avatar, Badge, Button } from 'antd'
import { AppstoreOutlined, BellOutlined, QuestionCircleOutlined, UserOutlined } from '@ant-design/icons'
import { Outlet, useLocation } from 'react-router-dom'
import RecognitionDrawer from '@/components/RecognitionDrawer'
import FloatingProgress from '@/components/FloatingProgress'
import OnboardingGuide from '@/components/OnboardingGuide'
import { useApp } from '@/store/AppStore'

const { Header, Content } = Layout

/** 一级导航 —— 本次原型只实现「回函管理」，其余为占位 */
const NAV_ITEMS = [
  { key: '往来函证（采购、销售）', active: false },
  { key: '控制表模板维护', active: false },
  { key: '制造管理', active: false },
  { key: '发函管理', active: false },
  { key: '发函记录', active: false },
  { key: '回函管理', active: true },
  { key: '未回函管理', active: false },
  { key: '回函过程检查', active: false },
  { key: '已确认结果函证', active: false },
  { key: '函证文件', active: false },
]

export default function WorkbenchLayout() {
  const { state, dispatch } = useApp()
  const location = useLocation()
  const runningCount = state.batches.reduce(
    (acc, b) => acc + b.tasks.filter((t) => t.status === 'pending').length,
    0,
  )

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          borderBottom: '1px solid var(--c-hairline)',
          position: 'sticky',
          top: 0,
          zIndex: 'var(--z-sticky-header)' as unknown as number,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 'var(--radius-control)',
              background: 'var(--c-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 14,
            }}
          >
            <AppstoreOutlined />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>数字函证平台</span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, overflow: 'hidden' }}>
          {NAV_ITEMS.map((item) => {
            const active = item.active && location.pathname.startsWith('/reply')
            if (!item.active) {
              return (
                <Tooltip key={item.key} title="本次原型聚焦「回函管理」模块，该模块暂为占位">
                  <span
                    style={{
                      padding: '6px 8px',
                      fontSize: 14,
                      color: 'var(--c-text-3)',
                      cursor: 'not-allowed',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.key}
                  </span>
                </Tooltip>
              )
            }
            return (
              <span
                key={item.key}
                aria-current={active ? 'page' : undefined}
                style={{
                  padding: '6px 8px',
                  fontSize: 14,
                  fontWeight: active ? 500 : 400,
                  color: active ? 'var(--c-primary)' : 'var(--c-text-2)',
                  background: active ? 'var(--c-primary-bg)' : 'transparent',
                  borderRadius: 'var(--radius-control)',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {item.key}
              </span>
            )
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <Tooltip title={`识别队列：${runningCount} 个任务处理中`}>
            <Button
              type="text"
              size="small"
              aria-label="查看识别队列"
              onClick={() => dispatch({ type: 'OPEN_RECOGNITION' })}
            >
              <Badge count={runningCount} size="small" offset={[2, -2]}>
                <BellOutlined style={{ fontSize: 15, color: 'var(--c-text-2)' }} />
              </Badge>
            </Button>
          </Tooltip>
          <Tooltip title="查看新手引导">
            <Button
              type="text"
              size="small"
              aria-label="查看新手引导"
              icon={<QuestionCircleOutlined style={{ fontSize: 15, color: 'var(--c-text-2)' }} />}
              onClick={() => dispatch({ type: 'OPEN_ONBOARDING' })}
            />
          </Tooltip>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar size={24} style={{ background: 'var(--c-primary)' }} icon={<UserOutlined />} />
            <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>张审计</span>
          </span>
        </div>
      </Header>

      <Content>
        <Outlet />
      </Content>

      <RecognitionDrawer />
      <FloatingProgress />
      <OnboardingGuide />
    </Layout>
  )
}
