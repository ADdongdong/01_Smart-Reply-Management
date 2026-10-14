import AnnotatedPdfPreview from '@/components/AnnotatedPdfPreview'
import type { SealBox } from '@/types'
import { browserSampleUrlOf } from '@/config/preview'

/**
 * 函证文件预览 —— 原件 + **固定叠加**的 AI 批注层。
 *
 * ## 「原始文件 / AI 批注」切换已删除（v3.35，用户口径）
 *
 * 用户原话：「**整体，去掉原始文件 / ai批注这个功能，全局**」。
 * 原先右上角有一对按钮，让用户在"只看原件"与"原件 + 批注"之间来回切（结果填写页、查看函证、
 * 核验页都有）。现在**批注层恒为显示**：调用方传了 `sealBoxes` / `showRegions` / `handwriting`，
 * 就是在说"这一屏要看 AI 依据"；不传则叠加层为空。
 * 于是"要不要批注"由**调用方传参**决定，不再由一个摆在自己内容上的按钮决定 ——
 * 那个按钮在多数页面里点了也没什么变化（该页的批注本来就在别处），只剩噪音。
 *
 * ⚠️ 连带后果（有意为之）：原先**默认落在「原始文件」**的那几处（回函结果填写页、查看函证详情）
 * 从此也直接显示批注层 —— 它们本就传了 `sealBoxes` / `handwriting`，只是默认没打开而已。
 *
 * ## 其余能力不变
 *
 * · 多页连续滚动、缩放（工具条 + Ctrl 滚轮 / 触控板捏合）与懒渲染由 `AnnotatedPdfPreview` 承载；
 * · 批注坐标与显示尺寸解耦（页面百分比），缩放与滚动时批注始终贴合文件内容；
 * · `markRange` / `markLabel`（标出「本段」/「本表」页区间）与 `scrollGroup`（多份预览同步滚动）照旧。
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
  locateToken = 0,
  totalPages = 2,
  sealBoxes = [],
  showRegions = false,
  activeRegion,
  height = 420,
  handwriting,
  markRange,
  markLabel = '本段',
  scrollGroup,
}: {
  confirmationNo: string
  /**
   * 直接指定要渲染的文件地址；不传则按函证编号推断回函附件样例。
   * 用于**内容不是回函附件**的预览（如快递面单：一份独立的单页面单扫描件）。
   */
  fileUrl?: string
  /**
   * **只渲染 `page` 那一页** —— 用于只看单页的场景（快递面单：一份单页扫描件，
   * 没有印章 / 落章区域 / 手写区，也没有其它页可看，铺整份只会让人以为漏了东西）。
   */
  singlePage?: boolean
  /** 以下三项由调用方传入，原件渲染不依赖（回函文件自带这些信息），保留以兼容既有调用 */
  entity?: string
  indexNo?: string
  totalPages?: number
  page?: number
  /**
   * 定位令牌（v2.70）—— `page` 没变时也能把视图**重新**定位过去，见 `AnnotatedPdfPreview`。
   * 用于「点右侧某张表 → 左侧原件跳到该表所在页」，同一张表可反复点。
   */
  locateToken?: number
  /** 印章定位框（AI 批注层）—— 不传即不画 */
  sealBoxes?: SealBox[]
  /** 是否展示「信息证明无误 / 信息不符」两个落章区域（AI 批注层） */
  showRegions?: boolean
  activeRegion?: '信息证明无误区' | '信息不符区' | '未识别'
  /** 预览高度：数字＝固定像素；`'100%'`＝撑满父容器（左固定栏场景，见 AnnotatedPdfPreview） */
  height?: number | string
  /** 手写体识别区（AI 批注层）—— 传了就在对应页上画出识别区 */
  handwriting?: string
  /**
   * 标出「本段」页区间（v2.56）—— 归属匹配里预览**整份回函**时用：
   * 整份铺出来、当前段描边打角标。不传 = 不标记。详见 `AnnotatedPdfPreview`。
   */
  markRange?: { start: number; end: number }
  /** 被标记页的角标前缀（默认「本段」）—— 见 `AnnotatedPdfPreview` 的同名 prop */
  markLabel?: string
  /**
   * **同步滚动分组键**（v3.01）—— 传同一个字符串的几份预览会同步上下滚动。
   * 核验页把「发函用印件」与「回函件」编成一组。见 `AnnotatedPdfPreview` 的同名 prop。
   */
  scrollGroup?: string
}) {
  return (
    /**
     * 根容器同样要吃满：内部 `AnnotatedPdfPreview` 的 `height` 是**相对本容器**算的
     * （本容器原先只有 `position:relative`、没有高度，传 `'100%'` 会直接塌成 0）。
     * `height:'100%'` 供普通容器、`flex:1` 供 flex 父级（左固定栏场景）——
     * 两者在各自场景下生效、互不干扰（flex 下 basis 优先，height 被忽略）。
     */
    <div style={{ position: 'relative', height: '100%', flex: 1, minHeight: 0 }}>
      <AnnotatedPdfPreview
        fileUrl={fileUrl ?? browserSampleUrlOf(confirmationNo)}
        page={page}
        locateToken={locateToken}
        singlePage={singlePage ? page : undefined}
        height={height}
        sealBoxes={sealBoxes}
        showRegions={showRegions}
        activeRegion={activeRegion}
        handwriting={handwriting}
        markRange={markRange}
        markLabel={markLabel}
        scrollGroup={scrollGroup}
      />
    </div>
  )
}
