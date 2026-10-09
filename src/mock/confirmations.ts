import type {
  AiVerification,
  AssignSource,
  BankCandidateSource,
  BankItemEntry,
  BankItemGroup,
  BankTextResult,
  ConfirmationType,
  ConsistencyRow,
  ConsistencyTable,
  HandwritingResult,
  ReplyRecord,
  SealResult,
  SubjectEntry,
} from '@/types'
import { scoreBankMatch } from '@/services/bankMatch'
import { compareCell, parseAmount } from '@/utils/consistency'

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
/**
 * 演示批次 B 那 4 个年度（控制表侧统一写 ISO）—— 2021 / 2022 / 2023 / 2024 年一季度。
 *
 * **只给"另外三家银行"用**：齐商那 4 封沿用既有的 `QS2024-016/017/018/031`（见下）。
 * 招商的 **2024 年一季度**是刻意的「表里最后一格」——演示批次里它那第 4 封是
 * 「24 年 1-6 月」，**在表里找不到对应期间**，用来看「期间对不上 → 待人工指定」。
 */
const BANK_YEARS: { start: string; end: string }[] = [
  { start: '2021-01-01', end: '2021-12-31' },
  { start: '2022-01-01', end: '2022-12-31' },
  { start: '2023-01-01', end: '2023-12-31' },
  { start: '2024-01-01', end: '2024-03-31' },
]

