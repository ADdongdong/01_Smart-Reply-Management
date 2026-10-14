/**
 * 文件预览配置
 * ------------------------------------------------------------------
 * **当前预览统一走 pdf.js**：`public/samples/` 下的**已脱敏占位样例**由 Vite dev server
 * 以 HTTP 提供，浏览器端用 pdf.js 自渲染（`AnnotatedPdfPreview`）。
 * 原件与批注层**共用同一画布**（批注是叠在原件上的坐标层）—— 才能零闪动地贴住缩放与滚动，
 * 视图切换已于 v3.35 取消，批注层恒为显示（见 `components/PdfPreview`）。
 *
 * 下方 KKFileView 相关配置**保留备用**：它是第三方 iframe（内部自渲染、跨域），
 * 无法在其内容上叠加坐标标注，因此不再用于回函预览；
 * 若后续需要预览非 PDF 格式（Word / Excel 等，pdf.js 不支持），可再启用这条链路。
 *
 * KKFileView 链路（备用）：
 *
 *   浏览器 ──→ KKFileView(127.0.0.1:18012)
 *                  │  容器去下载文件
 *                  ↓
 *           host.docker.internal:15178/samples/xxx.pdf  ← 容器视角的「宿主机」
 *                  ↑
 *           Vite dev server（伺服 public/ 静态资源，已改为 host: true）
 *
 * 两个易踩的点：
 *   1. KKFileView 跑在容器里，容器内的 127.0.0.1 是容器自身，
 *      访问宿主机必须用 `host.docker.internal`（Docker Desktop for Windows 已内置该解析）。
 *   2. 宿主机 8012 落在 Windows 保留端口区间 7961-8060 内，Docker 无法绑定，
 *      因此容器内 8012 映射到宿主机 **18012**。
 */

/** KKFileView 在宿主机上的映射端口 */
export const KKFILEVIEW_PORT = 18012

/** KKFileView 服务地址（跟随当前页面的 hostname，便于局域网访问） */
export const KKFILEVIEW_BASE =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${KKFILEVIEW_PORT}`
    : `http://127.0.0.1:${KKFILEVIEW_PORT}`

/** Vite dev server 端口（见 vite.config.ts）—— 刻意取在 Windows 动态端口范围之外，避免被保留区间吞掉 */
export const DEV_SERVER_PORT = 15178

/** KKFileView 容器访问本机文件的地址前缀（容器视角的宿主机） */
export const FILE_HOST = `http://host.docker.internal:${DEV_SERVER_PORT}`

/* ------------------------------------------------------------------ */
/* 函证 → 占位样例文件映射                                             */
/* ------------------------------------------------------------------ */

/** 齐商银行回函（银行函证，无文本层的扫描件；银行函证不检测手写体，样例不涉及手写区标注） */
const BANK_QISHANG = 'bank-qishang-20240331.pdf'
/** 往来函证真实回函（印章 + 手写体演示件 —— 手写体演示件为往来函证样例） */
const WANGLAI_SEAL = 'wanglai-1-SJ01YF001.pdf'

/**
 * **发函用印件 × 回函件** —— 一对占位样例（原件含红章，已按合规要求移除）。
 *
 * 为什么要有「发函件」这一份：一致性检测比的是**发函件 × 回函件** ——
 * 而在 v2.70 之前，核验页左栏只铺回函件，比对的核心依据（我们发出去的用印件）
 * 在界面上根本看不到，用户只能「拿一半依据去核对」。
 *
 * 两份占位件的**页数与版式**沿用原样例（原件含红章，已从本项目移除）：
 * · **发函用印件 6 页** = 3 封（`cswl05260001` 中信 / `cswl05260002` 国泰君安 / `cswl05260003` 华泰），每封 2 页；
 * · **回函件 9 页** = 同样 3 封，每封「正文 2 页 + 一张无文本层的扫描页」。
 */
const FAHAN_CSWL0526 = 'fahan-cswl0526.pdf'
const HUIHAN_CSWL0526 = 'huihan-cswl0526.pdf'

const SAMPLE_BY_CONFIRMATION: Record<string, string> = {
  'QS2024-031': BANK_QISHANG,
  whzf0010005: WANGLAI_SEAL,
}

