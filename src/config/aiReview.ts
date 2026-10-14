import type {
  AiReviewKey,
  AiReviewState,
  ConfirmationType,
  RecognitionStage,
  RecognitionTask,
  ReplyRecord,
  ReplyResultInfo,
  StageKey,
} from '@/types'
import { evaluateMatch } from '@/services/replyRule'
import { stagesOf } from '@/mock/recognition'

/**
 * 列表「核查事项复核」事项 —— **清单与映射的单一数据源**（v3.28 立；列名 v3.29「AI 核验事项」→ v3.30 改今名）。
 *
 * ## 它解决什么
 *
 * 用户把「一条回函 = 一串待核验事项」这条模型摆到了列表上：每行有若干枚 AI 识别事项，
 * 逐项点开看详情、采纳或不采纳，处理完全部事项即视为核验完成。
 * 这套事项被**三处**消费：
 *   ① 列表的「核查事项复核」列（`components/AiReviewCell.tsx`）—— 渲染**整条复核状态**
 *      （待复核 · 剩 N 项 / 已复核）；v3.31 起**不再逐项列**，理由见 `aiReviewSummaryOf`；
 *   ② 核验详情（`VerificationPanel`）—— 打开时定位到该项、页脚给采纳 / 不采纳；
 *   ③ 「回函结果填写」页（`ReplyResultModal`）—— 采纳过的项**自动带出**到对应字段。
 *
 * 三处若各写一份清单，必然漂移（项目一路在清理这类重复）。故清单、页签对应、
 * 结论可用性与「带出到哪个字段」全部收在本文件，三处只读不写。
 *
 * ## 口径（用户拍板，逐条对应）
 *
 * · **往来 = 3 项**：印章识别（**往来函证的「回函是否相符」由它判定**）· 发函回函一致性检测 ·
 *   手写体识别 —— 用户原话：「往来函回函是否相符，走印章识别。发函回函一致性检测，
 *   单独拉出来，**和印章识别同级别**」；
 * · **银行 = 2 项**：回函是否相符检测（询证事项逐项核对）· 印章识别 ——
 *   用户原话：「银行函证，没有发函回函一致性检测，只有回函是否相符检测」；
 * · **两类都不含「快递（面单）检测」** —— 用户原话：「银行函往来函，去掉快递检测」。
 *
 * ⚠️ **下面数组里的先后只表示"有哪几项"，不表示展示顺序** —— 展示顺序由
 * `aiReviewItemsOf` 按**机器核查顺序**算（见该函数的说明）。
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
      label: '印章核查',
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
      label: '印章核查',
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

/**
 * 事项在**机器核查管道**里的位置 —— 值越小越早跑。
 *
 * 取该事项那几个检测点里**最早**的一个在管道里的下标；管道 = 阶段一 + 阶段二
 * （`stagesOf` 是阶段划分的单一事实来源，见 `mock/recognition`）。
 * 没有映射的事项排到最后（兜底，正常不该出现）。
 */
function machineOrderOf(type: ConfirmationType, key: AiReviewKey): number {
  const pipeline = [...stagesOf(type, 1), ...stagesOf(type, 2)]
  const idx = (AI_REVIEW_STAGE_MAP[type][key] ?? [])
    .map((k) => pipeline.indexOf(k))
    .filter((i) => i >= 0)
  return idx.length ? Math.min(...idx) : Number.MAX_SAFE_INTEGER
}

