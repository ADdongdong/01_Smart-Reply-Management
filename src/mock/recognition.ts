import type {
  BankFieldInput,
  ConfirmationType,
  RecognitionStage,
  RecognitionTask,
  StageKey,
  UploadBatch,
} from '@/types'
import { AUDITED_ENTITY, CANDIDATE_SOURCES } from '@/mock/confirmations'
import { scoreBankMatch } from '@/services/bankMatch'

/**
 * 识别阶段：
 *   ① 归属匹配 —— 内部完成页面切分与二维码/文本定位，只对外给出「这份回函属于哪封函证」（不展示进度条）
 *      · 往来函证：二维码编码函证编号，精确命中
 *      · 银行函证：无二维码，按四要素加权匹配，分三档处置（自动归属 / 建议归属 / 待人工指定）
 *   ② AI 智能核验 —— 逐个检测点独立推进，让用户清楚系统到底查了哪几项
 */
export const STAGE_LABELS: Record<StageKey, string> = {
  match: '归属匹配',
  consistency: '发/回函一致性检测',
  sealExists: '回函文件是否印章检测',
  crossPageSeal: '骑缝章检测',
  sealNameMatch: '印章与被询证单位名称一致检测',
  handwriting: '手写体检测',
  bankText: '银行函证文本识别',
  expressSheet: '快递面单识别',
}

/**
 * 检测点展示名**按函证类型取**：银行函证的一致性来源是「回函 × 系统内格式一/二数据」，
 * 展示为「询证事项逐项核对」，与往来函证的「发函回函一致性检测」区分开。
 */
export function stageLabelOf(type: ConfirmationType, key: StageKey): string {
  if (type === '银行函证' && key === 'consistency') return '询证事项逐项核对'
  return STAGE_LABELS[key]
}

/** 往来函证的 AI 检测点（一次性跑完，无阶段之分） */
const STAGES_TRADE: StageKey[] = [
  'match',
  'consistency',
  'sealExists',
  'crossPageSeal',
  'sealNameMatch',
  'handwriting',
  'expressSheet',
]

/**
 * 银行函证的**阶段一**：只做页面切分 + 四要素识别（`match` + `bankText`）。
 * 目的是让用户**先把回函与系统内函证对应起来**，不必等六项检测跑完。
 */
const STAGES_BANK_P1: StageKey[] = ['match', 'bankText']

/** 银行函证的**阶段二**：归属确认后自动开跑（手写体换成银行函证文本识别，故无 handwriting） */
const STAGES_BANK_P2: StageKey[] = [
  'consistency',
  'sealExists',
  'crossPageSeal',
  'sealNameMatch',
  'expressSheet',
]

/**
 * 取某类型在某阶段的检测点 —— **阶段划分的单一事实来源**。
 * · 银行函证（两阶段）：阶段一 = 四要素与归属；阶段二 = 其余检测项；
 * · 往来函证（单阶段）：阶段一即全部检测点，阶段二为空数组。
 */
export function stagesOf(type: ConfirmationType, phase: 1 | 2): StageKey[] {
  if (type === '银行函证') return phase === 1 ? STAGES_BANK_P1 : STAGES_BANK_P2
  return phase === 1 ? STAGES_TRADE : []
}

/**
 * 生成某类型某阶段的检测点列表。
 * `detailPlan` 为各检测点的结论文案种子 —— 阶段二在归属确认时才并入任务，
 * 届时从任务的 `detailPlan` 里取，因此这里要支持传入。
 */
export function makeStages(
  type: ConfirmationType,
  phase: 1 | 2,
  detailPlan?: Partial<Record<StageKey, string>>,
): RecognitionStage[] {
  return stagesOf(type, phase).map((key) => ({
    key,
    label: stageLabelOf(type, key),
    status: 'waiting' as const,
    percent: 0,
    detail: detailPlan?.[key],
  }))
}

interface TaskSeed {
  /** 归属的函证编号；银行函证在匹配完成前为「待指定」 */
  confirmationNo: string
  /** 被询证单位：往来函证直接给出；银行函证填回函上识别到的银行名称 */
  entity: string
  pageRange: string
  type: ConfirmationType
  /** 银行函证：回函中识别出的四要素，由 bankMatch 计算归属档位 */
  bankFields?: BankFieldInput
  plannedFailure?: StageKey
  failReason?: string
  needManual?: boolean
  stageDetails?: Partial<Record<StageKey, string>>
}

