import * as pdfjsLib from 'pdfjs-dist'

/**
 * pdf.js 的两处**必需配置**（v2.87 补上）—— 扫描件能不能显示出来，全靠它们。
 *
 * ## 起因
 *
 * 22 页的银行演示件里后几页一直空白，控制台里只有一句被 `catch` 吞掉的
 * `Dependent image isn't ready yet`（见 `PageSplitBoard` 的缩略图循环）。查明真因是**图像解码器没配**：
 *
 * · 扫描件的图像多是 **JBIG2** 编码（扫描仪的标准做法），pdf.js 6 要 **wasm 解码器**才能解；
 *   不配就一直"等图"，**那一页永远画不出来**（不是慢，是永远不会好）。
 * · worker 也没配（`Setting up fake worker`）→ 退回主线程解析，慢且部分能力缺失。
 *
 * 两个坑在演示里特别容易踩到：**样例件全是扫描件**，而"页面空白"这种症状看起来像渲染逻辑的问题，
 * 实际是资源没配。
 *
 * ## `public/pdfjs/` 里的东西
 *
 * 从 `node_modules/pdfjs-dist` 拷来（见该目录）：
 * · `wasm/` —— JBIG2 / JPEG2000 / ICC 的解码器（**关键**，另含无 wasm 的 JS 回退实现）
 * · `standard_fonts/` —— PDF 内置字体（文字层不依赖用户系统装了什么字体）
 * · `pdf.worker.min.mjs` —— 真正的 worker
 *
 * 拷到 `public/` 而不是用 `?url` 导入，是为了**不引入构建期类型/路径的额外依赖**：
 * 这三处都是静态资源，直接给字符串地址最稳。
 */
/*
 * 用**绝对地址**（带 origin）而不是 `/pdfjs/`：pdf.js 取 wasm / 字体时若在一个
 * `blob:` 之类的作用域里解析相对路径，相对地址会取不到（实测报 `Unable to load wasm data at: /pdfjs/...`，
 * 而同一个地址用 HTTP 直接取是 200 —— 说明问题出在"谁来解析这个相对路径"上，而不是文件不存在）。
 */
export const PDF_ASSET_DIR =
  typeof window === 'undefined' ? '/pdfjs/' : new URL('/pdfjs/', window.location.origin).href

/*
 * worker：直接用发布包里的 worker 文件（**绝对地址**，免得 pdf.js 在某些作用域里解析相对路径失败）。
 *
 * ## 2026-09-30 排查记录（试过的两条路都失败，别重走）
 *
 * 症状：`Setting up fake worker` + `Unable to load wasm data at: /pdfjs/wasm/jbig2.wasm`
 * + `Failed to fetch dynamically imported module: .../jbig2_nowasm_fallback.js?import`。
 * 后果有两层，**同一个根**：依赖这些图像的页**一片空白**；图像"待就绪"导致 pdf.js 反复重试
 * → 连正常页也在**反复重绘**（用户看到"小图标一直闪"）。
 *
 * · **试过 1：Vite 的 `?worker` + `workerPort`** → worker 是起来了，但**整面墙全部画不出来**
 *   （22 页全是空白画布），退回本方案。
 * · **试过 2：把 wasmUrl 换成绝对地址** → 报错里的地址确实变成了绝对，但**照样取不到**。
 *
 * **已确认的关键事实**（下一步就靠它定位）：在页面里直接
 * `fetch('/pdfjs/wasm/jbig2.wasm')` → **200 / application/wasm / 104852 字节** ——
 * **文件完全可取**，所以问题不在"文件放哪"，而在 **pdf.js 内部那条 wasm 加载路径本身**
 * （`Setting up fake worker` 时它走的是主线程回退路径）。
 *
 * 下一步三选一：`optimizeDeps`（pdfjs-dist 预打包与否）、把 wasm 目录经**别名**指向 node_modules、
 * 或加一段**dev middleware** 直出这几个文件（后者只在 dev 生效，build 需另想办法）。
 */
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDF_ASSET_DIR}pdf.worker.min.mjs`

/**
 * 统一的 `getDocument` 初始化参数 —— **所有加载 pdf 的地方都用它**，不要各写各的
 * （漏一个就是"某些页空白"，而且报错在控制台角落里，很难联想到是配置问题）。
 */
export const PDF_INIT = {
  wasmUrl: `${PDF_ASSET_DIR}wasm/`,
  standardFontDataUrl: `${PDF_ASSET_DIR}standard_fonts/`,
} as const

export { pdfjsLib }
