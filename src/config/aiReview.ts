import type {
  AiReviewKey,
  AiReviewState,
  ConfirmationType,
  ReplyRecord,
  ReplyResultInfo,
} from '@/types'
import { evaluateMatch } from '@/services/replyRule'

/**
 * 列表「AI 核验事项」事项 —— **清单与映射的单一数据源**（v3.28）。
 *
 * ## 它解决什么
 *
 * 用户把「一条回函 = 一串待核验事项」这条模型摆到了列表上：每行有若干枚 AI 识别事项，
 * 逐项点开看详情、采纳或不采纳，处理完全部事项即视为核验完成。
 * 这套事项被**三处**消费：
 *   ① 列表的「AI 核验事项」列（`components/AiReviewCell.tsx`）—— 渲染标签与待办态；
 *   ② 核验详情（`VerificationPanel`）—— 打开时定位到该项、页脚给采纳 / 不采纳；
 *   ③ 「回函结果填写」页（`ReplyResultModal`）—— 采纳过的项**自动带出**到对应字段。
 *
 * 三处若各写一份清单，必然漂移（项目一路在清理这类重复）。故清单、页签对应、
 * 结论可用性与「带出到哪个字段」全部收在本文件，三处只读不写。
 *
 * ## 口径（用户拍板，逐条对应）
 *
 * · **往来**：① 印章识别（**往来函证的「回函是否相符」由它判定**）② 发函回函一致性检测
 *   ③ 手写体识别 —— 用户原话：「往来函回函是否相符，走印章识别。发函回函一致性检测，
 *   单独拉出来，**和印章识别同级别**」；
 * · **银行**：① 回函是否相符检测（询证事项逐项核对）② 印章识别 ——
 *   用户原话：「银行函证，没有发函回函一致性检测，只有回函是否相符检测」；
 * · **两类都不含「快递（面单）检测」** —— 用户原话：「银行函往来函，去掉快递检测」。
 */

/** 打开详情时落在哪个核验页签（对应 `VerificationPanel` 的页签 key） */
export type AiReviewPanelKey = 'consistency' | 'seal' | 'handwriting'

export interface AiReviewItem {
  key: AiReviewKey
  /** 列表上那枚标签的文字 */
  label: string
  /** 详情打开后定位到的页签 */
  panelKey: AiReviewPanelKey
  /** 悬停补充：这个事项在看什么（一句话） */
  hint: string
}

export const AI_REVIEW_ITEMS: Record<ConfirmationType, AiReviewItem[]> = {
  往来函证: [
    {
      key: 'seal',
      label: '印章识别',
      panelKey: 'seal',
      hint: '是否盖章 / 公章还是财务章 / 名称一致性 / 骑缝章 —— 往来函证的「回函是否相符」由印章落章区域判定',
    },
    {
      key: 'consistency',
      label: '发函回函一致性检测',
      panelKey: 'consistency',
      hint: '发函件与回函件里每一张数据表格并排对照，不一致的金额单元格标红（采纳后带出到「差异说明」）',
    },
    {
      key: 'handwriting',
      label: '手写体识别',
      panelKey: 'handwriting',
      hint: '「信息不符」处的手写说明转录（采纳后带出到「差异说明」）',
    },
  ],
  银行函证: [
    {
      key: 'match',
      label: '回函是否相符检测',
      panelKey: 'consistency',
      /*
       * 名字按**结论**取（用户口径：「银行函证，没有发函回函一致性检测，只有回函是否相符检测」），
       * 详情页那枚页签仍按 `TYPE_RULE.consistencyLabel` 写**方法名**「询证事项逐项核对」——
       * 两者是同一项的两个名字，故这里点明对应关系，免得用户以为是两件事。
       */
      hint: '回函 × 系统内格式一/二数据逐项核对（即详情里的「询证事项逐项核对」），有差异即判不相符',
    },
    {
      key: 'seal',
      label: '印章识别',
      panelKey: 'seal',
      hint: '是否有印章 / 印章名称与被询证单位是否一致（只作风险提示，不影响相符性）',
    },
  ],
}

/**
 * **承载「回函是否相符」结论的那一项** —— 两类不同：
 * 往来走印章识别（落章区域），银行走询证事项逐项核对。
 *
 * 列表「回函是否相符」列据此取该项的处置结果（`aiReviewStateOf`），决定那一格显示
 * 「未确认 / 待人工判定 / 结论」（v3.29，见 `Marks` 的 `MatchTag` 的 `review` 入参）。
 */
export const AI_REVIEW_MATCH_CARRIER: Record<ConfirmationType, AiReviewKey> = {
  往来函证: 'seal',
  银行函证: 'match',
}

export function aiReviewItemsOf(type: ConfirmationType): AiReviewItem[] {
  return AI_REVIEW_ITEMS[type]
}

