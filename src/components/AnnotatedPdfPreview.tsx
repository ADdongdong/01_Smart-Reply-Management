import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Divider, Dropdown, Spin, Tooltip } from 'antd'
import {
  ColumnWidthOutlined,
  FilePdfOutlined,
  FullscreenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import * as pdfjsLib from 'pdfjs-dist'

// pdf.js 6.x 的解析代码依赖若干 ES2024 新 API（Uint8Array 文本编解码、Map upsert 等），
// 尚未普及的浏览器内核需要按官方 polyfill 惯例补齐
type HexB64 = { toHex?: () => string; fromHex?: (hex: string) => Uint8Array; toBase64?: () => string; fromBase64?: (b64: string) => Uint8Array }
const u8 = Uint8Array.prototype as Uint8Array & HexB64
if (!u8.toHex) {
  u8.toHex = function () {
    return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('')
  }
}
if (!u8.toBase64) {
  u8.toBase64 = function () {
    return btoa(String.fromCharCode(...Array.from(this)))
  }
}
const mapProto = Map.prototype as Map<unknown, unknown> & {
  getOrInsert?: (key: unknown, value: unknown) => unknown
  getOrInsertComputed?: (key: unknown, insert: (key: unknown) => unknown) => unknown
}
if (!mapProto.getOrInsert) {
  mapProto.getOrInsert = function (key, value) {
    if (!this.has(key)) this.set(key, value)
    return this.get(key)
  }
}
if (!mapProto.getOrInsertComputed) {
  mapProto.getOrInsertComputed = function (key, insert) {
    if (!this.has(key)) this.set(key, insert(key))
    return this.get(key)
  }
}

// 主线程 fake worker：pdf.worker.mjs 会把 WorkerMessageHandler 挂到 globalThis.pdfjsWorker，
// pdf.js 检测到后自动改走主线程（LoopbackPort），规避打包环境下 module worker 的兼容问题
// （演示文件仅数页，主线程解析性能完全够用；生产接入后端时恢复真实 worker 即可）
import 'pdfjs-dist/build/pdf.worker.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { SealBox } from '@/types'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 5
const ZOOM_STEP = 1.25
/** 页面间距与容器内边距 */
const PAGE_GAP = 12
const PAD = 16
/** 缩放停手后才按新比例重渲染（缩放过程先用 CSS 拉伸撑住视觉，避免连续重渲染卡顿） */
const RERENDER_DEBOUNCE = 260

/** 落章区域与手写区所在的页（真实实现由版面分析服务按页输出） */
const ANNOTATION_PAGE = 1

/**
 * 落章区域 / 手写区的演示坐标（真实实现中由版面分析服务按页输出）。
 * 坐标为页面百分比，与缩放解耦 —— 放大缩小时批注始终贴合文件内容。
 * 当前按样例件 wanglai-1-SJ01YF001.pdf 的标准询证函版式校准（底部左右两个签章栏）。
 */
const REGION_BOX: Record<
  '信息证明无误区' | '信息不符区',
  { left: string; top: string; width: string; height: string }
> = {
  信息证明无误区: { left: '2%', top: '75.5%', width: '45.5%', height: '14%' },
  信息不符区: { left: '48.5%', top: '75.5%', width: '38%', height: '14%' },
}

/** 手写差异说明通常写在「信息不符」栏内 —— 演示坐标取该栏内圈。
 *  仅当 `handwriting` 文案传入时才绘制该标注框；**银行函证不检测手写体，
 *  调用方（按 TYPE_RULE[record.type].detectHandwriting 查表）不传该 prop，此处即不会出现手写区框。 */
const HANDWRITING_BOX = { left: '50%', top: '77%', width: '35%', height: '11.5%' }

const PRESET_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const clamp = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))

type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

