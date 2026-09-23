import type {
  BankFieldInput,
  BatchFaceSheet,
  ConfirmationType,
  RecognitionStage,
  RecognitionTask,
  StageKey,
  UploadBatch,
} from '@/types'
import { AUDITED_ENTITY, CANDIDATE_SOURCES } from '@/mock/confirmations'
import { scoreBankMatch } from '@/services/bankMatch'
import { parsePageRange } from '@/utils/pageRange'

/**
 * 识别阶段：
 *   ① 归属匹配 —— 内部完成页面切分与二维码/文本定位，只对外给出「这份回函属于哪封函证」（不展示进度条）
 *      · 往来函证：二维码编码函证编号，精确命中
 *      · 银行函证：无二维码，按四要素加权匹配，分三档处置（自动归属 / 建议归属 / 待人工指定）
 *   ② AI 智能核验 —— 逐个检测点独立推进，让用户清楚系统到底查了哪几项
 */
/**
 * 检测点默认展示名。
 *
 * **v2.39 口径变更**：
 * · `bankText` 由「银行函证文本识别」改名「**识别四要素**」—— 它不再是独立的智能检测点，
 *   而是**阶段一的检测点**（识别银行名称 / 被审计单位 / 函证起止日期，作为归属匹配的输入）；
 *   原先它顺带产出的「各询证项金额」已并入 `consistency`（「询证事项逐项核对」，见 v2.40）。
 * · `crossPageSeal` 与 `expressSheet` **仅往来函证**检测（R-03 骑缝章限定往来；银行面单是
 *   独立文件、不拼在回函件里），故名字里注明，避免在银行侧被误用。
 */