/**
 * 未单独指定的函证统一使用这份往来回函样例。
 *
 * **v2.70 由 `huihan-0813.pdf` 换成 `huihan-cswl0526.pdf`** —— 两者**同为 9 页**，
 * 与识别批次 A 的页区间（1-3 / 4-6 / 7-9）正好对齐，**切分与识别工作台零回归**；
 * 换过来的收益是：默认记录的左栏能同时铺出「发函用印件 × 回函件」，
 * 与右侧逐表比对数据**同源**（同一批函证的两侧）。
 */
export const DEFAULT_SAMPLE_FILE = HUIHAN_CSWL0526

/** 取某封函证对应的样例文件名（＝**回函件**） */
export function sampleFileOf(confirmationNo: string): string {
  return SAMPLE_BY_CONFIRMATION[confirmationNo] ?? DEFAULT_SAMPLE_FILE
}

/** 一段页区间（1-based、含两端） */
export interface PageRange {
  start: number
  end: number
}

/** 一封函证在这一对样例里的**整封页区间**（页号为文件里的绝对页号） */
export interface LetterPages {
  /** 发函用印件里这一封占的页区间 */
  sent: PageRange
  /** 回函件里这一封占的页区间 */
  replied: PageRange
}

/**
 * 函证编号 → 该封在这对样例里的整封页区间。
 *
 * 只有这三封是**真实对应**的（发函用印件里就是它们自己）；其余记录交给
 * `LETTER_PAGES_BY_SAMPLE` 按其所用样例取（拼接件走 `DEFAULT_LETTER_PAGES`，
 * 与识别批次 A 的三段切分同一口径；单封样例整份即这一封）。
 *
 * 每张**子表**落在文件哪一页由 mock 侧给出「**该封内的相对页号**」，再用这里的起点
 * 换算成绝对页号 —— 这样同一份 `AiVerification` 常量被多封记录共用时也不会串页。
 */
export const CSWL_LETTER_PAGES: Record<string, LetterPages> = {
  whzf0010002: { sent: { start: 1, end: 2 }, replied: { start: 1, end: 3 } }, // 中信证券 ← cswl05260001
  whzf0010004: { sent: { start: 3, end: 4 }, replied: { start: 4, end: 6 } }, // 国泰君安 ← cswl05260002
  whzf0010003: { sent: { start: 5, end: 6 }, replied: { start: 7, end: 9 } }, // 华泰证券 ← cswl05260003
}

/** 未单列的往来记录 —— 复用第一封（与识别批次 A 的段序一致） */
export const DEFAULT_LETTER_PAGES: LetterPages = {
  sent: { start: 1, end: 2 },
  replied: { start: 1, end: 3 },
}

/**
 * 各**样例文件**里「一封函证」占的页区间 —— 供没有单列页区间的记录使用。
 *
 * 上面这对是**多封拼接件**，必须按段取；而单封样例（`wanglai` 那份 2 页印章件、
 * 齐商银行 4 页扫描件）**整份就是这一封** —— 若一律套用拼接件的默认段，
 * 会出现「本封第 1-3 页」而文件总共只有 2 页这种自相矛盾的标注。
 */
const LETTER_PAGES_BY_SAMPLE: Record<string, LetterPages> = {
  'wanglai-1-SJ01YF001.pdf': { sent: { start: 1, end: 2 }, replied: { start: 1, end: 2 } },
  'bank-qishang-20240331.pdf': { sent: { start: 1, end: 4 }, replied: { start: 1, end: 4 } },
}

/** 取某封函证在该记录所用样例里的整封页区间 */
export function letterPagesOf(confirmationNo: string): LetterPages {
  return (
    CSWL_LETTER_PAGES[confirmationNo] ??
    LETTER_PAGES_BY_SAMPLE[sampleFileOf(confirmationNo)] ??
    DEFAULT_LETTER_PAGES
  )
}

/**
 * 取某封函证的**发函用印件**文件名。
 *
 * 三段判断都不涉及函证类型 —— 银行函证要不要铺这一栏，由调用方查
 * `TYPE_RULE[type].sentFilePreview` 决定（沿用「类型差异一律查表」的既有约定）：
 * · 三封真实对应的 → 用这对的发函用印件；
 * · 回函件本就走这对样例的（含未单列、走 `DEFAULT_LETTER_PAGES` 的那些）→ 发函件也用这对的；
 * · 其余（如 `whzf0010005`，它的回函件是另一份印章样例）→ **复用该记录自己的样例**，
 *   以免左栏两件变成「两封毫不相干的信」。真实环境按函证编号取件，不存在这一回退。
 */
