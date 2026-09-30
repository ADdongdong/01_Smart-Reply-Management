/**
 * 一致性比对的**单元格口径**（v2.69）。
 *
 * 为什么单独抽出来：同一份数据有**两处消费方** ——
 *   ① **拍平记录**（`mock/confirmations.ts` 的 `flattenConsistency`）→ 供「共几项、几项不一致」的汇总；
 *   ② **逐表红框**（`ConsistencyDiff`）→ 供界面上逐单元格的差异标注。
 *
 * 两处若各写一套判定，就会出现「结论条说 1 项不符、表里却框了 2 处」这种自相矛盾 ——
 * 本项目的既有口径是**同源**（见「询证事项」那套 `buildBankItemGroups` / `buildBankItemsForRecord`）。
 */

/** 金额单元格 → 数字；空 / 「-」/「—」等非金额 → null */
export function parseAmount(text: string | undefined | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[,\s元]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === '--') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * 单元格比对结论：
 * · `same`    一致；
 * · `diff`    两侧都有金额但数值不同；
 * · `missing` 发函有金额、回函未列示；
 * · `extra`   发函无、回函新增。
 */
export type CellState = 'same' | 'diff' | 'missing' | 'extra'

/**
 * 比较同一位置的「发函值 / 回函值」。
 *
 * 判定顺序：先各自尝试读成金额 ——
 * · 两侧都能读成金额 → 比数值；
 * · 只有一侧能读成金额 → `missing` / `extra`；
 * · 两侧都不是金额（科目 / 采购内容 / 备注这类文本）→ 比去掉首尾空白后的原文。
 */
export function compareCell(sent: string, replied: string): CellState {
  const s = parseAmount(sent)
  const r = parseAmount(replied)
  if (s != null || r != null) {
    if (s == null) return 'extra'
    if (r == null) return 'missing'
    return s === r ? 'same' : 'diff'
  }
  return sent.trim() === replied.trim() ? 'same' : 'diff'
}