/**
 * 真实 PDF 渲染 + AI 批注叠加层 —— 回函预览的唯一渲染器。
 *
 * 特性：
 * · **多页连续滚动** —— 逐页垂直排列，像 PDF 阅读器一样上下滚（回函常见 2~9 页）；
 * · **懒渲染** —— 只有进入（或接近）视口的页才真正绘制，长文件不卡；
 * · **缩放** —— 工具条与 Ctrl+滚轮 / 触控板捏合，默认「适应宽度」（回函文字小，适宽最易读）；
 * · **批注随缩放同步** —— 批注用页面百分比定位，缩放与滚动时自动贴合，无需重算坐标。
 *
 * 缩放过程先用 CSS 拉伸已渲染的 canvas 撑住视觉，停手后按新比例重渲染以保证清晰度。
 *
 * · **可只渲染一页**（`singlePage`）—— 用于「只看这一页」的场景（如快递面单预览）：
 *   其余页不进 DOM、页码指示为 `1 / 1`，「适应宽度 / 适应页面」也只按这一页算。
 */
export default function AnnotatedPdfPreview({
  fileUrl,
  page = 1,
  height = 420,
  sealBoxes = [],
  showRegions = false,
  activeRegion,
  handwriting,
  singlePage,
  markRange,
}: {
  fileUrl: string
  /** 打开时定位到的页（默认第 1 页） */
  page?: number
  /**
   * 预览高度：传数字为固定像素；传 `'100%'` 时**撑满父容器**。
   *
   * 用在「左固定栏」这类场景（如「回函结果填写」）：左栏高度由窗口决定、且除预览外
   * 只有一行标题，撑满即可 —— 不必去猜一个像素值（猜小了会在下方留一大块空白，
   * 猜大了又会溢出）。内部的 ResizeObserver 会在容器尺寸变化时自动重渲染。
   */
  height?: number | string
  sealBoxes?: SealBox[]
  /** 是否展示「信息证明无误 / 信息不符」两个落章区域 */
  showRegions?: boolean
  activeRegion?: '信息证明无误区' | '信息不符区' | '未识别'
  handwriting?: string
  /**
   * **只渲染指定的一页**（1-based）—— 用于「只看这一页」的场景（如快递面单预览：
   * 面单在回函拼接件里只是一页，不该把整份回函铺出来）。不传 = 渲染全部页。
   */
  singlePage?: number
  /**
   * 待**标记为「本段」**的页区间（v2.56）。
   *
   * 用于「归属匹配」里预览**整份回函**：整份都铺出来（能看到上下文 —— 这一封是从哪几页
   * 切出来的、前后还有什么），同时把属于当前这一段的页**描主色边 + 打角标**。
   * 不传 = 不做任何标记（如 AI 核验页的预览，那里没有"段"的概念）。
   */
  markRange?: { start: number; end: number }
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageElRefs = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const renderTasksRef = useRef<Record<number, { cancel: () => void } | undefined>>({})
  /** 已渲染页 → 渲染时所用的 scale（scale 变化后据此重渲染） */
  const renderedRef = useRef<Map<number, number>>(new Map())
  const scaleRef = useRef(1)

  /** 单页模式的页号（1-based）；`undefined` = 多页模式（默认行为） */
  const single = singlePage && singlePage >= 1 ? Math.floor(singlePage) : undefined

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  /** 各**渲染槽位**的 PDF 点尺寸（缩放基准）；单页模式下只有一项 */
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  /**
   * 各渲染槽位对应的**真实页号**（1-based）—— 渲染、页码指示、批注层筛选都以此为准。
   * 与 `sizes` 一一对应、由加载 effect 同步写入；单页模式下只有一项。
   */
  const [pageNos, setPageNos] = useState<number[]>([])
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width')
  const [scale, setScale] = useState(1)
  /** 页码指示用的是**槽位序号**（单页模式恒为 1） */
  const [currentPage, setCurrentPage] = useState(single ? 1 : page)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [errText, setErrText] = useState('')

  scaleRef.current = scale

  /* ---------------- 加载文档与页尺寸（单页模式只读一页） ---------------- */

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    ;(async () => {
      setLoading(true)
      setFailed(false)
      renderedRef.current.clear()
      try {
        // 先 fetch 全量字节再交给 pdf.js —— 绕开 Range/流式加载，打包环境下更稳
        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error(`样例文件请求失败：HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (cancelled) return
        task = pdfjsLib.getDocument({ data })
        const d: PDFDocumentProxy = await task.promise
        if (cancelled) return
        /*
         * 单页模式只读被指定那页的尺寸 —— 既省一遍逐页解析，
         * 也让「适应宽度 / 适应页面」只按这一页算（不被其它页宽高带偏）。
         */
        const targets = single
          ? [Math.min(Math.max(1, single), d.numPages)]
          : Array.from({ length: d.numPages }, (_, i) => i + 1)
        const list: { w: number; h: number }[] = []
        for (const n of targets) {
          const p = await d.getPage(n)
          const vp = p.getViewport({ scale: 1 })
          list.push({ w: vp.width, h: vp.height })
        }
        if (cancelled) return
        setSizes(list)
        setPageNos(targets)
        setDoc(d)
        setLoading(false)
      } catch (e) {
        console.error('[AnnotatedPdfPreview] 渲染失败：', e)
        if (!cancelled) {
          setErrText(e instanceof Error ? e.message : String(e))
          setFailed(true)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      if (task) void task.destroy()
    }
  }, [fileUrl, single])

  /* ---------------------- 容器尺寸与缩放计算 ---------------------- */

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!sizes.length || !viewport.w || !viewport.h) return
    const maxW = Math.max(...sizes.map((s) => s.w))
    const maxH = Math.max(...sizes.map((s) => s.h))
    if (zoomMode === 'fit-width') {
      setScale(Math.max(0.01, (viewport.w - PAD * 2) / maxW))
    } else if (zoomMode === 'fit-page') {
      setScale(Math.max(0.01, Math.min((viewport.w - PAD * 2) / maxW, (viewport.h - PAD * 2) / maxH)))
    }
  }, [zoomMode, sizes, viewport])

  /* ---------------------- 单页渲染（懒） ---------------------- */

  const renderPage = useCallback(
    async (index: number) => {
      const d = doc
      const canvas = canvasRefs.current[index]
      if (!d || !canvas) return
      const target = scaleRef.current
      if (renderedRef.current.get(index) === target) return
      try {
        const p = await d.getPage(pageNos[index] ?? index + 1)
        if (scaleRef.current !== target) return
        const dpr = window.devicePixelRatio || 1
        const vp = p.getViewport({ scale: target * dpr })
        canvas.width = Math.max(1, Math.floor(vp.width))
        canvas.height = Math.max(1, Math.floor(vp.height))
        renderTasksRef.current[index]?.cancel()
        const task = p.render({ canvas, viewport: vp })
        renderTasksRef.current[index] = task
        await task.promise
        renderedRef.current.set(index, target)
      } catch {
        /* 渲染被取消（缩放/卸载）：下一次进入视口或缩放后会重试 */
      }
    },
    [doc, pageNos],
  )

  /* ---------------------- 懒渲染 + 当前页跟踪 ---------------------- */

  useEffect(() => {
    const root = scrollRef.current
    if (!root || !doc || !sizes.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible: number[] = []
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const idx = Number((e.target as HTMLElement).dataset.pageIndex)
          visible.push(idx)
          void renderPage(idx)
        }
        /*
         * 页码指示取「**可见面积最大**的那一页」：
         * rootMargin 为了预渲染放宽了 400px，若直接取 `min(visible) + 1`，
         * 会把视口外的上一页算进来（表现为「明明在第 3 页却显示 2 / 9」）。
         */
        if (pageElRefs.current.length) {
          const rootRect = root.getBoundingClientRect()
          let bestIdx = Math.min(...visible)
          let bestOverlap = -1
          for (let i = 0; i < pageElRefs.current.length; i++) {
            const el = pageElRefs.current[i]
            if (!el) continue
            const r = el.getBoundingClientRect()
            const overlap = Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top)
            if (overlap > bestOverlap) {
              bestOverlap = overlap
              bestIdx = i
            }
          }
          setCurrentPage(bestIdx + 1)
        }
      },
      { root, rootMargin: '400px 0px' },
    )
    pageElRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [doc, sizes.length, renderPage])

  /* ---------------------- 缩放后按新比例重渲染 ---------------------- */

  useEffect(() => {
    if (!doc) return
    const t = setTimeout(() => {
      renderedRef.current.forEach((_, idx) => void renderPage(idx))
    }, RERENDER_DEBOUNCE)
    return () => clearTimeout(t)
  }, [scale, doc, renderPage])

  /* ---------------------- 打开时定位到指定页 ---------------------- */

  /**
   * 打开时定位到指定页。
   *
   * **必须等各页高度算出来再滚**：`sizes` 是逐页异步读出的，若在 `doc` 刚就绪时
   * 就 `scrollIntoView`，目标页此刻高度为 0（尚未撑开），滚动会落在错误的页上
   * （实测会偏到后面几页）。因此这里等到目标页元素有了真实高度再滚，
   * 并用 rAF 重试兜住懒渲染的时序。
   *
   * **单页模式直接短路** —— 只有一个渲染槽位，无需滚动定位。
   */
  useEffect(() => {
    if (!doc || single || page <= 1) return

    /**
     * 目标页 —— **钳到文件的实际页数**（v2.56）。
     *
     * 演示环境里样例文件与演示数据的页数**并不一致**：银行样例
     * `bank-qishang-20240331.pdf` 只有 4 页，而演示数据把它当 11 页用
     * （切分成 1-4 / 5-8 / 9-11）。此时若照 `page` 定位，「第 5 页」永远不存在 ——
     * 表现为「传了页码却停在第 1 页」，且**不会报错**，只有对着截图才发现。
     * 钳到末页至少让用户停在文件末尾（看得见"文件就是这么长"），
     * 比停在第 1 页误导性小。真实文件不会出现越界。
     */
    const targetPage = sizes.length ? Math.min(page, sizes.length) : page

    /** 直接把滚动容器滚到目标页（用 rect 差值，不依赖 offsetParent 与 scrollIntoView 的时序） */
    const jump = (): boolean => {
      const scroller = scrollRef.current
      if (!scroller) return false

      const target = pageElRefs.current[targetPage - 1]
      if (target && target.getBoundingClientRect().height > 0) {
        const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        scroller.scrollTop += delta - PAD
        return true
      }

      /*
       * 目标页**尚未挂载** —— 懒渲染只为可视区附近的页创建元素，滚动之前
       * `pageElRefs[targetPage-1]` 是 `null`。原实现此时直接 `return false` 并靠 rAF 重试，
       * 但**不滚就永远不会渲染、不渲染就永远滚不到**，重试到放弃。
       *
       * 改法：没有元素可测时，用 `sizes`（各页 PDF 点尺寸，**全量**、与页数等长）
       * 累加出目标页的 Y 偏移 —— 页高 × 缩放 + 页间距，与列表的垂直排布一致。
       * 滚到位后懒渲染自然会把该页渲染出来。
       */
      const idx = targetPage - 1
      if (sizes.length <= idx) return false
      let y = PAD
      for (let i = 0; i < idx; i++) y += sizes[i].h * scale + PAGE_GAP
      scroller.scrollTop = y
      return true
    }

    if (jump()) {
      /*
       * 弹窗打开动画 / 懒渲染会在随后几百毫秒内继续改变布局，
       * 只跳一次会在动画结束后落偏（实测偏到后面几页），因此再校正两次。
       */
      const t1 = window.setTimeout(jump, 180)
      const t2 = window.setTimeout(jump, 520)
      return () => {
        window.clearTimeout(t1)
        window.clearTimeout(t2)
      }
    }

    /* 目标页高度尚未算出来 → rAF 重试 */
    let raf = 0
    let tries = 0
    const tick = () => {
      if (!jump() && tries++ < 40) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [doc, page, sizes, single, scale])

  /* ---------------------- Ctrl + 滚轮 / 触控板捏合缩放 ---------------------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoomMode('custom')
      setScale((s) => clamp(s * (e.deltaY > 0 ? 0.92 : 1.08)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number) => {
    setZoomMode('custom')
    setScale((s) => clamp(s * factor))
  }

  /* ---------------------- 落章区域框 ---------------------- */

  /**
   * 落章区域框 —— 命中项按相符性着色：
   * 「信息证明无误」命中 = 相符（绿），「信息不符」命中 = 不相符（红），未命中为中性虚线。
   *
   * 标签定位约定（**防遮挡**）：区域框（大）的标签贴**右上角外侧**，
   * 印章定位框的标签贴**左上角外侧** —— 两者在页面上经常互相套叠（印章本就落在签章栏内），
   * 标签分置左右两侧才能保证互不遮挡，后续新增标注元素也应遵循「同类元素错开贴边」的原则。
   */
  const regionBox = (key: '信息证明无误区' | '信息不符区') => {
    const active = activeRegion === key
    const ok = key === '信息证明无误区'
    const tone = ok ? 'var(--c-risk-low)' : 'var(--c-risk-high)'
    const toneBg = ok ? 'var(--c-risk-low-bg)' : 'var(--c-risk-high-bg)'
    return (
      <div
        key={key}
        style={{
          position: 'absolute',
          ...REGION_BOX[key],
          border: `1.5px ${active ? 'solid' : 'dashed'} ${active ? tone : 'var(--c-text-3)'}`,
          background: active ? toneBg : 'transparent',
          borderRadius: 4,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: -18,
            right: 4,
            fontSize: 10,
            lineHeight: '15px',
            padding: '0 5px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            color: '#fff',
            background: active ? tone : 'var(--c-text-2)',
          }}
        >
          {key}
        </span>
        {active && (
          <span
            style={{
              position: 'absolute',
              bottom: -18,
              right: 4,
              fontSize: 10,
              fontWeight: 700,
              color: tone,
              whiteSpace: 'nowrap',
            }}
          >
            ← 印章落于此区
          </span>
        )}
      </div>
    )
  }

  const numPages = pageNos.length

  /** 该渲染槽位是否落在待标记的页区间内（单页模式下槽位对应单页，同样适用） */
  const isMarked = (i: number) => {
    if (!markRange) return false
    const p = pageNos[i]
    return p >= markRange.start && p <= markRange.end
  }

  return (
    <div style={{ position: 'relative', height }}>
      {/* 滚动容器 —— 多页垂直排列，缩放时用 CSS 拉伸已渲染页撑住视觉 */}
      <div
        ref={scrollRef}
        style={{
          height: '100%',
          overflow: 'auto',
          background: 'var(--c-preview-bg)',
          overscrollBehavior: 'contain',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: PAGE_GAP,
            padding: PAD,
            width: 'fit-content',
            minWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          {sizes.map((s, i) => (
            <div
              key={i}
              data-page-index={i}
              ref={(el) => {
                pageElRefs.current[i] = el
              }}
              className="pdf-canvas"
              style={{
                position: 'relative',
                flexShrink: 0,
                width: Math.round(s.w * scale),
                height: Math.round(s.h * scale),
                background: '#fff',
                /* 本段页描主色边（v2.56）—— 与阴影叠加，既标出范围又不破坏"纸"的观感 */
                boxShadow: isMarked(i) ? `0 0 0 2px var(--c-primary), var(--shadow-card)` : 'var(--shadow-card)',
              }}
            >
              {/*
               * 本段角标（v2.56）—— 贴**页外上方**、靠左。
               * 与页内既有标注错开：落章区域框贴页内右上、印章框贴页内左上、
               * 手写区贴页内左上，本角标在**页框之外**，互不遮挡。
               */}
              {isMarked(i) && (
                <span
                  style={{
                    position: 'absolute',
                    top: -20,
                    left: 0,
                    fontSize: 11,
                    lineHeight: '16px',
                    padding: '0 6px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                    color: '#fff',
                    background: 'var(--c-primary)',
                  }}
                >
                  本段 · 第 {pageNos[i]} 页
                </span>
              )}
              <canvas
                ref={(el) => {
                  canvasRefs.current[i] = el
                }}
                style={{ width: '100%', height: '100%', display: 'block' }}
              />

              {/* —— AI 批注叠加层（页面百分比定位，随缩放自动跟随） —— */}
              {sealBoxes
                .filter((b) => b.page === pageNos[i])
                .map((b, k) => (
                  <div
                    key={k}
                    className={`seal-box${b.abnormal ? ' abnormal' : ''}`}
                    style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                  >
                    <span>{b.label}</span>
                  </div>
                ))}

              {showRegions && pageNos[i] === ANNOTATION_PAGE && (
                <>
                  {regionBox('信息证明无误区')}
                  {regionBox('信息不符区')}
                  {handwriting && (
                    <div
                      style={{
                        position: 'absolute',
                        ...HANDWRITING_BOX,
                        border: '1.5px dashed var(--c-primary)',
                        background: 'var(--c-ai-bg)',
                        borderRadius: 4,
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: -18,
                          left: 4,
                          fontSize: 10,
                          lineHeight: '15px',
                          padding: '0 5px',
                          borderRadius: 3,
                          whiteSpace: 'nowrap',
                          color: '#fff',
                          background: 'var(--c-primary)',
                        }}
                      >
                        手写体识别区
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 缩放工具条 —— 浮动在预览区底部居中，不随内容滚动 */}
      {!failed && !loading && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.98)',
            borderRadius: 8,
            padding: 3,
            boxShadow: 'var(--shadow-pop)',
          }}
        >
          <Tooltip title="缩小">
            <Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={() => zoomBy(1 / ZOOM_STEP)} />
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: PRESET_SCALES.map((v) => ({ key: String(v), label: `${Math.round(v * 100)}%` })),
              onClick: ({ key }) => {
                setZoomMode('custom')
                setScale(clamp(Number(key)))
              },
            }}
          >
            <Button
              type="text"
              size="small"
              className="num"
              style={{ minWidth: 54, paddingInline: 4, fontSize: 13 }}
            >
              {Math.round(scale * 100)}%
            </Button>
          </Dropdown>
          <Tooltip title="放大">
            <Button type="text" size="small" icon={<ZoomInOutlined />} onClick={() => zoomBy(ZOOM_STEP)} />
          </Tooltip>

          <Divider type="vertical" style={{ margin: '0 3px', height: 14 }} />

          <Tooltip title="适应宽度">
            <Button
              type="text"
              size="small"
              icon={<ColumnWidthOutlined />}
              onClick={() => setZoomMode('fit-width')}
            />
          </Tooltip>
          <Tooltip title="适应页面">
            <Button
              type="text"
              size="small"
              icon={<FullscreenOutlined />}
              onClick={() => setZoomMode('fit-page')}
            />
          </Tooltip>
          <Tooltip title="实际大小">
            <Button
              type="text"
              size="small"
              style={{ fontSize: 13, paddingInline: 6 }}
              onClick={() => {
                setZoomMode('custom')
                setScale(1)
              }}
            >
              1:1
            </Button>
          </Tooltip>

          <Divider type="vertical" style={{ margin: '0 3px', height: 14 }} />

          <span className="num" style={{ fontSize: 13, color: 'var(--c-text-3)', padding: '0 6px' }}>
            {currentPage} / {numPages || '—'}
          </span>
        </div>
      )}

      {loading && !failed && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--c-text-3)',
          }}
        >
          <Spin size="small" /> 正在渲染回函文件…
        </div>
      )}
      {failed && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--c-text-3)',
          }}
        >
          <FilePdfOutlined style={{ fontSize: 28, color: 'var(--c-text-3)' }} />
          回函文件渲染失败
          {errText && (
            <span style={{ fontSize: 12, color: 'var(--c-text-3)', maxWidth: '80%', textAlign: 'center' }}>
              {errText}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
