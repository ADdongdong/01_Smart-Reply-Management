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

/** 往来函证的 AI 检测点 */
const STAGES_TRADE: StageKey[] = [
  'match',
  'consistency',
  'sealExists',
  'crossPageSeal',
  'sealNameMatch',
  'handwriting',
  'expressSheet',
]

/** 银行函证的 AI 检测点（手写体换成银行函证文本识别） */
const STAGES_BANK: StageKey[] = [
  'match',
  'consistency',
  'sealExists',
  'crossPageSeal',
  'sealNameMatch',
  'bankText',
  'expressSheet',
]

function makeStages(type: ConfirmationType): RecognitionStage[] {
  const order = type === '银行函证' ? STAGES_BANK : STAGES_TRADE
  return order.map((key) => ({
    key,
    label: STAGE_LABELS[key],
    status: 'waiting' as const,
    percent: 0,
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
  /** 归属是否已确定 —— 「待指定」表示尚未确定，此时不得写入回函列表 */
  const resolved = seed.confirmationNo !== '待指定'

  const matchDetail = bankMatch
    ? `${bankMatch.conclusion}${bankMatch.reason ? `（${bankMatch.reason}）` : ''}`
    : seed.stageDetails?.match

  return {
    id: `${fileName}-${index}`,
    confirmationNo: autoAssigned && best ? best.confirmationNo : seed.confirmationNo,
    fileName,
    pageRange: seed.pageRange,
    type: seed.type,
    matchedEntity: autoAssigned && best ? best.entity : seed.entity,
    bankMatch,
    assignSource: autoAssigned && resolved ? 'auto' : undefined,
    status: 'pending',
    plannedFailure: seed.plannedFailure,
    failReason: seed.failReason,
    needManual: seed.needManual,
    stages: makeStages(seed.type).map((s) => ({
      ...s,
      detail: s.key === 'match' && matchDetail ? matchDetail : seed.stageDetails?.[s.key],
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
        consistency: '银行存款 1,258.03 万元与账面一致',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '检出 2 处骑缝章',
        sealNameMatch: '印章名称与被询证单位一致',
        bankText: '按标准《银行询证函》6 项询证事项逐项核对完成',
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
        consistency: '银行存款 842.15 万元与账面一致',
        sealExists: '已盖章 · 业务专用章',
        crossPageSeal: '检出 1 处骑缝章',
        sealNameMatch: '印章名称为「齐商银行张店支行」，与发函的被询证单位不一致',
        bankText: '按标准《银行询证函》6 项询证事项逐项核对完成',
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
        consistency: '银行存款 76.40 万元，未匹配到对应发函底稿',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '未检出骑缝章',
        sealNameMatch: '无法比对（未匹配到被询证单位）',
        bankText: '被询证银行不在本期函证控制表内，请确认该回函是否属于本期范围',
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
