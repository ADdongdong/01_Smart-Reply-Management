import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from 'antd'
import {
  CarOutlined,
  CloseOutlined,
  EyeOutlined,
  LoadingOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  RotateRightOutlined,
  ScissorOutlined,
} from '@ant-design/icons'
import { PDF_INIT, pdfjsLib } from '@/utils/pdfSetup'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageSegment } from '@/types'
import { segmentCoversPage } from '@/utils/pageSplit'

import 'pdfjs-dist/build/pdf.worker.mjs'

/** 缩略图 CSS 宽（px）—— 实际 canvas 按 2 倍渲染，保证高分屏不糊 */
const THUMB_W = 150
const RENDER_SCALE = 2

/**
 * 取件失败后的**自动重试退避**（ms，v2.73 立、v2.74 由"只试一次"改为四档）。
 *
 * 为什么不是"只重试一次"：最常见的瞬时原因（后端刚重启）**往往要几十秒才恢复** ——
 * 只试一次等于把这整段时间里打开界面的用户都甩进错误态。四档退避覆盖约 32 秒，
 * 期间提示「正在重试」，恢复后自动出图、用户什么都不用做；真连不上再给错误态与手动按钮。
 */
const RETRY_DELAYS = [1200, 3000, 8000, 20000]

/** 悬停多久弹出放大预览（ms）—— 用户指定「鼠标放在某个页面 2 秒」 */
const ZOOM_DELAY = 1000
/**
 * 鼠标离开缩略图后、预览延后多久才收回（ms，v2.79）。
 *
 * 预览是**可交互**的（要能点「固定」、拖动平移），而"离开即收回"与"走过去点它"天然打架 ——
 * 这 300ms 就是留给人**从卡片走到弹窗上**的时间；期间只要进了弹窗，收回就作废。
 */
const ZOOM_GRACE_MS = 300

/** 默认值用的**稳定空数组** —— 写成字面量 `[]` 会让下面依赖它的 effect 每次渲染都重跑 */
const EMPTY_PAGES: number[] = []
const EMPTY_URLS: Record<number, string | null> = {}

/** 局部放大预览的窗口尺寸（CSS px）—— 横向窗口更适合读表格 */
const ZOOM_WIN_W = 720
const ZOOM_WIN_H = 500
/** 标题行 + 内边距的估算高度（只用于把弹窗夹进视口） */
const ZOOM_CHROME_H = 40

/**
 * 放大倍率（相对 PDF 1:1 的 px）—— **判据是"字要能读"，不是"看起来更大"**（v2.77）。
 *
 * 用户反馈：「用户鼠标放在图片上，能看见 pdf 的文字内容，所以，能不能只能局部预览，然后放大一点。」
 *
 * 算一下就明白整页铺满是走不通的：A4 页宽在 pdf.js 的 `scale 1` 下约 **793px**，
 * 函证正文约 8pt ⇒ 1:1 时仅约 10.7px；而整页要塞进 1000px 高的视口只能取 **0.84 倍**（更小）。
 * 取 **2 倍** ⇒ 约 21px，能看清；代价是窗口只覆盖约 **45% 页宽** —— 这就是"局部预览"，
 * 其余位置靠**光标跟随**移动（比让用户拖滚动条更直接）。
 */
const ZOOM_SCALE = 2
/** 离屏整页位图的设备像素倍率 —— 与窗口 canvas 的像素密度一致，保证不糊 */
const ZOOM_OFF_DPR = 2

/**
 * 悬停放大预览（v2.75，用户要求）。
 *
 * 用户原话：「在鼠标放在某个页面 2 秒，会自动悬浮弹出该页面的放大弹窗，鼠标移动开该页面弹窗自动收回。
 * 这样是因为，用户可能看不清小缩略页面的内容，但是通过这种方式，能更快查看页面内容，方便用户检查和切分。」
 *
 * 两条实现口径：
 * · **纯展示、不抢鼠标**（`pointerEvents: none`）—— 用户的规则是「鼠标移开该页就收回」，
 *   若弹窗能接住鼠标，就永远收不回去了；也因此它**摆在卡片旁边**而不是压在卡片上。
 * · **用 `createPortal` 挂到 `body`** —— 定位走 `fixed`，而全屏弹窗（`.fs-modal`）带 transform
 *   动画，**祖先有 transform 时 `fixed` 会退化成相对祖先定位**，弹窗会跑偏。
 */
