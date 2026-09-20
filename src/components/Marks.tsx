import type { ReactNode } from 'react'
import { Tooltip } from 'antd'
import { CheckCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons'
import type { RiskLevel, VerifyStatus } from '@/types'

/* ------------------- AI 来源标识 ------------------- */

export function AiMark({ source, confidence }: { source?: string; confidence?: number }) {
  return (
    <Tooltip
      title={
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 500 }}>由 AI 自动识别</div>
          {source && <div>来源：{source}</div>}
          {confidence != null && <div>置信度：{Math.round(confidence * 100)}%</div>}
          <div style={{ opacity: 0.8 }}>需人工确认后方可生效</div>
        </div>
      }
    >
      <span className="ai-mark">✦</span>
    </Tooltip>
  )
}

/** AI 置信度胶囊 —— 文字走墨色，低置信度仅由底色提示（红档 = 需人工重点核对） */
export function AiChip({ confidence, label = 'AI' }: { confidence: number; label?: string }) {
  const low = confidence < 0.9
  return (
    <span
      className="ai-chip"
      style={
        low
          ? { color: 'var(--c-text-1)', background: 'var(--c-risk-high-bg)' }
          : undefined
      }
      title={low ? '置信度偏低，建议人工重点核对' : undefined}
    >
      {label} {Math.round(confidence * 100)}%
    </span>
  )
}

/* ------------------- 风险等级 ------------------- */

/**
 * 标签文字统一走墨色，风险等级由底色承担（颜色只走底色，文字只走墨色）。
 * 一律「浅底无边框」—— 描边标签会在密集列表里堆出大量线条。
 *
 * 色彩只有红 / 绿两档：中风险在数据层保留（业务上需要区分关注程度），
 * 视觉并入红档 —— 档位差异由标签文字表达，不再引入第三个色相。
 */
const RISK_MAP: Record<RiskLevel, { text: string; color: string; bg: string }> = {
  high: { text: '高风险', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
  medium: { text: '中风险', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
  low: { text: '低风险', color: 'var(--c-text-1)', bg: 'var(--c-risk-low-bg)' },
  none: { text: '未核验', color: 'var(--c-text-3)', bg: 'var(--c-tag-bg)' },
}

export function RiskTag({ level, reasons }: { level: RiskLevel; reasons?: string[] }) {
  const cfg = RISK_MAP[level]
  const tag = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 6px',
        borderRadius: 'var(--radius-tag)',
        fontSize: 12,
        lineHeight: 1,
        color: cfg.color,
        background: cfg.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.text}
    </span>
  )
  if (!reasons?.length) return tag
  return (
    <Tooltip
      title={
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          {reasons.map((r) => (
            <div key={r}>· {r}</div>
          ))}
        </div>
      }
    >
      {tag}
    </Tooltip>
  )
}

/* ------------------- 人工核验徽标 ------------------- */

export function VerifyBadge({
  status,
  by,
  at,
}: {
  status: VerifyStatus
  by?: string
  at?: string
}) {
  if (status === 'verified') {
    return (
      <Tooltip title={`核验人：${by ?? '—'}　核验时间：${at ?? '—'}`}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 20,
            padding: '0 6px',
            borderRadius: 'var(--radius-tag)',
            fontSize: 12,
            lineHeight: 1,
            color: 'var(--c-text-1)',
            background: 'var(--c-primary-bg)',
            whiteSpace: 'nowrap',
            cursor: 'help',
          }}
        >
          ✓ 已人工核验
        </span>
      </Tooltip>
    )
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 6px',
        borderRadius: 'var(--radius-tag)',
        fontSize: 12,
        lineHeight: 1,
        color: 'var(--c-text-3)',
        background: 'var(--c-tag-bg)',
        whiteSpace: 'nowrap',
      }}
    >
      待核验
    </span>
  )
}

/* ------------------- AI 核验进度徽标 ------------------- */

export function VerifyProgress({
  done,
  total,
  risk,
}: {
  done: number
  total: number
  risk?: RiskLevel
}) {
  if (total === 0) {
    return (
      <span className="muted" style={{ fontSize: 13 }}>
        —
      </span>
    )
  }
  // 文字只走墨色；已完成退灰，未完成用主色提示「还差几项」
  const color = done === total ? 'var(--c-text-1)' : 'var(--c-primary)'
  return (
    <span className="num" style={{ color, fontWeight: 500, fontSize: 13 }}>
      {done}/{total}
    </span>
  )
}

/* ------------------- 核验明细的统一骨架 ------------------- */

const RESULT_CFG = {
  ok: { tone: 'tone-ok', color: 'var(--c-risk-low)', icon: <CheckCircleFilled /> },
  risk: { tone: 'tone-risk', color: 'var(--c-risk-high)', icon: <ExclamationCircleFilled /> },
  info: { tone: 'tone-primary', color: 'var(--c-primary)', icon: <InfoCircleFilled /> },
} as const

/**
 * 检测结论条 —— 四项核验明细（一致性 / 印章 / 手写体 / 银行文本）**统一用它开头**。
 *
 * 约定（2026-09-18 统一）：
 * · **只讲检测结果与判定结论**，不讲实现方式（如「minerU 解析」「四要素加权算法」）与业务规则 ——
 *   那些属于说明文档，写在明细里会让人看不出重点；
 * · 结论一句话讲完，需要补充依据时用 `detail`（次要墨色）；
 * · **不放处理动作** —— 动作统一沉到明细底部。
 */
export function ResultBar({
  status,
  statusText,
  message,
  detail,
  extra,
}: {
  status: 'ok' | 'risk' | 'info'
  /** 可选的档位 / 状态短语，如「自动归属」「建议归属」 */
  statusText?: string
  /** 一句话结论 */
  message: string
  /** 次要补充（判定依据等） */
  detail?: string
  /** 右侧附加元素（如归属来源徽标） */
  extra?: ReactNode
}) {
  const cfg = RESULT_CFG[status]
  return (
    <div
      className={`tone-block ${cfg.tone}`}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, lineHeight: 1.7 }}
    >
      <span style={{ color: cfg.color, fontSize: 14, lineHeight: '20px', flexShrink: 0 }}>
        {cfg.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
        {statusText && <b style={{ marginRight: 8 }}>{statusText}</b>}
        {message}
        {detail && <div style={{ color: 'var(--c-text-2)' }}>{detail}</div>}
      </div>
      {extra}
    </div>
  )
}

/**
 * 事实清单的字段行 —— 标签 + 值（+ 补充说明 + 置信度胶囊）。
 * 四项明细统一复用它，保证同一层级信息在各检测项里长得一样。
 */
export function InfoRow({
  label,
  value,
  tone = 'default',
  hint,
  confidence,
}: {
  label: string
  value: string
  /** 值的语义：默认墨色；`risk` 用于「未检出 / 不一致」这类需关注值 */
  tone?: 'default' | 'ok' | 'risk'
  hint?: string
  confidence?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', fontSize: 13 }}>
      <span style={{ width: 132, color: 'var(--c-text-2)', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontWeight: 600,
          color:
            tone === 'risk'
              ? 'var(--c-risk-high)'
              : tone === 'ok'
                ? 'var(--c-risk-low)'
                : undefined,
        }}
      >
        {value}
      </span>
      {hint && (
        <span className="muted" style={{ fontSize: 12 }}>
          {hint}
        </span>
      )}
      {confidence != null && (
        <span style={{ marginLeft: 'auto' }}>
          <AiChip confidence={confidence} />
        </span>
      )}
    </div>
  )
}