export function sentSampleFileOf(confirmationNo: string): string {
  if (CSWL_LETTER_PAGES[confirmationNo]) return FAHAN_CSWL0526
  if (sampleFileOf(confirmationNo) === HUIHAN_CSWL0526) return FAHAN_CSWL0526
  return sampleFileOf(confirmationNo)
}

/** 取某封函证对应的可下载文件地址（KKFileView 会去拉这个地址） */
export function sampleFileUrlOf(confirmationNo: string): string {
  return `${FILE_HOST}/samples/${sampleFileOf(confirmationNo)}`
}

/* ------------------------------------------------------------------ */
/* 快递面单样例（独立单页扫描件）                                        */
/* ------------------------------------------------------------------ */

/**
 * 面单样例目录。
 *
 * **快递面单不是一个单独上传的文件，而是回函文件里的一页** —— 但界面上只看面单
 * （「回函快递信息」弹窗左侧），因此这里直接放**单页的面单扫描件**，让预览只渲染这一页、
 * 不把整份回函附件铺出来。真实环境里面单地址由「快递面单识别」读出并回传，本表只用于演示。
 *
 * 目录内文件名与函证编号的对应关系（**快递面单样例按约定保留**）：
 * · `face-sheet-0010005.pdf` ← `csyhhz0010005.pdf`（顺丰面单，尾号映射到 whzf0010005）
 * · `face-sheet-0010014.pdf` ← `csyhhz0010014.pdf`（顺丰面单，演示数据暂无同尾号函证，预留）
 * · `face-sheet-1.pdf`       ← `测试快递面单1.pdf`（通用样例）
 * · `face-sheet-2.pdf`       ← `测试快递面单2.pdf`（通用样例）
 * · `face-sheet-none.pdf`    ← `csyhhz0010016（无）.pdf`（该函证「无面单」的标记件，不参与映射）
 */
const FACE_SHEET_DIR = '/samples/faceSheets/'

/**
 * 按函证编号**单独指定**的面单样例；`null` = 该函证明确「无面单」，左侧渲染空态。
 *
 * **银行侧自 v2.83 起也有面单了**（原注释「银行函证回函通常不含快递面单」已过期）：
 * 一个包裹一张面单、覆盖同包裹的那几封。演示批次 B 是**齐商银行按年度回的 4 封**
 * （21 / 22 / 23 / 24 年 1-6 月）装在**同一个快递**里寄回 —— 所以这 4 封**指向同一张面单**，
 * 这正是「一个快递单号对应多个函证编号」在预览上的样子。
 */
const FACE_SHEET_BY_CONFIRMATION: Record<string, string | null> = {
  whzf0010005: 'face-sheet-0010005.pdf',
  whzf0010014: 'face-sheet-0010014.pdf',
  /*
   * 这一封的快递单号在演示数据里就是「**条码读不出、要人工填**」（见 `SplitPanel` 的未识别态）——
   * 那就该给它一张**真正读不出条码**的面单（`csyhhz0010016`，文件名就叫 none），
   * 否则界面说"条码未读出"、旁边却摊着一张清晰可读的面单，素材与文案自相矛盾。
   */
  whzf0010003: 'face-sheet-none.pdf',
  /*
   * **演示批次 B（v3.25：四家银行各一个包裹，每包 4 封 3 页 + 末页一张面单）** ——
   * 编号 → 该包裹那张面单样例。三处必须一致：本表、`buildBatchB` 的 `PACKAGES`、
   * `FACE_SHEET_PAGES_BY_FILE`（页 → 样例）。
   * · 齐商：016 / 017 / 018 / 031（对应 2021 / 2022 / 2023 / 2024 一季度）→ 包裹 1，顺丰 `SF5128690159893`；
   * · 中信：ZX2024-011…014 → 包裹 2，顺丰 `SF0258034404761`；
   * · 浦发：PF2024-011…014 → 包裹 3，极兔 `JT3156541182381`；
   * · 招商：ZS2024-011…014 → 包裹 4，极兔 `JT3156563392581`。
   * 「招商 2024 年 1-6 月」那封在演示里**待人工指定**（还没有编号）—— 它的预览按**页**落到
   * 包裹 4 那张（见下表），不需要在这里预判它归给谁。
   */
  'QS2024-016': 'face-sheet-0010014.pdf',
  'QS2024-017': 'face-sheet-0010014.pdf',
  'QS2024-018': 'face-sheet-0010014.pdf',
  'QS2024-031': 'face-sheet-0010014.pdf',
  'ZX2024-011': 'face-sheet-0010005.pdf',
  'ZX2024-012': 'face-sheet-0010005.pdf',
  'ZX2024-013': 'face-sheet-0010005.pdf',
  'ZX2024-014': 'face-sheet-0010005.pdf',
  'PF2024-011': 'face-sheet-1.pdf',
  'PF2024-012': 'face-sheet-1.pdf',
  'PF2024-013': 'face-sheet-1.pdf',
  'PF2024-014': 'face-sheet-1.pdf',
  'ZS2024-011': 'face-sheet-2.pdf',
  'ZS2024-012': 'face-sheet-2.pdf',
  'ZS2024-013': 'face-sheet-2.pdf',
  'ZS2024-014': 'face-sheet-2.pdf',
}

