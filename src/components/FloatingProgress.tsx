import { Button } from 'antd'
import { CloseOutlined, LoadingOutlined, UpOutlined } from '@ant-design/icons'
import { useApp } from '@/store/AppStore'

/**
 * 右下角悬浮进度卡 —— 识别过程中不阻塞浏览列表。
 * 最小化状态：明确告知用户「可以继续做别的事」。
 */
export default function FloatingProgress() {
  const { state, dispatch } = useApp()

  // 抽屉已展开时不再显示悬浮卡
  if (state.recognitionOpen) return null
  if (!state.floatingVisible) return null

  const allTasks = state.batches.flatMap((b) => b.tasks)
  if (!allTasks.length) return null

  const done = allTasks.filter((t) => t.status === 'success' || t.status === 'failed').length
  const running = allTasks.find(
    (t) => t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
  )
  const allDone = done === allTasks.length
  /** 两阶段计数（v2.28）：对应通道（四要素与归属）与细查通道（其余检测项）各有多少份在跑 */
  const matching = allTasks.filter(
    (t) => t.phase === 1 && t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
  ).length
  const checking = allTasks.filter(
    (t) => t.phase === 2 && t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
  ).length

  return (
    <div
      className="floating-card"
      style={{
        position: 'fixed',
        right: 'calc(20px + env(safe-area-inset-right, 0px))',
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        width: 288,
        background: '#fff',
        borderRadius: 8,
        boxShadow: 'var(--shadow-pop)',
        padding: 12,
        zIndex: 'var(--z-floating-card)' as unknown as number,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        {allDone ? (
          <span style={{ color: 'var(--c-risk-low)', fontSize: 14 }}>●</span>
        ) : (
          <LoadingOutlined style={{ color: 'var(--c-primary)' }} />
        )}
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {allDone ? '识别已完成' : '正在识别回函'}
        </span>
        <Button
          type="link"
          size="small"
          style={{ marginLeft: 'auto', padding: 0, height: 'auto', fontSize: 13 }}
          onClick={() => dispatch({ type: 'OPEN_RECOGNITION' })}
        >
          展开 <UpOutlined style={{ fontSize: 11 }} />
        </Button>
        <Button
          type="text"
          size="small"
          aria-label="收起识别进度卡片"
          style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
          icon={<CloseOutlined style={{ fontSize: 12, color: 'var(--c-text-3)' }} />}
          onClick={() => dispatch({ type: 'SET_FLOATING', visible: false })}
        />
      </div>

      <div style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.9 }}>
        {allDone ? (
          <span>已归档 {done} 封函证，结果已写入回函管理列表</span>
        ) : (
          <>
            {/* 两阶段分开表达（v2.28）：正在对应（四要素与归属）/ 正在细查（其余检测项） */}
            {matching > 0 && (
              <div>
                正在对应：<b>{matching}</b> 份（识别四要素与归属）
              </div>
            )}
            {checking > 0 && (
              <div>
                正在细查：<b>{checking}</b> 份（其余检测项）
              </div>
            )}
            {matching === 0 && checking === 0 && (
              <div>
                正在处理：<b>{running?.confirmationNo ?? '—'}</b>
                {running?.pageRange ? ` · ${running.pageRange}` : ''}
              </div>
            )}
            <div style={{ color: 'var(--c-text-3)' }}>
              已完成 {done}/{allTasks.length} · 可继续浏览列表
            </div>
          </>
        )}
      </div>

      {allDone && (
        <Button
          type="primary"
          size="small"
          block
          style={{ marginTop: 8 }}
          onClick={() => dispatch({ type: 'OPEN_RECOGNITION' })}
        >
          查看识别结果
        </Button>
      )}
    </div>
  )
}
