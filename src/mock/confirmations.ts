import type {
  AiVerification,
  BankCandidateSource,
  BankItemEntry,
  BankItemGroup,
  BankTextResult,
  ConfirmationType,
  ConsistencyRow,
  HandwritingResult,
  ReplyRecord,
  SealResult,
  SubjectEntry,
} from '@/types'
import { scoreBankMatch } from '@/services/bankMatch'

/** 被审计单位名称 —— 银行函证四要素之一 */
export const AUDITED_ENTITY = '山东某某科技股份有限公司'

/* ------------------------------------------------------------------ */
/* 可归属的候选函证                                                    */
/* ------------------------------------------------------------------ */

/**
 * 候选函证 —— 银行函证按四要素匹配（见 services/bankMatch.ts），
 * 往来函证按回函右上角二维码精确命中。同一银行的不同期间各占一封，
 * 避免出现「同银行同期间多封函证」的归属歧义。
 */
export const CANDIDATE_SOURCES: BankCandidateSource[] = [
  {
    confirmationNo: 'QS2024-031',
    entity: '齐商银行股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2024-01-01',
    periodEnd: '2024-03-31',
    type: '银行函证',
  },
  {
    confirmationNo: 'QS2024-018',
    entity: '齐商银行股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2023-01-01',
    periodEnd: '2023-12-31',
    type: '银行函证',
  },
  {
    confirmationNo: 'QS2024-019',
    entity: '中国建设银行股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2024-01-01',
    periodEnd: '2024-03-31',
    type: '银行函证',
  },
  {
    confirmationNo: 'whzf0010008',
    entity: '东方财富证券股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2024-01-01',
    periodEnd: '2024-06-30',
    type: '往来函证',
  },
  {
    confirmationNo: 'whzf0010009',
    entity: '中金财富证券股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2024-01-01',
    periodEnd: '2024-06-30',
    type: '往来函证',
  },
  {
    confirmationNo: 'whzf0010010',
    entity: '平安证券股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2024-01-01',
    periodEnd: '2024-06-30',
    type: '往来函证',
  },
]

/* ------------------------------------------------------------------ */
/* 基础科目数据 —— 取自真实样例「0813回函123.pdf」正文表格 20 条事项    */
/* ------------------------------------------------------------------ */

const BASE_ROWS: { item: string; period: string; subject: string; amount: number }[] = [
  { item: '事项1', period: '2021年度', subject: '主营业务收入', amount: 5000000 },
  { item: '事项2', period: '2022年度', subject: '主营业务收入', amount: 5000001 },
  { item: '事项3', period: '2023年度', subject: '主营业务收入', amount: 5000002 },
  { item: '事项4', period: '2024年1-6月', subject: '主营业务收入', amount: 5000003 },
  { item: '事项5', period: '2021年度', subject: '应收账款', amount: 300000 },
  { item: '事项6', period: '2022年度', subject: '应收账款', amount: 301000 },
  { item: '事项7', period: '2023年度', subject: '应收账款', amount: 302000 },
  { item: '事项8', period: '2024年1-6月', subject: '应收账款', amount: 303000 },
  { item: '事项9', period: '2021年度', subject: '预收账款', amount: 600000 },
  { item: '事项10', period: '2022年度', subject: '预收账款', amount: 601000 },
  { item: '事项11', period: '2023年度', subject: '预收账款', amount: 602000 },
  { item: '事项12', period: '2024年1-6月', subject: '预收账款', amount: 603000 },
  { item: '事项13', period: '2021年度', subject: '其他应收款', amount: 603001 },
  { item: '事项14', period: '2022年度', subject: '其他应收款', amount: 603002 },
  { item: '事项15', period: '2023年度', subject: '其他应收款', amount: 603003 },
  { item: '事项16', period: '2024年1-6月', subject: '其他应收款', amount: 603004 },
  { item: '事项17', period: '2021年度', subject: '其他应付款', amount: 603005 },
  { item: '事项18', period: '2022年度', subject: '其他应付款', amount: 603006 },
  { item: '事项19', period: '2023年度', subject: '其他应付款', amount: 603007 },
  { item: '事项20', period: '2024年1-6月', subject: '其他应付款', amount: 603008 },
]

/**
 * 构建一致性比对结果
 * @param diffs 差异项：item -> 回函金额（null 表示回函缺失）
 */
function buildConsistency(diffs: Record<string, number | null> = {}): ConsistencyRow[] {
  return BASE_ROWS.map((r) => {
    const hasDiff = Object.prototype.hasOwnProperty.call(diffs, r.item)
    const replied = hasDiff ? (diffs[r.item] as number | null) : r.amount
    return {
      id: r.item,
      item: r.item,
      period: r.period,
      subject: r.subject,
      sentAmount: r.amount,
      repliedAmount: replied,
      match: !hasDiff ? 'match' : replied === null ? 'missing' : 'diff',
      confidence: hasDiff ? 0.93 : 0.98,
    }
  })
}

/** 科目余额分录（回函结果填写页使用） */
function buildSubjectEntries(rows: ConsistencyRow[]): SubjectEntry[] {
  return rows
    .filter((r) => r.match !== 'match')
    .map((r, i) => ({
      id: `se-${i}`,
      period: r.period,
      subject: r.subject,
      sentAmount: r.sentAmount,
      repliedAmount: r.repliedAmount,
      diff: (r.repliedAmount ?? 0) - (r.sentAmount ?? 0),
      match: false,
    }))
}

/* ------------------------------------------------------------------ */
/* 印章识别结果                                                        */
/* ------------------------------------------------------------------ */

