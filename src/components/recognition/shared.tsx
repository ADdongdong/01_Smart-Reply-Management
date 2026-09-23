import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useState } from 'react'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DownOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import type { RecognitionStage, RecognitionTask, RiskLevel } from '@/types'
import { stagesOf } from '@/mock/recognition'
import { MATCH_LEVEL_LABEL } from '@/components/BankTextRecognition'

/**
 * 识别相关两个界面（归属界面 / 智能识别界面）的**共用件**（v2.57）。
 *
 * 这些符号原先都私藏在 `RecognitionDrawer.tsx` 里（拆分前它是一个文件）。
 * 拆分时按「**谁真的共用**」判据收敛到本文件：
 * · `TaskDot` / `matchLineOf` / `matchStageOf` / `canAssignOf` —— **两个界面都用**
 *   （归属界面给结论与判定、识别界面也要在项头交代归属）；
 * · `StageIcon` / `StageList` —— 识别界面为主，但归属界面的状态点也走它的图标语言；
 * · `Section` / `Kv` —— 两个界面的分组与元信息都用。
 *
 * **判据写在文件级而非散在各处**：凡是"只在某一个界面用"的（`VerdictCell`、
 * `SourceItem` 之类），不进本文件 —— 共用件一多就退化成一个杂物间。
 * 本文件的符号**全部是纯展示或纯函数，零 store 依赖**（store 交互留在各界面内）。
 */

/* ------------------------------------------------------------------ */
/* 纯展示                                                              */
/* ------------------------------------------------------------------ */

/** 阶段状态图标 */
export function StageIcon({ status }: { status: RecognitionStage['status'] }) {
  if (status === 'done')
    return <CheckCircleFilled style={{ color: 'var(--c-risk-low)', fontSize: 13 }} />
  if (status === 'running')
    return <LoadingOutlined style={{ color: 'var(--c-primary)', fontSize: 13 }} />
  if (status === 'failed')
    return <CloseCircleFilled style={{ color: 'var(--c-risk-high)', fontSize: 13 }} />
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: '1px solid var(--c-border)',
      }}
    />
  )
}

/**
 * 任务状态圆点：
 *   · 归属已出结论但**待人工动作**（建议归属 / 待指定）—— 主色实心点；
 *   · 其余按任务/阶段状态取图标。
 */
export function TaskDot({ task, needsAction }: { task: RecognitionTask; needsAction: boolean }) {
  if (needsAction) {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--c-primary)',
          flexShrink: 0,
        }}
      />
    )
  }
  const running = task.stages.some((s) => s.status === 'running')
  const allDone = task.stages.every((s) => s.status === 'done')
  if (task.status === 'failed') return <StageIcon status="failed" />
  if (task.status === 'success' || allDone) return <StageIcon status="done" />
  if (running) return <StageIcon status="running" />
  return <StageIcon status="waiting" />
}

/** 详情分组 —— 分组标题 + 发丝线分隔，不卡片套卡片 */
export function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: ReactNode
  children: ReactNode
}) {
  return (
    <section style={{ paddingTop: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
          paddingBottom: 8,
          borderBottom: '1px solid var(--c-hairline)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--c-text-1)' }}>{title}</h3>
        {count != null && (
          <span className="num" style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
            {count}
          </span>
        )}
      </div>
      <div style={{ paddingTop: 12 }}>{children}</div>
    </section>
  )
}

/** 键值对（项头元信息） */
export function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--c-text-3)', whiteSpace: 'nowrap' }}>{k}</span>
      <span className={mono ? 'num' : undefined} style={{ fontSize: 13, color: 'var(--c-text-1)' }}>
        {v}
      </span>
    </span>
  )
}

/**
 * 检测点逐项列表 —— 图标 + 名称 + 结论，末行不画线（无进度条）。
 *
 * **一次只展开一个**：同一屏内多个依据区同时铺开会盖掉"步骤链"的节奏。
 * 注意本列表是**浅色底**的样式（走 `global.css` 的 `.recognition-stage*`），
 * 供归属界面与需要浅色呈现的场合使用；智能识别界面用的是深色版的 `ai/TaskRows`。
 */
