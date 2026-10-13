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
 * · `crossPageSeal` **仅往来函证**检测（R-03 骑缝章限定往来），故名字里注明，避免在银行侧被误用。
 * · `expressSheet` **两侧都有**（v3.21 起）—— 往来是"段尾面单页"，银行是"独立的面单页"
 *   （一个文件里可能有多张、每张管它前面那几段）；名字里的「（仅往来）」已随之去掉，
 *   否则银行侧那一行会写着"仅往来"却真的在银行批次里跑着。
 */
export const STAGE_LABELS: Record<StageKey, string> = {
  match: '归属匹配',
  consistency: '发/回函一致性检测',
  sealExists: '回函文件是否印章检测',
  crossPageSeal: '骑缝章检测（仅往来）',
  sealNameMatch: '印章与被询证单位名称一致检测',
  handwriting: '手写体检测',
  bankText: '识别四要素',
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
 * 银行函证的**阶段一**：页面切分 + 识别四要素 + **快递面单识别**。
 * 目的是让用户**先把回函与系统内函证对应起来**，不必等所有检测项跑完。
 *
 * 注（v2.39 §2 / v2.42）：真实实现里**批一（四要素与印章区域，走 OCR / 大模型）与
 * 批二（14 项表格，走 MinerU）是并行发起的** —— `bankText` 与 `consistency` 在真机上
 * 同时开始识别，只是**结论的呈现**仍分两段（归属先出、逐项核对后出）。
 * 演示环境里 `consistency` 仍排在归属确认之后开跑，以便让「先对应、后细查」的
 * 交互节奏可见（见 `src/services/mockRecognition.ts` 的调度）。
 *
 * ## v3.21：把「快递面单识别」接回银行阶段一
 *
 * v2.39 曾把它从银行侧移除，**当时的理由是"银行面单是独立扫描件、不拼在回函件里"** ——
 * 这条前提在 **v2.83 已经不成立**（银行弹窗同样声明"文件含面单页"，面单页就在回函件里，
 * 一个文件还可能有多张）。于是它回归阶段一，理由三条：
 * ① **它是纯"读"的活**（定位面单页 + 解码一维条码），不涉语义、不依赖归属，**最快**；
 * ② 它的产出（哪几页是面单 + 单号）**与用户切分函证段互不依赖** —— 两者可并行，
 *    所以它属"批一"、与四要素同批，用户不必等它就能开始切；
 * ③ 归属界面据此在**结果到达时**预切出面单段（见 `RecognitionTask.faceSheetPage`）。
 */
const STAGES_BANK_P1: StageKey[] = ['match', 'bankText', 'expressSheet']

/**
 * 银行函证的**阶段二**：归属确认后自动开跑。
 *
 * 银行侧检测点 **5 项**（v2.39 收敛为 4 项 → v3.21 因面单识别回归阶段一而 +1）：
 * `识别四要素` / `快递面单识别`（在阶段一）/ `询证事项逐项核对` / `回函是否有印章` /
 * `印章名称与被询证单位一致`。
 * · **`crossPageSeal` 银行侧不跑** —— 骑缝章自 v2.39 起**仅往来函证**检测（R-03 限定）；
 * · `expressSheet` 自 v3.21 起**银行侧也跑**（它回到阶段一）—— 银行面单虽然不是拼在回函件里，
 *   但**哪几页是面单**要靠识别给出（见 `faceSheetPage`），故这个检测点必须有。
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
  expressSheet: [
    /* 界面文案**不要写 markdown 标记** —— 原先这句里的星号会原样显示出来（v3.22 修） */
    '扫描全部页面，定位「快递面单页」（版式 + 条码区域）',
    '读取面单条形码，解析快递公司与运单号',
    '一个包裹一张面单：该面单管辖它前面的那些函证段（多封共用同一个单号）',
  ],
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
  /**
   * 段尾面单条码识别出的快递单号（v2.78）—— **段级**数据（面单页就是本段最后一页）。
   * 不给（或给空）表示该段面单没读出来，切分结果会标「未识别到」并允许人工补。
   */
  expressNo?: string
  /** 银行函证：回函中识别出的四要素，由 bankMatch 计算归属档位 */
  bankFields?: BankFieldInput
  /** 这一段**就是快递面单页**（v3.21，银行侧）—— 归属界面据此在结果到达时预切成面单段 */
  faceSheetPage?: boolean
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
    /* 段尾面单的单号（v2.78）—— 种子没给 = 该段没读出来，切成「未识别到」让人补 */
    expressNo: seed.expressNo,
    /* 这一页被识别为快递面单页（v3.21）—— 归属界面据此异步预切面单段 */
    faceSheetPage: seed.faceSheetPage,
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

