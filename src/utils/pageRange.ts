import type { RecognitionTask } from '@/types'

/**
 * 页码区间的**展示字符串** —— 由 `pageStart` / `pageEnd` 派生（v2.56）。
 *
 * 为什么不把「第 1-4 页」直接存进任务（这是改造前的做法）：
 * 归属匹配要展示**切分结果**（哪些页归到哪封函证）、并按本段页码**定位原文件预览**，
 * 这两件事都要拿页码**做计算**（排序、校验连续性、滚动到页），
 * 字符串无法参与。故只存数值，展示时统一从这里生成 —— **同一事实只有一个来源**。
 *
 * 缺数值时退回「—」：切分信息属于 v2.56 才结构化的字段，
 * 缺省说明该任务不是「按页切成的一段」（不该静默造一个假区间）。
 */
export function pageRangeOf(task: Pick<RecognitionTask, 'pageStart' | 'pageEnd'>): string {
  const { pageStart, pageEnd } = task
  if (pageStart == null || pageEnd == null) return '—'
  /* 单页段不写成「第 3-3 页」 */
  return pageStart === pageEnd ? `第 ${pageStart} 页` : `第 ${pageStart}-${pageEnd} 页`
}

/**
 * 解析种子里的「第 1-4 页」字符串 → `{ start, end }`。
 *
 * 存在的理由：mock 的种子数据用字符串书写**人读起来最直观**（`pageRange: '第 1-4 页'`），
 * 但任务对象上必须存**数值**（见 `RecognitionTask.pageStart` 的注释）。
 * 故转换放在两者之间 —— 种子里写字符串，`createTask` 入库时转数值。
 * 解析失败返回 `undefined`（宁可缺页码，也不要造一个假的区间）。
 */
export function parsePageRange(text?: string): { start: number; end: number } | undefined {
  if (!text) return undefined
  const m = text.match(/第\s*(\d+)\s*(?:[-–~至]\s*(\d+))?\s*页/)
  if (!m) return undefined
  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : start
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return { start, end }
}

/** 该段是否包含某一页（预览定位与切分表高亮共用） */
export function coversPage(
  task: Pick<RecognitionTask, 'pageStart' | 'pageEnd'>,
  page: number,
): boolean {
  const { pageStart, pageEnd } = task
  if (pageStart == null || pageEnd == null) return false
  return page >= pageStart && page <= pageEnd
}

/**
 * 对同属一个上传文件的各段做**连续性校验** —— 切分结果表用它提示异常。
 *
 * 真实场景里「切分」是识别阶段按归属算出来的，理论上应当无缝无重叠
 * （1-4 / 5-8 / 9-11）。但**归属是人工可改的**，改完就可能出现断档或重叠，
 * 而这类错误不看原件根本发现不了（用户只会觉得「这封回函怎么少了一页」）。
 * 返回问题描述数组，空数组表示切分正常。
 */
export function splitIssuesOf(tasks: Pick<RecognitionTask, 'pageStart' | 'pageEnd'>[]): string[] {
  const spans = tasks
    .filter((t) => t.pageStart != null && t.pageEnd != null)
    .map((t) => ({ start: t.pageStart!, end: t.pageEnd! }))
    .sort((a, b) => a.start - b.start)
  if (spans.length < 2) return []

  const issues: string[] = []
  const totalPages = Math.max(...spans.map((s) => s.end))
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1]
    const cur = spans[i]
    if (cur.start === prev.start && cur.end === prev.end) {
      issues.push(`第 ${cur.start}-${cur.end} 页被重复归属`)
    } else if (cur.start <= prev.end) {
      issues.push(`第 ${prev.end + 1}-${cur.start} 页被重复归属`)
    } else if (cur.start > prev.end + 1) {
      issues.push(`第 ${prev.end + 1}-${cur.start - 1} 页未归属任何函证`)
    }
  }
  /* 首段不从第 1 页起、或末段不到文件末页，同样是断档（两端容易漏检） */
  if (spans[0].start > 1) issues.push(`第 1-${spans[0].start - 1} 页未归属任何函证`)
  const last = spans[spans.length - 1]
  if (last.end < totalPages) issues.push(`第 ${last.end + 1}-${totalPages} 页未归属任何函证`)

  return issues
}
