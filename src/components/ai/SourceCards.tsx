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
 *
 * ## v3.15：本组件**当前无人挂载**（保留备用）
 *
 * 智能识别界面里那一摞「回函原件 · 第 N-M 页」的卡已被用户判为多余并移除
 * （原话：「这个区域的内容，删除，不知道是干啥的」）—— 它列的素材与归属
 * 恰恰是用户上一屏（归属界面）**自己逐段确认过的东西**，此处只是重抄一遍。
 * 组件本体按既有习惯**保留备用**（同 KKFileView 的处理），样式 `.source-card*` 仍在
 * `styles/insight.css`；若"结论依据在哪"另有落点（如检测点依据明细之外的独立证据区），
 * 它可以直接复用。
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
