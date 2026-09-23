import { useState } from 'react'
import { Button, Space } from 'antd'
import { FilePdfOutlined, ThunderboltOutlined } from '@ant-design/icons'
import AnnotatedPdfPreview from '@/components/AnnotatedPdfPreview'
import type { SealBox } from '@/types'
import { DEFAULT_PREVIEW_MODE, browserSampleUrlOf, type PreviewMode } from '@/config/preview'

/**
 * 函证文件预览 —— 两种视图**共用同一套 pdf.js 渲染**，样式完全一致，切换零闪动：
 *
 * · **原始文件** —— 只渲染回函原件；
 * · **AI 批注** —— 同一份原件之上叠加 AI 批注层（印章定位框、落章区域高亮、手写体识别区）。
 *
 * 实现要点：两者是**同一套多页画布**，切换只显隐批注叠加层、不重建 PDF ——
 * 因此「原文 ↔ 批注」来回核对时，页面位置、缩放、滚动位置完全对齐，不会闪动或跳动。
 * 多页连续滚动、缩放（工具条 + Ctrl 滚轮 / 触控板捏合）与懒渲染由 `AnnotatedPdfPreview` 承载。
 *
 * 批注坐标与显示尺寸解耦（页面百分比），缩放与滚动时批注始终贴合文件内容。
 *
 * 视图可由外部受控（`viewMode` + `onViewModeChange`）—— AI 核验页据此在切到「印章识别」时
 * 自动切到批注视图；不传则内部自管理。`forceAnnotated` 用于锁定批注视图且不显示切换按钮。
 *
 * 另有两个「换内容 / 换范围」的入口，供**预览的不是整份回函**的场景使用：
 * · `fileUrl` —— 直接指定文件（如快递面单：一份独立的单页面单扫描件），不传则按函证编号推断；
 * · `singlePage` —— 只渲染 `page` 那一页（面单只看一页，不把整份回函铺出来）。
 */
export default function PdfPreview({
  confirmationNo,
  fileUrl,
  singlePage = false,
  entity = '广东证券股份有限公司',
  indexNo = 'LC2026006906',
  page = 1,
  totalPages = 2,
  sealBoxes = [],
  showRegions = false,
  activeRegion,
  height = 420,
  handwriting,
  forceAnnotated = false,
  hideViewToggle = false,
  viewMode,
  onViewModeChange,
}: {
  confirmationNo: string
  /**
   * 直接指定要渲染的文件地址；不传则按函证编号推断回函附件样例。
   * 用于**内容不是回函附件**的预览（如快递面单：一份独立的单页面单扫描件）。
   */
  fileUrl?: string
  /**
   * **只渲染 `page` 那一页** —— 用于只看单页的场景（快递面单）。
   * 与 `hideViewToggle` 搭配使用：面单上没有印章 / 落章区域 / 手写区，也没有其它页可看。
   */
  singlePage?: boolean
  /** 以下三项由调用方传入，原件渲染不依赖（回函文件自带这些信息），保留以兼容既有调用 */
  entity?: string
  indexNo?: string
  totalPages?: number
  page?: number
  sealBoxes?: SealBox[]
  /** 是否展示「信息证明无误 / 信息不符」两个落章区域 */
  showRegions?: boolean
  activeRegion?: '信息证明无误区' | '信息不符区' | '未识别'
  /** 预览高度：数字＝固定像素；`'100%'`＝撑满父容器（左固定栏场景，见 AnnotatedPdfPreview） */
  height?: number | string
  handwriting?: string
  /** 锁定为 AI 批注视图，不提供切换（需要叠加定位框时使用） */
  forceAnnotated?: boolean
  /**
   * 隐藏「原始文件 / AI 批注」切换 —— 用于**本身没有 AI 批注可看**的预览
   * （如快递面单页：面单上没有印章、落章区域与手写区，留着切换只会误导）。
   */
  hideViewToggle?: boolean
  /** 受控视图（配合 `onViewModeChange` 使用；不传则内部自管理） */
  viewMode?: PreviewMode
  onViewModeChange?: (mode: PreviewMode) => void
}) {
  const [internalMode, setInternalMode] = useState<PreviewMode>(DEFAULT_PREVIEW_MODE)
  const pref = forceAnnotated ? 'annotated' : (viewMode ?? internalMode)
  const annotated = pref === 'annotated'

  const setMode = (m: PreviewMode) => {
    setInternalMode(m)
    onViewModeChange?.(m)
  }

  /**
   * 视图切换 —— 固定在预览右上角，当前视图用主色实心按钮标识，
   * 让用户随时知道「现在看的是原件，还是带 AI 批注的原件」。
   */
  const switcher = !forceAnnotated && !hideViewToggle && (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 2,
        background: 'rgba(255,255,255,0.98)',
        borderRadius: 8,
        padding: 3,
        boxShadow: 'var(--shadow-pop)',
      }}
    >
      <Space.Compact>
        <Button
          type={annotated ? 'default' : 'primary'}
          icon={<FilePdfOutlined />}
          onClick={() => setMode('original')}
          title="仅显示回函原件，供人工阅读原文"
        >
          原始文件
        </Button>
        <Button
          type={annotated ? 'primary' : 'default'}
          icon={<ThunderboltOutlined />}
          onClick={() => setMode('annotated')}
          title="在原件上叠加印章定位框、落章区域与手写识别区等 AI 批注"
        >
          AI 批注
        </Button>
      </Space.Compact>
    </div>
  )

  return (
    /**
     * 根容器同样要吃满：内部 `AnnotatedPdfPreview` 的 `height` 是**相对本容器**算的
     * （本容器原先只有 `position:relative`、没有高度，传 `'100%'` 会直接塌成 0）。
     * `height:'100%'` 供普通容器、`flex:1` 供 flex 父级（左固定栏场景）——
     * 两者在各自场景下生效、互不干扰（flex 下 basis 优先，height 被忽略）。
     */
    <div style={{ position: 'relative', height: '100%', flex: 1, minHeight: 0 }}>
      {/* 批注开关只切换叠加层，pdf.js 画布始终复用 —— 切换不重渲染、不闪动 */}
      <AnnotatedPdfPreview
        fileUrl={fileUrl ?? browserSampleUrlOf(confirmationNo)}
        page={page}
        singlePage={singlePage ? page : undefined}
        height={height}
        sealBoxes={annotated ? sealBoxes : []}
        showRegions={annotated && showRegions}
        activeRegion={annotated ? activeRegion : undefined}
        handwriting={annotated ? handwriting : undefined}
      />
      {switcher}
    </div>
  )
}
