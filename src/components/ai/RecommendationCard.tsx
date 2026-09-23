/**
 * 建议卡（v2.57）—— 以「AI 建议 + 置信度」呈现识别结论。
 *
 * 形态取自 beautifului.dev 的 **Recommendation Card**（建议 + 置信度条 + 动作）。
 *
 * ## 为什么必须标明「建议」
 *
 * 项目底线是「**AI 只出建议、人工确认才算数**」（见 `Marks.tsx` 的 `MatchTag` 注释）。
 * 本界面是用户主动进来看 AI 干了什么的地方，看到的结论**最容易**被当成定论 ——
 * 故卡片尾部固定有一句"未经人工核验"，且**不提供采纳动作**：
 * 用不用这个结果由用户在「回函结果确认」页决定（用户明确要求）。
 * 这条边界比卡片的视觉更重要。
 */
export function RecommendationCard({
  /**
   * 这张卡属于**哪一封函证**（v2.61）。
   *
   * 多封一起识别时，一张不标明归属的「不相符」是无从理解的 —— 用户实测就问过
   * 「**下面的不相符是什么意思**」（其实是指第一段，但界面没说）。
   */
  owner,
  /** 结论，如「不相符」/「相符」/「待人工判定」 */
  verdict,
  /** 语义档位：决定结论文字色（红 / 绿 / 中性），**不改底色** */
  tone,
  /** 一行依据摘要 */
  basis,
  /** 置信度（0–1）；低于 0.9 转风险红档 */
  confidence,
  /** 风险原因等补充行 */
  reasons,
}: {
  owner?: string
  verdict: string
  tone: 'high' | 'low' | 'neutral'
  basis?: string
  confidence?: number
  reasons?: string[]
}) {
  const low = confidence != null && confidence < 0.9
  /* 浅色底上用**深档**语义色文字（`-text`），不用原色 —— 原色在浅底上饱和度偏低、读起来发飘 */
  const toneColor =
    tone === 'high'
      ? 'var(--c-risk-high-text)'
      : tone === 'low'
        ? 'var(--c-risk-low-text)'
        : 'var(--c-text-2)'

  return (
    <div className="insight-card">
      {owner && <div className="insight-card__owner">{owner}</div>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: toneColor }}>{verdict}</span>
        {basis && (
          <span style={{ fontSize: 12, color: 'var(--in-text-2)', minWidth: 0 }}>{basis}</span>
        )}
      </div>

      {confidence != null && (
        <div className="confidence" style={{ marginTop: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--in-text-3)' }}>置信度</span>
          <span className="confidence__track">
            <span
              className={low ? 'confidence__fill is-low' : 'confidence__fill'}
              style={{ width: `${Math.round(confidence * 100)}%` }}
            />
          </span>
          <span className="confidence__pct in-num">{Math.round(confidence * 100)}%</span>
        </div>
      )}

      {reasons && reasons.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {reasons.map((r) => (
            <span key={r} className="task-row__detail-line" style={{ fontSize: 12 }}>
              {r}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          paddingTop: 11,
          borderTop: '1px solid var(--in-line)',
          fontSize: 11,
          color: 'var(--in-text-3)',
        }}
      >
        以下是 AI 的建议值，尚未经人工核验；是否采用由你在「回函结果确认」时决定。
      </div>
    </div>
  )
}