/** 该事项的人工处置结果（`undefined` = 尚未处理） */
export function aiReviewStateOf(record: ReplyRecord, key: AiReviewKey): AiReviewState | undefined {
  return record.aiReview?.[key]
}

/** 是否**有 AI 结论可采纳** —— 没有结论时详情里的「采纳」必须禁用（没什么可采的） */
export function isAiReviewAvailable(record: ReplyRecord, key: AiReviewKey): boolean {
  const v = record.verification
  if (!v) return false
  switch (key) {
    case 'consistency':
      return v.consistency.tables.length > 0
    case 'handwriting':
      return !!v.handwriting
    case 'seal':
      return v.seal.hasSeal || v.seal.sealCount > 0
    case 'match':
      /* 银行询证事项由 `bankItems` 派生（缺省回退演示数据），**恒有结论**：有差异即不相符 */
      return true
  }
}

/**
 * 该项**是否已被人工表态**（采纳或不采纳都算）。
 * 「处理过」= 这个待办已完成，列表上打勾 —— 与"采纳"是两件事（不采纳也算处理完）。
 */
export function isAiReviewHandled(record: ReplyRecord, key: AiReviewKey): boolean {
  return !!aiReviewStateOf(record, key)
}

/** 待办提示：已处理过的事项在标签上悬停显示「谁、什么时候处理成什么」 */
export function aiReviewTip(state: AiReviewState | undefined): string | undefined {
  if (!state) return undefined
  return `${state.status === 'adopted' ? '已采纳' : '已标记不采纳'} · ${state.by} · ${state.at}`
}

/* ------------------------------------------------------------------ */
/* 采纳值 → 「回函结果填写」页的带出                                       */
/* ------------------------------------------------------------------ */

/** 一致性检测的差异项 → 一句可读的差异说明（用户口径：采纳后带出到「差异说明」） */
function diffDescOf(record: ReplyRecord): string {
  const rows = record.verification?.consistency.rows.filter((r) => r.match !== 'match') ?? []
  if (!rows.length) return ''
  const money = (n: number | null) => (n == null ? '未填' : n.toLocaleString('zh-CN'))
  const lines = rows.map(
    (r) => `· ${r.subject}${r.period ? `（${r.period}）` : ''}：发函 ${money(r.sentAmount)} / 回函 ${money(r.repliedAmount)}`,
  )
  return `发函回函一致性检测发现不符项：\n${lines.join('\n')}`
}

/** 手写体转录 → 说明里的一段 */
function handwriteDescOf(record: ReplyRecord): string {
  const t = record.verification?.handwriting?.text
  return t ? `手写体识别转录：${t}` : ''
}

/**
 * **已采纳的事项 → 「回函结果填写」页该带出的值**（v3.28）。
 *
 * 返回的是「初值」，不是「已保存值」—— 结果页的优先级是
 * **已保存的 `resultInfo` → 本函数的返回值 → 空**（守住「AI 不外写」：只有人明确采纳过才带入）。
 *
 * 映射（成对实现，不引入第二套规则）：
 * · 往来 `seal` 采纳 → `matched`（用 `evaluateMatch` 的 AI 值）+ `sealConsistent` +
 *   `officialSeal` + `crossSeal`（往来查骑缝章；银行不查）；
 * · 往来 `consistency` 采纳 → `diffDesc`（差异项清单）；
 * · 往来 `handwriting` 采纳 → `diffDesc`（手写体转录，与差异项**分段拼接**，互不覆盖）；
 * · 银行 `match` 采纳 → `matched`；
 * · 银行 `seal` 采纳 → `sealConsistent` + `officialSeal`。
 *
 * `ignored`（不采纳）**一律不带值** —— 用户口径：「只标记已处理，不带入值」。
 */
export function aiReviewPrefill(record: ReplyRecord): Partial<ReplyResultInfo> {
  const r = record.aiReview
  if (!r) return {}
  const adopted = (k: AiReviewKey) => r[k]?.status === 'adopted'
  const v = record.verification
  const out: Partial<ReplyResultInfo> = {}

  if (record.type === '往来函证') {
    if (adopted('seal') && v) {
      out.matched = evaluateMatch(record).matched ?? undefined
      out.sealConsistent = v.seal.nameMatched
      if (v.seal.hasSeal) {
        out.officialSeal = v.seal.sealType === '公章'
        out.crossSeal = v.seal.crossPageSeal ? 'yes' : 'no'
      }
    }
    const parts = [
      adopted('consistency') ? diffDescOf(record) : '',
      adopted('handwriting') ? handwriteDescOf(record) : '',
    ].filter(Boolean)
    if (parts.length) out.diffDesc = parts.join('\n\n')
    return out
  }

  if (adopted('match')) out.matched = evaluateMatch(record).matched ?? undefined
  if (adopted('seal') && v) {
    out.sealConsistent = v.seal.nameMatched
    if (v.seal.hasSeal) out.officialSeal = v.seal.sealType === '公章'
  }
  return out
}