/** 正常：公章，盖在「信息证明无误」区 */
const SEAL_NORMAL: SealResult = {
  hasSeal: true,
  sealCount: 1,
  crossPageSeal: true,
  crossPageSealCount: 3,
  sealType: '公章',
  sealName: '中信证券股份有限公司',
  nameMatched: true,
  region: '信息证明无误区',
  regionConclusion: '印章落于「信息证明无误」区域 → 回函结果应为「相符」',
  confidence: 0.96,
  boxes: [
    { page: 1, x: 7, y: 75, w: 27, h: 15, label: '公章 · 信息证明无误区', abnormal: false },
    { page: 1, x: 92, y: 42, w: 6, h: 30, label: '骑缝章', abnormal: false },
  ],
}

/** 异常：公章，盖在「信息不符」区 */
const SEAL_ABNORMAL: SealResult = {
  hasSeal: true,
  sealCount: 1,
  crossPageSeal: true,
  crossPageSealCount: 2,
  sealType: '公章',
  sealName: '广东证券股份有限公司',
  nameMatched: true,
  region: '信息不符区',
  regionConclusion:
    '印章落于「信息不符」区域 → 回函结果应为「不相符」，请核对差异项目并填写不相符说明',
  confidence: 0.92,
  boxes: [
    { page: 1, x: 7, y: 75, w: 27, h: 15, label: '公章 · 信息不符区', abnormal: true },
    { page: 1, x: 92, y: 42, w: 6, h: 30, label: '骑缝章', abnormal: false },
  ],
}

/** 银行函证：未盖章 */
const SEAL_MISSING: SealResult = {
  hasSeal: false,
  sealCount: 0,
  crossPageSeal: false,
  crossPageSealCount: 0,
  sealType: '无',
  sealName: '—',
  nameMatched: false,
  region: '未识别',
  regionConclusion:
    '未在回函文件任何页检出印章 → 仅作风险提示（建议退回补盖）；银行函证的相符性由询证事项逐项核对决定，与印章无关',
  confidence: 0.88,
  boxes: [],
}

/* ------------------------------------------------------------------ */
/* 银行函证文本识别（四要素）                                          */
/* ------------------------------------------------------------------ */

/** 齐商银行这份回函中识别出的四要素（日期为自然写法，需归一化后比对） */
export const BANK_REPLY_INPUT = {
  bankName: '齐商银行股份有限公司',
  auditedEntity: AUDITED_ENTITY,
  periodStart: '2024年1月1日',
  periodEnd: '2024/03/31',
}

/** 齐商银行回函的四要素匹配结果 —— 由纯函数计算，与识别队列共用同一套口径 */
const BANK_TEXT: BankTextResult = {
  ...scoreBankMatch(BANK_REPLY_INPUT, CANDIDATE_SOURCES),
  assignSource: 'auto',
}

/* ------------------------------------------------------------------ */
/* 询证事项逐项核对（银行函证专用）                                    */
/* ------------------------------------------------------------------ */

/**
 * 齐商银行询证事项逐项核对（演示：第 4 项担保存在差异）。
 * 按标准《银行询证函》固定询证项组织，未涉及的事项标注「本期无」。
 */
export const BANK_ITEMS_QS: BankItemEntry[] = [
  {
    id: 'bi-1',
    itemNo: '1',
    item: '银行存款',
    sentAmount: 12580342.66,
    repliedAmount: 12580342.66,
    diff: 0,
    match: true,
    note: '活期存款账户余额，双方一致',
  },
  {
    id: 'bi-2',
    itemNo: '2',
    item: '银行借款',
    sentAmount: 5000000,
    repliedAmount: 5000000,
    diff: 0,
    match: true,
    note: '短期流动资金借款，本金一致',
  },
  { id: 'bi-3', itemNo: '3', item: '注销银行账户', sentAmount: 0, repliedAmount: 0, diff: 0, match: true, note: '本期无注销银行账户' },
  {
    id: 'bi-4',
    itemNo: '4',
    item: '担保（含保函）',
    sentAmount: 0,
    repliedAmount: 2000000,
    diff: 2000000,
    match: false,
    note: '发函未列示，银行回函补充该担保事项，需核实是否为被审计单位提供',
  },
  { id: 'bi-5', itemNo: '5', item: '票据贴现', sentAmount: 0, repliedAmount: 0, diff: 0, match: true, note: '本期无票据贴现' },
  { id: 'bi-6', itemNo: '6', item: '未到期保理', sentAmount: 0, repliedAmount: 0, diff: 0, match: true, note: '本期无未到期保理' },
]

/* ------------------------------------------------------------------ */
/* 手写体识别                                                          */
/* ------------------------------------------------------------------ */

const HANDWRITING_ABNORMAL: HandwritingResult = {
  text: '上述应收账款金额与我公司账面记录不符，差异原因系 2023 年 12 月一批退货尚未办理入库冲销，金额 18,000 元。',
  region: '信息不符区',
  conclusion: '手写说明位于「信息不符」区，与印章落章区域一致 → 佐证回函结果为「不相符」',
  confidence: 0.89,
}

const HANDWRITING_NORMAL: HandwritingResult = {
  text: '经核对，上述各项金额与我公司账面记录一致。',
  region: '信息证明无误区',
  conclusion: '手写说明位于「信息证明无误」区 → 佐证回函结果为「相符」',
  confidence: 0.91,
}

/* ------------------------------------------------------------------ */
/* 组装 AI 核验结果                                                    */
/* ------------------------------------------------------------------ */

/**
 * AI 风险等级与原因 —— **按函证类型分口径**（与 replyRule 的相符性判据配套）：
 * · 往来函证 —— 印章缺失 → 相符性「无法判定」；盖于「信息不符」区 → 不相符；
 *   两者都是高风险原因。
 * · 银行函证 —— 印章三项检测**只作风险提示**，不再推导「回函结果无法判定 / 不相符」；
 *   相符性只看询证事项逐项核对（bankDiffCount）。
 */
