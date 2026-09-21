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
 */
export default function AnnotatedPdfPreview({
  fileUrl,
  page = 1,
  height = 420,
  sealBoxes = [],
  showRegions = false,
  activeRegion,
  handwriting,
}: {
  fileUrl: string
  /** 打开时定位到的页（默认第 1 页） */
  page?: number
  height?: number
  sealBoxes?: SealBox[]
  /** 是否展示「信息证明无误 / 信息不符」两个落章区域 */
  showRegions?: boolean
  activeRegion?: '信息证明无误区' | '信息不符区' | '未识别'
  handwriting?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageElRefs = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const renderTasksRef = useRef<Record<number, { cancel: () => void } | undefined>>({})
  /** 已渲染页 → 渲染时所用的 scale（scale 变化后据此重渲染） */
  const renderedRef = useRef<Map<number, number>>(new Map())
  const scaleRef = useRef(1)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  /** 各页的 PDF 点尺寸（缩放基准） */
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width')
  const [scale, setScale] = useState(1)
  const [currentPage, setCurrentPage] = useState(page)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [errText, setErrText] = useState('')

  scaleRef.current = scale

  /* ---------------------- 加载文档与逐页尺寸 ---------------------- */

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
        const list: { w: number; h: number }[] = []
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i)
          const vp = p.getViewport({ scale: 1 })
          list.push({ w: vp.width, h: vp.height })
        }
        if (cancelled) return
        setSizes(list)
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
  }, [fileUrl])

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
        const p = await d.getPage(index + 1)
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
    [doc],
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
        if (visible.length) setCurrentPage(Math.min(...visible) + 1)
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

  useEffect(() => {
    if (!doc || page <= 1) return
    pageElRefs.current[page - 1]?.scrollIntoView({ block: 'start' })
  }, [doc, page])

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

  const numPages = sizes.length

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
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[i] = el
                }}
                style={{ width: '100%', height: '100%', display: 'block' }}
              />

              {/* —— AI 批注叠加层（页面百分比定位，随缩放自动跟随） —— */}
              {sealBoxes
                .filter((b) => b.page === i + 1)
                .map((b, k) => (
                  <div
                    key={k}
                    className={`seal-box${b.abnormal ? ' abnormal' : ''}`}
                    style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                  >
                    <span>{b.label}</span>
                  </div>
                ))}

              {showRegions && i + 1 === ANNOTATION_PAGE && (
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
