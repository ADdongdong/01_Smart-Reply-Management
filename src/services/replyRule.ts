import type { ConfirmationType, ReplyRecord } from '@/types'
import { buildBankItemsForRecord } from '@/mock/confirmations'

/**
 * 按函证类型分流的**业务规则表（单一事实来源）**。
 * ------------------------------------------------------------------
 * 往来函证与银行函证的智能检测事项差别很大，此前相符性判定散落在
 * 列表 `matchOf` / 历次摘要 `conclusionOf` / 结果填写页 `aiMatched` 三处，
 * 且都以 `type === '银行函证'` 内联分支混用印章口径 —— 这是口径打架的根因。
 *
 * 本表集中回答「每类函证查什么、依据什么判相符」：
 *   · **往来函证** —— 一致性 = 发函件 × 回函件逐行比对；相符性由**印章落章区域**判定
 *     （落「信息证明无误」区 → 相符；落「信息不符」区 → 不相符；未识别 → 无法判定）。
 *     另检测手写体（「信息不符」处的手写说明转录）。
 *   · **银行函证** —— 银行回函的格式一 / 格式二数据已存放在函证系统中，
 *     系统**只识别回函件**，与系统内已存的询证事项逐项核对（发函金额 vs 回函金额）；
 *     相符性**只由该逐项核对决定**，有差异即判不相符。**不检测手写体**，
 *     印章落章区域不参与相符性推理（印章三项检测保留，仅作风险提示）。
 *
 * 列表列、历次回函摘要、结果填写页 AI 建议必须共用 `evaluateMatch` 这一个出口，
 * 禁止再写 `type === '银行函证'` 的新判定分支 —— 需要类型差异时一律查本表。
 */

/** 一致性数据的来源：往来=发函件 × 回函件；银行=回函件 × 系统内格式一/二 */
export type ConsistencySource = 'consistency' | 'bankItems'

/** 相符性判据：往来=印章落章区域；银行=仅一致性（询证事项逐项核对） */
export type MatchBasis = 'sealRegion' | 'consistencyOnly'

export interface TypeRule {
  /** 一致性（核对）数据来源 */
  source: ConsistencySource
  /** 一致性检测点的展示名（银行侧为「询证事项逐项核对」） */
  consistencyLabel: string
  /** 是否检测并展示手写体（银行侧 false：核验明细、批注层、结果填写页同步关闭） */
  detectHandwriting: boolean
  /** 是否检测并展示银行函证文本识别（四要素，用于归属匹配） */
  detectBankText: boolean
  /** 相符性判据 */
  matchBy: MatchBasis
  /**
   * 是否为两阶段识别（v2.28）：**先对应、后细查**。
   * · 银行函证 true —— 阶段一只识别四要素并给出归属，用户确认对应后其余检测项才自动开跑；
   * · 往来函证 false —— 二维码精确命中归属，无需人工「对应」，一次性跑完。
   */
  twoPhase: boolean
  /** 识别工作台的演示批次 */
  presetBatchId: 'A' | 'B'
  /** 列表页上传入口按钮文案 */
  entryTitle: string
  /** 「完整核验明细（…）」的括号文案 —— 按类型列出各自检测项 */
  verifyItemsLabel: string
  /** 「函证结果是否相符」旁的业务规则提示（Tooltip） */
  matchRuleHint: string
  /** 「回函结果不相符处的描述」占位符 */
  diffPlaceholder: string
}

export const TYPE_RULE: Record<ConfirmationType, TypeRule> = {
  往来函证: {
    source: 'consistency',
    consistencyLabel: '发函回函一致性检测',
    detectHandwriting: true,
    detectBankText: false,
    matchBy: 'sealRegion',
    twoPhase: false,
    presetBatchId: 'A',
    entryTitle: '上传往来函证回函',
    verifyItemsLabel: '一致性比对 / 印章 / 手写体',
    matchRuleHint: '依据函证业务规则：印章盖在「信息证明无误」区判定为相符；盖在「信息不符」区判定为不相符',
    diffPlaceholder: '请描述不符项目及差异缘由，可由上方「手写体识别」一键带入',
  },
  银行函证: {
    source: 'bankItems',
    consistencyLabel: '询证事项逐项核对',
    detectHandwriting: false,
    detectBankText: true,
    matchBy: 'consistencyOnly',
    twoPhase: true,
    presetBatchId: 'B',
    entryTitle: '上传银行函证回函',
    verifyItemsLabel: '询证事项逐项核对 / 印章 / 银行函证文本识别',
    matchRuleHint: '依据函证业务规则：银行函证与系统内格式一 / 格式二数据逐项核对，有差异即判不相符（印章位置不参与相符性判定）',
    diffPlaceholder: '请描述不符项目及差异缘由，可参考上方「询证事项逐项核对」结果',
  },
}