function riskOf(type: ConfirmationType, v: { diffCount: number; seal: SealResult; bankDiffCount?: number }): {
  level: 'high' | 'medium' | 'low' | 'none'
  reasons: string[]
} {
  const reasons: string[] = []
  if (type === '银行函证') {
    // 印章问题单列为风险提示，与相符性分开表达
    if (!v.seal.hasSeal) reasons.push('回函未检出印章，建议退回被询证方补盖银行印章')
    if (v.seal.sealType === '财务章' && v.seal.nameMatched === false) {
      reasons.push('印章名称与被询证单位不一致')
    }
    if ((v.bankDiffCount ?? 0) > 0) {
      reasons.push(`回函与系统内询证事项逐项核对存在 ${v.bankDiffCount} 项差异`)
    }
    return {
      level: !v.seal.hasSeal ? 'high' : (v.bankDiffCount ?? 0) > 0 ? 'medium' : 'low',
      reasons,
    }
  }

  // 往来函证 —— 印章落章区域仍参与相符性推导（口径不变）
  if (!v.seal.hasSeal) reasons.push('未检出印章，回函结果无法判定')
  if (v.seal.region === '信息不符区') reasons.push('印章盖于「信息不符」区，回函结果为不相符')
  if (v.diffCount > 0) reasons.push(`一致性比对存在 ${v.diffCount} 项金额差异`)
  if (v.seal.sealType === '财务章' && v.seal.nameMatched === false) {
    reasons.push('印章名称与被询证单位不一致')
  }
  const level: 'high' | 'medium' | 'low' | 'none' =
    !v.seal.hasSeal || v.seal.region === '信息不符区'
      ? 'high'
      : v.diffCount > 0
        ? 'medium'
        : 'low'
  return { level, reasons }
}