/**
 * 该类型的事项清单，**顺序 = 机器核查顺序**（2026-10-14 改）。
 *
 * 用户原话：「当前字段识别的顺序和这个**智能核查进度**的顺序不一致，需要把**进度检查的顺序
 * 弄成和核查顺序一样**的」—— 表里那两列是同一份清单，人那一列（「核查事项复核」）先写着
 * 印章识别、机器那一列（「智能核查进度」）却是先跑一致性，于是两列**逐项对不上**：
 * 某一项在左边刚变蓝，右边同位置那一项却是另一件事。
 * （v3.31 起人那一列已不列项，"两列逐项对照"这条约束随之作废 —— 列上不列项，
 *   就没有两个列表逐项对错的余地了；留下的那条是"顺序同源"，见文末。）
 *
 * 修法不是"把数组顺序改一改"（那样两处各有一份顺序，迟早再漂），而是**顺序由管道算出来**：
 * 每个事项取它最早那个检测点在 `stagesOf` 里的位置 —— 管道顺序一旦调整，两列自动跟着走。
 *
 * 于是往来的三项变成 **发函回函一致性检测 → 印章识别 → 手写体识别**
 * （`STAGES_TRADE` = match / consistency / sealExists / crossPageSeal / sealNameMatch / handwriting，
 * 一致性排在最前）；银行两项本来就是 回函是否相符检测 → 印章识别，不变。
 *
 * ⚠️ **这个顺序三处共用**：「智能核查进度」列（机器逐项）、核验详情右侧的页签、
 * 以及**点「核查事项复核」格进来时的默认落点**（`aiReviewEntryOf` 取"第一个未复核项"）。
 * 它是"机器会按什么次序认完这几项"；三处若不一致，用户会以为"进去之后顺序变了"。
 */
export function aiReviewItemsOf(type: ConfirmationType): AiReviewItem[] {
  return [...AI_REVIEW_ITEMS[type]].sort((a, b) => machineOrderOf(type, a.key) - machineOrderOf(type, b.key))
}

/* ------------------------------------------------------------------ */
/* 事项 ↔ 检测项的映射（机器侧进度，2026-10-14 随入表时机回退新增）              */
/* ------------------------------------------------------------------ */

/**
 * **每个核验事项背后是哪些识别检测项**。
 *
 * ## 为什么需要它
 *
 * 入表时机回退后，列表要在**同一份事项清单**上同时表达两件事：
 * · 「**核查事项复核**」列 = 人处理了没有（读 `record.aiReview`）；
 * · 「**智能核查进度**」列 = 机器核查完没有（读 `task.stages`，2026-10-14 新增）。
 * 两张脸、一份清单 —— 用户原话：「这个字段有点类似 AI 核验事项字段展示的内容」。
 * 于是把「事项 → 检测项」的映射也收在本文件：事项「印章识别」跑完 = 它那三个检测项
 * （是否有印章 / 骑缝章 / 名称一致）**全部落定**。
 *
 * ## 两条刻意的取舍
 *
 * · **不含「归属匹配」（`match`）** —— 归属是这行**能出现在表里**的原因，不是一项核查内容；
 * · **不含「快递面单识别」（`expressSheet`）** —— 用户已明确它归**切分阶段**，
 *   不进智能识别（见 `RecognitionProgressBoard` 头注释与 5.1）。
 *   银行侧的「识别四要素」（`bankText`）同理不列：它是阶段一的归属输入。
 */
export const AI_REVIEW_STAGE_MAP: Record<
  ConfirmationType,
  Partial<Record<AiReviewKey, StageKey[]>>
> = {
  往来函证: {
    /* 「印章识别」在检测侧是三项，合成一件人要看的事 */
    seal: ['sealExists', 'crossPageSeal', 'sealNameMatch'],
    consistency: ['consistency'],
    handwriting: ['handwriting'],
  },
  银行函证: {
    /* 银行一致性的检测点叫「询证事项逐项核对」，事项名按结论叫「回函是否相符检测」 */
    match: ['consistency'],
    seal: ['sealExists', 'sealNameMatch'],
  },
}

/** 事项在**机器侧**的状态 —— 四项，比人那两态多出"还没轮到"与"失败" */
export type AiReviewStageStatus = 'waiting' | 'running' | 'done' | 'failed'

/**
 * 某个核验事项**机器核查到哪一步了**。
 *
 * · **没有对应任务**（演示种子行、历史数据，不是本次核查产生的）→ 视为 `done`：
 *   它们的核查早就跑完了，表上的旗子给蓝是诚实的；
 * · **检测项还没被追加到任务上**（银行阶段二尚未启动）→ `waiting`；
 * · 任一项 `failed` → `failed`（**不能打旗**，那是在说谎，同「识别区」的旧口径）；
 * · 任一项 `running` → `running`；
 * · 全部 `done` → `done`。
 */
