import { Fragment, type ReactNode } from 'react'
import { Tooltip } from 'antd'
import {
  CheckCircleFilled,
  CheckOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
} from '@ant-design/icons'
import type { ConfirmationType, VerifyStatus } from '@/types'
import { TYPE_RULE } from '@/services/replyRule'
import { StatusTag, type TagTone } from '@/components/StatusTag'

/* ------------------- AI 来源标识 ------------------- */

/**
 * **AI 产出标记 ✦ 的"裸"形态**（2026-10-14 立）—— 不带悬停卡，只出那一个符号。
 *
 * 用在**位置小、不需要解释**的地方：按钮的 icon 位、小节标题前缀等。
 * 立它的直接动因是图标盘点的结论：站内「AI 产出」的记号是 **`✦`**（`AiMark` / `AiReviewCell`
 * 的项尾 / 标签的 mark 位都是它），但有三处却用了 **`ThunderboltOutlined`（⚡）** ——
 * 而 ⚡ 在别处表示的是"**一键跑演示数据**"（三个演示入口）。同一个符号两种含义、
 * 同一含义两种符号，两笔账都错。现在：
 * · **AI 产出 = `✦`**（就是本件与 `AiMark`）；
 * · **一键 / 快速 = `⚡`**（只留给演示数据入口）。
 */
export function AiGlyph() {
  return (
    <span className="ai-glyph" aria-hidden="true">
      ✦
    </span>
  )
}

/**
 * AI 来源标识 ✦ —— 悬停给出**来源卡**（v2.49 由纯文字改为结构化卡片）。
 *
 * 结构：**标题（这是什么）→ 字段区（来源）→ 结论行**。对审计场景来说，
 * 「这个值从哪来」是证据链的一部分，值得比一行小字更清楚。
 *
 * ⚠️ **卡里的「置信度」一行已移除（2026-10-14，用户：「去掉所有的置信度」）** ——
 * 连带 `AiChip`（胶囊）与 `.ai-card__pct` / `.ai-card__meter` 样式一并删除。
 * `AiMark` 的 `confidence` 入参也随之取消：**留着一个没人读的参数比删掉更糟**。
 */
export function AiMark({ source }: { source?: string }) {
  return (
    <Tooltip
      title={
        <div className="ai-card">
          <div className="ai-card__head">
            <span className="ai-card__badge">✦ AI</span>
            <span>自动识别</span>
          </div>
          <div className="ai-card__rows">
            {source && (
              <div className="ai-card__row">
                <span className="ai-card__k">来源</span>
                <span className="ai-card__v">{source}</span>
              </div>
            )}
          </div>
          <div className="ai-card__foot">需人工确认后方可生效</div>
        </div>
      }
    >
      <span className="ai-mark">✦</span>
    </Tooltip>
  )
}

/* ------------------- 风险等级 ------------------- */


/**
 * 「识别中」标签的中性样式（v2.28 两阶段）—— 与「无法判定 / 未核验」同一灰阶：
 * 它表达的是「**数据还没就绪**」，不是任何业务结论。
 */
const PENDING_CFG = { text: '识别中', tone: 'neutral' } as const

/** 「识别中」的悬停说明 —— 与「无法判定」的「待人工判定」区分开 */
export const RECOGNIZING_HINT = 'AI 识别中 —— 归属已确认，其余检测项完成后自动刷新结论'

/* ------------------- 回函进度步骤条 ------------------- */

/**
 * 回函进度步骤条（v2.51 立，v3.12 改口径）—— 列表「回函进度」列的呈现。
 *
 * 形态取自用户提供的参考界面：`✓ 快递信息 › | ○ 回函结果 ›`。
 *
 * ## 两个步骤**各自取证据**，不再是"一个枚举推两个勾"（v3.12）
 *
 * 用户实测报：「完成回函结果填写后，前面的快递信息也会默认勾选完成，但实际上并没有完成」——
 * 这两件事是**独立的、没有必然先后**（可以先填结果、后确认快递信息，反之亦然）。
 * 所以完成态各按自己的事实判定，**两个布尔值由调用方给**：
 *
 * · **快递信息** = `verifyStatus === 'verified'` —— 那一步的确认是全流程**唯一的人工核验留痕动作**；
 * · **回函结果** = `resultInfo` 存在 —— `SUBMIT_RESULT` 写的就是这个字段。
 *
 * 顺带撤销了旧的隐式假设：原口径把三个进度值当作「两个步骤的三种完成组合」，
 * 于是"只填了结果"也会把快递信息勾上（`done: progress !== '待确认快递信息'`）。
 * 「当前该做的那一步」仍是**第一个还没做的**：前面没做完时，后面不标 `current`。
 * 本组件因此**不再需要进度取值**（两个布尔值足够推出全部三态）。
 *
 * 相比原来的两行文字（状态 + 「下一步：xxx」），步骤条的收益是**一眼看出走到了哪一步、
 * 还剩几步**，而不必读两行字再自己折算。
 *
 * **步骤名可点**（参考界面里它是主色的，确有道理）：操作列只有「下一步」一个主按钮，
 * 而步骤条把**两个入口都摆在行内** —— 已完成的步骤用于回看，未完成的用于推进。
 * 点击回调由调用方注入，本组件不碰 store（`Marks` 是纯展示层）。
 */