export const STAGE_LABELS: Record<StageKey, string> = {
  match: '归属匹配',
  consistency: '发/回函一致性检测',
  sealExists: '回函文件是否印章检测',
  crossPageSeal: '骑缝章检测（仅往来）',
  sealNameMatch: '印章与被询证单位名称一致检测',
  handwriting: '手写体检测',
  bankText: '识别四要素',
  expressSheet: '快递面单识别（仅往来）',
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
 * 银行函证的**阶段一**：页面切分 + 识别四要素（`match` + `bankText`）。
 * 目的是让用户**先把回函与系统内函证对应起来**，不必等所有检测项跑完。
 *
 * 注（v2.39 §2 / v2.42）：真实实现里**批一（四要素与印章区域，走 OCR / 大模型）与
 * 批二（14 项表格，走 MinerU）是并行发起的** —— `bankText` 与 `consistency` 在真机上
 * 同时开始识别，只是**结论的呈现**仍分两段（归属先出、逐项核对后出）。
 * 演示环境里 `consistency` 仍排在归属确认之后开跑，以便让「先对应、后细查」的
 * 交互节奏可见（见 `src/services/mockRecognition.ts` 的调度）。
 */
const STAGES_BANK_P1: StageKey[] = ['match', 'bankText']

/**
 * 银行函证的**阶段二**：归属确认后自动开跑。
 *
 * **v2.39 收敛**（银行检测点 6 → 4 项）：
 * · **去掉 `crossPageSeal`** —— 骑缝章自 v2.39 起**仅往来函证**检测（R-03 限定）；
 * · **去掉 `expressSheet`** —— 银行面单是**独立文件**（随批次上传、只识别条形码），
 *   不拼在回函件里，故银行侧没有「快递面单识别」这个检测点（往来侧保留）；
 * · 加上阶段一的 `bankText`，银行侧检测点恰为 **4 项**：
 *   `识别四要素` / `询证事项逐项核对` / `回函是否有印章` / `印章名称与被询证单位一致`。
 *
 * 印章两项**刻意留在阶段二**：①「名称一致」的判据是「印章名 vs **系统内那封函证的被询证单位**」，
 * 归属未定无从比对；②「是否有印章」技术上与四要素同批、无前提，但归属未定时列表里
 * 还没有这条记录，抛出风险用户无处处理（延续 v2.33「结论不得先于归属」）。
 */
const STAGES_BANK_P2: StageKey[] = ['consistency', 'sealExists', 'sealNameMatch']

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
 * 检测点的**依据明细**（v2.49）—— 展开该检测点时逐条显示「AI 是怎么得出结论的」：
 * 读了哪几页、用了哪个引擎、比对了什么、命中或差异在哪。
 *
 * **演示用模板**：真实实现应由识别服务按接口契约返回（批一 / 批二各带自己的过程记录）。
 * 这里按检测点给通用过程，文案里出现的单位名与演示批次一致，便于对照。
 *
 * 与 `detail` 的分工：`detail` 是**结论**（折叠态显示），`evidence` 是**过程与依据**（展开才显示）。
 * 折叠给结论、展开给过程 —— 既守住「AI 的核查内容必须全暴露」，
 * 也让 MinerU 这类慢环节的等待有东西可看。
 */
const EVIDENCE_BY_KEY: Partial<Record<StageKey, string[]>> = {
  bankText: [
    'OCR 读取回函抬头与落款，定位四要素所在区域（第 1 页页眉 / 页脚）',
    '识别结果：银行名称「齐商银行股份有限公司」· 被审计单位「山东某某科技股份有限公司」· 期间 2024-01-01 ~ 2024-12-31',
    '按加权规则与系统内本期函证控制表逐封比对（银行名称 50% / 被审计单位 20% / 起止日期各 15%），名称精确命中',
  ],
  consistency: [
    'MinerU 整表识别回函第 3–6 页的询证事项表，共 14 组、27 行',
    '与系统内格式一 / 格式二逐项比对「系统数据 → 回函值」',
    '3 处差异：银行存款第 3 个账户（+529）、已贴现商业汇票第 4 张（+400）',
  ],
  sealExists: ['扫描回函全部页面，检测色块与轮廓', '在落款处检出印章 1 枚，类型判为「公章」'],
  sealNameMatch: ['OCR 读出印章内文字', '与系统内那封函证的被询证单位名称逐字比对', '名称一致'],
  crossPageSeal: ['逐页检测页边位置是否有残留印痕', '回函共 3 页，页边未检出骑缝章'],
  handwriting: ['检测「信息不符」栏位是否存在手写笔迹', '转录文本已带入回函结果填写页'],
  expressSheet: ['读取面单页条形码', '解析快递公司「顺丰」与运单号', '按运单号与函证建立对应'],
}

/** 各检测点的典型耗时（演示值）—— 用于展开区的「用时 x.xs」 */
const ELAPSED_BY_KEY: Partial<Record<StageKey, number>> = {
  bankText: 1200,
  consistency: 18600,
  sealExists: 3400,
  sealNameMatch: 1500,
  crossPageSeal: 2100,
  handwriting: 4300,
  expressSheet: 900,
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
    evidence: EVIDENCE_BY_KEY[key],
    elapsedMs: ELAPSED_BY_KEY[key],
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

  /*
   * 页码区间入库（v2.56）：种子按人读习惯写字符串，这里转成**数值**——
   * 「归属匹配展示切分结果」与「预览定位到本段」都要拿页码做计算，字符串不行。
   * 见 `utils/pageRange.ts`。
   */
  const span = parsePageRange(seed.pageRange)

  return {
    id: `${fileName}-${index}`,
    confirmationNo: finalConfirmationNo,
    fileName,
    pageStart: span?.start,
    pageEnd: span?.end,
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
      pageRange: '第 1-3 页',
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
      confirmationNo: 'whzf0010005',
      entity: '海通证券股份有限公司',
      pageRange: '第 4-6 页',
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
    {
      /* 末段保留一个**失败演示**：面单页未识别出运单号，需人工核对面单 */
      confirmationNo: 'whzf0010003',
      entity: '华泰证券股份有限公司',
      pageRange: '第 7-9 页',
      type: '往来函证',
      plannedFailure: 'expressSheet',
      failReason: '末页面单未识别出运单号（扫描模糊），需人工核对面单',
      stageDetails: {
        match: '二维码解析成功 → 归属函证 whzf0010003（第 1 次回函）',
        consistency: '20 项科目逐行比对完成 · 全部相符',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '检出 3 处骑缝章',
        sealNameMatch: '印章名称与被询证单位一致',
        handwriting: '已转录 · 位于「信息证明无误」区',
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
    /* v2.42：面单一叠随批次上传（银行侧的面单不再拼在回函件里） */
    faceSheets: BANK_FACE_SHEETS,
  }
}

/**
 * 银行批次的**快递面单**（v2.42）—— 演示三种校验形态：
 * · 单封：寄件人与被询证单位一致（`ok`）；
 * · **一对多**：一个包裹里 3 封同一个银行回函（**正常业务形态**，只提示封数）；
 * · 配错：寄件人是另一家银行（`warn`，最可疑的那种）。
 * `matchedConfirmationNos` 留空 —— 由 `services/faceSheet.ts` 的 `pairFaceSheets`
 * 按任务的归属结果填入（不按单号猜：归属是已确认过的事实，比推断可靠）。
 */
const BANK_FACE_SHEETS: BatchFaceSheet[] = [
  {
    id: 'fs1',
    fileName: 'SF7444706556947.jpg',
    expressNo: 'SF7444706556947',
    sender: '中国工商银行股份有限公司西安分行',
    matchedConfirmationNos: [],
  },
  {
    id: 'fs2',
    fileName: 'SF7444706556901.jpg',
    expressNo: 'SF7444706556901',
    sender: '招商银行股份有限公司西安分行',
    matchedConfirmationNos: [],
  },
  {
    id: 'fs3',
    fileName: 'SF7444706557147.jpg',
    expressNo: 'SF7444706557147',
    sender: '中国银行股份有限公司西安高新支行',
    matchedConfirmationNos: [],
  },
]

export const PRESET_BATCHES: Record<'A' | 'B', () => UploadBatch> = {
  A: buildBatchA,
  B: buildBatchB,
}

/**
 * 演示数据的按钮文案 —— **上传弹窗与识别工作台共用一份**（v2.47）。
 * 此前只写在工作台里；「用演示数据体验」入口搬到上传弹窗后，两处都要用，
 * 故提到这里，避免各写一份而措辞漂移。
 */
export const DEMO_LABEL: Record<'A' | 'B', string> = {
  A: '往来函证拼接回函（9 页 / 5 封）',
  B: '银行函证回函（11 页 / 3 封 · 三档归属）',
}