export function StageList({ stages }: { stages: RecognitionStage[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)

  return (
    <div>
      {stages.map((s) => {
        const color =
          s.status === 'waiting'
            ? 'var(--c-text-3)'
            : s.status === 'running'
              ? 'var(--c-primary)'
              : 'var(--c-text-2)'
        const detail =
          s.detail ?? (s.status === 'running' ? '检测中…' : s.status === 'failed' ? '识别失败' : '待检测')
        /* 有依据明细才可展开 —— 等待中 / 未跑的检测点没有过程可看，不给空箭头 */
        const canExpand = !!s.evidence?.length
        const open = canExpand && openKey === s.key

        return (
          <div key={s.key}>
            <div
              className={`recognition-stage${canExpand ? ' is-expandable' : ''}`}
              {...(canExpand
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-expanded': open,
                    onClick: () => setOpenKey(open ? null : s.key),
                    onKeyDown: (e: ReactKeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenKey(open ? null : s.key)
                      }
                    },
                  }
                : {})}
            >
              <span className="recognition-stage__icon">
                <StageIcon status={s.status} />
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--c-text-1)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={s.label}
              >
                {s.label}
              </span>
              <span style={{ fontSize: 13, color, overflowWrap: 'anywhere' }}>{detail}</span>
              {canExpand && (
                <span className="recognition-stage__more">
                  <DownOutlined
                    style={{
                      fontSize: 10,
                      color: 'var(--c-text-3)',
                      transform: open ? 'rotate(180deg)' : 'none',
                      transition: 'transform 180ms var(--ease-out)',
                    }}
                  />
                </span>
              )}
            </div>

            {/* 依据明细 —— 缩进 + 左侧竖线，视觉上「挂在」该检测点之下 */}
            {open && (
              <div className="recognition-evidence">
                {s.evidence!.map((line, i) => (
                  <div key={i} className="recognition-evidence__line">
                    <span className="recognition-evidence__idx">{i + 1}</span>
                    <span>{line}</span>
                  </div>
                ))}
                {s.elapsedMs != null && (
                  <div className="recognition-evidence__foot">用时 {(s.elapsedMs / 1000).toFixed(1)}s</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 派生（全部查表 / 复用既有口径，不写内联类型判断与新词）              */
/* ------------------------------------------------------------------ */

const RISK_LABEL: Record<RiskLevel, string> = { high: '高', medium: '中', low: '低', none: '无' }

export function riskTone(level?: RiskLevel): 'high' | 'low' | 'neutral' {
  if (level === 'high' || level === 'medium') return 'high'
  if (level === 'low') return 'low'
  return 'neutral'
}

export function riskText(level?: RiskLevel): string {
  if (level === 'high' || level === 'medium' || level === 'low') return RISK_LABEL[level]
  return '待人工判定'
}

export function matchStageOf(task: RecognitionTask): RecognitionStage | undefined {
  return task.stages.find((s) => s.key === 'match')
}

/** 阶段一是否已完成（银行=四要素识别完成，可开始「对应」） */
export function phase1DoneOf(task: RecognitionTask): boolean {
  return stagesOf(task.type, 1).every((k) => task.stages.find((s) => s.key === k)?.status === 'done')
}

/** 归属是否**可操作**（建议归属 / 待指定）：四要素完成即可确认 / 改派，且尚未确定归属 */
export function canAssignOf(task: RecognitionTask): boolean {
  return (
    task.type === '银行函证' &&
    !!task.bankMatch &&
    matchStageOf(task)?.status === 'done' &&
    phase1DoneOf(task) &&
    !task.assignSource
  )
}

/**
 * AI 智能核验检测点 —— 照 `TYPE_RULE` 取，不写死：**排除「归属匹配」**（它只给结果）。
 *
 * **v2.39 起银行侧的「识别四要素」计入检测点**（用户决策：`bankText` 保留 key、改为
 * 「识别四要素」的语义并计入阶段一 1 项），故不再被排除：
 *   · **往来 = 6 项**：一致性 / 是否印章 / 骑缝章 / 名称一致 / 手写体 / 快递面单；
 *   · **银行 = 4 项**：**识别四要素** / 询证事项逐项核对 / 回函是否有印章 / 印章名称与被询证单位一致。
 *
 * 判据里的「归属确认前不列 `bankText`」在**解耦后**依然成立：识别界面只在归属确定后
 * 才会被打开，故实际上走的是"列出"这一支；保留该判断是为了让函数自身语义完整、可单独复用。
 */
export function verifyItemsOf(task: RecognitionTask): RecognitionStage[] {
  return task.stages.filter(
    (s) =>
      s.key !== 'match' &&
      !(s.key === 'bankText' && !task.assignSource),
  )
}

/** 回函次数 —— 从归属匹配阶段文案中取（「…（第 1 次回函）」），取不到则不展示 */
export function replySeqOf(task: RecognitionTask): string | undefined {
  return matchStageOf(task)?.detail?.match(/（(第[^）]*)）/)?.[1]
}

/** 归属匹配的一句话结论（只给结果，不含得分 / 阈值 / 相似度等内部指标） */
export function matchLineOf(task: RecognitionTask): string {
  if (task.status === 'failed') return '归属匹配失败'
  if (task.type === '银行函证') {
    if (!task.assignSource) return MATCH_LEVEL_LABEL[task.bankMatch?.level ?? 'manual']
    const entity = task.matchedEntity && task.matchedEntity !== '—' ? ` · ${task.matchedEntity}` : ''
    return `${task.assignSource === 'auto' ? '自动归属' : '已归属'}：${task.confirmationNo}${entity}`
  }
  if (task.assignSource) {
    const seq = replySeqOf(task)
    const entity = task.matchedEntity && task.matchedEntity !== '—' ? ` · ${task.matchedEntity}` : ''
    return `已归属：${task.confirmationNo}${entity}${seq ? ` · ${seq}` : ''}`
  }
  return '待指定归属'
}

/** 项头 —— 归属界面与识别界面共用的元信息行（两个界面各渲染一次，语义一致） */
export function TaskHeaderMeta({
  task,
  sendRecordNo,
}: {
  task: RecognitionTask
  sendRecordNo?: string
}) {
  const replySeq = replySeqOf(task)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px' }}>
      <Kv k="来源文件" v={task.fileName} />
      {task.pageStart != null && (
        <Kv
          k="页码"
          v={
            task.pageStart === task.pageEnd
              ? `第 ${task.pageStart} 页`
              : `第 ${task.pageStart}-${task.pageEnd} 页`
          }
        />
      )}
      {sendRecordNo && <Kv k="发函记录编号" v={sendRecordNo} mono />}
      {replySeq && <Kv k="回函次数" v={replySeq} />}
    </div>
  )
}
