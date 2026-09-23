/**
 * 文件预览配置
 * ------------------------------------------------------------------
 * **当前预览统一走 pdf.js**：三个真实样例 PDF 放在 `public/samples/` 下，由 Vite dev server
 * 以 HTTP 提供，浏览器端用 pdf.js 自渲染（`AnnotatedPdfPreview`）。
 * 「原始文件 / AI 批注」两个视图**共用同一画布** —— 这样才能在原件之上叠加坐标批注层，
 * 且两个视图样式完全一致、切换零闪动。
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
 *           host.docker.internal:5178/samples/xxx.pdf   ← 容器视角的「宿主机」
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

/** Vite dev server 端口（见 vite.config.ts） */
export const DEV_SERVER_PORT = 5178

/** KKFileView 容器访问本机文件的地址前缀（容器视角的宿主机） */
export const FILE_HOST = `http://host.docker.internal:${DEV_SERVER_PORT}`

/* ------------------------------------------------------------------ */
/* 函证 → 真实样例文件映射                                             */
/* ------------------------------------------------------------------ */

/** 齐商银行回函（银行函证，无文本层的扫描件；银行函证不检测手写体，样例不涉及手写区标注） */
const BANK_QISHANG = 'bank-qishang-20240331.pdf'
/** 往来函证真实回函（印章 + 手写体演示件 —— 手写体演示件为往来函证样例） */
const WANGLAI_SEAL = 'wanglai-1-SJ01YF001.pdf'
/** 往来函证拼接回函（9 页，含文本层，覆盖大多数演示记录） */
const HUIHAN_0813 = 'huihan-0813.pdf'

const SAMPLE_BY_CONFIRMATION: Record<string, string> = {
  'QS2024-031': BANK_QISHANG,
  whzf0010005: WANGLAI_SEAL,
}

/** 未单独指定的函证统一使用往来函证拼接回函样例 */
export const DEFAULT_SAMPLE_FILE = HUIHAN_0813

/** 取某封函证对应的样例文件名 */
export function sampleFileOf(confirmationNo: string): string {
  return SAMPLE_BY_CONFIRMATION[confirmationNo] ?? DEFAULT_SAMPLE_FILE
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
 * 目录内文件与原样例的对应关系（原文件位于 `01_售前演示数据/标准数据/快递面单/`）：
 * · `face-sheet-0010005.pdf` ← `csyhhz0010005.pdf`（顺丰面单，尾号映射到 whzf0010005）
 * · `face-sheet-0010014.pdf` ← `csyhhz0010014.pdf`（顺丰面单，演示数据暂无同尾号函证，预留）
 * · `face-sheet-1.pdf`       ← `测试快递面单1.pdf`（通用样例）
 * · `face-sheet-2.pdf`       ← `测试快递面单2.pdf`（通用样例）
 * · `face-sheet-none.pdf`    ← `csyhhz0010016（无）.pdf`（该函证「无面单」的标记件，不参与映射）
 */
const FACE_SHEET_DIR = '/samples/faceSheets/'

/**
 * 按函证编号**单独指定**的面单样例；`null` = 该函证明确「无面单」，左侧渲染空态
 * （银行函证回函由银行自行出具、通常不含快递面单）。
 */
const FACE_SHEET_BY_CONFIRMATION: Record<string, string | null> = {
  whzf0010005: 'face-sheet-0010005.pdf',
  whzf0010014: 'face-sheet-0010014.pdf',
  'QS2024-031': null,
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

/**
 * 预览视图。
 * `original` = 只渲染回函原件；`annotated` = 同一份原件之上叠加 AI 批注层。
 * 两者共用同一套 pdf.js 渲染（同一个画布），切换只显隐批注层。
 */
export type PreviewMode = 'original' | 'annotated'

/** 默认视图 —— 先看原件，需要核对 AI 判定时再切「AI 批注」 */
export const DEFAULT_PREVIEW_MODE: PreviewMode = 'original'

/** KKFileView 未就绪时的提示文案 */
export const KK_NOT_READY_HINT = `无法连接 KKFileView（${KKFILEVIEW_BASE}）。请确认容器已启动且端口已映射。`
