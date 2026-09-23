/**
 * 来源卡（v2.57）—— 一条依据的出处。
 *
 * 形态取自 beautifului.dev 的 **Context Cards**（检索到的片段 + 来源）。
 *
 * ## 在审计场景里的意义
 *
 * 这一块不是装饰。审计看的是**证据链**：一个"不相符"的结论，
 * 必须能回答「依据在哪」—— 是原件第几页的哪张表、还是系统内那封函证的哪个金额。
 * 故每张卡只承载一条出处，且**只在确有来源时出现**（无来源不占位，
 * 避免用空卡凑数 —— 那会让人以为"有依据只是没显示"）。
 */
export interface SourceItem {
  /** 类型标记，如「原件」「系统数据」「面单」 */
  kind: string
  /** 出处，如「齐商银行回函 · 第 3 页」 */
  from: string
  /** 片段摘要（可省） */
  quote?: string
}

export function SourceCards({ items }: { items: SourceItem[] }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((s) => (
        <div key={`${s.kind}-${s.from}`} className="source-card">
          <span className="source-card__kind">{s.kind}</span>
          <span className="source-card__body">
            <span className="source-card__from">{s.from}</span>
            {s.quote && <span className="source-card__quote">{s.quote}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
