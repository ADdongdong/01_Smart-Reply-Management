/** 函证类型 */
export type ConfirmationType = '往来函证' | '银行函证'

/** 发函方式 */
export type SendMethod = '邮寄发函' | '电子发函' | '跟函'

/**
 * 回函进度 —— 用户视角的「下一步要做什么」。
 * 注意：本列表只含**已回函**的发函记录（未回函的函证在「未回函管理」模块），
 * 因此不存在「未回函 / 待识别」状态。
 */
export type ReplyProgress = '待确认快递信息' | '待填写回函结果' | '已完成'

/** 风险等级 */
export type RiskLevel = 'high' | 'medium' | 'low' | 'none'

/** 人工核验状态 */
export type VerifyStatus = 'pending' | 'verified'

/**
 * 归属匹配档位（银行函证专用）
 *   auto    —— 四要素全部命中，自动归属，无需人工干预
 *   confirm —— 银行名称命中但存在差异，给出建议归属，需人工确认
 *   manual  —— 银行名称未命中或总分低于阈值，进入待人工指定
 */
export type MatchLevel = 'auto' | 'confirm' | 'manual'

/**
 * 归属来源留痕
 *   auto           自动归属（四要素全匹配）
 *   manual-confirm 人工确认了系统建议的归属
 *   manual-assign  人工从候选中指定的归属
 */
export type AssignSource = 'auto' | 'manual-confirm' | 'manual-assign'

/* ------------------------------------------------------------------ */
/* AI 智能核验                                                         */
/* ------------------------------------------------------------------ */

/** 一致性比对单行 */
export interface ConsistencyRow {
  id: string
  item: string
  period: string
  subject: string
  sentAmount: number | null
  repliedAmount: number | null
  match: 'match' | 'diff' | 'missing' | 'extra'
  confidence: number
}

/** 印章定位框（百分比坐标） */
export interface SealBox {
  page: number
  x: number
  y: number
  w: number
  h: number
  label: string
  abnormal: boolean
}

/** 印章识别结果 */
export interface SealResult {
  hasSeal: boolean
  sealCount: number
  crossPageSeal: boolean
  crossPageSealCount: number
  sealType: '公章' | '财务章' | '无'
  sealName: string
  nameMatched: boolean
  /**
   * 落章区域 —— **仅往来函证**据此判定「回函结果是否相符」；
   * 银行函证的相符性由询证事项逐项核对决定（见 services/replyRule.ts），
   * 印章落章区域对银行函证只作风险提示。
   */
  region: '信息证明无误区' | '信息不符区' | '未识别'
  regionConclusion: string
  boxes: SealBox[]
  confidence: number
}

/**
 * 银行函证四要素匹配明细。
 * 在原有「回函识别值 / 发函底稿值 / 是否一致」之上，补充归一化结果、命中方式与权重，
 * 供归属匹配看板呈现「为什么命中 / 为什么没命中」。
 */
export interface BankTextField {
  key: string
  label: string
  value: string
  matched: boolean
  confidence: number
  sentValue: string
  /** 回函识别值归一化后 */
  repliedNorm?: string
  /** 发函底稿值归一化后 */
  sentNorm?: string
  /** 归一化后命中但原文有差异（如分支机构、简称、日期写法不同） */
  fuzzy?: boolean
  /** 该要素在加权打分中的权重 */
  weight?: number
  /** 命中 / 未命中原因说明 */
  reason?: string
}

/** 候选函证（按匹配度降序） */
export interface BankCandidate {
  confirmationNo: string
  /** 被询证单位（即银行名称） */
  entity: string
  periodStart: string
  periodEnd: string
  /** 加权得分 0~1 */
  score: number
  /** 命中的要素键 */
  hitKeys: string[]
  /** 银行名称是否命中 */
  bankNameHit: boolean
}

/** 参与匹配的候选函证原始信息 */
export interface BankCandidateSource {
  confirmationNo: string
  /** 被询证单位（即银行名称） */
  entity: string
  /** 被审计单位名称 */
  auditedEntity: string
  periodStart: string
  periodEnd: string
}

/** 银行函证四要素识别输入 */
export interface BankFieldInput {
  /** 回函落款 / 章上的银行名称 */
  bankName: string
  /** 被审计单位名称 */
  auditedEntity: string
  periodStart: string
  periodEnd: string
}

/**
 * 银行函证文本识别 + 归属匹配结果。
 * 既有字段保持兼容：仅补充可选字段，AiVerification.bankText 与只读展示不受影响。
 */
