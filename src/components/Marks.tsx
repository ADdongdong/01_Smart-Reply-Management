import type { ReactNode } from 'react'
import { Tooltip } from 'antd'
import { CheckCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons'
import type { ConfirmationType, RiskLevel, VerifyStatus } from '@/types'
import { TYPE_RULE } from '@/services/replyRule'

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
 * 风险标签 —— 只有红 / 绿两档：中风险在数据层保留（业务上要区分关注程度），
 * 视觉并入红档，档位差异由标签文字「高风险 / 中风险」表达，不引入第三个色相。
 *
 * 色彩用法（2026-09-20 调整。起因：用户反馈「AI 风险那列的标签饱和度太低，看着很不清晰」）：
 * · 底色继续走浅档（`--c-risk-*-bg`）且**无边框** —— 描边标签会在密集列表里堆出大量线条；
 * · 但**文字改用深档语义色**（`--c-risk-high-text` / `--c-risk-low-text`），不再一律用墨色。
 *   原因是「墨色文字 + 8% 浅底」的最终观感是**整片偏灰**，红绿只藏在底色里，扫视时认不出来；
 *   改用深档语义色后，红 / 绿在浅底上依然 ≥ 4.5:1（WCAG AA），且这两个色已排除橙色系，
 *   不会出现用户反感的「咖啡色」。
 */
const RISK_MAP: Record<RiskLevel, { text: string; color: string; bg: string }> = {
  high: { text: '高风险', color: 'var(--c-risk-high-text)', bg: 'var(--c-risk-high-bg)' },
  medium: { text: '中风险', color: 'var(--c-risk-high-text)', bg: 'var(--c-risk-high-bg)' },
  low: { text: '低风险', color: 'var(--c-risk-low-text)', bg: 'var(--c-risk-low-bg)' },
  none: { text: '未核验', color: 'var(--c-text-3)', bg: 'var(--c-tag-bg)' },
}

/**
 * 「识别中」标签的中性样式（v2.28 两阶段）—— 与「无法判定 / 未核验」同一灰阶：
 * 它表达的是「**数据还没就绪**」，不是任何业务结论。
 */
const PENDING_CFG = { text: '识别中', color: 'var(--c-text-3)', bg: 'var(--c-tag-bg)' } as const

/** 「识别中」的悬停说明 —— 与「无法判定」的「待人工判定」区分开 */
export const RECOGNIZING_HINT = 'AI 识别中 —— 归属已确认，其余检测项完成后自动刷新结论'

export function RiskTag({
  level,
  reasons,
  pending,
}: {
  level: RiskLevel
  reasons?: string[]
  /** AI 识别中（银行函证阶段二尚未回填）—— 渲染中性「识别中」，不表达风险结论 */
  pending?: boolean
}) {
  const cfg = pending ? PENDING_CFG : RISK_MAP[level]
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
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.text}
    </span>
  )
  const tips = pending ? [RECOGNIZING_HINT] : (reasons ?? [])
  if (!tips.length) return tag
  return (
    <Tooltip
      title={
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          {tips.map((r) => (
            <div key={r}>· {r}</div>
          ))}
        </div>
      }
    >
      {tag}
    </Tooltip>
  )
}

/* ------------------- 回函是否相符 ------------------- */

/**
 * 「回函是否相符」标签 —— 列表列专用（v2.25）。
 *
 * **判定口径（业务硬规则，不可违背）**：判定本身已收敛到
 * `services/replyRule.ts` 的 `evaluateMatch` 单一出口，本组件只负责展示：
 * · 往来函证 —— 印章落「信息证明无误」区 → **相符**；落「信息不符」区 → **不相符**；未识别 → 无法判定；
 * · 银行函证 —— **只看询证事项逐项核对**（有差异即判不相符），印章不作相符性依据；
 * · 人工填写过回函结果后（`resultInfo.matched`），**以人工值为准**。
 *
 * **为什么必须区分来源**：项目底线是「AI 只出建议、人工确认才算数」。
 * 未人工填写时带 `✦` 前缀与「AI 建议」说明，避免读者把 AI 结论误当成已确认的结论。
 *
 * 视觉口径与 `RiskTag` 一致（v2.23）：**浅底无边框 + 深档语义色文字 + 字重 500**；
 * 「无法判定」走中性灰 —— 它不是结论，只是一种未知。
 */
