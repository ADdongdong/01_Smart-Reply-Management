import type { PageSegment } from '@/types'

/**
 * 页级切分的**计算层**（v2.62）—— 「回函归属」界面的手动切分所需的一切换算。
 *
 * ## 为什么单独成文件
 *
 * `utils/pageRange.ts` 管的是**已有切分的展示与校验**（`pageRangeOf` / `splitIssuesOf`），
 * 前置条件是"切分已经存在"；本文件管的是**切分本身怎么被编辑出来**
 * （切点 ⇄ 段、批量拆分的三种算法、自定义范围的解析）。
 * 一个回答"它是什么"，一个回答"怎么改它"，混在一起会让两边都难读。
 *
 * ## 唯一的真相是「切点」
 *
 * 界面上的手动切分，本质是一串**切点**：`cuts = [3, 6]` 表示「第 3 页后、第 6 页后各切一刀」，
 * 于是得到 1-3 / 4-6 / 7-9 三段。段列表、批量工具全部由它派生 ——
 * **界面只维护 `cuts` 一个状态**，不维护两份（段 + 切点）以免两者不一致。
 *
 * 字段名与 `RecognitionTask` 的 `pageStart` / `pageEnd` 对齐，好让段能直接喂给
 * `pageRangeOf` / `splitIssuesOf` 这些既有函数，不必再转一层。
 */

/** 一段连续的页 —— 字段名与 `RecognitionTask` 对齐（见上方说明） */
export type { PageSegment }

/** 切点排序去重 —— 越界的切点丢弃（页面被删/页数变小后可能残留） */
function normalizeCuts(pageCount: number, cuts: number[]): number[] {
  return [...new Set(cuts)].filter((c) => c >= 1 && c < pageCount).sort((a, b) => a - b)
}

/**
 * 切点 → 段。
 *
 * 切点为空时返回**整份一段**（`[{1, pageCount}]`）—— 这正是银行函证打开时的初始态：
 * 用户要的「整份 1 段，从头手动切」，在数据上就是"一个切点都没有"。
 */
export function segmentsOfCuts(pageCount: number, cuts: number[]): PageSegment[] {
  if (pageCount < 1) return []
  const sorted = normalizeCuts(pageCount, cuts)
  const segs: PageSegment[] = []
  let start = 1
  for (const c of sorted) {
    segs.push({ pageStart: start, pageEnd: c })
    start = c + 1
  }
  segs.push({ pageStart: start, pageEnd: pageCount })
  return segs
}

/** 段 → 切点（取每段的pageEnd，末段不算） */
export function cutsOfSegments(segs: PageSegment[]): number[] {
  return segs.slice(0, -1).map((s) => s.pageEnd)
}

/** 在第 `afterPage` 页后**切换**切点（已切则取消）—— 剪刀按钮的语义 */
export function toggleCut(pageCount: number, cuts: number[], afterPage: number): number[] {
  const set = new Set(normalizeCuts(pageCount, cuts))
  if (set.has(afterPage)) set.delete(afterPage)
  else set.add(afterPage)
  return [...set].sort((a, b) => a - b)
}

/* ------------------------------ 批量拆分 ------------------------------ */

/**
 * ① 按固定页数拆分 —— 每 `perPage` 页一段。
 * 末段不足 `perPage` 页也照样成段（与 PDF 工具的通行做法一致）。
 */
export function cutsByFixedPages(pageCount: number, perPage: number): number[] {
  const n = Math.max(1, Math.floor(perPage))
  const cuts: number[] = []
  for (let p = n; p < pageCount; p += n) cuts.push(p)
  return cuts
}

/**
 * ② 按文档数量均分 —— 切成 `count` 段，**页数尽量平均**。
 *
 * 余数分给靠前的段（9 页切 4 段 → 3/2/2/2），而不是全塞给最后一段：
 * 前者每段页数相近、看起来是"均分"，后者会出现一个明显臃肿的尾巴。
 */
export function cutsByCount(pageCount: number, count: number): number[] {
  const m = Math.max(1, Math.min(Math.floor(count) || 1, pageCount))
  if (m === 1) return []
  const base = Math.floor(pageCount / m)
  const rest = pageCount % m
  const cuts: number[] = []
  let acc = 0
  for (let i = 0; i < m - 1; i++) {
    acc += base + (i < rest ? 1 : 0)
    cuts.push(acc)
  }
  return cuts
}

/**
 * ③ 按自定义范围拆分 —— 解析 `1-4, 5-8, 9-11` 这类输入（也接受中文逗号 / 顿号 / 空格分隔）。
 *
 * **要求恰好铺满整份**：首段必须从第 1 页起、末段必须到末页、中间无缝无重叠。
 * 因为"切分"的定义就是**把整份完整地分成若干段**；若允许留空或重叠，
 * 就会出现"第 5-7 页既没归这段、也没归那段"的悬空页 —— 那正是
 * `splitIssuesOf` 事后要报警的错误状态，不该让人从输入框里造出来。
 *
 * 解析失败（格式错 / 不铺满 / 越界）返回 `null`，界面据此保持原切分不动、只提示。
 */
export function cutsByCustomRanges(text: string, pageCount: number): number[] | null {
  const parts = text.split(/[,，、;；\s]+/).filter(Boolean)
  if (!parts.length) return null

  const segs: PageSegment[] = []
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*[-–~至]\s*(\d+))?$/)
    if (!m) return null
    const start = Number(m[1])
    const end = m[2] ? Number(m[2]) : start
    if (start < 1 || end < start || end > pageCount) return null
    segs.push({ pageStart: start, pageEnd: end })
  }

  segs.sort((a, b) => a.pageStart - b.pageStart)
  if (segs[0].pageStart !== 1) return null
  if (segs[segs.length - 1].pageEnd !== pageCount) return null
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].pageStart !== segs[i - 1].pageEnd + 1) return null
  }
  return cutsOfSegments(segs)
}

/** 段里是否包含某页 —— 缩略图板据此高亮"当前段" */
export function segmentCoversPage(seg: PageSegment, page: number): boolean {
  return page >= seg.pageStart && page <= seg.pageEnd
}