function ZoomPreview({
  doc,
  page,
  sourcePage,
  rect,
  fx,
  fy,
  pinned,
  rotate,
  pos,
  onPan,
  onRotate,
  onMoveTo,
  onHoverStart,
  onHoverEnd,
  onClose,
}: {
  doc: PDFDocumentProxy | null
  /** **展示用**页号（标题里写「第 N 页」，用户看到的是上传件的页序） */
  page: number
  /**
   * **取图用**页号（v2.84）—— 默认同 `page`。面单页传 `1`：
   * 它展示的是"上传件的第 17 页"，但图来自**面单文件的第 1 页**。
   */
  sourcePage?: number
  rect: DOMRect
  /** 光标在页面里的归一化位置（0~1）—— 窗口以它为取景中心 */
  fx: number
  fy: number
  /** 钉住后：不再随鼠标移开收回，且**摆到不挡右侧面板的位置**（点窗口可滑动查看） */
  pinned: boolean
  /**
   * **临时旋转角**（0 / 90 / 180 / 270，顺时针；v2.90）—— 只作用在这块预览画布上：
   * **不改原文件、也不动缩略图墙**。用户实景：「有的快递面单是横着或者竖着扫描的」，
   * 不转一下，面单上的字是横躺的，单号根本读不出来。
   */
  rotate: number
  /**
   * **用户拖出来的窗口位置**（v2.92）—— `null` = 用自动摆位（钉住贴面板左缘 / 悬停贴卡片旁）。
   *
   * 一旦用户拖过就**一直用他拖的位置**：否则下一次渲染又回到自动位，
   * 他刚把窗口挪开这件事等于白做 —— 而他挪开，往往正是因为自动位挡着他要看的东西。
   */
  pos: { left: number; top: number } | null
  onPan: (fx: number, fy: number) => void
  /** 顺时针转 90°（累加），由父组件记在**每页各自**的角度上 */
  onRotate: () => void
  /** 拖窗口（按住头部）：把新位置交给父组件记住 */
  onMoveTo: (left: number, top: number) => void
  /** 进入弹窗 → 取消"离开卡片"那次收回 */
  onHoverStart: () => void
  onHoverEnd: () => void
  onClose: () => void
}) {
  const viewRef = useRef<HTMLCanvasElement | null>(null)
  /**
   * **整页位图**（按 `ZOOM_SCALE × ZOOM_OFF_DPR` 渲染一次）。
   *
   * 光标每移动一下都重跑一次 pdf.js 渲染是绝对跟不上的（一次几十毫秒）；
   * 所以整页只渲染一遍存在离屏 canvas 里，之后每次移动**只做一次 `drawImage` 裁剪**（位图搬运）。
   */
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const [ready, setReady] = useState(0)
  /** 是否正在按住拖动（只用于换光标 + 挂 window 级 move/up，拖出窗口也不会断） */
  const [dragging, setDragging] = useState(false)
  /** 按下那一刻的鼠标位置与取景 —— 位移以它为基准算，避免逐帧累加跑飞 */
  const dragRef = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null)

  /**
   * **拖动整个窗口：按住头部**（v2.92，用户要求）。
   *
   * 为什么放头部、而不是"哪儿都能拖"：**画布上的拖动已经被"看别处"占用了**
   * （按住拖动平移取景，v2.82 定的）—— 同一个手势不能干两件事，必须分区。
   * 分给头部是桌面端的通用约定（拖标题栏移动窗口），**用户不用学第二遍**。
   */
  const [moving, setMoving] = useState(false)
  const moveRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onHeadDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!pinned) return
    /* 与画布、旋转按钮同一条规矩：**按下不能抢走输入框焦点**（那个输入框失焦即保存） */
    e.preventDefault()
    moveRef.current = { x: e.clientX, y: e.clientY, left, top }
    setMoving(true)
  }
  useEffect(() => {
    if (!moving) return
    const onMove = (e: MouseEvent) => {
      const m = moveRef.current
      if (!m) return
      onMoveTo(m.left + (e.clientX - m.x), m.top + (e.clientY - m.y))
    }
    const onUp = () => {
      moveRef.current = null
      setMoving(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [moving, onMoveTo])

  /* ① 整页 → 离屏位图（每页一次） */
  useEffect(() => {
    offRef.current = null
    if (!doc) return
    let cancelled = false
    void (async () => {
      try {
        const real = doc.numPages
        /* 取图用 `sourcePage`（面单页为 1），展示仍用 `page` —— 见 props 里的说明 */
        const src = sourcePage ?? page
        const p = await doc.getPage(((src - 1) % real) + 1)
        /*
         * **旋转在「画离屏位图」这一步做，不在 CSS 上转**（v2.90）：
         * 位图转好之后，下面那套"按归一化坐标裁剪 + 按住拖动"的取景逻辑**一行都不用改**；
         * 若改用 CSS `transform: rotate()`，裁剪坐标与拖动方向映射全得跟着改，容易出歪。
         *
         * `rotation` 是**绝对角**：pdf.js 的默认值是 `page.rotate`（扫描件自己常带 90/270），
         * 所以必须写 `p.rotate + rotate` —— 只写 `rotate` 会把**文件自带的旋转撤销掉**，
         * 于是"本来就竖着的面单"被转回横躺。
         */
        const viewport = p.getViewport({
          scale: ZOOM_SCALE * ZOOM_OFF_DPR,
          rotation: (p.rotate + rotate) % 360,
        })
        const off = document.createElement('canvas')
        off.width = Math.max(1, Math.floor(viewport.width))
        off.height = Math.max(1, Math.floor(viewport.height))
        await p.render({ canvas: off, viewport }).promise
        if (cancelled) return
        offRef.current = off
        setReady((n) => n + 1)
      } catch {
        /* 放大预览失败就留空白 —— 不影响到切分 */
      }
    })()
    return () => {
      cancelled = true
    }
    /* `rotate` 变了要**重新画一遍离屏位图**（旋转就发生在这一步，见上面注释） */
  }, [doc, page, sourcePage, rotate])

  /* ② 把光标附近的区域裁进可视 canvas（纯位图搬运，跟着光标走） */
  useEffect(() => {
    const off = offRef.current
    const view = viewRef.current
    if (!off || !view) return
    /* 源区域尺寸 = 窗口的设备像素尺寸 ⇒ 与窗口 1:1，显示倍率正好是 `ZOOM_SCALE` */
    const srcW = ZOOM_WIN_W * ZOOM_OFF_DPR
    const srcH = ZOOM_WIN_H * ZOOM_OFF_DPR
    view.width = srcW
    view.height = srcH
    const ctx = view.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, srcW, srcH)
    /* 以光标为中心取景，再**夹进页面边界** —— 否则窗口角落会露出纸外的空白 */
    const cx = fx * off.width - srcW / 2
    const cy = fy * off.height - srcH / 2
    const sx = Math.min(Math.max(0, cx), Math.max(0, off.width - srcW))
    const sy = Math.min(Math.max(0, cy), Math.max(0, off.height - srcH))
    ctx.drawImage(off, sx, sy, srcW, srcH, 0, 0, srcW, srcH)
  }, [ready, fx, fy])

  /**
   * **按住拖动平移取景**（v2.82 —— 这个手势改到第三版才定，前两版都是被用户否掉才换的：
   * v2.79「悬停跟随」→「鼠标在预览界面滑动，内容也跟着滑动，很难受」；
   * v2.81「点一下进入滑动查看」→ 同样难受）。
   *
   * **两次都快在同一个地方：都在想办法"让平移不需要按住"** —— 一个用悬停代按住，一个用一次点击代按住。
   * 用户最后要的其实就是**最普通的那种拖动**：按下去、拖着走、松手停住。
   * 别为了绕开"按住"这个动作去发明更轻的手势 —— 那个"绕"本身才是难受的来源。
   *
   * 两处必须保留的细节：
   * · **`onMouseDown` 里 `preventDefault()`** —— 否则按下会把输入框焦点抢走，而它是**失焦即保存**，
   *   "想挪一下看单号"就会把编辑当场提交掉（v2.79 实测踩到，这条路必须堵住）；
   * · 方向按 **"抓住纸拖"** 的直觉（与 `cursor: grab` 一致）：往右拖 → 内容跟着往右 → **取景左移**。
   *   若更习惯"拖到右边就看右边"，把下面两处 `d.fx -` 的减号去掉即可，只改这一处。
   */
  const onCanvasDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    dragRef.current = { x: e.clientX, y: e.clientY, fx, fy }
    setDragging(true)
  }
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      const off = offRef.current
      if (!d || !off) return
      /* 屏幕位移 → 离屏位图位移：窗口 1 CSS px 对应 `ZOOM_OFF_DPR` 个离屏像素，
         而归一化坐标的 1 = 整张离屏位图 ⇒ 系数就是 `ZOOM_OFF_DPR / 离屏尺寸`。
         以 `d.fx` 起算（不是当前值）—— 否则逐帧累加会跑飞 */
      const nx = d.fx - ((e.clientX - d.x) * ZOOM_OFF_DPR) / off.width
      const ny = d.fy - ((e.clientY - d.y) * ZOOM_OFF_DPR) / off.height
      onPan(Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)))
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, onPan])

  /**
   * 摆位 —— **钉住时与悬停时是两套规则**：
   *
   * · **钉住时贴到「不挡右侧面板」的位置**（`面板左缘 − 间距 − 窗口宽`）。这是本功能的关键：
   *   用户钉住预览正是为了**一边看面单、一边往面板里的输入框打字**，压住输入框就白钉了（用户实景反馈）。
   * · **悬停时**：优先卡片右侧（墙外空白）→ 右侧不够翻左侧 → 都不够（720 宽窗口 + 约 950 宽墙）
   *   贴视口右缘。悬停预览是"看一眼就走"，压在静态 UI 上比压住"还能看的别的页"更可接受。
   */
  const gap = 12
  const paneLeft =
    document.querySelector('.assign-pane__right')?.getBoundingClientRect().left ?? window.innerWidth
  const hoverLeft = (() => {
    if (rect.right + gap + ZOOM_WIN_W <= window.innerWidth - 8) return rect.right + gap
    if (rect.left - gap - ZOOM_WIN_W >= 8) return rect.left - gap - ZOOM_WIN_W
    return Math.max(8, window.innerWidth - ZOOM_WIN_W - 8)
  })()
  const autoLeft = pinned ? Math.max(8, Math.round(paneLeft - gap - ZOOM_WIN_W)) : hoverLeft
  const autoTop = Math.min(
    Math.max(8, rect.top),
    Math.max(8, window.innerHeight - 8 - ZOOM_WIN_H - ZOOM_CHROME_H),
  )
  /*
   * **用户拖过就用他拖的位置**（v2.92），并在渲染时再夹一次视口 ——
   * 夹的目的只有一个：**头（拖拽把手）永远够得着**。
   * 允许窗口贴边部分出屏（左侧/右侧各留 160px 可见），但不允许整窗飞出屏幕：
   * 否则用户只能刷新页面才能把它找回来。
   */
  const left = Math.min(Math.max(pos ? pos.left : autoLeft, 8 - ZOOM_WIN_W + 160), window.innerWidth - 160)
  const top = Math.min(Math.max(pos ? pos.top : autoTop, 8), window.innerHeight - 44)

  return createPortal(
    <div
      className={`split-board__zoom${pinned ? ' is-pinned' : ''}`}
      style={{ left, top, width: ZOOM_WIN_W }}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
    >
      <div
        className={`split-board__zoom-head${moving ? ' is-moving' : ''}`}
        onMouseDown={onHeadDown}
        title={pinned ? '按住这里可拖动窗口' : undefined}
      >
        {/*
          **固定状态用图标表示，不用文字**（v2.92，用户要求：「固定前和固定后，希望窗口上有个固定的图标来标识，
          而不是用文字说明」）。两态一眼可辨：**空心图钉 = 未固定**（预览跟随鼠标）、
          **实心图钉 = 已固定**（不再随鼠标移开收回）。含义靠 `title` 补 —— 悬停说明不算"文字说明"，
          它不占版面、也不会在读面单时干扰视线。
        */}
        <span
          className={`split-board__zoom-pin${pinned ? ' is-on' : ''}`}
          title={
            pinned
              ? '已固定 —— 预览不会随鼠标移开消失'
              : '未固定 —— 预览跟随鼠标；在缩略图上点一下即可固定'
          }
        >
          {pinned ? <PushpinFilled /> : <PushpinOutlined />}
        </span>
        <span className="split-board__zoom-title">
          第 {page} 页 · 局部放大 ×{ZOOM_SCALE}
          {rotate ? ` · 已旋转 ${rotate}°` : ''}
        </span>
        <span className="split-board__zoom-actions">
          {/*
            按下时必须 `preventDefault()` —— 否则这一下会把输入框的焦点抢走，而它是**失焦即保存**：
            用户"点改 → 发现是横的 → 点旋转"这条最自然的路径，会在按钮上把还没敲的编辑当场提交掉
            （v2.90 实测踩到）。与预览画布同一套处理，见 `onCanvasDown`。
          */}
          <Button
            type="text"
            size="small"
            icon={<RotateRightOutlined />}
            title="顺时针旋转 90°（只转这块预览，不改原文件）"
            aria-label="旋转 90 度"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRotate}
          />
          <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭预览" onClick={onClose} />
        </span>
      </div>
      {doc ? (
        <canvas
          ref={viewRef}
          className={`split-board__zoom-canvas${dragging ? ' is-dragging' : ''}`}
          onMouseDown={onCanvasDown}
          /* 两种拖动各归其位，靠 tooltip 说清楚（不占版面） */
          title={pinned ? '按住拖动看别处；拖标题栏可移动窗口' : undefined}
        />
      ) : (
        <div className="split-board__zoom-empty" style={{ minHeight: ZOOM_WIN_H }}>
          原件未加载，无法生成放大预览 ——
          <br />
          点卡片右上角「查看原件」可用浏览器直接打开这一页
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * 网络层失败（而不是服务端明确答复失败）—— **只有这类值得自动重试**（v2.73）。
 *
 * `fetch` 在网络层失败时抛的是 `TypeError: Failed to fetch`（服务没起来 / 刚重启 / 断网），
 * 而"文件不存在"是 `res.ok === false`（我们自己抛 `HTTP 404`）—— 后者重试一万次也没用。
 */
const isTransient = (e: unknown) =>
  !(e instanceof Error) || !/^HTTP \d/.test(e.message)

/**
 * 把底层异常翻译成人能读懂的一句话（v2.73）。
 *
 * 起因：界面上直接显示 `Failed to fetch` —— 这是浏览器内部文案，用户读完不知道自己能做什么。
 * 原始文案仍以小字保留在下方，原型阶段排查问题比翻译后的句子有用。
 */
function errorHint(raw: string): string {
  if (/HTTP 4\d\d/.test(raw)) return '读不到原始回函文件：服务端说这份文件不存在'
  if (/HTTP 5\d\d/.test(raw)) return '服务端出错了，暂时读不到原始回函文件'
  return '暂时读不到原始回函文件（多为服务刚重启或网络中断），可直接重新加载'
}

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
  pinnedPage,
  pinnedAnchor,
  pinRequest = 0,
  faceSheetPages = EMPTY_PAGES,
  faceSheetUrls = EMPTY_URLS,
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
  /**
   * 外部请求「钉住某页的预览」（v2.79）—— `SplitPanel` 里点「改」某个段的快递单号时调它，
   * 请求把**该段最后一页（面单页）**钉在屏幕上（传 `null` = 撤销该请求）。
   */
  pinnedPage?: number | null
  /** 请求方给的锚点（那一行）—— 弹窗纵向与它对齐 */
  pinnedAnchor?: HTMLElement | null
  /**
   * **本次请求的序号**（v3.08）—— 每次点「改」都递增。
   *
   * 只按 `pinnedPage` / `pinnedAnchor` 比依赖是不够的：同一段**每次点的都是同一个页码、
   * 同一个行元素**，两个值都没变 → 下面那个钉预览的 effect 不重跑 → **关掉预览后再点「改」，
   * 预览不再出现**（用户实测"只有第一次会弹出"）。带上序号，每次点击都是一次新请求。
   */
  pinRequest?: number
  /**
   * 哪几页是**快递面单页**（v2.84，银行侧）—— 这些页**从面单文件取图**渲染，
   * 而不是从用户上传的那份回函件里取：上传件里根本没有这些页的清晰扫描件
   * （演示数据按 17 页书写、样例只有 4 页，超出部分一直在循环取页凑数）。
   */
  faceSheetPages?: number[]
  /**
   * **面单页 → 面单样例地址**（v2.85 起支持一个文件多个包裹、每张面单一份文件）。
   * 不给就不换源，行为与改动前完全一致。
   */
  faceSheetUrls?: Record<number, string | null>
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  /**
   * **面单文件**的 pdf 文档（v2.84 立、v2.85 支持一个文件多个包裹）：**页号 → 文档**。
   * 用 ref 存 + 一个自增计数器触发重画 —— 面单页可能分属不同的面单文件，各加载各的、互不影响。
   */
  const faceDocsRef = useRef<Record<number, PDFDocumentProxy>>({})
  const [faceLoaded, setFaceLoaded] = useState(0)
  /** 已经取过的「页 → 面单地址」—— 去重，避免上游重渲染反复取（见下面的 effect 注释） */
  const loadedFaceRef = useRef<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 自增即重新取件 —— 「重新加载」按钮与自动重试都走它 */
  const [reloadKey, setReloadKey] = useState(0)
  /** 已自动重试次数（用完 `RETRY_DELAYS` 才放弃） */
  const retryCountRef = useRef(0)
  /** 重试期间给一句说明 —— 否则屏幕上一直只有「正在生成页面缩略图…」，像卡住了 */
  const [retryNote, setRetryNote] = useState('')

  const reload = () => {
    retryCountRef.current = 0
    setRetryNote('')
    setReloadKey((k) => k + 1)
  }

  /*
   * ── 按「内容」稳定这两个入参（v3.07：修缩略图持续闪烁）────────────────────────
   *
   * 上游 `AssignView` 的 `faceSheetPages` / `faceSheetUrls` 是从「批次任务 → 切分初稿」
   * 一路 `useMemo` 推下来的，而**识别期间 store 每 600ms 发一次 `TICK`**：批次一变，
   * 这条链上每一级都换新引用，于是这两个入参**每 600ms 就是一份新数组 / 新对象**。
   *
   * 下面几个重画 effect 依赖它们 ⇒ 整面墙每 600ms 从头重画一遍。而 `canvas.width = …`
   * 会**先清空画布**、再等 pdf.js 异步重绘，屏幕上就是**缩略图一直闪**（页数越多越明显，
   * 22 页串行重画时几乎看不清）。
   *
   * 修法：把"内容其实没变的新引用"折回**上一次那个引用**（`useMemo` 按内容键缓存），
   * 依赖自然就稳了 —— 只有面单页清单 / 地址真的变了才重画。
   *
   * ⚠️ **别在 effect 里加"内容没变就 return"的守卫**：React 重跑 effect 前会先执行上一次的
   * cleanup（把 `cancelled` 置真），提前 return 等于把上一轮**画到一半就掐掉** —— 墙上会留下
   * 永远画不完的空白页，比闪更糟。所以必须从**依赖**这层修。
   */
  const facePagesKey = faceSheetPages.join(',')
  const faceUrlKey = faceSheetPages.map((pg) => `${pg}:${faceSheetUrls[pg] ?? ''}`).join('|')
  const stableFacePages = useMemo(() => faceSheetPages, [facePagesKey])
  const stableFaceUrls = useMemo(() => faceSheetUrls, [faceUrlKey])

  /* 换文件时重置自动重试 */
  useEffect(() => {
    retryCountRef.current = 0
    setRetryNote('')
  }, [fileUrl])

  /* ---------------- 悬停放大预览（v2.75） ---------------- */

  /**
   * 放大预览态。`pinned` = 已**钉住** —— 不再随鼠标移开收回（v2.79）。
   *
   * 为什么必须有"钉住"（用户实景）：快递单号没识别出来时，用户得**眼睛看面单、手在右侧输入框里敲**；
   * 而"悬停即预览、移开即消失"正好帮倒忙 —— 鼠标一移过去预览就没了，**预览还正好压住那个输入框**。
   * 解法是**钉住 + 位置避让**（钉住时摆到不挡右侧面板的位置），而不是去移动窗口。
   */
  const [zoom, setZoom] = useState<{
    page: number
    rect: DOMRect
    fx: number
    fy: number
    pinned: boolean
  } | null>(null)
  /**
   * **每一页各自的临时旋转角**（0/90/180/270，v2.90）—— 纯预览行为，不写回文件、不改缩略图墙。
   * 按页记：同一份文件里很可能"这页横着、那页竖着"，共用一个角度会互相打架。
   */
  const [zoomRotations, setZoomRotations] = useState<Record<number, number>>({})
  /**
   * **用户拖出来的窗口位置**（v2.92）—— `null` = 还没拖过，用自动摆位。
   *
   * 为什么必须存在父组件：位置是"跨多次预览打开"的（用户把它挪开，往往是因为自动位挡着他要看的东西；
   * 关掉再打开又弹回原处，等于白挪）。存在这里，只要不离开归属界面就一直有效。
   */
  const [zoomPos, setZoomPos] = useState<{ left: number; top: number } | null>(null)
  const zoomTimerRef = useRef<number | undefined>(undefined)
  /** 「离开卡片 → 收回」的延迟句柄 —— 留出从卡片走到弹窗上的时间（见 `disarmZoom`） */
  const hideTimerRef = useRef<number | undefined>(undefined)
  /** 光标位置先写 ref —— 每次 mousemove 都 setState 会让整面墙每帧重渲染 */
  const posRef = useRef({ fx: 0.5, fy: 0.5 })
  const moveRafRef = useRef<number | undefined>(undefined)
  /** 当前钉住是「外部请求」（点改单号时自动钉的）还是用户自己钉的 —— 前者在编辑结束时自动撤掉 */
  const requestedPinRef = useRef<number | null>(null)

  const cancelHide = () => window.clearTimeout(hideTimerRef.current)

  /** 悬停满 `ZOOM_DELAY` 才弹 —— 顺手记下卡片位置与当前光标位置（取景以光标为中心） */
  const armZoom = (page: number, el: HTMLElement) => {
    window.clearTimeout(zoomTimerRef.current)
    cancelHide()
    /* 已经钉住一页时不接管 —— 否则用户刚钉好去填单号、手从别的页上划过就把预览换掉了 */
    if (zoom?.pinned) return
    posRef.current = { fx: 0.5, fy: 0.5 }
    zoomTimerRef.current = window.setTimeout(
      () => setZoom({ page, rect: el.getBoundingClientRect(), ...posRef.current, pinned: false }),
      ZOOM_DELAY,
    )
  }

  /**
   * 鼠标离开卡片 —— **不立刻收回，而是延迟 `ZOOM_GRACE_MS`**：
   * 弹窗可交互（要能点「固定」、拖动平移），从卡片走过去要点时间；期间进了弹窗就作废这次收回。
   */
  const disarmZoom = () => {
    window.clearTimeout(zoomTimerRef.current)
    if (zoom?.pinned) return
    cancelHide()
    hideTimerRef.current = window.setTimeout(() => setZoom(null), ZOOM_GRACE_MS)
  }

  /**
   * **临时旋转预览**（v2.90，用户要求：「有的快递面单是横着或者竖着扫描的」）。
   *
   * 转的是**这一块预览的画布**（在离屏位图那一步转，见 `ZoomPreview` 注释），
   * 原文件、缩略图墙、切分结果都不动 —— 用户说的就是"临时旋转不修改原始 PDF"。
   *
   * 两个细节：
   * · **角度按页各记一份**：同一份文件里常常"这几页横、那几页竖"，共用一个角度会互相打架；
   *   而且关掉预览再打开**同一页还是转好的角度**（用户要连着核对好几个面单）。
   * · **转完接着看同一处纸面**：绕中心顺时针 90°，原在 `(fx, fy)` 的那点会落到 `(1 - fy, fx)`；
   *   不同步挪取景，用户刚对准的单号就"转没了"、还得重拖一遍。（转四次回到原处，可逆。）
   */
  const rotateZoom = () => {
    if (!zoom) return
    setZoomRotations((m) => ({ ...m, [zoom.page]: ((m[zoom.page] ?? 0) + 90) % 360 }))
    setZoom({ ...zoom, fx: 1 - zoom.fy, fy: zoom.fx })
  }

  /**
   * **把窗口挪到用户拖到的位置**（v2.92）。
   *
   * `useCallback` 是为了让引用稳定：ZoomPreview 里为此挂了 `window` 级 mousemove，
   * 而拖动每一帧都会 setState → 重渲染 —— 回调若每帧换一次，监听器就被反复摘挂
   * （功能不会坏，但没必要）。依赖为空：它只做一次 setState。
   */
  const moveZoomTo = useCallback((left: number, top: number) => setZoomPos({ left, top }), [])

  const closeZoom = () => {
    window.clearTimeout(zoomTimerRef.current)
    cancelHide()
    requestedPinRef.current = null
    setZoom(null)
  }

  /* 外部请求：把某段末页（面单页）钉出来（切分结果里点「改」单号）—— `null` = 撤销该请求 */
  useEffect(() => {
    if (pinnedPage == null) {
      /* 只撤掉「请求来的」那一张，不动用户自己钉的 */
      const requested = requestedPinRef.current
      if (requested == null) return
      requestedPinRef.current = null
      setZoom((z) => (z && z.page === requested ? null : z))
      return
    }
    requestedPinRef.current = pinnedPage
    cancelHide()
    window.clearTimeout(zoomTimerRef.current)
    setZoom((z) => {
      /*
       * **同一页再次请求时保留当前取景**（v2.79 实测踩到的坑）：用户拖动预览找单号会让输入框失焦
       * → 失焦即提交 → 编辑态结束；要接着改就得再点一次「改」。若这里把取景重置回默认位置，
       * 用户刚才辛苦拖到的位置就白费了 —— 所以同页视为"保持原样"。
       */
      if (z && z.pinned && z.page === pinnedPage) return { ...z, rect: pinnedAnchor?.getBoundingClientRect() ?? z.rect }
      return {
        page: pinnedPage,
        rect: pinnedAnchor?.getBoundingClientRect() ?? new DOMRect(0, 8, 0, 0),
        /* 面单单号通常在**页面上部**（条码区）—— 默认取景略偏上，省得用户还要先拖一下 */
        fx: 0.5,
        fy: 0.32,
        pinned: true,
      }
    })
    /* `pinRequest` 必须进依赖：同页再次点击时，只有它会变（见 props 里的说明） */
  }, [pinnedPage, pinnedAnchor, pinRequest])

  /*
   * **故意不接管 Esc**（v2.81 实测后撤掉）：整个「回函归属」是 antd 的 `FullscreenModal`，
   * **Esc 在这一屏原本的语义就是"退出归属界面"**；预览里再抢一次 Esc，用户想收起预览就会连整屏一起丢掉
   * （实测：脚本按 Esc 后归属界面被关掉，后续操作全都找不到元素）。
   * 收起预览只留头部那个 ✕ —— **同一个键不要有两个消失层级**。
   */

  /**
   * 光标在缩略图上移动 → 记下归一化位置（放大预览以它为取景中心）。
   *
   * **用 rAF 节流**：位置先写 ref，每帧最多同步一次进 state，避免整面墙跟着每帧重渲染。
   */
  const onCardMove = (page: number, e: ReactMouseEvent<HTMLCanvasElement>) => {
    /*
     * **钉住后，划过缩略图不再改取景**（v2.98，用户：「到固定模式以后，就算鼠标放在原始文件缩略图上，
     * 固定页面的预览内容也不要移动了，只有在固定模式拖动才可以移动」）。
     *
     * 钉住的语义是"**我看见的就是我要核对的那一格**"——之后鼠标顺路划过缩略图
     * （去点别的段、去右侧填单号）都不该把这一格挪走。要动，就在预览窗口里**按住拖**。
     * 顺带也把"固定后仍可用缩略图微调位置"这条旧口径正式撤掉了（它与"钉住"本就互相矛盾）。
     */
    if (zoom?.pinned) return
    const r = e.currentTarget.getBoundingClientRect()
    const fx = r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0.5
    const fy = r.height ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0.5
    posRef.current = { fx, fy }
    if (moveRafRef.current) return
    moveRafRef.current = window.requestAnimationFrame(() => {
      moveRafRef.current = undefined
      setZoom((z) => (z && z.page === page ? { ...z, ...posRef.current } : z))
    })
  }

  /* 卸载时清掉定时器与 rAF，避免在已卸载的组件上 setState */
  useEffect(
    () => () => {
      window.clearTimeout(zoomTimerRef.current)
      window.clearTimeout(hideTimerRef.current)
      if (moveRafRef.current) window.cancelAnimationFrame(moveRafRef.current)
    },
    [],
  )

  /* 已切下的页号（段尾）—— 决定哪把剪刀是"已激活" */
  const cutSet = new Set(segments.slice(0, -1).map((s) => s.pageEnd))

  /** 某页属于第几段（-1 表示不属于任何段，理论上不会发生） */
  const segIndexOfPage = (page: number) => segments.findIndex((s) => segmentCoversPage(s, page))

  /*
   * 加载文档 —— 与 `AnnotatedPdfPreview` 同样的 fetch + getDocument 路径。
   *
   * **失败不再"一次定生死"（v2.73）**：此前 catch 到就直接把整块板子换成一行报错，
   * 于是后端重启一次（或断网一下），用户就必须重开界面才能恢复 —— 而这是**演示环境里最常见的情况**
   * （实测踩到：界面上只剩「原始回函加载失败：Failed to fetch」）。现在：
   *   ① 瞬时失败（网络层）按 `RETRY_DELAYS` **退避重试**，重试期间**保持 loading 态**、不先闪报错；
   *   ② 重试仍失败才进错误态，且错误态给可读原因 + 取件地址 + 「重新加载」按钮。
   */
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    let retryTimer: number | undefined
    setLoading(true)
    setError(null)
    setDoc(null)

    void (async () => {
      try {
        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (cancelled) return
        /* `...PDF_INIT` 必须带上：扫描件的 JBIG2 图像没有 wasm 解码器就永远解不出来（v2.87） */
        task = pdfjsLib.getDocument({ data, ...PDF_INIT })
        const d = await task.promise
        if (cancelled) return
        setRetryNote('')
        setDoc(d)
      } catch (e) {
        if (cancelled) return
        const attempt = retryCountRef.current
        if (isTransient(e) && attempt < RETRY_DELAYS.length) {
          retryCountRef.current = attempt + 1
          setRetryNote(`读取失败，正在重试（${attempt + 1}/${RETRY_DELAYS.length}）…`)
          retryTimer = window.setTimeout(() => setReloadKey((k) => k + 1), RETRY_DELAYS[attempt])
          return
        }
        setRetryNote('')
        setError(e instanceof Error ? e.message : '样例文件加载失败')
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (task) void task.destroy()
    }
  }, [fileUrl, reloadKey])

  /*
   * 加载**面单文件**（v2.84）—— 只在这一份文件确实有"面单页"、并且给了面单地址时才去取。
   * **失败就静默留空**：墙上那一页留白框，不弹错、不影响切分（面单图是锦上添花，缺了也能归属）。
   *
   * **同一份面单只取一次**（`faceLoadedRef` 去重）：v3.07 之前这个 effect 会被上游重渲染
   * 反复触发（识别期间每 600ms 一次），实测没去重时同一份面单被取了 **17 次**
   * （百来 KB × 17 的无谓流量）；更要紧的是原来每次 cleanup 都 `destroy()` 当前文档 ——
   * 反复触发时会把**已经画好的那张**一起弄没。现在只有"换成另一份面单"时才释放上一份。
   * （v3.07 起依赖已按内容稳定，本 effect 本身不会再每帧重跑；这道取件去重留作兜底。）
   */
  useEffect(() => {
    /* 每个"面单页"各自加载自己那张面单（同一个文件里可能有多个包裹） */
    stableFacePages.forEach((pg) => {
      const url = stableFaceUrls[pg]
      if (!url) return
      if (loadedFaceRef.current[pg] === url) return
      loadedFaceRef.current[pg] = url
      void (async () => {
        try {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = new Uint8Array(await res.arrayBuffer())
          const d = await pdfjsLib.getDocument({ data, ...PDF_INIT }).promise
          /* 换成另一张了（同一页换了面单）→ 释放旧的 */
          const prev = faceDocsRef.current[pg]
          if (prev) void (prev as unknown as { destroy?: () => void }).destroy?.()
          faceDocsRef.current[pg] = d
          setFaceLoaded((n) => n + 1)
        } catch {
          /* 取不到面单 → 该页留空框 */
        }
      })()
    })
  }, [stableFaceUrls, stableFacePages])

  /* 逐页画缩略图 —— 页数不多（演示里 ≤ 17 页），串行渲染即可，不必懒加载 */
  useEffect(() => {
    if (!doc) return
    let cancelled = false

    void (async () => {
      for (let i = 1; i <= pageCount; i++) {
        if (cancelled) return
        const canvas = canvasRefs.current[i - 1]
        if (!canvas) continue
        /*
         * **面单页从面单文件取图**（v2.84）：这类页在上传件里没有对应的清晰扫描件，
         * 原先只能拿原文件循环取页凑数（看上去就是一张函证正文，与"这是面单"自相矛盾）。
         * 面单文件通常只有一页，故恒取它的第 1 页；文档还没到就先跳过，
         * 等它到了这个 effect 会因 `faceDoc` 变化再跑一遍把这张补画上。
         */
        const isFace = stableFacePages.includes(i)
        const srcDoc = isFace ? faceDocsRef.current[i] : doc
        if (!srcDoc) continue
        try {
          const real = srcDoc.numPages
          const page = await srcDoc.getPage(isFace ? 1 : ((i - 1) % real) + 1)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (THUMB_W / base.width) * RENDER_SCALE })
          canvas.width = Math.max(1, Math.floor(viewport.width))
          canvas.height = Math.max(1, Math.floor(viewport.height))
          await page.render({ canvas, viewport }).promise
        } catch (e) {
          /*
           * 单页渲染失败不该让整墙空白 —— 跳过，该页留空框。
           * **但要留下可查的痕迹**（v2.87）：这条 catch 静默吞过一次真实故障 ——
           * 22 页的演示件里后几页一直空白，界面上没有任何提示，只能靠猜。
           */
          console.warn(`[PageSplitBoard] 第 ${i} 页缩略图渲染失败`, e)
        }
      }
      if (!cancelled) setLoading(false)
    })()

    return () => {
      cancelled = true
    }
    /*
     * 依赖里**刻意不放 `faceLoaded`** —— 面单文档后到时的补画交给下面那个专门的小循环。
     * 放进来会让整墙每次到一张面单就**从头重画**：22 页串行本就要好几秒，
     * 反复重启的结果是"后面几页永远画不到、加载提示也一直不消失"（v2.85 实测踩到）。
     */
  }, [doc, pageCount, stableFacePages])

  /**
   * 面单文档**后到**时补画那几页面单（v2.85）—— 只重画面单页，**不重启整面墙**。
   */
  useEffect(() => {
    if (!faceLoaded) return
    let cancelled = false
    void (async () => {
      for (const pg of stableFacePages) {
        if (cancelled) return
        const srcDoc = faceDocsRef.current[pg]
        const canvas = canvasRefs.current[pg - 1]
        if (!srcDoc || !canvas) continue
        try {
          const page = await srcDoc.getPage(1)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (THUMB_W / base.width) * RENDER_SCALE })
          canvas.width = Math.max(1, Math.floor(viewport.width))
          canvas.height = Math.max(1, Math.floor(viewport.height))
          await page.render({ canvas, viewport }).promise
        } catch {
          /* 单页失败 → 该页留空框 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [faceLoaded, stableFacePages])

  return (
    <div className="split-board">
      {loading && (
        <div className="split-board__loading">
          <LoadingOutlined spin /> {retryNote || '正在生成页面缩略图…'}
        </div>
      )}

      {/*
       * 取件失败 —— **绝不替换整块板子**（v2.75 修正）。
       *
       * 上一版（v2.73/2.74）在错误时把整块板子换成一行报错，后果是**连剪刀都没了**：
       * 而"切分"本来就只是**按页索引**的操作，图片拿不到时用户照样要能切、能逐页打开原件
       * （用户环境里就是这种情况：`fetch` 一直失败，于是整个左侧都不可用）。
       * 现在错误只作一条**常驻横幅**压在板子顶部（`sticky`），页面卡片与剪刀一律照常渲染。
       *
       * 两个动作：**用浏览器打开原件**是主路径 —— 它不走本站的 `fetch` / pdf.js，
       * 与缩略图墙是**两条链路**（用户要求：「我点这里，你就默认打开展示文件就行了，不用实时加载」）；
       * 「重新加载」是重试本站渲染。
       */}
      {error && (
        <div className="split-board__error">
          <div className="split-board__error-title">{errorHint(error)}</div>
          <div className="split-board__raw">原始错误：{error}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button
              size="small"
              type="primary"
              icon={<EyeOutlined />}
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
            >
              用浏览器打开原件
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              重新加载
            </Button>
          </div>
        </div>
      )}

      {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
        const segIndex = segIndexOfPage(page)
        const isSegStart = segIndex >= 0 && segments[segIndex].pageStart === page
        const isActive = segIndex >= 0 && segIndex === activeIndex
        return (
          <Fragment key={page}>
            <div
              className="split-board__pagewrap"
              onMouseEnter={(e) => armZoom(page, e.currentTarget)}
              onMouseLeave={disarmZoom}
            >
              <button
                type="button"
                className={`split-board__page${isActive ? ' is-active' : ''}${
                  isSegStart ? ' is-seg-start' : ''
                }`}
                onClick={() => {
                  /*
                   * 点一下 = **把此刻这一格固定下来**（v2.81，用户提的交互：先在缩略图上把位置找好，
                   * 再点一下进入固定模式，接着就能照着预览填快递单号了）。
                   * 之所以比"去瞄头部那个「固定」小按钮"好：点的时候光标就在你想看的地方，
                   * 少一次瞄准、少一次移动（移动过程中取景还会跟着变）。
                   *
                   * **只在"预览已弹出且正是本页"时才固定** —— 否则普通的一次点击（还没等预览出来）
                   * 就只是想选中这一段。两种意图靠"预览在不在"天然分开，不需要额外修饰键。
                   */
                  setZoom((z) => (z && !z.pinned && z.page === page ? { ...z, pinned: true } : z))
                  if (segIndex >= 0) onPickSegment(segIndex)
                }}
                title={`第 ${page} 页`}
              >
                {isSegStart && <span className="split-board__seg">段 {segIndex + 1}</span>}
                <canvas
                  ref={(el) => void (canvasRefs.current[page - 1] = el)}
                  className="split-board__canvas"
                  /* 光标在**页面本身**上移动 → 放大预览跟着取景（故挂在 canvas 上而不是外层的卡片容器上，
                     这样归一化坐标直接就是"页面内的位置"，不用扣 padding） */
                  onMouseMove={(e) => onCardMove(page, e)}
                />
                <span className="split-board__no">第 {page} 页</span>
                {/*
                 * **面单页角标**（v3.22）—— 此前这一页只是"悄悄换了取图来源"（v2.84 起从面单文件取图），
                 * 画面上看不出它是什么；用户问「银行函证的快递面单自动识别的过程，和识别结束，
                 * 是不是需要一个显示的图标来标识」⇒ 是：这里给它一枚与切分结果里**同款**的
                 * 卡车图标 + 「面单」。识别结果到达时它就会出现 —— 这也是"过程看得见"的一半。
                 */}
                {stableFacePages.includes(page) && (
                  <span
                    className="split-board__sheet"
                    title="这一页被识别为快递面单（运单号由它管辖前面那几段函证）"
                  >
                    <CarOutlined /> 面单
                  </span>
                )}
              </button>
              {/*
               * 「查看原件」—— **不经过本站的实时渲染**（v2.75，用户要求：「我点这里，你就默认打开展示文件
               * 就行了，不用实时加载」）：一个普通链接导航，交给浏览器自带的 PDF 查看器打开，
               * 并用 `#page=` 直达这一页。它同时是最可靠的兜底 —— 本站 `fetch` 取不到原件时，
               * 这条路通常仍能用（两者走的不是同一条链路）。
               * **必须放在按钮外面**：`<a>` 不能嵌在 `<button>` 里（非法嵌套，点击还会连带动到按钮）。
               */}
              <a
                className="split-board__open"
                href={`${fileUrl}#page=${page}`}
                target="_blank"
                rel="noreferrer"
                title={`在新窗口打开第 ${page} 页原件`}
                aria-label={`在新窗口打开第 ${page} 页原件`}
              >
                <EyeOutlined />
              </a>
            </div>

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

      {/* 悬停放大预览（portal 到 body —— 见 `ZoomPreview` 顶部说明） */}
      {zoom && (
        <ZoomPreview
          /*
           * 面单页 → 用**面单文件**渲染；**面单文件还没到（或该页没有对应样例）就退回上传件** ——
           * 宁可给"这一页的真实内容"，也不要弹个空窗：原先这里直接给 `null`，
           * 用户在预览里只看到一行"原件未加载"，什么都看不到（v2.89 修）。
           */
          doc={faceDocsRef.current[zoom.page] ?? doc}
          page={zoom.page}
          /* 取图页：用面单文档时取它的第 1 页；退回上传件时按正常页码（`undefined` = 用 `page`） */
          sourcePage={faceDocsRef.current[zoom.page] ? 1 : undefined}
          rect={zoom.rect}
          fx={zoom.fx}
          fy={zoom.fy}
          pinned={zoom.pinned}
          rotate={zoomRotations[zoom.page] ?? 0}
          pos={zoomPos}
          onPan={(fx, fy) => setZoom((z) => (z ? { ...z, fx, fy } : z))}
          onRotate={rotateZoom}
          onMoveTo={moveZoomTo}
          onHoverStart={cancelHide}
          onHoverEnd={disarmZoom}
          onClose={closeZoom}
        />
      )}
    </div>
  )
}