/** 广东证券：印章落「信息不符」区 + 2 项金额差异 → 高风险 */
const VERIFY_GD: AiVerification = (() => {
  const rows = buildConsistency({ 事项7: 284000, 事项11: null })
  const diffCount = rows.filter((r) => r.match !== 'match').length
  const seal = SEAL_ABNORMAL
  const { level, reasons } = riskOf('往来函证', { diffCount, seal })
  return {
    consistency: { rows, diffCount, confidence: 0.95 },
    seal,
    handwriting: HANDWRITING_ABNORMAL,
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
})()

/** 中信证券：全部相符 → 低风险 */
const VERIFY_ZX: AiVerification = (() => {
  const rows = buildConsistency()
  const seal = SEAL_NORMAL
  const { level, reasons } = riskOf('往来函证', { diffCount: 0, seal })
  return {
    consistency: { rows, diffCount: 0, confidence: 0.97 },
    seal,
    handwriting: HANDWRITING_NORMAL,
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
})()

/** 齐商银行：未盖章（风险提示）+ 询证事项 1 项差异（判不相符）→ 高风险。
 *  相符性只由询证事项逐项核对决定；印章缺失不改变结论，只进风险原因。 */
const VERIFY_QS: AiVerification = (() => {
  const rows = buildConsistency()
  const seal = SEAL_MISSING
  const bankDiffCount = BANK_ITEMS_QS.filter((i) => !i.match).length
  const { level, reasons } = riskOf('银行函证', { diffCount: 0, seal, bankDiffCount })
  return {
    consistency: { rows, diffCount: 0, confidence: 0.9 },
    seal,
    bankText: BANK_TEXT,
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
})()

/** 中国建设银行（QS2024-019）：印章正常 + 询证事项 1 项差异（判不相符）→ 中风险。
 *  它与齐商银行的区别是**印章齐全**（齐商是未盖章），用于演示「有章但金额不符」这一组合。 */
const VERIFY_JH: AiVerification = (() => {
  const rows = buildConsistency()
  const seal = SEAL_NORMAL
  const bankDiffCount = BANK_ITEMS_QS.filter((i) => !i.match).length
  const { level, reasons } = riskOf('银行函证', { diffCount: 0, seal, bankDiffCount })
  return {
    consistency: { rows, diffCount: 0, confidence: 0.92 },
    seal,
    bankText: BANK_TEXT,
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
})()

/**
 * 候选函证的**核验兜底**（v2.55）。
 *
 * ## 为什么需要它
 *
 * 银行函证是**两阶段**类型：落库时 `verification` 刻意留空（否则第二次回函会在阶段一
 * 就显示上一份的结论，「识别中」态无法成立），等阶段二跑完由 `applyVerification` 回填。
 * 而回填走的是 `lookupVerification`，它原先**只查 `REPLY_RECORDS` 演示数据** ——
 * 于是**任何「上传后才归属」的函证**（它们本来就不在演示数据里）都会回填 `undefined`，
 * 表现为「回函结果填写」页里 **「AI 核验结论」整块消失**。
 *
 * 用户反馈：「为什么中国建设银行没有 AI 识别的是否采用的内容」—— 就是这个。
 * 齐商银行有，只是因为它恰好带着 `VERIFY_QS` 预置在演示数据里，**不是它特殊**。
 *
 * 真实实现里核验结果来自识别流水；本兜底只为让演示环境里**每条候选函证都出得了结论**。
 */
export const BANK_VERIFY_FALLBACK: Record<string, AiVerification> = {
  'QS2024-019': VERIFY_JH,
  /* 其余候选函证（齐商 2023 年度、东方财富 / 中金财富 / 平安证券）共用一份「全部相符」结论：
     演示重点在「不同函证都能出结论」，不在逐份造差异。 */
}

/** 兜底结论的工具函数 —— 给未单列配比的候选函证一份中性「全部相符、印章正常」结果 */
export function fallbackVerification(type: ConfirmationType): AiVerification {
  const bank = type === '银行函证'
  const seal = SEAL_NORMAL
  const { level, reasons } = riskOf(type, {
    diffCount: 0,
    seal,
    bankDiffCount: bank ? BANK_ITEMS_QS.filter((i) => !i.match).length : undefined,
  })
  return {
    consistency: { rows: buildConsistency(), diffCount: 0, confidence: 0.95 },
    seal,
    ...(bank ? { bankText: BANK_TEXT } : { handwriting: HANDWRITING_NORMAL }),
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
}

/**
 * 海通证券：加盖**财务章**（非公章）+ 缺骑缝章 + 1 项差异 → 中风险。
 * 印章类型专设为财务章，用于演示「是否为公章 = 否」这一分支。
 */
const VERIFY_HT: AiVerification = (() => {
  const rows = buildConsistency({ 事项15: 590000 })
  const diffCount = 1
  const seal: SealResult = {
    ...SEAL_NORMAL,
    sealType: '财务章',
    sealName: '海通证券股份有限公司',
    crossPageSeal: false,
    crossPageSealCount: 0,
    confidence: 0.9,
    boxes: [{ page: 1, x: 7, y: 75, w: 27, h: 15, label: '财务章 · 信息证明无误区', abnormal: false }],
  }
  return {
    consistency: { rows, diffCount, confidence: 0.94 },
    seal,
    handwriting: {
      text: '其他应收款余额差异系跨期入账所致。',
      region: '信息不符区',
      conclusion: '手写说明位于「信息不符」区，与印章区域不一致，建议人工复核',
      confidence: 0.82,
    },
    riskLevel: 'medium',
    riskReasons: [
      '一致性比对存在 1 项金额差异',
      '多页回函未检出骑缝章',
      '手写说明区域与印章区域不一致',
      '回函加盖的是财务章，非公章',
    ],
    completedModules: 6,
    totalModules: 6,
  }
})()

/* ------------------------------------------------------------------ */
/* 回函数据                                                            */
/* ------------------------------------------------------------------ */

/**
 * 数据说明
 * --------
 * 每条记录 = 该函证**某一次回函**的完整资料（附件、快递、AI 核验结果、人工核验留痕）。
 * 列表渲染时按 `confirmationNo` 归并为一封函证一行：
 *   · 主行取「最终有效回函」= 该函证最近一次收到回函的那条记录
 *   · 其余记录作为历史回函，收进展开区，可不处理、不计入统计
 * 因此本数组长度 > 列表行数。
 *
 * id 命名：`{函证编号}-{第几次回函}`
 */
export const REPLY_RECORDS: ReplyRecord[] = [
  /* ---------- 广东证券：仅 1 次回函，印章盖「信息不符」区 → 高风险，已人工核验 ---------- */
  {
    id: 'whzf0010006-1',
    sendSeq: 1,
    sendRecordNo: '20260810000006',
    confirmationNo: 'whzf0010006',
    entity: '广东证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-14 15:26:13',
    replyDate: '2026-09-14 15:39:39',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF7444706557147',
    replyFile: '0813回函123_p6.pdf',
    faceSheet: 'SF7444706557147.jpg',
    replyProgress: '已完成',
    hasReplied: true,
    risk: 'high',
    verifyStatus: 'verified',
    verifiedBy: '张审计',
    verifiedAt: '2026-09-14 16:02:11',
    aiFilled: true,
    verification: VERIFY_GD,
  },

  /* ---------- 海通证券：2 次回函 → 以第 2 次为准（第 1 次回函不相符，故重新发函） ---------- */
  {
    id: 'whzf0010005-1',
    sendSeq: 1,
    sendRecordNo: '20260809000020',
    confirmationNo: 'whzf0010005',
    entity: '海通证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-09 09:30:11',
    replyDate: '2026-09-10 16:05:44',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF7444706556901',
    replyFile: 'whzf0010005_reply_v1.pdf',
    faceSheet: 'SF7444706556901.jpg',
    replyProgress: '已完成',
    hasReplied: true,
    risk: 'high',
    verifyStatus: 'verified',
    verifiedBy: '李复核',
    verifiedAt: '2026-09-10 17:12:08',
    aiFilled: true,
    verification: VERIFY_GD,
  },
  {
    id: 'whzf0010005-2',
    sendSeq: 2,
    sendRecordNo: '20260810000005',
    confirmationNo: 'whzf0010005',
    entity: '海通证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-14 15:20:02',
    replyDate: '2026-09-14 15:31:20',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF7444706556947',
    replyFile: '1-SJ01YF001_p2.pdf',
    faceSheet: 'SF7444706556947.jpg',
    replyProgress: '待填写回函结果',
    hasReplied: true,
    risk: 'medium',
    verifyStatus: 'pending',
    aiFilled: true,
    verification: VERIFY_HT,
  },

  /* ---------- 齐商银行：1 次回函，回函未盖章 → 高风险，待人工确认 ---------- */
  {
    id: 'QS2024-031-1',
    sendSeq: 1,
    sendRecordNo: '20260810000004',
    confirmationNo: 'QS2024-031',
    entity: '齐商银行股份有限公司',
    type: '银行函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-14 14:58:40',
    replyDate: '2026-09-14 15:12:05',
    expressCompany: '中国邮政（系统对接）',
    expressNo: 'EMS1122334455667',
    replyFile: '齐商银行股份有限公司-20240331.pdf',
    replyProgress: '待确认快递信息',
    hasReplied: true,
    risk: 'high',
    verifyStatus: 'pending',
    aiFilled: true,
    periodStart: '2024-01-01',
    periodEnd: '2024-03-31',
    bankItems: BANK_ITEMS_QS,
    verification: VERIFY_QS,
  },

  /* ---------- 华泰证券：1 次回函，全部相符、无任何提示 → 低风险待确认 ---------- */
  {
    id: 'whzf0010003-1',
    sendSeq: 1,
    sendRecordNo: '20260810000003',
    confirmationNo: 'whzf0010003',
    entity: '华泰证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-14 11:02:18',
    replyDate: '2026-09-14 11:20:44',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF528601590893',
    replyFile: 'whzf0010003_reply.pdf',
    faceSheet: 'SF528601590893.jpg',
    replyProgress: '待确认快递信息',
    hasReplied: true,
    risk: 'low',
    verifyStatus: 'pending',
    aiFilled: true,
    verification: VERIFY_ZX,
  },

  /* ---------- 中信证券：1 次回函，全部相符 → 低风险，已完成 ---------- */
  {
    id: 'whzf0010002-1',
    sendSeq: 1,
    sendRecordNo: '20260810000002',
    confirmationNo: 'whzf0010002',
    entity: '中信证券股份有限公司',
    type: '往来函证',
    sendMethod: '电子发函',
    sendDate: '2026-09-13 17:41:52',
    replyDate: '2026-09-14 09:15:33',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF528601590877',
    replyFile: '0813回函123_p1.pdf',
    faceSheet: 'SF528601590877.jpg',
    replyProgress: '已完成',
    hasReplied: true,
    risk: 'low',
    verifyStatus: 'verified',
    verifiedBy: '李复核',
    verifiedAt: '2026-09-14 09:52:40',
    aiFilled: true,
    verification: VERIFY_ZX,
  },

  /* ---------- 广发证券：2 次回函 → 以第 2 次为准 ---------- */
  {
    id: 'whzf0010001-1',
    sendSeq: 1,
    sendRecordNo: '20260808000030',
    confirmationNo: 'whzf0010001',
    entity: '广发证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-08 10:12:40',
    replyDate: '2026-09-09 14:22:31',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF528601590833',
    replyFile: 'whzf0010001_reply_v1.pdf',
    faceSheet: 'SF528601590833.jpg',
    replyProgress: '已完成',
    hasReplied: true,
    risk: 'high',
    verifyStatus: 'verified',
    verifiedBy: '张审计',
    verifiedAt: '2026-09-09 15:40:02',
    aiFilled: true,
    verification: VERIFY_GD,
  },
  {
    id: 'whzf0010001-2',
    sendSeq: 2,
    sendRecordNo: '20260810000001',
    confirmationNo: 'whzf0010001',
    entity: '广发证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-13 16:20:09',
    replyDate: '2026-09-14 08:40:12',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF528601590861',
    replyFile: 'whzf0010001_reply.pdf',
    faceSheet: 'SF528601590861.jpg',
    replyProgress: '待填写回函结果',
    hasReplied: true,
    risk: 'medium',
    verifyStatus: 'pending',
    aiFilled: true,
    verification: VERIFY_HT,
  },

  /* ---------- 招商证券：1 次回函，全部相符 → 低风险，待人工确认 ---------- */
  {
    id: 'whzf0010007-1',
    sendSeq: 1,
    sendRecordNo: '20260809000014',
    confirmationNo: 'whzf0010007',
    entity: '招商证券股份有限公司',
    type: '往来函证',
    sendMethod: '邮寄发函',
    sendDate: '2026-09-13 15:02:31',
    replyDate: '2026-09-14 10:05:18',
    expressCompany: '顺丰（系统对接）',
    expressNo: 'SF7444706556912',
    replyFile: 'whzf0010007_reply.pdf',
    faceSheet: 'SF7444706556912.jpg',
    replyProgress: '待确认快递信息',
    hasReplied: true,
    risk: 'low',
    verifyStatus: 'pending',
    aiFilled: true,
    verification: VERIFY_ZX,
  },

  /* ---------- 国泰君安：1 次回函，全部相符 → 低风险，已完成 ---------- */
  {
    id: 'whzf0010004-1',
    sendSeq: 1,
    sendRecordNo: '20260809000012',
    confirmationNo: 'whzf0010004',
    entity: '国泰君安证券股份有限公司',
    type: '往来函证',
    sendMethod: '电子发函',
    sendDate: '2026-09-12 10:31:20',
    replyDate: '2026-09-13 14:08:55',
    expressCompany: '京东物流（系统对接）',
    expressNo: 'JD0033445566778',
    replyFile: 'whzf0010004_reply.pdf',
    faceSheet: 'JD0033445566778.jpg',
    replyProgress: '已完成',
    hasReplied: true,
    risk: 'low',
    verifyStatus: 'verified',
    verifiedBy: '李复核',
    verifiedAt: '2026-09-13 15:20:31',
    /*
     * 演示「已归档 + 已修改」这条链路：
     * 两个入口打开即回显下列人工确认值（而非 AI 原始猜测），修改后保持「已完成」并留下最近修改留痕。
     * 收件人三项是 AI 完全识别不了的字段，只能由人工补录 —— 这里给出一组已补录的值。
     */
    expressInfo: {
      replyFile: 'whzf0010004_reply.pdf',
      faceSheet: 'JD0033445566778.jpg',
      expressCompany: '京东物流（系统对接）',
      expressNo: 'JD0033445566778',
      senderName: '陈静',
      senderPhone: '13800000005',
      senderAddress: '广东省广州市黄埔区腾飞一街2号618室',
      receiverName: '王海涛',
      receiverPhone: '021-58881234',
      receiverAddress: '上海市浦东新区世纪大道100号环球金融中心58层',
      sendTime: '2026-09-12 10:31:20',
      signTime: '2026-09-13 14:08:55',
    },
    resultInfo: {
      matched: true,
      sealConsistent: true,
      officialSeal: true,
      crossSeal: 'yes',
    },
    lastEditedBy: '张审计',
    lastEditedAt: '2026-09-13 15:35:12',
    aiFilled: true,
    verification: VERIFY_ZX,
  },
]

/** 候选函证（识别失败时「手动指定归属」的数据源，按函证编号归属） */
export const CANDIDATE_RECORDS: (BankCandidateSource & { type: ConfirmationType })[] = CANDIDATE_SOURCES.map(
  (s) => ({
    ...s,
    type: s.confirmationNo.startsWith('QS') ? ('银行函证' as const) : ('往来函证' as const),
  }),
)

/**
 * AI 预填字段的默认采纳门槛。
 *
 * **默认采纳规则**：置信度达标的 AI 字段直接预采纳，低置信度与未识别的字段留给人工 ——
 * 打开弹窗时业务人员只需处理少数几项，而不必逐项点「采纳」。
 *
 * 置信度差异说明：银行回函版式各异，面单类非结构化字段（地址、时间）识别难度高于往来函证，
 * 因此这些字段在银行函证上给出更低置信度，用于呈现「低置信度需人工重点核对」。
 */
const ADOPT_THRESHOLD = 0.9

/** 回函快递信息录入 —— AI 预填字段 */
export function buildPrefillFields(record: ReplyRecord) {
  const isBank = record.type === '银行函证'
  const raw = [
    {
      key: 'replyFile',
      label: '回函文件',
      value: record.replyFile ?? '未识别',
      source: `回函 PDF 第 ${isBank ? '1-4' : '6'} 页切分`,
      confidence: 0.98,
      required: true,
      ai: true,
    },
    {
      key: 'faceSheet',
      label: '快递面单',
      value: record.faceSheet ?? '未识别',
      source: '拼接文件最后一页',
      confidence: 0.95,
      required: true,
      ai: true,
    },
    {
      key: 'expressCompany',
      label: '快递公司',
      value: record.expressCompany ?? '待填写',
      source: '面单承运商 LOGO 识别',
      confidence: 0.99,
      required: true,
      ai: true,
    },
    {
      key: 'expressNo',
      label: '快递运单号',
      value: record.expressNo ?? '待填写',
      source: '面单条码识别',
      confidence: 0.99,
      required: true,
      ai: true,
    },
    { key: 'senderName', label: '发件人姓名', value: '陈静', source: '面单寄件人栏', confidence: 0.92, required: true, ai: true },
    { key: 'senderPhone', label: '发件人联系电话', value: '13800000005', source: '面单寄件人栏', confidence: 0.9, required: true, ai: true },
    { key: 'senderAddress', label: '发件地址', value: '广东省广州市黄埔区腾飞一街2号618室', source: '面单寄件人栏', confidence: isBank ? 0.86 : 0.93, required: true, ai: true },
    { key: 'receiverName', label: '收件人姓名', value: '—', source: '未识别', confidence: 0, required: true, ai: false },
    { key: 'receiverPhone', label: '收件人联系电话', value: '—', source: '未识别', confidence: 0, required: true, ai: false },
    { key: 'receiverAddress', label: '收件人地址', value: '—', source: '未识别', confidence: 0, required: true, ai: false },
    { key: 'sendTime', label: '寄件时间（下单时间）', value: '2026-09-12 10:22:31', source: '面单时间栏', confidence: isBank ? 0.88 : 0.92, required: true, ai: true },
    { key: 'signTime', label: '签收时间（回函时间）', value: '2026-09-14 09:41:02', source: '面单签收栏', confidence: 0.91, required: true, ai: true },
  ]
  /**
   * 回显优先于默认采纳：
   *   · 人工保存过的字段 → 用保存值覆盖 AI 识别值，标为「人工确认值」且不再待确认
   *   · 其余字段 → 置信度达标即默认采纳（低置信度与未识别项留给人工点一下）
   * 重开弹窗必须看到「上次我确认的那个值」，而不是 AI 的原始猜测 ——
   * 否则「修改」会变成每次都从零重填，越改越乱。
   */
  return raw.map((f) => {
    const savedValue = (record.expressInfo as Record<string, string | undefined> | undefined)?.[f.key]
    if (savedValue !== undefined && savedValue !== '') {
      return {
        ...f,
        value: savedValue,
        source: '人工确认值',
        confidence: 1,
        adopted: true,
        confirmed: true,
      }
    }
    return { ...f, adopted: f.ai && f.confidence >= ADOPT_THRESHOLD }
  })
}

/** 回函结果填写 —— 科目余额分录 */
export function buildSubjectEntriesForRecord(record: ReplyRecord): SubjectEntry[] {
  if (record.verification) {
    const diffRows = record.verification.consistency.rows.filter((r) => r.match !== 'match')
    if (diffRows.length) return buildSubjectEntries(diffRows)
  }
  return buildSubjectEntries([
    { id: 'm1', item: '事项5', period: '2021年度', subject: '应收账款', sentAmount: 300000, repliedAmount: 300000, match: 'match', confidence: 0.98 },
    { id: 'm2', item: '事项9', period: '2021年度', subject: '预收账款', sentAmount: 600000, repliedAmount: 600000, match: 'match', confidence: 0.98 },
    { id: 'm3', item: '事项17', period: '2021年度', subject: '其他应付款', sentAmount: 603005, repliedAmount: 603005, match: 'match', confidence: 0.98 },
  ])
}

/**
 * 回函结果填写 —— 询证事项逐项核对（银行函证专用）**分组形态**（v2.40）。
 *
 * 数据取自真实回函《银行询证函（格式一）》（8 页 / 14 项 + 1 个资金归集附表），
 * 每组**列结构与该组的标准子表一致**（银行存款 11 列、托管的证券 5 列……），
 * 但界面上只展示「标识列 + 金额列 + 五列对照」——
 * 币种 / 利率 / 起止日期这类描述性字段不进对照，否则银行存款会是 11 + 5 = 16 列。
 *
 * 三个演示态就落在数据里：第 11 组（外汇买卖合约）为 `run` 识别中、
 * 第 12 组（托管的证券）为 `fail` 识别失败、第 14 组（其他）为 `empty` 本份未列示；
 * 另有两处刻意造的差异（银行存款第 3 个账户、已贴现商业汇票第 4 张），便于看差异行样式。
 */
const BANK_ITEM_GROUPS_QS: BankItemGroup[] = [
  {
    id: 'g1',
    itemNo: '1',
    item: '银行存款',
    keyLabels: ['账户名称', '银行账号', '币种'],
    amountLabel: '账户余额',
    stat: 'done',
    rows: [
      { id: 'g1-1', keys: ['西安西点信息技术有限公司', '58491750', '人民币'], sentAmount: 5367, aiAmount: 5367, replyAmount: 5367, diff: 0, match: true },
      /* 第 2 行刻意让**回函值 ≠ AI 识别值**（表示 AI 读数被人工改过）：既能演示「AI 识别值」
         这一列的意义，也让「应用 AI 识别值」的变更预览有内容可看 */
      { id: 'g1-2', keys: ['西安西点信息技术有限公司', '58491749', '人民币'], sentAmount: 25368, aiAmount: 25368, replyAmount: 25000, diff: -368, match: false },
      { id: 'g1-3', keys: ['西安西点信息技术有限公司', '58491751', '人民币'], sentAmount: 5371, aiAmount: 5900, replyAmount: 5900, diff: 529, match: false },
    ],
  },
  {
    id: 'g2',
    itemNo: '2',
    item: '银行借款',
    keyLabels: ['借款人名称', '借款账号', '币种'],
    amountLabel: '余额',
    stat: 'done',
    rows: [
      { id: 'g2-1', keys: ['西小点', '58491749', '人民币'], sentAmount: 10, aiAmount: 10, replyAmount: 10, diff: 0, match: true },
    ],
  },
  {
    id: 'g3',
    itemNo: '3',
    item: '自 2025-01-01 起至 2025-12-31 期间内注销的银行存款账户',
    keyLabels: ['账户名称', '银行账号', '币种'],
    amountLabel: '注销账户日',
    stat: 'done',
    rows: [
      { id: 'g3-1', keys: ['西安西点信息技术有限公司', '58491749', '人民币'], sentAmount: null, aiAmount: null, replyAmount: null, diff: null, match: true },
    ],
  },
  {
    id: 'g4',
    itemNo: '4',
    item: '本公司作为委托人的委托贷款',
    keyLabels: ['账户名称', '银行结算账号', '资金借入方', '币种'],
    amountLabel: '余额',
    stat: 'done',
    rows: [
      { id: 'g4-1', keys: ['西点信息', '58491749', '东点信息', '人民币'], sentAmount: 600, aiAmount: 600, replyAmount: 600, diff: 0, match: true },
    ],
  },
  {
    id: 'g5',
    itemNo: '5',
    item: '本公司作为借款人的委托贷款',
    keyLabels: ['账户名称', '银行结算账号', '资金借出方', '币种'],
    amountLabel: '余额',
    stat: 'done',
    rows: [
      { id: 'g5-1', keys: ['西点信息', '58491749', '东点信息', '人民币'], sentAmount: 600, aiAmount: 600, replyAmount: 600, diff: 0, match: true },
    ],
  },
  {
    id: 'g6',
    itemNo: '6',
    item: '担保',
    keyLabels: ['被担保人', '担保方式', '币种'],
    amountLabel: '担保余额',
    stat: 'done',
    rows: [
      { id: 'g6-1', keys: ['西安西小小技术有限公司', '保证', '人民币'], sentAmount: 10000, aiAmount: 10000, replyAmount: 10000, diff: 0, match: true },
    ],
  },
  {
    id: 'g7',
    itemNo: '7',
    item: '本公司为出票人且由贵行承兑而尚未支付的银行承兑汇票',
    keyLabels: ['银行承兑汇票号码', '结算账户账号', '币种'],
    amountLabel: '票面金额',
    stat: 'done',
    rows: [
      { id: 'g7-1', keys: ['58491749', '58491749', '人民币'], sentAmount: 800, aiAmount: 800, replyAmount: 800, diff: 0, match: true },
    ],
  },
  {
    id: 'g8',
    itemNo: '8',
    item: '本公司向贵行已贴现而尚未到期的商业汇票',
    keyLabels: ['商业汇票号码', '承兑人名称', '币种'],
    amountLabel: '票面金额',
    stat: 'done',
    rows: [
      { id: 'g8-1', keys: ['123459', '小孙', '人民币'], sentAmount: 4000, aiAmount: 4000, replyAmount: 4000, diff: 0, match: true },
      { id: 'g8-2', keys: ['123456', '小李', '人民币'], sentAmount: 1000, aiAmount: 1000, replyAmount: 1000, diff: 0, match: true },
      { id: 'g8-3', keys: ['123458', '小赵', '人民币'], sentAmount: 3000, aiAmount: 3000, replyAmount: 3000, diff: 0, match: true },
      { id: 'g8-4', keys: ['123457', '小王', '人民币'], sentAmount: 2000, aiAmount: 2400, replyAmount: 2400, diff: 400, match: false },
    ],
  },
  {
    id: 'g9',
    itemNo: '9',
    item: '本公司为持票人且由贵行托收（或由本公司提示付款）的商业汇票',
    keyLabels: ['商业汇票号码', '承兑人名称', '币种'],
    amountLabel: '票面金额',
    stat: 'done',
    rows: [
      { id: 'g9-1', keys: ['123457', '小王', '人民币'], sentAmount: 2000, aiAmount: 2000, replyAmount: 2000, diff: 0, match: true },
      { id: 'g9-2', keys: ['123456', '小李', '人民币'], sentAmount: 1000, aiAmount: 1000, replyAmount: 1000, diff: 0, match: true },
    ],
  },
  {
    id: 'g10',
    itemNo: '10',
    item: '本公司为申请人，由贵行开具的、未履行完毕的不可撤销信用证',
    keyLabels: ['信用证号码', '受益人', '币种'],
    amountLabel: '信用证金额',
    stat: 'done',
    rows: [
      { id: 'g10-1', keys: ['123458', '小赵', '人民币'], sentAmount: 3000, aiAmount: 3000, replyAmount: 3000, diff: 0, match: true },
      { id: 'g10-2', keys: ['123456', '小李', '人民币'], sentAmount: 1000, aiAmount: 1000, replyAmount: 1000, diff: 0, match: true },
      { id: 'g10-3', keys: ['123457', '小王', '人民币'], sentAmount: 2000, aiAmount: 2000, replyAmount: 2000, diff: 0, match: true },
      { id: 'g10-4', keys: ['123459', '小孙', '人民币'], sentAmount: 4000, aiAmount: 4000, replyAmount: 4000, diff: 0, match: true },
    ],
  },
  {
    /* 演示「识别中」—— MinerU 是整表识别，故整组一起等，不做「逐项进度」 */
    id: 'g11',
    itemNo: '11',
    item: '本公司与贵行之间未履行完毕的外汇买卖合约',
    keyLabels: ['类别', '合约号码', '卖出 / 买入币种'],
    amountLabel: '未履行的合约买卖金额',
    stat: 'run',
    rows: [
      { id: 'g11-1', keys: ['类别2', '123459', '人民币 / 人民币'], sentAmount: 4000, aiAmount: null, replyAmount: null, diff: null, match: null },
      { id: 'g11-2', keys: ['类别2', '123457', '人民币 / 人民币'], sentAmount: 2000, aiAmount: null, replyAmount: null, diff: null, match: null },
      { id: 'g11-3', keys: ['类别1', '123456', '人民币 / 人民币'], sentAmount: 1000, aiAmount: null, replyAmount: null, diff: null, match: null },
      { id: 'g11-4', keys: ['类别2', '123458', '人民币 / 人民币'], sentAmount: 3000, aiAmount: null, replyAmount: null, diff: null, match: null },
    ],
  },
  {
    /* 演示「识别失败」—— 回函值列可直接手填，失败补录就在表内完成，不需要另开录入界面 */
    id: 'g12',
    itemNo: '12',
    item: '本公司存放于贵行托管的证券或其他产权文件',
    keyLabels: ['文件名称', '编号', '币种'],
    amountLabel: '金额',
    stat: 'fail',
    rows: [
      { id: 'g12-1', keys: ['文件1', '123456', '人民币'], sentAmount: 1000, aiAmount: null, replyAmount: null, diff: null, match: null },
      { id: 'g12-2', keys: ['文件2', '123457', '人民币'], sentAmount: 2000, aiAmount: null, replyAmount: null, diff: null, match: null },
    ],
  },
  {
    id: 'g13',
    itemNo: '13',
    item: '本公司购买的由贵行发行的未到期银行理财产品',
    keyLabels: ['产品名称', '产品类型', '币种'],
    amountLabel: '产品净值',
    stat: 'done',
    rows: [
      { id: 'g13-1', keys: ['文件2', '123457（封闭式）', '人民币'], sentAmount: 2000, aiAmount: 2000, replyAmount: 2000, diff: 0, match: true },
      { id: 'g13-2', keys: ['文件1', '123456（开放式）', '人民币'], sentAmount: 1000, aiAmount: 1000, replyAmount: 1000, diff: 0, match: true },
    ],
  },
  {
    /* 本份回函未列示 —— 收成一行灰字，不给空表 */
    id: 'g14',
    itemNo: '14',
    item: '其他',
    keyLabels: ['内容'],
    amountLabel: '金额',
    stat: 'empty',
    rows: [],
  },
  {
    id: 'gAtt',
    itemNo: '附',
    item: '资金归集（资金池或其他资金管理）账户具体信息',
    keyLabels: ['资金提供机构名称', '资金提供机构账号', '资金使用机构名称'],
    amountLabel: '拨入 / 拨出余额',
    stat: 'done',
    rows: [
      { id: 'gAtt-1', keys: ['机构1', '123123', '机构1'], sentAmount: 200, aiAmount: 200, replyAmount: 200, diff: 0, match: true },
      { id: 'gAtt-2', keys: ['机构2', '123321', '机构2'], sentAmount: 200, aiAmount: 200, replyAmount: 200, diff: 0, match: true },
    ],
  },
]

/**
 * 回函结果填写 / 核验明细 —— 询证事项逐项核对（银行函证专用）**分组形态**。
 * 银行回函是银行盖章的格式化证明，与我方函证逐项对应，
 * 因此核对对象是**标准询证项**而非往来科目余额。
 */
export function buildBankItemGroups(record: ReplyRecord): BankItemGroup[] {
  if (record.bankItemGroups?.length) return record.bankItemGroups
  return BANK_ITEM_GROUPS_QS
}

/**
 * 询证事项**拍平视图** —— 从分组派生，供只关心「共几项、几项不一致」的消费者使用
 * （`consistencyOf` 的一致性摘要、列表「回函是否相符」列）。
 *
 * **展示一律用分组**（`buildBankItemGroups`）；本函数只为兼容既有的汇总口径而存在，
 * 二者同源，不会出现「摘要说有 1 项差异、表里却看到 2 处」这类打架。
 */
export function buildBankItemsForRecord(record: ReplyRecord): BankItemEntry[] {
  if (record.bankItems?.length) return record.bankItems
  const out: BankItemEntry[] = []
  buildBankItemGroups(record).forEach((g) => {
    /* `empty` 组（本份未列示）与 `run` 组（尚未识别）不参与汇总 ——
       否则识别中就会算出一个看起来正常的「相符」结论（见 evaluateMatch 的短路注释） */
    if (g.stat === 'empty' || g.stat === 'run') return
    g.rows.forEach((r) => {
      out.push({
        id: r.id,
        itemNo: g.itemNo,
        item: g.rows.length > 1 ? `${g.item}（${r.keys.join(' / ')}）` : g.item,
        sentAmount: r.sentAmount,
        repliedAmount: r.replyAmount,
        diff: r.diff ?? 0,
        match: r.match !== false,
        note: g.stat === 'fail' ? '表格识别失败，待人工补录' : undefined,
      })
    })
  })
  return out
}