/**
 * 通用面单样例池 —— 未单独指定的函证按**编号稳定取一张**（不用随机数，
 * 同一封函证每次进入看到的都是同一张面单，截图与演示可复现）。
 */
const FACE_SHEET_POOL = ['face-sheet-1.pdf', 'face-sheet-2.pdf']

/** 由函证编号算一个稳定下标 */
function stableIndex(seed: string, mod: number): number {
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) % 997
  return sum % mod
}

/**
 * 取某封函证的快递面单样例地址；`null` = 无面单（调用方据此显示空态，
 * 而不是退回展示函证正文）。
 */
export function faceSheetUrlOf(confirmationNo: string): string | null {
  const hit = FACE_SHEET_BY_CONFIRMATION[confirmationNo]
  if (hit === null) return null
  const file = hit ?? FACE_SHEET_POOL[stableIndex(confirmationNo, FACE_SHEET_POOL.length)]
  return `${FACE_SHEET_DIR}${file}`
}

/**
 * 某份**回函文件**所携带的那张面单（v2.84）—— 按文件名给。
 *
 * 为什么还需要一个"按文件"的入口：**面单页要在切分板里显示** —— 那一刻用户还没指定归属，
 * `faceSheetUrlOf(函证编号)` 根本无从查起（编号还是「待指定」）。所以墙上"哪一页是面单"
 * 只能**按文件**去找它的面单样例。
 *
 * **v3.24 起它只是"兜底"**：一份文件里可以有多个包裹、每张面单各不相同（演示批次 B 是 4 张），
 * 逐页对应关系由下面的 `FACE_SHEET_PAGES_BY_FILE` 给；这里这一条是给**没有逐页样例**的页兜底的
 * （用户自己手工标出来的面单页，见 `AssignView` 的取图逻辑）。
 *
 * 往来不需要它：往来的面单页是各段自己的尾页、与函证正文在同一份文件里，墙按原文件渲染即可。
 */
const FACE_SHEET_BY_FILE: Record<string, string> = {
  '银行函证回函-20240913.pdf': 'face-sheet-0010014.pdf',
}

export function faceSheetUrlOfFile(fileName: string): string | null {
  const file = FACE_SHEET_BY_FILE[fileName]
  return file ? `${FACE_SHEET_DIR}${file}` : null
}

/**
 * 演示文件里**哪几页是面单页**（v2.85）—— 页面号 → 面单样例。
 *
 * 为什么需要一个"页 → 面单文件"的表：银行一份件里可能有**不止一个包裹**
 * （演示批次 B 是 **4 个包裹**、各带一张面单），而这几张面单的**识别结局不同**
 * —— 3 张读出来了、1 张没读出来要人工填，这正是要讲的那套逻辑。
 *
 * v3.25 的对应关系（与 `buildBatchB` 的 `PACKAGES`、`FACE_SHEET_BY_CONFIRMATION` 必须一致）：
 * 每包 = 4 封 × 3 页 + **末页一张面单**，故面单页就是每包的**第 13 / 26 / 39 / 52 页**：
 * · 第 13 页 = 包裹 1 齐商（顺丰 `SF5128690159893`）→ `face-sheet-0010014.pdf`
 * · 第 26 页 = 包裹 2 中信（顺丰 `SF0258034404761`）→ `face-sheet-0010005.pdf`
 * · 第 39 页 = 包裹 3 浦发（极兔 `JT3156541182381`）→ `face-sheet-1.pdf`
 * · 第 52 页 = 包裹 4 招商（极兔 `JT3156563392581`）→ `face-sheet-2.pdf` —— **这一张读不出**
 *   （图仍是清晰件：演示时要人能照着它把号读出来、填进去）
 *
 * ⚠️ 面单图是**真扫描件**，页上的运单号是印死的 —— 改数据里的单号必须同时换这张图。
 */