export function MatchTag({
  matched,
  byAi,
  basis,
  reasons,
  type,
  pending,
}: {
  /** 相符 = true；不相符 = false；无法判定 = null */
  matched: boolean | null
  /** 是否为 AI 建议（回函结果尚未人工填写） */
  byAi?: boolean
  /** 一句话依据，如「印章落于「信息证明无误」区」 */
  basis?: string
  /** 不相符时的原因 / 差异说明（与「AI 风险」列一致：只用悬停，不加图标） */
  reasons?: string[]
  /** 函证类型 —— 用于「无法判定」时给出与类型相符的归因（不得把银行函证归因到印章区域） */
  type?: ConfirmationType
  /**
   * AI 识别中（v2.28 银行函证两阶段）—— 渲染中性「识别中」。
   * 与「无法判定」的区分：识别中是「数据还没就绪」，无法判定是「结论是未知、待人工」。
   * 本入参**不改变** `{ matched, byAi, basis, reasons }` 的语义契约。
   */
  pending?: boolean
}) {
  const cfg = pending
    ? PENDING_CFG
    : matched === true
      ? { text: '相符', color: 'var(--c-risk-low-text)', bg: 'var(--c-risk-low-bg)' }
      : matched === false
        ? { text: '不相符', color: 'var(--c-risk-high-text)', bg: 'var(--c-risk-high-bg)' }
        : { text: '无法判定', color: 'var(--c-text-3)', bg: 'var(--c-tag-bg)' }

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
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {byAi && matched !== null && <span style={{ marginRight: 2, fontSize: 10 }}>✦</span>}
      {cfg.text}
    </span>
  )

  const tips: string[] = []
  if (pending) {
    tips.push(RECOGNIZING_HINT)
  } else if (matched === null) {
    /* 无法判定的归因必须与该类型的相符性判据一致 —— 银行函证不得归因到印章落章区域 */
    tips.push(
      type && TYPE_RULE[type].matchBy === 'consistencyOnly'
        ? 'AI 未能完成询证事项逐项核对，无法自动判定 —— 待人工判定'
        : 'AI 未能识别印章落章区域，无法自动判定 —— 待人工判定',
    )
  } else if (byAi) {
    tips.push('✦ AI 建议 —— 尚未经人工确认，以「填写回函结果」时确认的结论为准')
  } else {
    tips.push('已人工确认（回函结果填写）')
  }
  if (basis) tips.push(`依据：${basis}`)
  if (reasons?.length) tips.push(...reasons.map((r) => `· ${r}`))

  return (
    <Tooltip
      title={
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          {tips.map((t) => (
            <div key={t}>{t}</div>
          ))}
        </div>
      }
    >
      {tag}
    </Tooltip>
  )
}

/* ------------------- 人工核验徽标 ------------------- */

/**
 * 人工核验徽标 —— 「待核验」中性灰 / 「✓ 已人工核验」主色。
 *
 * 配色调整（v2.25，用户反馈「已人工核验的标签颜色需要调整」）：
 * 原先已核验态是「墨色文字 + 8% 主色底」，与「待核验」的灰底墨字**拉不开差距**，
 * 扫视时几乎看不出哪几行已经核验过。现改为**主色文字**（`--c-primary` 在此浅底上约 5.5:1，
 * 达 WCAG AA）+ 字重 500 —— 与 v2.23 对风险标签的同一处理口径：
 * 靠「文字着色 + 字重」提辨识度，而不是加描边或新色相。
 */
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
            color: 'var(--c-primary)',
            background: 'var(--c-primary-bg)',
            fontWeight: 500,
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
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      待核验
    </span>
  )
}

/* ------------------- （已移除）AI 核验进度徽标 ------------------- */

/*
 * 原 `VerifyProgress`（显示 `6/6` 这类「AI 检测点完成计数」）已于 v2.25 删除。
 *
 * 删除原因（用户）：「不展示 6/6 这个数字，因为用户不知道 6/6 是啥、有什么含义。」
 * 这个计数属于**系统内部指标** —— 列表与核验弹窗上都不再出现；
 * AI 具体查了哪几项，在「AI 核验」页正文里逐项列出即可（那才是用户要看的「依据」）。
 * 需要恢复时从 git 历史取回即可（数据结构里的 `completedModules` / `totalModules` 仍然保留）。
 */

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