export function ProgressSteps({
  expressConfirmed,
  resultFilled,
  onOpenExpress,
  onOpenResult,
}: {
  /** 「快递信息」那一步确认过没有 —— 证据：该行 `verifyStatus === 'verified'` */
  expressConfirmed: boolean
  /** 「回函结果」那一步填过没有 —— 证据：该行 `resultInfo` 存在（`SUBMIT_RESULT` 写的就是它） */
  resultFilled: boolean
  /** 点「快递信息」—— 打开回函快递信息弹窗 */
  onOpenExpress?: () => void
  /** 点「回函结果」—— 打开回函结果填写弹窗 */
  onOpenResult?: () => void
}) {
  const expressDone = expressConfirmed
  const resultDone = resultFilled
  const steps = [
    {
      label: '快递信息',
      done: expressDone,
      /* 「当前该做的那一步」—— 未完成的第一个步骤。操作列的主按钮已于 v2.52 移除，
         引导职责全部落在这里，故给当前步骤加字重提示（`.is-current`）。 */
      /* 「当前该做的那一步」= **第一个还没做的**（本步没做就是它） */
      current: !expressDone,
      onClick: onOpenExpress,
    },
    {
      label: '回函结果',
      done: resultDone,
      /* 前面那步没做完时不标 current —— 引导一次只给一个落点 */
      current: expressDone && !resultDone,
      onClick: onOpenResult,
    },
  ]
  return (
    <span className="progress-steps">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && (
            <span className="progress-steps__sep" aria-hidden="true">
              |
            </span>
          )}
          <button
            type="button"
            className={s.current ? 'progress-steps__step is-current' : 'progress-steps__step'}
            disabled={!s.onClick}
            onClick={s.onClick}
          >
            <span className={s.done ? 'progress-steps__dot is-done' : 'progress-steps__dot'}>
              {s.done && <CheckOutlined />}
            </span>
            <span>{s.label}</span>
            <span className="progress-steps__arrow" aria-hidden="true">
              ›
            </span>
          </button>
        </Fragment>
      ))}
    </span>
  )
}

/* ------------------- 回函是否相符 ------------------- */

/**
 * 「回函是否相符」标签 —— 列表列专用（v2.25 立，v3.29 改口径）。
 *
 * **判定口径（业务硬规则，不可违背）**：判定本身已收敛到
 * `services/replyRule.ts` 的 `evaluateMatch` 单一出口，本组件只负责展示：
 * · 往来函证 —— 印章落「信息证明无误」区 → **相符**；落「信息不符」区 → **不相符**；未识别 → 无法判定；
 * · 银行函证 —— **只看询证事项逐项核对**（有差异即判不相符），印章不作相符性依据；
 * · 人工填写过回函结果后（`resultInfo.matched`），**以人工值为准**。
 *
 * ## v3.29：这一格是「**用户确认之后的那个结果**」，不再带任何 AI 标记
 *
 * 用户原话：「**是否相符，不需要 ai 标识和虚线**，这个是否相符，就是**用户确认之后的结果**，
 * 在未确认之前，这里标识为**未确认**就行」。
 *
 * 于是把 v2.25 起的「`✦` + 虚线框 = AI 建议、实线 = 已人工确认」那套**整套去掉**：
 * 结论要么是用户认过的，要么根本还没结论 —— 两种状态各自有名字，不需要再教用户读边框样式。
 *
 * 三态（`review` 为承载相符性的那一项在「核查事项复核」里的处置结果，见 `config/aiReview`）：
 * · **未确认**（那项还没处理、结果页也没填过）→ 中性「未确认」；
 * · **待人工判定**（那项被标记「不采纳」）→ 中性 —— AI 的结论人没收，相符性得由人在
 *   「回函结果填写」页给；
 * · **已确认**（采纳了那项，或结果页填过 `matched`）→ 如实给「相符 / 不相符 / 无法判定」。
 *
 * 视觉口径与结论标签（`MatchTag`）一致（v2.23）：**浅底无边框 + 深档语义色文字 + 字重 500**（列表里的
 * 标签是"结论徽标"、与整页一致）；「未确认 / 待人工判定 / 无法判定」走中性灰 ——
 * 它们都**不是结论**，只是"还没有结论"。
 */
