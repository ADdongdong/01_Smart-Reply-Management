import { AiChip } from '@/components/Marks'
import { StatusTag } from '@/components/StatusTag'

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
  /** 风险等级标签文字（高风险 / 中风险 / 低风险 / 待人工判定）—— 卡头右侧彩色标签（v3.14，v3.16 改标签） */
  riskLabel,
  /** 风险语义档：决定标签配色（红 = 高 / 橙 = 中 / 绿 = 低 / 中性） */
  riskTone,
}: {
  owner?: string
  verdict: string
  tone: 'high' | 'low' | 'neutral'
  basis?: string
  confidence?: number
  reasons?: string[]
  riskLabel?: string
  riskTone?: 'high' | 'medium' | 'low' | 'neutral'
}) {
  /* 浅色底上用**深档**语义色文字（`-text`），不用原色 —— 原色在浅底上饱和度偏低、读起来发飘 */
  const toneColor =
    tone === 'high'
      ? 'var(--c-risk-high-text)'
      : tone === 'low'
        ? 'var(--c-risk-low-text)'
        : 'var(--c-text-2)'

  return (
    <div className="insight-card">
      {/*
       * 卡头：编号 · 单位 ／（右侧）风险等级。
       *
       * **风险等级随结论卡走（v3.14）** —— 用户要求：「风险等级也放在这个区域吧，
       * 这个区域相当于是结论区域。底下的风险等级的数据就可以不要了」。
       * 原先它只在页面底部出现**一次**、取的是 `primary`（第一封）的等级，
       * 多封一起识别时"这行风险是谁的"与当初那句「下面的不相符是什么意思」是同一个歧义。
       */}
      {(owner || riskLabel) && (
        <div
          className="insight-card__owner"
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <span>{owner}</span>
          {riskLabel && (
            /*
             * 风险等级 = **彩色标签**（v3.16，用户要求：「这个风险等级也用不同颜色的标签来展示，
             * 标签可以稍微大一点」）。
             *
             * 此前是「风险等级」四个字 + 一个染色数字 —— 读起来像一条**字段行**，
             * 而它是这一封的结论之一。现在直接复用全站统一件 `StatusTag`：
             * 浅底 + 深档文字，红 / 绿 / 中性三档，与列表「AI 风险」列**同形态、同用词**
             * （高风险 / 中风险 / 低风险）；尺寸走 v3.16 新开的 `lg` 档（26px）——
             * 与 17px 的结论文字并列时不显单薄。
             * 因此**「风险等级」前缀不再需要**：标签文字自己就带「风险」二字。
             */
            <span style={{ marginLeft: 'auto' }}>
              <StatusTag tone={riskTone} size="lg">
                {riskLabel}
              </StatusTag>
            </span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: toneColor }}>{verdict}</span>
        {basis && (
          <span style={{ fontSize: 12, color: 'var(--in-text-2)', minWidth: 0 }}>{basis}</span>
        )}
      </div>

      {/*
       * 置信度 —— **彩色胶囊**（v3.13，用户要求：「这个置信度进度条，根本看不见进度，都是灰色的，
       * 要么改成明显的颜色，要么改成彩色的标签，标签内是文字+置信度百分比」）。
       *
       * 原进度条为什么"全灰"：填充元素是个 `<span>`（**inline**），而 `width` / `height`
       * 对 inline 元素**不生效** ⇒ 填充宽度恒为 0，轨道那条 8% 灰底就成了唯一的可见部分。
       * （真要留进度条，一行 `.confidence__fill { display: block }` 即可；本条已改走胶囊形态。）
       *
       * 胶囊是**项目既有件** `AiChip` —— 与「回函结果填写」页的 AI 结论用的是同一个，
       * 文字与百分比同处一个标签内、低置信度走红档，比一条 6px 细线更经得起扫视，
       * 也免了"条 + 百分比"两处信息各说一半。
       */}
      {confidence != null && (
        <div style={{ marginTop: 14 }}>
          <AiChip confidence={confidence} label="置信度" />
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