export interface BankTextResult {
  fields: BankTextField[]
  conclusion: string
  confidence: number
  /** 匹配档位 */
  level?: MatchLevel
  /** 加权得分 0~1 */
  score?: number
  /** 候选函证（按匹配度降序） */
  candidates?: BankCandidate[]
  /** 未自动归属时的原因 */
  reason?: string
  /** 归属来源留痕 */
  assignSource?: AssignSource
}

/** 手写体识别 —— **往来函证专用**：银行函证不检测手写体（核验明细、批注层与结果填写页同步关闭） */
export interface HandwritingResult {
  text: string
  region: '信息证明无误区' | '信息不符区'
  conclusion: string
  confidence: number
}

/** AI 核验总览 */
export interface AiVerification {
  consistency: {
    rows: ConsistencyRow[]
    diffCount: number
    confidence: number
  }
  seal: SealResult
  bankText?: BankTextResult
  handwriting?: HandwritingResult
  riskLevel: RiskLevel
  riskReasons: string[]
  completedModules: number
  totalModules: number
}

/* ------------------------------------------------------------------ */
/* 回函记录                                                            */
/* ------------------------------------------------------------------ */

export interface ReplyRecord {
  id: string
  /** 发函记录编号 —— 每次发函唯一 */
  sendRecordNo: string
  /** 该函证的第几次发函（从 1 开始）。系统持有该信息，但列表不以此为主线索展示 */
  sendSeq: number
  confirmationNo: string
  /** 被询证单位（银行） */
  entity: string
  type: ConfirmationType
  sendMethod: SendMethod
  sendDate: string
  replyDate?: string
  expressCompany?: string
  expressNo?: string
  replyFile?: string
  /**
   * 快递面单。
   *
   * 快递面单**不是单独上传的文件** —— 它拼接在回函文件里（往来函证是「多封回函 + 面单」
   * 拼成一个 PDF），单号与所属函证都由识别阶段读出。该字段存识别出的面单文件名；
   * 「回函快递信息」弹窗左侧只看面单，面单内容按函证编号取（见 `config/preview.ts`
   * 的 `faceSheetUrlOf`），**不存页码** —— 界面只渲染面单本身那一页。
   */
  faceSheet?: string
  replyProgress: ReplyProgress
  hasReplied: boolean
  risk: RiskLevel
  verifyStatus: VerifyStatus
  verifiedBy?: string
  verifiedAt?: string
  /**
   * 回函快递信息的人工确认值（12 项）。
   * AI 识别值只作预填，人工在弹窗内采纳/修改并保存后才写入这里；
   * 重新打开弹窗时以本对象回显 —— 没有它，「修改」就只是看起来改了。
   */
  expressInfo?: ExpressInfo
  /** 回函结果填写的人工判断项（相符性 / 盖章一致性 / 公章 / 骑缝章） */
  resultInfo?: ReplyResultInfo
  /** 最近一次修改留痕 —— 供已归档数据被修改后追溯（不改变回函进度） */
  lastEditedBy?: string
  lastEditedAt?: string
  /** 该行是否存在 AI 识别/预填数据 */
  aiFilled: boolean
  verification?: AiVerification
  /** 函证起止日期（银行函证四要素之一、二） */
  periodStart?: string
  periodEnd?: string
  /** 询证事项逐项核对（银行函证专用，替代往来函证的科目余额分录）—— 拍平视图，见 `BankItemEntry` 的注释 */
  bankItems?: BankItemEntry[]
  /**
   * 询证事项的**分组形态**（v2.40）—— 展示用；缺省时由 `buildBankItemGroups` 回退到内置演示数据。
   * `bankItems` 与它**同源**：前者是后者拍平的结果（见 `buildBankItemsForRecord`）。
   */
  bankItemGroups?: BankItemGroup[]
  /**
   * 「AI 识别中」标记（银行函证两阶段专用）。
   * 阶段一落库时置 true（此时只识别出四要素、归属已确认，其余检测项尚未开跑），
   * 阶段二跑完回填核验数据后置 false。
   * **判据必须走 `isRecognitionPending()`（services/replyRule.ts）**，不要在组件里直读本字段。
   */
  recognitionPending?: boolean
}

/* ------------------------------------------------------------------ */
/* 异步识别任务                                                        */
/* ------------------------------------------------------------------ */

/**
 * 识别阶段：
 *   match —— 归属匹配（内部含页面切分、二维码/文本定位），只给结果
 *   其余为 AI 智能核验的具体检测点，每项独立进度
 */
export type StageKey =
  | 'match'
  | 'consistency'
  | 'sealExists'
  | 'crossPageSeal'
  | 'sealNameMatch'
  | 'handwriting'
  | 'bankText'
  | 'expressSheet'