export function MatchTag({
  matched,
  basis,
  reasons,
  type,
  pending,
  review,
  filled,
}: {
  /** 相符 = true；不相符 = false；无法判定 = null */
  matched: boolean | null
  /** 一句话依据，如「印章落于「信息证明无误」区」 */
  basis?: string
  /** 不相符时的原因 / 差异说明（只用悬停，不加图标） */
  reasons?: string[]
  /** 函证类型 —— 用于「无法判定」时给出与类型相符的归因（不得把银行函证归因到印章区域） */
  type?: ConfirmationType
  /**
   * AI 识别中（v2.28 银行函证两阶段）—— 渲染中性「识别中」。
   * 与「无法判定」的区分：识别中是「数据还没就绪」，无法判定是「结论是未知、待人工」。
   */
  pending?: boolean
  /**
   * **承载相符性的那一项在「核查事项复核」里的处置结果**（v3.29）——
   * 往来 = 印章识别、银行 = 回函是否相符检测（见 `AI_REVIEW_MATCH_CARRIER`）。
   * `undefined` = 还没处理。
   */
  review?: 'adopted' | 'ignored'
  /** 是否已在「回函结果填写」页人工填过相符性（`resultInfo.matched`）—— 那也是"确认过" */
  filled?: boolean
}) {
  /** 人已经认过这个结论：采纳了承载项，或在结果页自己填过 */
  const confirmed = review === 'adopted' || filled === true
  const cfg: { text: string; tone: TagTone } = pending
    ? PENDING_CFG
    : review === 'ignored'
      ? { text: '待人工判定', tone: 'neutral' }
      : !confirmed
        ? { text: '未确认', tone: 'neutral' }
        : matched === true
          ? { text: '相符', tone: 'low' }
          : matched === false
            ? { text: '不相符', tone: 'high' }
            : { text: '无法判定', tone: 'neutral' }

  const tips: string[] = []
  if (pending) {
    tips.push(RECOGNIZING_HINT)
  } else if (review === 'ignored') {
    tips.push('你在「核查事项复核」里标记了不采纳该项识别数据 —— 相符性以「回函结果填写」页的人工判断为准')
  } else if (!confirmed) {
    tips.push('待确认 —— 相符性以你在「核查事项复核」里确认的结论为准；确认后这里才显示结果')
  } else if (matched === null) {
    /* 无法判定的归因必须与该类型的相符性判据一致 —— 银行函证不得归因到印章落章区域 */
    tips.push(
      type && TYPE_RULE[type].matchBy === 'consistencyOnly'
        ? 'AI 未能完成询证事项逐项核对，无法自动判定 —— 待人工判定'
        : 'AI 未能识别印章落章区域，无法自动判定 —— 待人工判定',
    )
  } else {
    tips.push(
      review === 'adopted'
        ? '已确认 —— 你在列表「核查事项复核」里采纳了这一项的识别数据'
        : '已确认 —— 你在「回函结果填写」页填写了相符性',
    )
  }
  if (basis) tips.push(`依据：${basis}`)
  if (reasons?.length) tips.push(...reasons.map((r) => `· ${r}`))

  return (
    <StatusTag
      tone={cfg.tone}
      tip={
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          {tips.map((t) => (
            <div key={t}>{t}</div>
          ))}
        </div>
      }
    >
      {cfg.text}
    </StatusTag>
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
      <StatusTag
        tone="primary"
        className="status-tag--help"
        tip={`核验人：${by ?? '—'}　核验时间：${at ?? '—'}`}
      >
        ✓ 已人工核验
      </StatusTag>
    )
  }
  return <StatusTag tone="neutral">待核验</StatusTag>
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
 * 事实清单的字段行 —— 标签 + 值（+ 补充说明）。
 * 四项明细统一复用它，保证同一层级信息在各检测项里长得一样。
 *
 * ⚠️ **行尾那枚置信度胶囊已移除（2026-10-14，用户：「去掉所有的置信度」）** ——
 * 故 `confidence` 入参一并取消（调用处同步删参）。这一行现在只讲「事实是什么」。
 */
export function InfoRow({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string
  value: string
  /** 值的语义：默认墨色；`risk` 用于「未检出 / 不一致」这类需关注值 */
  tone?: 'default' | 'ok' | 'risk'
  hint?: string
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
    </div>
  )
}
