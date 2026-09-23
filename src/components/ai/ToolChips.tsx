/**
 * 计数标签（v2.57）—— 一排紧凑标签，回答「做了几项、几项要关注」。
 *
 * 形态取自 beautifului.dev 的 **Tool Chips**（把工具调用压缩成紧凑 chip，
 * 如「4 tool calls, 2 messages」）。
 *
 * 用在这里的价值是**先给结论的体量、再给过程**：用户进这个界面第一眼看到
 * 「4 项检测 · 2 项已完成」，比直接看到四行任务更容易建立预期。
 * 故它挂在任务列表上方，而不是列表下方做统计。
 */
export interface ChipItem {
  text: string
  /** `warn` 红档（需关注）／`ok` 绿档（通过）／缺省中性。语义色仍取项目既有红绿 */
  tone?: 'ok' | 'warn'
}

export function ToolChips({ items }: { items: ChipItem[] }) {
  if (!items.length) return null
  return (
    <div className="chips">
      {items.map((c) => (
        <span
          key={c.text}
          className={
            c.tone === 'warn' ? 'chip chip--warn' : c.tone === 'ok' ? 'chip chip--ok' : 'chip'
          }
        >
          {c.text}
        </span>
      ))}
    </div>
  )
}
