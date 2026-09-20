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

/** 齐商银行回函（银行函证，无文本层的扫描件） */
const BANK_QISHANG = 'bank-qishang-20240331.pdf'
/** 往来函证真实回函（印章 + 手写体演示件） */
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