function createTask(seed: TaskSeed, fileName: string, index: number): RecognitionTask {
  const bankMatch = seed.bankFields ? scoreBankMatch(seed.bankFields, CANDIDATE_SOURCES) : undefined
  const best = bankMatch?.candidates?.[0]

  /**
   * 往来函证凭二维码精确命中，天然确定归属；
   * 银行函证只有在四要素**全部匹配**（auto 档）时才自动归属，
   * 建议归属（confirm）与待人工指定（manual）都必须人工确认后才落库 —— 见 AppStore 的 finalizeTask。
   */
  const autoAssigned = seed.type === '往来函证' ? true : bankMatch?.level === 'auto'
  /**
   * 归属是否已确定 —— 以**任务最终拿到的函证编号**判断（v2.28 修正）：
   * 银行 auto 档的任务在四要素全匹配时会被改写为命中的函证编号，归属即已确定；
   * 此前用 `seed.confirmationNo !== '待指定'` 判断，导致银行 auto 任务永远拿不到
   * `assignSource`，卡在「未写入列表」、也不会自动进入阶段二。
   */
  const finalConfirmationNo = autoAssigned && best ? best.confirmationNo : seed.confirmationNo
  const resolved = finalConfirmationNo !== '待指定'

  /* 归属行只给**一句话结论**（匹配到哪封 / 需人工指定）—— 不再追加 reason 等细节（v2.29 精简） */
  const matchDetail = bankMatch ? bankMatch.conclusion : seed.stageDetails?.match

  return {
    id: `${fileName}-${index}`,
    confirmationNo: finalConfirmationNo,
    fileName,
    pageRange: seed.pageRange,
    type: seed.type,
    matchedEntity: autoAssigned && best ? best.entity : seed.entity,
    bankMatch,
    assignSource: autoAssigned && resolved ? 'auto' : undefined,
    status: 'pending',
    /* v2.28：任务从阶段一开始；阶段二在归属确认时由 store 追加（见 extendToPhase2） */
    phase: 1,
    detailPlan: seed.stageDetails,
    plannedFailure: seed.plannedFailure,
    failReason: seed.failReason,
    needManual: seed.needManual,
    stages: makeStages(seed.type, 1, seed.stageDetails).map((s) => ({
      ...s,
      detail: s.key === 'match' && matchDetail ? matchDetail : s.detail,
    })),
  }
}

/** 演示批次 A：往来函证拼接回函（含一个二维码识别失败案例） */
export function buildBatchA(): UploadBatch {
  const fileName = '0813回函123.pdf'
  const seeds: TaskSeed[] = [
    {
      confirmationNo: 'whzf0010006',
      entity: '广东证券股份有限公司',
      pageRange: '第 1-2 页',
      type: '往来函证',
      stageDetails: {
        match: '二维码解析成功 → 归属函证 whzf0010006（第 1 次回函）',
        consistency: '20 项科目逐行比对完成 · 2 项差异',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '检出 2 处骑缝章',
        sealNameMatch: '印章名称与被询证单位一致',
        handwriting: '已转录 · 位于「信息不符」区',
        expressSheet: '运单号 SF7444706557147 已识别并关联',
      },
    },
    {
      confirmationNo: 'whzf0010007',
      entity: '招商证券股份有限公司',
      pageRange: '第 3-4 页',
      type: '往来函证',
      stageDetails: {
        match: '二维码解析成功 → 归属函证 whzf0010007（第 1 次回函）',
        consistency: '20 项科目逐行比对完成 · 全部相符',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '检出 3 处骑缝章',
        sealNameMatch: '印章名称与被询证单位一致',
        handwriting: '已转录 · 位于「信息证明无误」区',
        expressSheet: '运单号 SF7444706556912 已识别并关联',
      },
    },
    {
      confirmationNo: 'whzf0010002',
      entity: '中信证券股份有限公司',
      pageRange: '第 5-6 页',
      type: '往来函证',
      stageDetails: {
        match: '二维码解析成功 → 归属函证 whzf0010002（第 1 次回函）',
        consistency: '20 项科目逐行比对完成 · 全部相符',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '检出 3 处骑缝章',
        sealNameMatch: '印章名称与被询证单位一致',
        handwriting: '已转录 · 位于「信息证明无误」区',
        expressSheet: '运单号 SF528601590877 已识别并关联',
      },
    },
    {
      confirmationNo: '待指定',
      entity: '—',
      pageRange: '第 7 页',
      type: '往来函证',
      plannedFailure: 'match',
      failReason: '第 7 页未识别到系统二维码（可能为复印件或二维码被遮挡），无法归属到具体函证',
      needManual: true,
    },
    {
      confirmationNo: 'whzf0010005',
      entity: '海通证券股份有限公司',
      pageRange: '第 8-9 页',
      type: '往来函证',
      stageDetails: {
        match: '二维码解析成功 → 归属函证 whzf0010005（第 2 次回函）',
        consistency: '20 项科目逐行比对完成 · 1 项差异',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '未检出骑缝章（多页回函建议补盖）',
        sealNameMatch: '印章名称与被询证单位一致',
        handwriting: '已转录 · 手写区域与印章区域不一致',
        expressSheet: '运单号 SF7444706556947 已识别并关联',
      },
    },
  ]
  return {
    id: 'batch-a',
    fileName,
    fileSize: '625 KB',
    pageCount: 9,
    type: '往来函证',
    status: 'queued',
    createdAt: '刚刚',
    tasks: seeds.map((s, i) => createTask(s, fileName, i)),
  }
}

