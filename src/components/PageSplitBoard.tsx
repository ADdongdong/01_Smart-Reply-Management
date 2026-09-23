import { Fragment, useEffect, useRef, useState } from 'react'
import { LoadingOutlined, ScissorOutlined } from '@ant-design/icons'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageSegment } from '@/types'
import { segmentCoversPage } from '@/utils/pageSplit'

import 'pdfjs-dist/build/pdf.worker.mjs'

/** 缩略图 CSS 宽（px）—— 实际 canvas 按 2 倍渲染，保证高分屏不糊 */
const THUMB_W = 150
const RENDER_SCALE = 2

/**
 * 页缩略图切分板（v2.62）—— 「回函归属」界面的主区。
 *
 * ## 它取代了什么
 *
 * 此前归属界面左侧是**整份连续预览**（`AnnotatedPdfPreview` 把每页铺成 A4 大小），
 * 用户要"把第 4 页和第 5 页之间切开"只能靠猜页码 —— 预览按页滚动，
 * 切点在哪一页、切完是几段，界面上都看不出来。
 *
 * 现在改成**缩略图墙**：一页一张小图，**页与页之间立着一把剪刀**，点一下就在那里切一刀。
 * 这正是用户给参考界面的做法，也是 PDF 拆分工具的通用交互 ——
 * 切分从"用页码描述"变成"**在页面上直接指**"。
 *
 * ## 两类函证共用
 *
 * 往来（按二维码切）与银行（此前走 AI 识别再切）现在**用同一套手动切分**：
 * 区别只在**初稿**——往来进来时已按二维码切好可微调，银行进来是整份一段、从头切。
 * 那是 `AssignView` 的事，本组件只负责"显示页、改切点"。
 *
 * ## 关于"页数可能多于样例文件实际页数"
 *
 * 演示数据里银行批次按 11 页书写，而样例扫描件 `bank-qishang-20240331.pdf` 真实只有 4 页
 * （这一不一致自 v2.56 就存在，见 `AnnotatedPdfPreview` 里对页码的钳制说明）。
 * 缩略图**以数据的页数为准**（用户要切的是"11 页的那份文件"），
 * 超出实际页数时**循环取页**渲染 —— 缩略图在这一步的职责是**页码索引**
 * （让用户看清"切在哪两页之间"），不是供人逐字阅读，故内容重复不影响使用。
 * 真实环境里页数天然一致，这段只是演示环境的兜底。
 */
export default function PageSplitBoard({
  fileUrl,
  pageCount,
  segments,
  activeIndex,
  onToggleCut,
  onPickSegment,
}: {
  fileUrl: string
  /** 整份文件的页数（以**数据**为准，见上方说明） */
  pageCount: number
  /** 当前切分结果 —— 段首会被标出来，当前段整体描边 */
  segments: PageSegment[]
  /** 当前选中的段（-1 表示未选） */
  activeIndex: number
  /** 切换「第 N 页后」的切点 —— 剪刀按钮 */
  onToggleCut: (afterPage: number) => void
  /** 点某页 → 选中它所属的段（段序） */
  onPickSegment: (segmentIndex: number) => void
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* 已切下的页号（段尾）—— 决定哪把剪刀是"已激活" */
  const cutSet = new Set(segments.slice(0, -1).map((s) => s.pageEnd))

  /** 某页属于第几段（-1 表示不属于任何段，理论上不会发生） */
  const segIndexOfPage = (page: number) => segments.findIndex((s) => segmentCoversPage(s, page))

  /* 加载文档 —— 与 `AnnotatedPdfPreview` 同样的 fetch + getDocument 路径 */
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setLoading(true)
    setError(null)
    setDoc(null)

    void (async () => {
      try {
        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (cancelled) return
        task = pdfjsLib.getDocument({ data })
        const d = await task.promise
        if (cancelled) return
        setDoc(d)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '样例文件加载失败')
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (task) void task.destroy()
    }
  }, [fileUrl])

  /* 逐页画缩略图 —— 页数不多（演示里 ≤ 11 页），串行渲染即可，不必懒加载 */
  useEffect(() => {
    if (!doc) return
    let cancelled = false

    void (async () => {
      const real = doc.numPages
      for (let i = 1; i <= pageCount; i++) {
        if (cancelled) return
        const canvas = canvasRefs.current[i - 1]
        if (!canvas) continue
        try {
          /* 页数超出样例实际页数时循环取页（见组件顶部说明） */
          const page = await doc.getPage(((i - 1) % real) + 1)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (THUMB_W / base.width) * RENDER_SCALE })
          canvas.width = Math.max(1, Math.floor(viewport.width))
          canvas.height = Math.max(1, Math.floor(viewport.height))
          await page.render({ canvas, viewport }).promise
        } catch {
          /* 单页渲染失败不该让整墙空白 —— 跳过，该页留空框 */
        }
      }
      if (!cancelled) setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [doc, pageCount])

  if (error) {
    return (
      <div className="split-board split-board--msg">
        <div>原始回函加载失败：{error}</div>
      </div>
    )
  }

  return (
    <div className="split-board">
      {loading && (
        <div className="split-board__loading">
          <LoadingOutlined spin /> 正在生成页面缩略图…
        </div>
      )}

      {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
        const segIndex = segIndexOfPage(page)
        const isSegStart = segIndex >= 0 && segments[segIndex].pageStart === page
        const isActive = segIndex >= 0 && segIndex === activeIndex
        return (
          <Fragment key={page}>
            <button
              type="button"
              className={`split-board__page${isActive ? ' is-active' : ''}${
                isSegStart ? ' is-seg-start' : ''
              }`}
              onClick={() => segIndex >= 0 && onPickSegment(segIndex)}
              title={`第 ${page} 页`}
            >
              {isSegStart && <span className="split-board__seg">段 {segIndex + 1}</span>}
              <canvas ref={(el) => void (canvasRefs.current[page - 1] = el)} className="split-board__canvas" />
              <span className="split-board__no">第 {page} 页</span>
            </button>

            {/*
             * 页间剪刀 —— **只有"切"与"不切"两态**，点一下切换。
             * 不做"拖拽切分线"：页间的位置是离散的（只有 pageCount-1 个切点），
             * 一个可点的按钮就能穷尽全部状态，拖拽只会引入"拖到半页算什么"的歧义。
             */}
            {page < pageCount && (
              <button
                type="button"
                className={`split-board__cut${cutSet.has(page) ? ' is-on' : ''}`}
                onClick={() => onToggleCut(page)}
                title={cutSet.has(page) ? `取消第 ${page} 页后的切分` : `在第 ${page} 页后切分`}
                aria-label={cutSet.has(page) ? `取消第 ${page} 页后的切分` : `在第 ${page} 页后切分`}
                aria-pressed={cutSet.has(page)}
              >
                <ScissorOutlined />
              </button>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