const FACE_SHEET_PAGES_BY_FILE: Record<string, Record<number, string>> = {
  '银行函证回函-20240913.pdf': {
    13: 'face-sheet-0010014.pdf',
    26: 'face-sheet-0010005.pdf',
    39: 'face-sheet-1.pdf',
    52: 'face-sheet-2.pdf',
  },
}

/** 该文件里被当作**面单页**的页码（按文件给；往来为空 —— 它的面单页是各段尾页、不单独成段） */
export function faceSheetPagesOfFile(fileName: string): number[] {
  const map = FACE_SHEET_PAGES_BY_FILE[fileName]
  return map ? Object.keys(map).map(Number).sort((a, b) => a - b) : []
}

/** 某一份文件的**第 N 页**该从哪个面单样例取图；`null` = 不是面单页（照常从上传件取） */
export function faceSheetUrlOfPage(fileName: string, page: number): string | null {
  const file = FACE_SHEET_PAGES_BY_FILE[fileName]?.[page]
  return file ? `${FACE_SHEET_DIR}${file}` : null
}

/**
 * 构造 KKFileView 预览地址。
 *
 * `url` 参数需先 Base64 再整体 URL 编码；文件名含中文时须先 encodeURIComponent，
 * 否则 `window.btoa` 会抛异常。
 */
export function buildKkPreviewUrl(fileUrl: string): string {
  const base64 = window.btoa(encodeURIComponent(fileUrl))
  return `${KKFILEVIEW_BASE}/onlinePreview?url=${encodeURIComponent(base64)}`
}

/** 浏览器视角的样例文件地址（同源相对路径，由 Vite 伺服 public/samples/；pdf.js 渲染用） */
export function browserSampleUrlOf(confirmationNo: string): string {
  return `/samples/${sampleFileOf(confirmationNo)}`
}

/** 发函用印件的浏览器取件地址 —— 与回函件同一套渲染链路（见 `browserSampleUrlOf`） */
export function browserSentSampleUrlOf(confirmationNo: string): string {
  return `/samples/${sentSampleFileOf(confirmationNo)}`
}

/**
 * 按**上传文件名**取样例地址（v2.56）。
 *
 * 为何需要它：识别工作台的「归属匹配」要在**归属尚未确定**时就预览原始回函 ——
 * 而那一刻任务还没有 `confirmationNo`（值为「待指定」），走不了按编号取件的老路。
 * 银行函证的回函本就是**银行自行出具的扫描件**、与系统内函证无编号关联，
 * 「按上传文件名」才是它天然的取件方式（同一份上传件切出的各段共用同一个文件名）。
 */
const SAMPLE_BY_UPLOAD_NAME: Record<string, string> = {
  /* 银行批次的上传件 —— 样例就是齐商银行那份扫描回函（11 页） */
  '银行函证回函-20240913.pdf': BANK_QISHANG,
  '银行回函_20240913.pdf': BANK_QISHANG,
}

/** 按文件名取浏览器可用的样例地址；未登记的文件退回通用样例 */
export function browserSampleUrlByFileName(fileName: string): string {
  return `/samples/${SAMPLE_BY_UPLOAD_NAME[fileName] ?? DEFAULT_SAMPLE_FILE}`
}

/** 某封函证的真实预览地址 */
export function kkPreviewUrlOf(confirmationNo: string): string {
  return buildKkPreviewUrl(sampleFileUrlOf(confirmationNo))
}

/*
 * 原 `PreviewMode` / `DEFAULT_PREVIEW_MODE`（`original` | `annotated` 视图切换）已于 **v3.35 删除** ——
 * 用户口径：「整体，去掉原始文件 / ai批注这个功能，全局」。批注层现在**恒为显示**，
 * "要不要批注"由调用方传不传 `sealBoxes` / `showRegions` / `handwriting` 决定（见 `components/PdfPreview`）。
 */
/** KKFileView 未就绪时的提示文案 */
export const KK_NOT_READY_HINT = `无法连接 KKFileView（${KKFILEVIEW_BASE}）。请确认容器已启动且端口已映射。`