/** 演示批次 B：银行函证回函（无二维码，按四要素匹配，覆盖三档处置） */
export function buildBatchB(): UploadBatch {
  const fileName = '银行函证回函-20240913.pdf'
  const seeds: TaskSeed[] = [
    {
      /* ① 四要素全部匹配 → 自动归属 */
      confirmationNo: '待指定',
      entity: '齐商银行股份有限公司',
      pageRange: '第 1-4 页',
      type: '银行函证',
      bankFields: {
        bankName: '齐商银行股份有限公司',
        auditedEntity: AUDITED_ENTITY,
        periodStart: '2024年1月1日',
        periodEnd: '2024/03/31',
      },
      stageDetails: {
        consistency: '回函与系统内格式一/二数据逐项核对完成 · 1 项差异（担保事项）',
        sealExists: '未检出印章 · 建议退回补盖（仅作风险提示）',
        crossPageSeal: '未检出骑缝章',
        sealNameMatch: '未检出印章，无法比对名称',
        bankText: '四要素识别完成 · 与发函底稿一致',
        expressSheet: '运单号 EMS1122334455667 已识别并关联',
      },
    },
    {
      /* ② 回函落款为支行 → 建议归属，需人工确认 */
      confirmationNo: '待指定',
      entity: '齐商银行股份有限公司张店支行',
      pageRange: '第 5-8 页',
      type: '银行函证',
      bankFields: {
        bankName: '齐商银行股份有限公司张店支行',
        auditedEntity: AUDITED_ENTITY,
        periodStart: '2024-01-01',
        periodEnd: '2024年3月31日',
      },
      stageDetails: {
        consistency: '回函与系统内格式一/二数据逐项核对完成 · 全部一致',
        sealExists: '已盖章 · 业务专用章',
        crossPageSeal: '检出 1 处骑缝章',
        sealNameMatch: '印章名称为「齐商银行张店支行」，与发函的被询证单位不一致',
        bankText: '四要素识别完成 · 银行名称与发函底稿有差异',
        expressSheet: '运单号 EMS1122334455781 已识别并关联',
      },
    },
    {
      /* ③ 银行名称不在本期控制表内 → 待人工指定 */
      confirmationNo: '待指定',
      entity: '淄博市农村信用合作联社',
      pageRange: '第 9-11 页',
      type: '银行函证',
      bankFields: {
        bankName: '淄博市农村信用合作联社',
        auditedEntity: AUDITED_ENTITY,
        periodStart: '2024-01-01',
        periodEnd: '2024-03-31',
      },
      stageDetails: {
        consistency: '未匹配到系统内函证数据，待确定归属后核对',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '未检出骑缝章',
        sealNameMatch: '无法比对（未匹配到被询证单位）',
        bankText: '四要素识别完成 · 不在本期函证控制表内',
        expressSheet: '运单号 EMS1122334455902 已识别并关联',
      },
    },
  ]
  return {
    id: 'batch-b',
    fileName,
    fileSize: '3.42 MB',
    pageCount: 11,
    type: '银行函证',
    status: 'queued',
    createdAt: '刚刚',
    tasks: seeds.map((s, i) => createTask(s, fileName, i)),
  }
}

export const PRESET_BATCHES: Record<'A' | 'B', () => UploadBatch> = {
  A: buildBatchA,
  B: buildBatchB,
}