export type StageStatus = 'waiting' | 'running' | 'done' | 'failed'

export interface RecognitionStage {
  key: StageKey
  label: string
  status: StageStatus
  percent: number
  /** 一行结论（折叠态显示） */
  detail?: string
  /**
   * **依据明细**（v2.49）—— 展开该检测点时逐条显示「AI 是怎么得出结论的」：
   * 读了哪几页、用了哪个引擎、比对了什么、命中/差异在哪。
   *
   * 与 `detail` 的分工：`detail` 是**结论**（"识别完成，与发函底稿一致"），
   * `evidence` 是**过程与依据**（"OCR 读取回函抬头 → 银行名称 = 齐商银行…"）。
   * 折叠态只给结论、展开才给过程 —— 既是「AI 的核查内容必须全暴露」的落点，
   * 也让「MinerU 慢」这种等待有东西可看。
   */
  evidence?: string[]
  /** 该检测点耗时（毫秒），用于在展开区显示「用时 3.2s」——慢环节的安抚信息 */
  elapsedMs?: number
}

export interface RecognitionTask {
  id: string
  /** 归属到的函证编号；尚未确定时为「待指定」 */
  confirmationNo: string
  /** 本段所出自的**上传文件**名 —— 一个文件按归属切成多段，各段共用它 */
  fileName: string
  /**
   * 本段在原始上传文件里对应的**页码区间**（v2.56）。
   *
   * 此前只有一个展示用字符串 `pageRange`（如「第 1-4 页」），**无法参与计算** ——
   * 而「归属匹配要展示切分结果 + 原文件预览并定位到本段」这两件事都需要**数值**：
   * 预览要按页区间滚动/高亮，切分表要能排序与校验连续性（如 1-4 / 5-8 / 9-11 无重叠无断档）。
   * 展示字符串改由这两个数派生，见 `@/utils/pageRange` 的 `pageRangeOf`。
   */
  pageStart?: number
  pageEnd?: number
  type: ConfirmationType
  stages: RecognitionStage[]
  /** 被询证单位名称（匹配结果或人工指定时回填） */
  matchedEntity?: string
  /** 银行函证的四要素匹配结果（含档位、得分、候选） */
  bankMatch?: BankTextResult
  /**
   * 归属来源。为空表示归属尚未确定 —— 此时任务即便跑到 success 也不写入回函列表，
   * 必须由人工「确认归属」或「指定归属」后才落库（见 AppStore 的 finalizeTask）。
   */
  assignSource?: AssignSource
  /**
   * 当前识别阶段（v2.28 两阶段）：
   *   1 = 只做页面切分 + 四要素识别 + 归属匹配（「先对应」）；
   *   2 = 归属确认后自动开跑其余检测项（「后细查」）。
   * 往来函证恒为 1（一次性跑完，阶段一即全部检测项）。
   */
  phase: 1 | 2
  /**
   * 各检测点的结论文案种子（演示数据用）。
   * 阶段二在归属确认时才并入任务，届时从这里取阶段二各检测点的文案。
   */
  detailPlan?: Partial<Record<StageKey, string>>
  /** 是否已写入回函管理列表，避免重复写入 */
  applied?: boolean
  /** 落库后对应回函记录的 id —— 阶段二完成时按此 id 回填核验数据 */
  recordId?: string
  /** 阶段二核验数据是否已回填（防重复回填） */
  verificationApplied?: boolean
  status: 'pending' | 'success' | 'failed'
  failReason?: string
  needManual?: boolean
  /** 原型演示用：预设在该阶段注入失败 */
  plannedFailure?: StageKey
}

/**
 * 批次内的一张**快递面单**（v2.42）。
 *
 * 识别只读**条形码**（→ `expressNo`）与**寄件人**（→ `sender`），
 * 再由 `services/faceSheet.ts` 与函证做交叉校验。
 *
 * **`matchedConfirmationNos` 是数组** —— 一个包裹里可能装着同一被询证单位的
 * 多封回函（银行一次寄回多个函证项很常见），此时多封**共用一张面单**。
 * 所以这里不能用「面单 ↔ 函证 一对一」的模型。
 */
export interface BatchFaceSheet {
  id: string
  /** 面单扫描件文件名，如 `SF7444706556947.jpg` */
  fileName: string
  /** 条形码读出的快递单号 */
  expressNo: string
  /** 条形码上方印的寄件人名称 —— 交叉校验的对象（应与被询证单位一致） */
  sender: string
  /** 交叉校验后配对到的函证编号（**可多封**） */
  matchedConfirmationNos: string[]
  /** 校验结论；`ok` 为通过 */
  check?: FaceSheetCheck
}