export const CANDIDATE_SOURCES: BankCandidateSource[] = [
  {
    confirmationNo: 'QS2024-031',
    entity: '齐商银行股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2024-01-01',
    periodEnd: '2024-03-31',
    type: '银行函证',
  },
  /*
   * 齐商银行按**年度**各占一封（v2.83）—— 演示批次 B 就是同一个被询证单位按年度回 4 封
   * （2021 / 2022 / 2023 / 2024 年 1-6 月），装在一个快递里。前三个年度在表内、
   * 24 年 1-6 月不在（表里只有 24 年一季度那封）—— 用来看"期间对不上 → 待人工指定"。
   */
  {
    confirmationNo: 'QS2024-016',
    entity: '齐商银行股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2021-01-01',
    periodEnd: '2021-12-31',
    type: '银行函证',
  },
  {
    confirmationNo: 'QS2024-017',
    entity: '齐商银行股份有限公司',
    auditedEntity: AUDITED_ENTITY,
    periodStart: '2022-01-01',
    periodEnd: '2022-12-31',
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
  /*
   * **另外三家银行各 4 个年度**（v3.25）—— 演示批次 B 改成「四家银行各一个快递包裹、
   * 每包 4 封 3 页」，故这三家各补 4 个编号（与 `buildBatchB` 的四个年度一一对应）。
   * 生成而不手抄 12 条：编号、期间、被询证单位三者必须一致，抄错一处就会让某封
   * 自动归属到别人头上，而生成式的写法让它们不可能不一致。
   */
  ...[
    { prefix: 'ZX', entity: '中信银行股份有限公司' },
    { prefix: 'PF', entity: '上海浦东发展银行股份有限公司' },
    { prefix: 'ZS', entity: '招商银行股份有限公司' },
  ].flatMap(({ prefix, entity }) =>
    BANK_YEARS.map((y, i) => ({
      confirmationNo: `${prefix}2024-0${11 + i}`,
      entity,
      auditedEntity: AUDITED_ENTITY,
      periodStart: y.start,
      periodEnd: y.end,
      type: '银行函证' as const,
    })),
  ),
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
/* 发函件里识别出的表格 —— 逐单元格保留原件行列（v2.69）                 */
/* ------------------------------------------------------------------ */

/**
 * 表格模板（**发函侧**）—— 回函侧由它 + 单元格差异覆盖派生。
 *
 * 两套模板分别取自两份真实样例函证（**都是逐格取自原件**）：
 * · `cswl`    —— `fahan-cswl0526.pdf`（《企业询证函》，4 大类 / **6 张子表、列结构各不相同**），
 *                也是左栏「发函用印件」那份样例 —— **默认记录用它，双方同源**；
 * · `wanglai` —— `wanglai-1-SJ01YF001.pdf`（另一份《企业询证函》，4 张表），
 *                供 `whzf0010005` 使用（它的回函样例是这份、印章批注坐标按它校准）。
 *
 * **模板里只写发函值**；回函值默认与发函一致，差异由 `buildConsistency` 的 patch 注入 ——
 * 这样「发函 / 回函两套行」天然同构，不会出现列对不上的情况。
 */
interface LetterTableTemplate {
  id: string
  /** 所属大类（原件里的大项标题，如「1. 销售与未结算」）；没有两级结构时省略 */
  section?: string
  title: string
  unit?: string
  columns: string[]
  comparedColumns: number[]
  keyColumns: number[]
  periodColumn?: number
  subjectColumn?: number
  /** 该表在**这一封**发函用印件里的页区间（**相对页号**，1 = 该封第 1 页） */
  sentPages?: { start: number; end: number }
  /** 该表在**这一封**回函件里的页区间（**相对页号**，同上） */
  repliedPages?: { start: number; end: number }
  /** 各行的单元格（发函侧），顺序与 `columns` 一致 */
  rows: string[][]
}

/**
 * 回函侧的单元格差异覆盖：表 id → **行下标** → 列下标 → 回函识别值。
 * 值为空串即「回函未列示该金额」（对应 `missing`）。
 */
type LetterPatch = Record<string, Record<number, Record<number, string>>>

/**
 * `fahan-cswl0526.pdf` 的 **4 大类 / 6 张子表** —— 逐格取自原件（2026-09-28 按文字层坐标逐行还原）。
 *
 * 这封信是**「大类 → 子表」两级**结构（比 `wanglai` 那份更接近真实函证）：
 * ```
 * 1. 销售与未结算  （1）销售与应（预）收账款  （2）应收贵公司票据
 * 2. 采购与未结算  （1）采购与预（应）付账款  （2）应付贵公司票据
 * 3. 其他往来账项  （本大类即一张表，无子标题）
 * 4. 其他事项      （空白填写框）
 * ```
 * 六张表的列数分别是 6 / 5 / 6 / 5 / 5 / 2 —— **没有一列共通**，再次印证「不能归一化成一张表」。
 * 「信息证明无误 / 信息不符」签章区**不是数据表格**，不在其中（它属于印章 / 手写体识别）。
 *
 * **页号是「该封内的相对页号」**（每封在发函件里占 2 页、在回函件里占 3 页），
 * 绝对页号由界面侧叠加 `letterPagesOf()` 的起点算出（见 `ConsistencyTable.sentPages` 的注释）。
 */
const CSWL_TEMPLATES: LetterTableTemplate[] = [
  {
    id: 'sales-receivable',
    section: '1. 销售与未结算',
    title: '（1）销售与应（预）收账款',
    columns: [
      '截止日期',
      '贵公司欠（不含暂估）',
      '暂估金额',
      '销售给贵公司（不含税）',
      '欠贵公司',
      '本公司科目',
    ],
    comparedColumns: [1, 2, 3, 4],
    /* 期间有重复（主营业务收入与应收账款各有 2021 年度），故配对键取「期间 + 科目」 */
    keyColumns: [0, 5],
    periodColumn: 0,
    subjectColumn: 5,
    sentPages: { start: 1, end: 1 },
    repliedPages: { start: 1, end: 1 },
    rows: [
      ['2021年度', '无', '无', '5,000,000', '无', '主营业务收入'],
      ['2022年度', '无', '无', '5,000,001', '无', '主营业务收入'],
      ['2023年度', '无', '无', '5,000,002', '无', '主营业务收入'],
      ['2024年1-6月', '无', '无', '5,000,003', '无', '主营业务收入'],
      ['2021年度', '300,000', '无', '无', '无', '应收账款'],
      ['2022年度', '301,000', '无', '无', '无', '应收账款'],
      ['2023年度', '302,000', '无', '无', '无', '应收账款'],
      ['2024年1-6月', '303,000', '无', '无', '无', '应收账款'],
    ],
  },
  {
    id: 'receivable-bills',
    section: '1. 销售与未结算',
    title: '（2）应收贵公司票据',
    columns: ['出票日期', '票据编号', '金额', '收票人/出票人', '备注'],
    comparedColumns: [2],
    keyColumns: [0, 1],
    periodColumn: 0,
    sentPages: { start: 1, end: 1 },
    repliedPages: { start: 1, end: 1 },
    rows: [
      ['2021-12-31', '1000005', '5,004', '西小点0005', '备注5'],
      ['2022-12-31', '1000006', '5,005', '西小点0006', '备注6'],
      ['2023-12-31', '1000007', '5,006', '西小点0007', '备注7'],
      ['2024-06-30', '1000008', '5,007', '西小点0008', '备注8'],
    ],
  },
  {
    id: 'purchase-payable',
    section: '2. 采购与未结算',
    title: '（1）采购与预（应）付账款',
    columns: [
      '截止日期',
      '贵公司欠',
      '向贵公司采购（不含税）',
      '欠贵公司（不含暂估）',
      '暂估金额',
      '本公司科目',
    ],
    comparedColumns: [1, 2, 3, 4],
    keyColumns: [0, 5],
    periodColumn: 0,
    subjectColumn: 5,
    sentPages: { start: 1, end: 1 },
    repliedPages: { start: 1, end: 1 },
    /* 原件里这一项**只印了表头、没有数据行** —— 照实保留这张空表（不给它编数据） */
    rows: [],
  },
  {
    id: 'payable-bills',
    section: '2. 采购与未结算',
    title: '（2）应付贵公司票据',
    columns: ['出票日期', '票据编号', '金额', '受票人', '备注'],
    comparedColumns: [2],
    keyColumns: [0, 1],
    periodColumn: 0,
    /* 表标题与表头印在发函件第 1 页、数据行在第 2 页 —— 页区间照实横跨两页 */
    sentPages: { start: 1, end: 2 },
    repliedPages: { start: 1, end: 2 },
    rows: [
      ['2021-12-31', '1000001', '5,000', '西小点0001', '备注1'],
      ['2022-12-31', '1000002', '5,001', '西小点0002', '备注2'],
      ['2023-12-31', '1000003', '5,002', '西小点0003', '备注3'],
      ['2024-06-30', '1000004', '5,003', '西小点0004', '备注4'],
    ],
  },
  {
    id: 'other-accounts',
    title: '3. 其他往来账项',
    columns: ['截止日期', '贵公司欠', '欠贵公司', '备注（内容、性质）', '本公司科目'],
    comparedColumns: [1, 2],
    keyColumns: [0, 4],
    periodColumn: 0,
    subjectColumn: 4,
    sentPages: { start: 2, end: 2 },
    repliedPages: { start: 2, end: 2 },
    rows: [
      ['2021年度', '603,001', '无', '无', '其他应收款'],
      ['2022年度', '603,002', '无', '无', '其他应收款'],
      ['2023年度', '603,003', '无', '无', '其他应收款'],
      ['2024年1-6月', '603,004', '无', '无', '其他应收款'],
      ['2021年度', '无', '603,005', '无', '其他应付款'],
      ['2022年度', '无', '603,006', '无', '其他应付款'],
      ['2023年度', '无', '603,007', '无', '其他应付款'],
      ['2024年1-6月', '无', '603,008', '无', '其他应付款'],
    ],
  },
  {
    id: 'other-matters',
    title: '4. 其他事项',
    columns: ['其他事项', '其他备注'],
    /* 空白填写框 —— 原件无金额，不作为核对项，但**照实展示**（它是原件里的一张表） */
    comparedColumns: [],
    keyColumns: [0],
    sentPages: { start: 2, end: 2 },
    repliedPages: { start: 2, end: 2 },
    /* 「其他备注」格里印着一个「1」（原件如此，不臆造也不丢弃） */
    rows: [['', '1']],
  },
]

/**
 * `wanglai-1-SJ01YF001.pdf` 的 4 张表 —— **数据逐格取自原件**（2026-09-28 渲染原页逐格核对）。
 *
 * 四张表的列结构**互不相同**，这正是「不能归一化成一张表」的证据：
 *   ① 往来款项余额 5 列（含两个方向的欠款）② 交易额 4 列 ③ 票据往来 4 列 ④ 其他事项（空白框）。
 * 「信息证明无误 / 信息不符」签章区**不是数据表格**，不在其中（它属于印章 / 手写体识别）。
 */
const WANGLAI_TEMPLATES: LetterTableTemplate[] = [
  {
    id: 'balance',
    title: '本公司与贵公司的往来款项余额如下',
    unit: '单位：人民币元',
    columns: ['截止日期', '欠贵公司（已开票-含税）', '欠贵公司（未开票-不含税）', '贵公司欠', '备注'],
    comparedColumns: [1, 2, 3],
    keyColumns: [0],
    periodColumn: 0,
    subjectColumn: 4,
    rows: [
      ['2018/12/31', '293,338.73', '329,040.37', '-', '应付账款'],
      ['2019/12/31', '919,413.26', '-', '-', '应付账款'],
      ['2020/12/31', '340,078.37', '693,303.74', '-', '应付账款'],
      ['2021/12/31', '229,975.56', '287,846.41', '-', '应付账款'],
      ['2022/6/30', '274,715.14', '180,359.77', '-', '应付账款'],
    ],
  },
  {
    id: 'trade',
    title: '本公司与贵公司的交易额如下',
    unit: '单位：人民币元',
    columns: ['所属期间', '交易金额（含税）', '采购内容', '备注'],
    comparedColumns: [1],
    keyColumns: [0],
    periodColumn: 0,
    rows: [
      ['2019年度', '4,344,679.63', '材料款及加工费', ''],
      ['2020年度', '4,169,130.47', '材料款及加工费', ''],
      ['2021年度', '4,753,787.81', '材料款及加工费', ''],
      ['2022年1-6月', '1,890,257.59', '材料款及加工费', ''],
    ],
  },
  {
    id: 'bill',
    title: '本公司与贵公司票据往来金额如下',
    unit: '单位：人民币元',
    columns: ['所属期间', '交易内容', '票据结算金额', '备注'],
    comparedColumns: [2],
    /* 期间有重复（两行都是 2020 年度），故配对键取「期间 + 交易内容」 */
    keyColumns: [0, 1],
    periodColumn: 0,
    rows: [
      ['2019年度', '承兑汇票支付货款', '350,000.00', ''],
      ['2020年度', '承兑汇票支付货款', '3,000,000.00', ''],
      ['2021年度', '承兑汇票支付货款', '1,000,000.00', ''],
      ['2022年1-6月', '-', '-', ''],
      ['2020年度', '接受贵公司承兑汇票背书转让', '550,000.00', ''],
    ],
  },
  {
    id: 'other',
    title: '其他事项',
    columns: ['（本栏由被询证方填写）'],
    /* 空白填写框 —— 原件无金额，不作为核对项，但**照实展示**（它是原件里的一张表） */
    comparedColumns: [],
    keyColumns: [0],
    rows: [['']],
  },
]

/**
 * 函证样例 → 表格模板（v2.70 由「`huihan` / `wanglai` 两套」收敛为「`cswl` / `wanglai` 两套」）：
 * · `cswl`    —— **默认**，与左栏「发函用印件」同源；
 * · `wanglai` —— `whzf0010005` 专用（它的回函样例是那份卷宗、印章批注坐标按它校准）。
 *
 * 原先那套 `huihan`（0813 拼接回函的 20 条事项）随默认样例切换一并删除 —— 不留死模板。
 */
type LetterKind = 'cswl' | 'wanglai'

/**
 * 由「逐表」派生「拍平」记录 —— 一条 = 一个**有值的金额单元格**。
 *
 * 判定口径与界面上的红框**共用** `@/utils/consistency`，因此「结论条说几项不符」
 * 与「表里框了几处」必然一致。
 */
function flattenConsistency(tables: ConsistencyTable[]): ConsistencyRow[] {
  const out: ConsistencyRow[] = []
  tables.forEach((t) => {
    t.sentRows.forEach((sent, i) => {
      const replied = t.repliedRows[i]
      t.comparedColumns.forEach((c) => {
        const sentText = sent.cells[c] ?? ''
        const repliedText = replied?.cells[c] ?? ''
        const state = compareCell(sentText, repliedText)
        /* 两侧都没有金额（如「贵公司欠」整列「-」）→ 不是核对项，不进拍平记录 */
        if (state === 'same' && parseAmount(sentText) == null) return
        out.push({
          id: `${t.id}-${i}-${c}`,
          item: sent.cells[t.keyColumns[0]] ?? '',
          period: sent.cells[t.periodColumn ?? t.keyColumns[0]] ?? '',
          subject: t.subjectColumn != null ? (sent.cells[t.subjectColumn] ?? t.title) : t.title,
          sentAmount: parseAmount(sentText),
          repliedAmount: parseAmount(repliedText),
          match: state === 'same' ? 'match' : state,
          confidence: state === 'same' ? 0.98 : 0.93,
        })
      })
    })
  })
  return out
}

/**
 * 构建一致性比对结果 —— **逐表识别结果 + 逐表比对**。
 *
 * @param kind  用哪份样例函证的表格结构（决定「发函件里有几张表、各有哪些列」）
 * @param patch 回函侧的单元格差异覆盖（不传 = 回函与发函完全一致）
 */
function buildConsistency(
  kind: LetterKind = 'cswl',
  patch: LetterPatch = {},
): { tables: ConsistencyTable[]; rows: ConsistencyRow[]; diffCount: number } {
  const templates = kind === 'wanglai' ? WANGLAI_TEMPLATES : CSWL_TEMPLATES
  /** 未显式标注页区间的表一律落在「该封首页」——`wanglai` 那份的 4 张表都在第 1 页 */
  const FIRST_PAGE = { start: 1, end: 1 }
  const tables: ConsistencyTable[] = templates.map((t) => {
    const cellPatch = patch[t.id] ?? {}
    return {
      id: t.id,
      section: t.section,
      title: t.title,
      unit: t.unit,
      columns: t.columns,
      comparedColumns: t.comparedColumns,
      keyColumns: t.keyColumns,
      periodColumn: t.periodColumn,
      subjectColumn: t.subjectColumn,
      sentPages: t.sentPages ?? FIRST_PAGE,
      repliedPages: t.repliedPages ?? FIRST_PAGE,
      sentRows: t.rows.map((cells, i) => ({ id: `${t.id}-${i}`, cells: [...cells] })),
      repliedRows: t.rows.map((cells, i) => {
        const p = cellPatch[i]
        return {
          id: `${t.id}-${i}`,
          cells: p ? cells.map((cell, ci) => (ci in p ? p[ci] : cell)) : [...cells],
        }
      }),
    }
  })
  const rows = flattenConsistency(tables)
  return { tables, rows, diffCount: rows.filter((r) => r.match !== 'match').length }
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

/**
 * 广东证券：印章落「信息不符」区 + 2 项金额差异 → 高风险。
 * 差异落点（`cswl` 正文表）：① 销售给贵公司（不含税）2024 年 1-6 月 `5,000,003 → 5,000,030`；
 * ② 其他往来账项 2023 年度「贵公司欠」回函**未列示**（整格缺失）。
 */
const VERIFY_GD: AiVerification = (() => {
  const consistency = buildConsistency('cswl', {
    'sales-receivable': { 3: { 3: '5,000,030' } },
    'other-accounts': { 2: { 1: '' } },
  })
  const seal = SEAL_ABNORMAL
  const { level, reasons } = riskOf('往来函证', { diffCount: consistency.diffCount, seal })
  return {
    consistency: { ...consistency, confidence: 0.95 },
    seal,
    handwriting: HANDWRITING_ABNORMAL,
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
})()

/**
 * 与 `VERIFY_GD` 同口径（印章落「信息不符」区 + 2 项差异 → 高风险），
 * 但用 **`wanglai` 样例的 4 张表** —— 供 `whzf0010005` 使用（它预览的就是那份样例文件）。
 *
 * 差异落点拆在两处，正是「表格不归一化」的价值：一处是**同一行的某个金额列**（往来款项余额表
 * 2022/6/30 的「欠贵公司（已开票-含税）」），另一处是**整格缺失**（交易额表 2021 年度回函未列示）。
 */
const VERIFY_GD_W: AiVerification = (() => {
  const consistency = buildConsistency('wanglai', {
    balance: { 4: { 1: '274,715.41' } },
    trade: { 2: { 1: '' } },
  })
  const seal = SEAL_ABNORMAL
  const { level, reasons } = riskOf('往来函证', { diffCount: consistency.diffCount, seal })
  return {
    consistency: { ...consistency, confidence: 0.95 },
    seal,
    handwriting: HANDWRITING_ABNORMAL,
    riskLevel: level,
    riskReasons: reasons,
    completedModules: 6,
    totalModules: 6,
  }
})()

/** 招商证券：**几处金额不符**（含一处整格缺失）+ 印章正常 → 中风险（待人工核对差异） */
const VERIFY_ZX: AiVerification = (() => {
  /*
   * v3.01：原来这里是「全部相符」（`buildConsistency('cswl')` 不带 patch）——
   * 用户要"**做几个不一致的数据**"看标注效果，于是补三处，覆盖两种状态：
   * · 两处**金额不符**（同一列不同行）；
   * · 一处**整格缺失**（回函未列示）。
   * 索引取的都是在 `VERIFY_GD` 里已验证存在的行列 ⇒ 不会越界。
   */
  const consistency = buildConsistency('cswl', {
    'sales-receivable': { 1: { 3: '4,800,000' }, 3: { 3: '5,000,030' } },
    'other-accounts': { 2: { 1: '' } },
  })
  const seal = SEAL_NORMAL
  const { level, reasons } = riskOf('往来函证', { diffCount: consistency.diffCount, seal })
  return {
    consistency: { ...consistency, confidence: 0.97 },
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
  const consistency = buildConsistency('cswl')
  const seal = SEAL_MISSING
  const bankDiffCount = BANK_ITEMS_QS.filter((i) => !i.match).length
  const { level, reasons } = riskOf('银行函证', { diffCount: 0, seal, bankDiffCount })
  return {
    consistency: { ...consistency, confidence: 0.9 },
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
  const consistency = buildConsistency('cswl')
  const seal = SEAL_NORMAL
  const bankDiffCount = BANK_ITEMS_QS.filter((i) => !i.match).length
  const { level, reasons } = riskOf('银行函证', { diffCount: 0, seal, bankDiffCount })
  return {
    consistency: { ...consistency, confidence: 0.92 },
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
    consistency: { ...buildConsistency('cswl'), confidence: 0.95 },
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
  /* 差异落点（`cswl` 正文表）：销售与应（预）收账款 2021 年度应收账款的「贵公司欠」300,000 → 300,300 */
  const consistency = buildConsistency('cswl', { 'sales-receivable': { 4: { 1: '300,300' } } })
  const diffCount = consistency.diffCount
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
    consistency: { ...consistency, confidence: 0.94 },
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

/**
 * 与 `VERIFY_HT` 同口径（1 项差异 + 财务章 + 缺骑缝章 → 中风险），
 * 但用 **`wanglai` 样例的 4 张表** —— 供 `whzf0010005` 第 2 次回函使用（它预览的就是那份样例文件）。
 * 差异落点：交易额表 2020 年度「交易金额（含税）」回函 4,169,130.00（与发函 4,169,130.47 不符）。
 */
const VERIFY_HT_W: AiVerification = (() => {
  const consistency = buildConsistency('wanglai', { trade: { 1: { 1: '4,169,130.00' } } })
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
    consistency: { ...consistency, confidence: 0.94 },
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
    /* 该函证预览的样例是 `wanglai-1-SJ01YF001.pdf`（4 张表），故用同结构的核验数据 */
    verification: VERIFY_GD_W,
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
    /* 该函证预览的样例是 `wanglai-1-SJ01YF001.pdf`（4 张表），故用同结构的核验数据 */
    verification: VERIFY_HT_W,
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

  /* ---------- 招商证券：1 次回函，**几处金额不符** → 中风险，待人工确认 ---------- */
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
    /*
     * **类型直接取源数据自己的 `type`**（v3.25 修）。
     * 原先按编号前缀猜（`startsWith('QS')` ⇒ 银行函证），这在"银行侧只有一个编号前缀"
     * 时碰巧成立；v3.25 起银行侧有四个前缀（QS / ZX / PF / ZS），猜法会把中信、浦发、招商
     * 那 12 封**当成往来函证** —— 于是银行批次的候选下拉里根本看不到它们。
     */
    type: s.type,
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

/* ------------------------------------------------------------------ */
/* 归属来源留痕（v2.64）                                                */
/* ------------------------------------------------------------------ */

/**
 * 演示数据的**归属来源**。
 *
 * 它回答的是审计复核时最常被问的那句「**这封凭什么是这家银行的**」——
 * 这份回函是怎么被归到当前这封函证的。它随记录长期保留，展示在列表**展开行的留痕行**里。
 *
 * 真实环境由识别落库时写入（`AppStore.applyRecognizedReply` 从任务上带过来），
 * 下面是给**既有演示数据**补的值 —— 刻意配出**三种来源**，好在界面上都能看到：
 * · `auto` 系统自动 —— 往来函证凭右上角二维码精确命中（绝大多数）；
 * · `manual-confirm` 人工确认 —— 系统给了建议、由人点头（齐商：四要素命中，但日期写法与发函底稿不同）；
 * · `manual-assign` 人工指定 —— 系统没给出可用建议、由人从清单里挑（广发：回函落款单位名与系统内不一致）。
 */
const ASSIGN_SOURCE_BY_ID: Record<string, AssignSource> = {
  'QS2024-031-1': 'manual-confirm',
  'whzf0010001-1': 'manual-assign',
  'whzf0010001-2': 'manual-assign',
}

/*
 * 就地补写，而不是塞进上面那 10 条记录的字面量里：演示数据的重点是业务字段，
 * 而归属来源是**每条记录都该有**的一项元信息 —— 集中写在这里，
 * 一眼能看出「三种来源都覆盖到了」，也不必让每条记录都多一行容易看漏的字段。
 */
for (const r of REPLY_RECORDS) {
  r.assignSource = ASSIGN_SOURCE_BY_ID[r.id] ?? 'auto'
}