/** 相符性判定结果 —— 形状与列表 MatchTag 的约定一致，不得擅自变更 */
export interface MatchEvaluation {
  /** true=相符 / false=不相符 / null=无法判定（待人工） */
  matched: boolean | null
  /** 是否为 AI 建议值（未人工确认时恒为 true） */
  byAi: boolean
  /** AI 建议的依据文案（Tooltip「依据：…」） */
  basis?: string
  /** 附加原因（风险原因等，Tooltip 追加段） */
  reasons?: string[]
}

/**
 * 「回函是否相符」判定 —— **唯一出口**。
 *
 * · 人工填写过回函结果（`resultInfo.matched`）→ 以人工值为准（约束 C-03：
 *   AI 只出建议、人工确认才写入；已确认的值必须原样回显）。
 * · 否则按 `TYPE_RULE[record.type].matchBy` 分流：
 *   - 银行函证（consistencyOnly）：只看询证事项逐项核对，有差异即不相符、
 *     全部一致即相符；**印章状态不参与**（印章问题走 AI 风险提示）。
 *   - 往来函证（sealRegion）：由印章落章区域判定；未识别 → 无法判定。
 */
/**
 * 「AI 识别中」态的唯一判据 —— 归属已确认、其余检测项（银行函证阶段二）尚未回填完成。
 *
 * 刻意**不用「`verification === undefined` 即识别中」这种隐式契约**：
 * 那样任何一处误写都会让列表沉默地显示错误结论；显式字段 + 单一判据才能保证
 * 列表列、展开区、结果填写页、核验页对「识别中」的口径完全一致。
 */
export function isRecognitionPending(record: ReplyRecord): boolean {
  return record.recognitionPending === true
}

export function evaluateMatch(record: ReplyRecord): MatchEvaluation {
  // ① 人工已确认 → 以人工值为准
  if (record.resultInfo?.matched !== undefined) {
    return {
      matched: record.resultInfo.matched,
      byAi: false,
      reasons: record.resultInfo.diffDesc ? [record.resultInfo.diffDesc] : undefined,
    }
  }

  /*
   * ①′ 识别中（银行函证阶段二尚未回填）→ 直接返回「无结论」。
   * **这一步是防错的关键**：`consistencyOf` 对银行函证会回退到内置询证事项数据，
   * 若不短路，未识别完就会算出一个看起来正常的「相符 / 不相符」结论。
   */
  if (isRecognitionPending(record)) {
    return { matched: null, byAi: true, basis: 'AI 识别中 —— 其余检测项完成后自动刷新' }
  }

  const rule = TYPE_RULE[record.type]
  const v = record.verification

  // ② 银行函证 —— 只看询证事项逐项核对（回函 × 系统内格式一/二）
  if (rule.matchBy === 'consistencyOnly') {
    const c = consistencyOf(record)
    if (c.total === 0) {
      return { matched: null, byAi: true, basis: '询证事项逐项核对尚未完成' }
    }
    return c.diffCount > 0
      ? {
          matched: false,
          byAi: true,
          basis: `回函与系统内询证事项逐项核对有 ${c.diffCount} 项差异`,
          reasons: v?.riskReasons,
        }
      : { matched: true, byAi: true, basis: '回函与系统内询证事项逐项核对全部一致' }
  }

  // ③ 往来函证 —— 印章落章区域判定（口径不变）
  const region = v?.seal.region
  if (region === '信息证明无误区') {
    return { matched: true, byAi: true, basis: '印章落于「信息证明无误」区' }
  }
  if (region === '信息不符区') {
    return {
      matched: false,
      byAi: true,
      basis: '印章落于「信息不符」区',
      reasons: v?.riskReasons,
    }
  }
  return { matched: null, byAi: true }
}

export interface ConsistencySummary {
  /** 该类型下一致性（核对）检测点的展示名 */
  label: string
  /** 参与核对的条目数 */
  total: number
  /** 差异条目数 */
  diffCount: number
}

/**
 * 一致性摘要 —— **按类型取数据源**：
 * · 往来函证取 `verification.consistency`（发函件 × 回函件科目比对）；
 * · 银行函证取 `bankItems`（回函 × 系统内格式一/二询证事项）。
 * 消除「展开区显示全部相符、列表结论却是询证事项有差异」这类数据打架。
 *
 * **调用前提**：识别已完成。银行函证在识别中（`isRecognitionPending`）时
 * `buildBankItemsForRecord` 会回退到内置演示数据、算出看似正常的数字 ——
 * 因此调用方必须先判 `isRecognitionPending`，识别中一律展示「识别中」而不是本摘要。
 */
export function consistencyOf(record: ReplyRecord): ConsistencySummary {
  const rule = TYPE_RULE[record.type]
  if (rule.source === 'bankItems') {
    const items = buildBankItemsForRecord(record)
    return {
      label: rule.consistencyLabel,
      total: items.length,
      diffCount: items.filter((i) => !i.match).length,
    }
  }
  const c = record.verification?.consistency
  return {
    label: rule.consistencyLabel,
    total: c?.rows.length ?? 0,
    diffCount: c?.diffCount ?? 0,
  }
}