/**
 * 面单的**交叉校验**结论（v2.42）。
 *
 * 本轮只实现**第一条**（用户决策：先做模型与最少的交叉校验，其余四条后续补）：
 * **寄件人 ↔ 被询证单位**。故 `rule` 目前只有这一个取值，但结构预留 ——
 * 后续四条（单号唯一性 / 一面对多封的合理上限 / 寄件日期与回函日期先后 /
 * 收件人是否为项目组）沿用同一形状追加即可。
 */
export interface FaceSheetCheck {
  rule: 'senderMatchesEntity'
  level: 'ok' | 'warn'
  /** 直接可读的结论句 —— 界面不再二次加工 */
  message: string
}

/** 上传批次 */
export interface UploadBatch {
  id: string
  fileName: string
  fileSize: string
  pageCount: number
  type: ConfirmationType | '自动判定中'
  tasks: RecognitionTask[]
  /**
   * 本批次携带的**快递面单**（v2.42）。
   *
   * 真实形态：面单是**独立的一叠扫描件**（一次寄 20 封就是 20 张面单，打进一个 PDF），
   * 与回函件**一起上传**；识别只在面单上读**条形码**（拿快递单号），
   * 再按「同批次内的单号 / 寄件人」把面单与函证配对。
   *
   * 两处与旧模型的关键差别：
   * · **一张面单可以对应多封函证** —— 一个快递包裹里塞了 3 封回函（同一被询证单位
   *   一次寄回多个函证项，常见于银行），此时 3 封共用一个单号，故
   *   `matchedConfirmationNos` 是数组（见 `BatchFaceSheet`）；
   * · **面单不再拼在回函件里** —— 旧模型（`ReplyRecord.faceSheet` 那条「面单是回函 PDF
   *   的最后一页」）只保留给**往来函证**（它的拼接件确实带面单页）；银行函证改走本字段。
   */
  faceSheets?: BatchFaceSheet[]
  status: 'queued' | 'running' | 'done' | 'failed'
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* 回函快递信息（AI 预填）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 回函快递信息 —— 该弹窗承载的 12 项字段（其中 11 项为快递 / 物流信息）。
 * 键与 buildPrefillFields 产出的字段 key 一一对应；人工保存后整块写入 ReplyRecord.expressInfo。
 */
export interface ExpressInfo {
  replyFile?: string
  faceSheet?: string
  expressCompany?: string
  expressNo?: string
  senderName?: string
  senderPhone?: string
  senderAddress?: string
  receiverName?: string
  receiverPhone?: string
  receiverAddress?: string
  sendTime?: string
  signTime?: string
}

/** 骑缝章选择 —— 单页回函不存在该概念，故保留第三态「不适用」 */
export type CrossSealChoice = 'yes' | 'no' | 'na'

/**
 * 回函结果填写 —— 由人工做出的必填判断 + 原因说明。
 * 字段名用业务语义（matched / sealConsistent），不暴露表单控件的原始取值。
 */
export interface ReplyResultInfo {
  /** 函证结果是否相符 */
  matched?: boolean
  /** 不相符时的差异说明 */
  diffDesc?: string
  /** 盖章是否与被询证方名称一致 */
  sealConsistent?: boolean
  /** 不一致时的原因 */
  sealReason?: string
  /** 是否为公章 */
  officialSeal?: boolean
  /** 是否有骑缝章 */
  crossSeal?: CrossSealChoice
}

export interface PrefillField {
  key: string
  label: string
  value: string
  source: string
  confidence: number
  adopted: boolean
  required?: boolean
  /** 是否由 AI 识别填充 */
  ai: boolean
  /** 是否是人工确认/修改过的值 —— 重开弹窗时回显保存值，且不再标为「待确认」 */
  confirmed?: boolean
}

/** 科目余额分录（往来函证） */
export interface SubjectEntry {
  id: string
  period: string
  subject: string
  sentAmount: number | null
  repliedAmount: number | null
  diff: number
  match: boolean
}

/**
 * 询证事项逐项核对（银行函证，按标准《银行询证函》固定询证项）。
 * 数据来自**系统内已存的格式一 / 格式二**，与回函识别结果逐项比对 ——
 * 它是银行函证「回函是否相符」判定的**唯一依据**（见 services/replyRule.ts）。
 *
 * **注意（v2.40 起）**：本结构是**拍平后的视图**，供「一致性摘要 / 列表相符性」这类
 * 只关心「共几项、几项不一致」的消费者使用。**真正的展示形态是分组（见下 `BankItemGroup`）** ——
 * 真实回函里每一项各是一张列结构互不相同的子表、且一项可能多行，
 * 「一项一行一个金额」装不下（如银行存款 3 个账户）。
 * 分组由 `buildBankItemGroups` 提供，拍平由 `buildBankItemsForRecord` 从分组派生。
 */
export interface BankItemEntry {
  id: string
  /** 询证事项序号，如 "1" */
  itemNo: string
  /** 询证事项名称，如 "银行存款" */
  item: string
  sentAmount: number | null
  repliedAmount: number | null
  diff: number
  match: boolean
  note?: string
}

/**
 * 询证事项的**一个分组** = 标准《银行询证函》的一个大项（v2.40）。
 *
 * 为什么不是扁平的「一行一项」：真实回函里
 * · **每一项各是一张列结构互不相同的子表** —— 银行存款 11 列（账户名称 / 银行账号 / 币种 /
 *   利率 / 账户类型 / 账户余额 / 是否属于资金归集账户 / 起始日期 / 终止日期 /
 *   是否存在冻结担保或使用限制 / 备注），而「存放于贵行托管的证券或其他产权文件」只有 5 列
 *   （文件名称 / 编号 / 数量 / 币种 / 金额），**没有一列共通**；
 * · **一项可能多行** —— 银行存款 3 个账户、已贴现商业汇票 4 张、信用证 4 笔。
 *
 * 故展示形态为「**可折叠分组 + 组内标准子表 + 对照列**」：组内保留该组的**标识列**（天然主键）
 * 与**金额列**，再对金额列给 `系统数据 → AI 识别值 → 回函值 → 差异 → 结论` 五列对照；
 * 币种 / 利率 / 起止日期这类描述性字段不进对照（否则银行存款会是 11 + 5 = 16 列）。
 */
export interface BankItemGroup {
  id: string
  /** 序号，如 "1"；附表为 "附" */
  itemNo: string
  /** 项名，如「银行存款」「自 2025-01-01 起至 2025-12-31 期间内注销的银行存款账户」 */
  item: string
  /** 该组的**标识列名**（行配对的依据），如 ['账户名称', '银行账号', '币种'] */
  keyLabels: string[]
  /** 该组**参与比对的金额列名**，如「账户余额」 */
  amountLabel: string
  /**
   * 该组的识别状态：
   * · `done` 已识别 —— 有 AI 值，可编辑回函值、可一键应用；
   * · `run` 识别中 —— 显示「正在识别…」，回函值输入框禁用；
   * · `fail` 识别失败 —— 组标题给「重新识别」（**组级动作**：MinerU 整表识别只能重跑整张表），
   *   回函值列**可直接手填**（失败补录就在表内完成，不需要另开录入界面）；
   * · `empty` 本份回函未列示 —— 收成一行灰字，不给空表。
   */
  stat: 'done' | 'run' | 'fail' | 'empty'
  rows: BankItemRow[]
}

/** 分组内的一行 —— 对应标准子表里的一条记录（一个账户 / 一张票据 / 一笔合约） */
export interface BankItemRow {
  id: string
  /** 标识列的值，顺序与所属分组的 `keyLabels` 一致 */
  keys: string[]
  /** 系统内数据（发函）—— 来自格式一 / 格式二 */
  sentAmount: number | null
  /** **AI 识别回函值** —— 独立成列是为了让人**看出自己改了什么**；识别中 / 失败时为 null */
  aiAmount: number | null
  /** **回函值** —— 比对的实际输入，**人工确认值**，AI 值到达即自动预填、人工可改 */
  replyAmount: number | null
  /**
   * 差异 = `回函值 − 系统数据`（v2.40）。**人工改「回函值」后必须实时重算** ——
   * 否则会出现「回函值 900 / 系统数据 1000 / 差异 0」这种自相矛盾的行，比对表自己不可信。
   */
  diff: number | null
  /** 核对结论：相符 / 不相符 / 系统无此笔（回函新增） */
  match: boolean | null
}

/* ------------------------------------------------------------------ */
/* 快递数据导入（Excel）—— 不做步骤化处理，直接给出匹配代入结果          */
/* ------------------------------------------------------------------ */

export interface ExpressMatchRow {
  id: string
  expressNo: string
  expressCompany: string
  sender: string
  phone: string
  address: string
  /** 匹配到的函证 */
  matchedConfirmationNo?: string
  matchedEntity?: string
  matchedSendRecordNo?: string
  status: 'matched' | 'unmatched'
  reason?: string
}

export interface ExpressImportResult {
  fileName: string
  fileSize: string
  totalRows: number
  matchedCount: number
  unmatchedCount: number
  rows: ExpressMatchRow[]
  importedAt: string
}