export function aiReviewStageStatusOf(
  task: RecognitionTask | undefined,
  type: ConfirmationType,
  key: AiReviewKey,
): AiReviewStageStatus {
  if (!task) return 'done'
  const keys = AI_REVIEW_STAGE_MAP[type][key] ?? []
  const stages = keys
    .map((k) => task.stages.find((s) => s.key === k))
    .filter((s): s is RecognitionStage => !!s)
  if (!stages.length) return 'waiting'
  if (stages.some((s) => s.status === 'failed')) return 'failed'
  if (stages.some((s) => s.status === 'running')) return 'running'
  return stages.every((s) => s.status === 'done') ? 'done' : 'waiting'
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

/**
 * 待办提示：已处理过的事项在标签上悬停显示「谁、什么时候处理成什么」。
 *
 * v3.34：**不采纳原因**也接在这句里（`note`）—— 它是处置的一部分，
 * 「谁在什么时候因为什么不采纳」才是一条完整的留痕；
 * 采纳没有理由可写，故只在 `ignored` 时带上。
 */
export function aiReviewTip(state: AiReviewState | undefined): string | undefined {
  if (!state) return undefined
  const head = state.status === 'adopted' ? '已采纳' : '已标记不采纳'
  const note = state.status === 'ignored' && state.note ? `（原因：${state.note}）` : ''
  return `${head}${note} · ${state.by} · ${state.at}`
}

/* ------------------------------------------------------------------ */
/* 「核查事项复核」列的**整条状态**（v3.31）                                   */
/* ------------------------------------------------------------------ */

/**
 * 一条回函的**整条复核状态** —— 列表「核查事项复核」列（`AiReviewCell`）与
 * "点进去默认落在哪一项"共用这一份算法。
 *
 * ## 为什么这一列不再逐项列（v3.31，用户拍板）
 *
 * 用户原话：「**这一列就展示：待复核、已复核**。这一步从业务逻辑上就是想把识别的结果展示给用户看，
 * 然后，用户顺便在这里做对 AI 结果的复核工作。**因为前面已经有 AI 核查进度展示具体进行了哪些
 * AI 核查项目，所以，这里就不展示具体的哪些核查项了**，只需要告诉用户，要去做 AI 核查。」
 *
 * 于是：**逐项**交给左边的「智能核查进度」列（机器侧：短横 → 像素网格 → 裸勾 / 叉），
 * 这一列只回答"**人**这边还有没有要做的事"——一份清单两张脸，不必在相邻两格各列一遍。
 *
 * ## 口径（用户确认）
 *
 * · **已复核** = 该行**全部**核查项都表过态（往来 3 项 / 银行 2 项，采纳或不采纳都算表态）；
 *   缺一项即**待复核**。这正是本文件头那段"一条回函 = 一串 todo，全部做完这单才算完成"。
 * · **待复核**时把**未复核的项**原样带出来（列上显示"剩 N 项"、悬停里列项名）——
 *   格内不列项，但**不点进去也该知道还剩几件**（用户确认要这一条：从"一眼看清"别退成
 *   "点进去才发现"）。
 * · **已复核**时把各项的处置结果一并带出（悬停里列"谁、什么时候、采纳 / 不采纳"）。
 *
 * 判定复用既有 `aiReviewStateOf` / `aiReviewItemsOf`，**不引入第二套规则**。
 */
export interface AiReviewSummary {
  /** 全部核查项都已表态 */
  reviewed: boolean
  /** 还没表态的项（顺序同 `aiReviewItemsOf`，即机器核查顺序） */
  pending: AiReviewItem[]
  /** 已表态的项及其处置结果（顺序同上） */
  done: { item: AiReviewItem; state: AiReviewState }[]
}

export function aiReviewSummaryOf(record: ReplyRecord): AiReviewSummary {
  const pending: AiReviewItem[] = []
  const done: AiReviewSummary['done'] = []
  aiReviewItemsOf(record.type).forEach((item) => {
    const state = aiReviewStateOf(record, item.key)
    if (state) done.push({ item, state })
    else pending.push(item)
  })
  return { reviewed: pending.length === 0, pending, done }
}

/*
 * 落点函数 `aiReviewEntryOf`（v3.31 加）已于 **v3.33 移出本文件** ——
 * 总判定把"回函结果必填项没填"也纳入了待办（见 `config/replyTasks.ts`），
 * 落点必须跟着总判定一起走；否则会出现"AI 项都复核完了、只差必填项，
 * 点进核验页却停在第一项，用户还得自己切到第 4 项"的错位。
 *
 * 现在的落点是 `replyTasks.replyTaskEntryPanelKeyOf`（返回**页签 key**）。
 * 本文件不再提供落点 —— 它只管 AI 事项自己的口径（清单、顺序、表态、带出）。
 */

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
 * **某一项的 AI 结论 → 该代进回函结果的哪些字段**（v3.34 抽出）。
 *
 * 核验页现在"采纳即代入人工确认列"，它要的是**单项**的映射（点哪一项就代哪一项）；
 * 结果页要的是**整条**的初值（`aiReviewPrefill`）。两者若各写一份映射必然漂移 ——
 * 故映射只在这里写一遍，`aiReviewPrefill` 由它折叠而来。
 *
 * 映射（逐条对应口径）：
 * · `seal` 采纳 → `sealConsistent` + `officialSeal`（+ 往来另有 `matched` 与 `crossSeal`）——
 *   往来函证的相符性由**落章区域**判定，银行侧印章不作相符性依据（R-01），故银行不带 `matched`；
 * · `consistency` 采纳 → 往来是 `diffDesc`（差异项清单）；银行这一项即「询证事项逐项核对」，
 *   带出的是 `matched`（相符性）；
 * · `handwriting` 采纳 → `diffDesc`（手写体转录）；
 * · `match` 采纳 → `matched`。
 *
 * `ignored`（不采纳）**一律不带值** —— 用户口径：「只标记已处理，不带入值」。
 */
export function aiReviewAdoptPatchOf(
  record: ReplyRecord,
  key: AiReviewKey,
): Partial<ReplyResultInfo> {
  const v = record.verification
  if (!v) return {}

  switch (key) {
    case 'seal': {
      const out: Partial<ReplyResultInfo> = { sealConsistent: v.seal.nameMatched }
      if (record.type === '往来函证') out.matched = evaluateMatch(record).matched ?? undefined
      if (v.seal.hasSeal) {
        out.officialSeal = v.seal.sealType === '公章'
        /* 骑缝章仅往来函证检测（v2.39 起 R-03 限定往来；银行回函无此业务要求） */
        if (record.type === '往来函证') out.crossSeal = v.seal.crossPageSeal ? 'yes' : 'no'
      }
      return out
    }
    case 'consistency':
      return record.type === '银行函证'
        ? { matched: evaluateMatch(record).matched ?? undefined }
        : { diffDesc: diffDescOf(record) }
    case 'handwriting':
      return { diffDesc: handwriteDescOf(record) }
    case 'match':
      return { matched: evaluateMatch(record).matched ?? undefined }
  }
}

/**
 * **已采纳的事项 → 「回函结果填写」页该带出的值**（v3.28）。
 *
 * 返回的是「初值」，不是「已保存值」—— 结果页的优先级是
 * **已保存的 `resultInfo` → 本函数的返回值 → 空**（守住「AI 不外写」：只有人明确采纳过才带入）。
 *
 * 实现上由 `aiReviewAdoptPatchOf` **折叠**而来（v3.34）：单项映射只写一遍，
 * 这里只负责"把多项并成一条"——其中 `diffDesc` 有几个出处（一致性差异、手写体转录），
 * 故**分段拼接**、互不覆盖；其余字段后采纳的覆盖先采纳的（同一个字段只有一个真值）。
 */
export function aiReviewPrefill(record: ReplyRecord): Partial<ReplyResultInfo> {
  const r = record.aiReview
  if (!r) return {}
  const out: Partial<ReplyResultInfo> = {}
  const descs: string[] = []

  ;(Object.keys(r) as AiReviewKey[]).forEach((k) => {
    if (r[k]?.status !== 'adopted') return
    const { diffDesc, ...rest } = aiReviewAdoptPatchOf(record, k)
    if (diffDesc) descs.push(diffDesc)
    Object.assign(out, rest)
  })

  if (descs.length) out.diffDesc = descs.join('\n\n')
  return out
}
