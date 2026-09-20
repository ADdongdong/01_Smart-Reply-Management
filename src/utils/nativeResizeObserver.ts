/**
 * `resize-observer-polyfill` 的原生替身（由 vite 的 resolve.alias 顶上）。
 *
 * ## 为什么要顶掉它（2026-09-20）
 *
 * AntD 的 `rc-resize-observer` **无条件** `import ResizeObserver from 'resize-observer-polyfill'`
 * —— 也就是说本项目里 AntD 从来没有用过浏览器原生的 `ResizeObserver`，
 * 而当前 `resize-observer-polyfill@1.5.1` 内部**自己也调用 `getBoundingClientRect`**（3 处），
 * 并维护一张元素登记表来做「临时元素」测量。
 *
 * 元素卸载与它内部轮询之间的竞态，正是这几天反复出现在 IDE 预览面板里的
 * `Cannot read properties of null (reading 'getBoundingClientRect')` 的经典来源。
 *
 * 项目的目标运行环境（Chrome / Electron / IDE 内嵌 WebView）全部是 Chromium，
 * 原生早已支持该 API；这个 polyfill 只在 IE11 / 老 Safari 一类环境才有意义。
 * 所以整体换成原生实现：**行为一致，但少一层 JS 轮询与登记表，也就少一类竞态**。
 *
 * ## 兼容性说明
 *
 * 若将来确实需要跑在没有原生 API 的环境，把下面的 `FallbackResizeObserver`
 * 换回 polyfill 实现即可（届时也应重新评估上面那类竞态）。
 */
const FallbackResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const NativeResizeObserver: typeof ResizeObserver =
  typeof window !== 'undefined' && typeof window.ResizeObserver === 'function'
    ? window.ResizeObserver
    : FallbackResizeObserver

export default NativeResizeObserver