/**
 * 按「切分结果」新建一段的任务（v2.62）。
 *
 * ## 什么时候用它
 *
 * 用户在「回函归属」界面手动切分后点「确定」，store 的 `COMMIT_SPLIT` 会用切分结果
 * **重建该文件的任务**。重建时优先**复用**页区间完全一致的旧任务（保住识别进度与核验数据）；
 * 只有对不上（用户切出了新的区间）才走这里新建。
 *
 * 与 `createTask`（种子 → 任务）的差别：种子那套要算四要素归属、解析 `pageRange` 字符串，
 * 而这里**切分与归属都已经是确定的事实**（人切好、人选好的），直接落字段即可 ——
 * 这也是「归属不再依赖 AI」的落点：新段的归属来自 `seg.confirmationNo`，不经过任何匹配。
 */
export function makeSegmentTask(opts: {
  type: ConfirmationType
  fileName: string
  /** 本段在文件内的序号（仅用于生成 id） */
  index: number
  pageStart: number
  pageEnd: number
  /** 归属到的函证编号；`待指定` = 尚未归属（该段不会写入回函列表） */
  confirmationNo: string
  entity?: string
  /** 段尾面单的单号（人工在切分结果里补/改的值也走这里，见 `COMMIT_SPLIT`） */
  expressNo?: string
  /**
   * 这一段**就是快递面单页**（v3.22 新增入参）。
   *
   * **为什么现在要新建时也带上它** —— 原先（v2.83）面单段**不提交**（`COMMIT_SPLIT` 里被过滤掉），
   * 因为那时它的职责只是"把单号交给被管辖的函证段"，而单号已经落在那些段的 `expressNo` 上。
   * v3.21 之后模型变了：**哪几页是面单**是**识别结果**，只有这个标记记着它 ——
   * 不提交就等于把识别结果扔掉：识别界面看不到「快递面单」那一组、重开归属界面还会
   * 退化成"未识别到快递面单"（`detectedFacePages` 从这个标记来）。故现在**照提交**，
   * 但仍**不写回函列表**（`confirmationNo` 恒为「待指定」，落库只认有归属的段）。
   */
  faceSheetPage?: boolean
}): RecognitionTask {
  const {
    type,
    fileName,
    index,
    pageStart,
    pageEnd,
    confirmationNo,
    entity,
    expressNo,
    faceSheetPage,
  } = opts
  const resolved = confirmationNo !== '待指定'
  return {
    id: `${fileName}-seg${pageStart}-${pageEnd}-${index}`,
    confirmationNo,
    fileName,
    pageStart,
    pageEnd,
    type,
    matchedEntity: entity,
    expressNo,
    /* 这一段就是面单页（见入参说明）—— 识别界面据此单独成组、归属界面据此预切 */
    faceSheetPage,
    /* 归属由人指定 —— 与「确认归属」一样记 manual-assign，不冒充系统自动归属 */
    assignSource: resolved ? 'manual-assign' : undefined,
    status: 'pending',
    phase: 1,
    stages: makeStages(type, 1),
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
      expressNo: 'SF7444706557147',
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
      expressNo: 'SF7444706556947',
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
      /*
       * 中段保留一个**失败演示**（v3.29 换了失败点）——
       *
       * 原来失败的是「快递面单识别」，但 v3.29 起面单识别归**切分阶段**、不再是智能识别的
       * 检测项，一个"面单没认出来"就不该把这封函证判成识别失败（那是切分那一步的事，
       * 由归属界面的状态行交代）。
       *
       * 故失败点落在**整表比对**上 —— 这也正是真实环境里最容易失败的一项：它走 MinerU
       * 整表识别，是整条链路里最慢、最容易超时的一环（见 `RECOVERY_ACTIONS.consistency`）。
       */
      confirmationNo: 'whzf0010003',
      entity: '华泰证券股份有限公司',
      pageRange: '第 7-9 页',
      type: '往来函证',
      expressNo: 'SF7444706556801',
      plannedFailure: 'consistency',
      failReason: '回函纸张折痕导致整表识别超时，未能完成逐行比对 —— 可重新识别或转人工核对',
      stageDetails: {
        match: '二维码解析成功 → 归属函证 whzf0010003（第 1 次回函）',
        sealExists: '已盖章 · 公章',
        crossPageSeal: '检出 3 处骑缝章',
        sealNameMatch: '印章名称与被询证单位一致',
        handwriting: '已转录 · 位于「信息证明无误」区',
        expressSheet: '运单号 SF7444706556801 已识别并关联',
        /* 刻意**不给** `consistency` 的结论文案 —— 这一项在本段是失败演示 */
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

/**
 * 演示批次 B：银行函证回函 —— **四家银行各一个快递包裹，每包装 4 封回函 + 该包裹末页那张面单**（v3.25）。
 *
 * 形态（用户 v3.25 指定）：「一共 4 个包裹，前三个包裹都是 4 封函证，每封函证 3 页，
 * 包裹的最后一页是快递面单」—— 于是这份文件 = **52 页 / 16 封函证 / 4 张面单**：
 *
 * | 包裹 | 被询证单位（各 4 封：2021 / 2022 / 2023 / 2024 年一季度） | 函证页 | 面单页 | 面单样例（真扫描件） | 运单号 | 结局 |
 * |---|---|---|---|---|---|---|
 * | 1 | 齐商银行股份有限公司 | 第 1-12 页 | 第 13 页 | `face-sheet-0010014.pdf`（顺丰） | SF5128690159893 | 读出 |
 * | 2 | 中信银行股份有限公司 | 第 14-25 页 | 第 26 页 | `face-sheet-0010005.pdf`（顺丰） | SF0258034404761 | 读出 |
 * | 3 | 上海浦东发展银行股份有限公司 | 第 27-38 页 | 第 39 页 | `face-sheet-1.pdf`（极兔） | JT3156541182381 | 读出 |
 * | 4 | 招商银行股份有限公司 | 第 40-51 页 | 第 52 页 | `face-sheet-2.pdf`（极兔） | —— | **未读出（人工照图填）** |
 *
 * 一个包裹 = 一家银行的一个快递袋：袋里是它回应过的那几封函证，袋口贴着那张面单 ——
 * 这正是「**一张面单管前面那几封**」的真实形态，也是演示时最好讲的一种。
 *
 * **「4 张里 3 张读出、1 张读不出」是用户点名要的对照**：一律读得出就看不出「人工照面单填」
 * 那条路，一律读不出又看不出常态。故**最后一个包裹**那张条码读不出；但它的图仍是一张
 * **清晰**的面单 —— 用户 v3.25 明确要求「不要那个模糊的快递面单」：演示时要人能照着图把号
 * 读出来、填进去，用一张看不清的件反而没法演示"人工填"这一步（原先那张 `face-sheet-none.pdf`
 * 已从本批次换掉，往来侧那张「无面单」标记件仍归往来用）。
 *
 * 归属处置覆盖**两类**：三家银行各 4 封四要素全匹配 → **自动归属**（下拉里预填好编号，人可改）；
 * **齐商 2023 那封**落款是支行（四要素里的银行名称与发函底稿不一致）与
 * **招商 2024 年 1-6 月那封**（期间不在本期控制表内，表里只有 24 年一季度）
 * → 都**留待人工选**（界面上是「待指定」：系统不替用户预判银行归属，这条口径见 5.2）。
 */
export function buildBatchB(): UploadBatch {
  const fileName = '银行函证回函-20240913.pdf'

  /**
   * 四个包裹 —— **一个包裹一家银行**：4 封函证（各 3 页）+ 1 页面单。
   *
   * `expressNo` 取自样例图上**印着的号**（面单图是真扫描件，数据写另一个号就是"图和话对不上"）：
   * v3.25 把四张样例**逐张放大读条码**核对了一遍 ——
   * 顺丰 `face-sheet-0010014` → SF5128690159893、顺丰 `face-sheet-0010005` → SF0258034404761、
   * 极兔 `face-sheet-1` → JT3156541182381、极兔 `face-sheet-2` → JT3156563392581。
   *
   * **最后一个包裹（招商）故意不给 `expressNo`** —— 条码没读出来，界面标
   * 「未识别到 —— 请照预览图上的运单号填写」并给「改」，用户照着那张清晰的面单把号补上。
   */
  const PACKAGES: {
    entity: string
    sheetFile: string
    expressNo?: string
    /** 包内第 N 封（1-based）的落款是**支行**（四要素里的银行名称与发函底稿不一致）→ 归属留待人工选 */
    branchAt?: number
    /** 包内第 N 封（1-based）的期间**不在本期控制表内** → 待人工指定 */
    outOfTable?: number
  }[] = [
    {
      entity: '齐商银行股份有限公司',
      sheetFile: 'face-sheet-0010014.pdf',
      expressNo: 'SF5128690159893',
      branchAt: 3,
    },
    {
      entity: '中信银行股份有限公司',
      sheetFile: 'face-sheet-0010005.pdf',
      expressNo: 'SF0258034404761',
    },
    {
      entity: '上海浦东发展银行股份有限公司',
      sheetFile: 'face-sheet-1.pdf',
      expressNo: 'JT3156541182381',
    },
    {
      entity: '招商银行股份有限公司',
      sheetFile: 'face-sheet-2.pdf',
      /* expressNo 刻意缺省 —— 这一包的条码没读出来（人工照面单填） */
      outOfTable: 4,
    },
  ]

  /** 每封页数 / 每包封数 / 每包总页数（含末页那张面单） */
  const PAGE_PER_LETTER = 3
  const LETTERS_PER_PACKAGE = 4
  const PER_PACKAGE = LETTERS_PER_PACKAGE * PAGE_PER_LETTER + 1

  /** 包内第 j 封（0-based）的页区间（1-based、含两端） */
  const pagesOf = (pkg: number, j: number) => {
    const start = pkg * PER_PACKAGE + j * PAGE_PER_LETTER + 1
    return { start, end: start + PAGE_PER_LETTER - 1 }
  }
  /** 包内那张面单的页码 —— 它就是**包裹的最后一页** */
  const sheetPageOf = (pkg: number) => (pkg + 1) * PER_PACKAGE

  /**
   * 四个年度的回函期间 —— **写法刻意不统一**（企业/银行回函上的日期本就五花八门，
   * 归一化是四要素匹配要处理的事，见 `services/bankMatch`）。
   */
  const YEARS = [
    { start: '2021年1月1日', end: '2021/12/31' },
    { start: '2022-01-01', end: '2022年12月31日' },
    { start: '2023年1月1日', end: '2023/12/31' },
    { start: '2024年1月1日', end: '2024/03/31' },
  ]
  /** 最后一封改成「24 年 1-6 月」—— 表里只有一季度，用于演示「期间对不上 → 待人工指定」 */
  const OUT_OF_TABLE = { start: '2024年1月1日', end: '2024年6月30日' }
  const seeds: TaskSeed[] = []

  PACKAGES.forEach((pkg, pi) => {
    /* 一张面单管本包那几封 —— 这正是要演示的「一个快递单号对应多个函证编号」 */
    const shareNote = pkg.expressNo
      ? `本封与同包裹另外 ${LETTERS_PER_PACKAGE - 1} 封共用一个快递单号（${pkg.expressNo} · 见该包裹的面单页）`
      : '本封所在包裹的面单条码未读出，需人工照面单填写'

    for (let j = 0; j < LETTERS_PER_PACKAGE; j++) {
      const isBranch = pkg.branchAt === j + 1
      const outOfTable = pkg.outOfTable === j + 1
      /* 落款是支行时，四要素里的银行名称就是支行名（与发函底稿不一致 → 建议归属） */
      const entity = isBranch ? `${pkg.entity}张店支行` : pkg.entity
      const period = outOfTable ? OUT_OF_TABLE : YEARS[j]
      const { start, end } = pagesOf(pi, j)

      seeds.push({
        confirmationNo: '待指定',
        entity,
        pageRange: `第 ${start}-${end} 页`,
        type: '银行函证',
        bankFields: {
          bankName: entity,
          auditedEntity: AUDITED_ENTITY,
          periodStart: period.start,
          periodEnd: period.end,
        },
        stageDetails: outOfTable
          ? {
              /* 期间不在本期控制表内 —— 连询证事项也无从核对 */
              consistency: '未匹配到系统内函证数据，待确定归属后核对',
              sealExists: '未检出印章 · 建议退回补盖（仅作风险提示）',
              crossPageSeal: '未检出骑缝章',
              sealNameMatch: '无法比对（未匹配到被询证单位）',
              bankText: '四要素识别完成 · 回函期间（24 年 1-6 月）不在本期函证控制表内',
              expressSheet: shareNote,
            }
          : {
              consistency: '回函与系统内格式一/二数据逐项核对完成 · 全部一致',
              sealExists: '已盖章 · 业务专用章',
              crossPageSeal: '检出 1 处骑缝章',
              /* 支行落款那封：印章名与发函底稿的被询证单位不一致（→ 建议归属，需人工确认） */
              sealNameMatch: isBranch
                ? `印章名称为「${entity}」，与发函的被询证单位不一致`
                : `印章名称为「${pkg.entity}」，与发函的被询证单位一致`,
              bankText: isBranch
                ? '四要素识别完成 · 银行名称与发函底稿有差异'
                : '四要素识别完成 · 与发函底稿一致',
              expressSheet: shareNote,
            },
      })
    }

    /*
     * **包裹末页 = 那张面单**（v3.21 起由识别判定哪几页是面单，归属界面据此预切成独立段）。
     * **刻意不给 `bankFields`**：面单不是函证，不该参与四要素匹配、更不能被自动归属
     * （`createTask` 里 `bankFields ? scoreBankMatch(...) : undefined` —— 不给就永远匹配不上）。
     */
    seeds.push({
      confirmationNo: '待指定',
      entity: pkg.entity,
      pageRange: `第 ${sheetPageOf(pi)} 页`,
      type: '银行函证',
      faceSheetPage: true,
      expressNo: pkg.expressNo,
      stageDetails: {
        expressSheet: pkg.expressNo
          ? `面单条形码读出 ${pkg.expressNo} · 本包裹 ${LETTERS_PER_PACKAGE} 封共用这一张面单`
          : '面单条码未读出（反光 / 沾污）—— 需人工照面单填写',
      },
    })
  })
  return {
    id: 'batch-b',
    fileName,
    fileSize: '5.86 MB',
    /* 4 包 × (每包 4 封 × 3 页 + 1 页面单) = 52 页 */
    pageCount: PACKAGES.length * PER_PACKAGE,
    type: '银行函证',
    status: 'queued',
    createdAt: '刚刚',
    tasks: seeds.map((s, i) => createTask(s, fileName, i)),
    /*
     * **本文件含快递面单页**（v2.83 立；v3.21 起语义由"末页是面单"改成"文件里有面单页"）——
     * 银行侧**哪几页**是面单由「快递面单识别」给出，归属界面据此预切成独立段（见 5.2）。
     */
    faceSheetLast: true,
    /*
     * v2.42 的"面单是随批次上传的独立扫描件"模型保留（这条支路真实存在），
     * 本演示批次走的是**面单拼在回函件里**那条 —— 这里把 4 个包裹的面单各列一条，
     * 让两条模型在数据上对得起来（界面不消费它，见 5.4 的实现状态）。
     */
    faceSheets: BANK_FACE_SHEETS,
  }
}

/**
 * 银行批次的**快递面单**（v2.42 立、v2.83 起改为"一个包裹一张"、v3.25 改为 4 家银行各一张）。
 *
 * 演示批次 B 是 4 个包裹，故这里 4 条；**最后一个包裹（招商）那张条码读不出**（`expressNo` 缺省）——
 * 与回函件里那 4 个面单页（各包的**最后一页**：13 / 26 / 39 / 52）一一对应，
 * 见 `buildBatchB` 的 `PACKAGES` 与 `config/preview.ts` 的映射表。
 *
 * `matchedConfirmationNos` 留空，由 `services/faceSheet.ts` 的 `pairFaceSheets` 按任务归属回填
 * （不按单号猜：归属是已确认过的事实，比推断可靠）—— 每个包裹都是"一张面单管 4 封"，
 * 回填出来就是**四项**，这正是「一张面单对多封函证」在数据上的样子。
 */
const BANK_FACE_SHEETS: BatchFaceSheet[] = [
  {
    id: 'fs1',
    fileName: 'face-sheet-0010014.pdf',
    expressNo: 'SF5128690159893',
    sender: '齐商银行股份有限公司',
    matchedConfirmationNos: [],
  },
  {
    id: 'fs2',
    fileName: 'face-sheet-0010005.pdf',
    expressNo: 'SF0258034404761',
    sender: '中信银行股份有限公司',
    matchedConfirmationNos: [],
  },
  {
    id: 'fs3',
    fileName: 'face-sheet-1.pdf',
    expressNo: 'JT3156541182381',
    sender: '上海浦东发展银行股份有限公司',
    matchedConfirmationNos: [],
  },
  {
    /* 第 4 个包裹：条码读不出，`expressNo` 缺省 —— 人工照面单填（图仍是清晰件） */
    id: 'fs4',
    fileName: 'face-sheet-2.pdf',
    sender: '招商银行股份有限公司',
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
  /* v3.06：A 批此前写「9 页 / 5 封」，而 `buildBatchA` 实际是 **9 页 / 3 段**
     （whzf0010006 第 1-3 页 / whzf0010005 第 4-6 页 / whzf0010003 第 7-9 页，每段尾部各一页面单）。
     该文案此前无人消费（入口只在银行弹窗），往来的入口接上后它就成了**按钮上的可见文案**，故按批次实际形态改正。 */
  A: '往来函证拼接回函（9 页 / 3 段）',
  /* v3.25：按 `buildBatchB` 的实际形态 —— `pageCount: 52`、**16 个函证段 + 4 个面单段**：
     四家银行各一个包裹，每包 = 4 封 × 3 页 + **末页一张面单**（第 13 / 26 / 39 / 52 页），
     每张面单管辖本包那 4 封 —— 即同一份文件里**四个快递包裹**，最后一个包裹那张**条码未读出**。
     文案里点明"含 1 张条码未读出"：这是用户点名要看的那个形态，写在按钮上最省一次点击试错。 */
  B: '银行函证回函（52 页 / 16 封 + 4 张面单 · 四个包裹，含 1 张条码未读出）',
}
