import { Button } from 'antd'
import type { HandwritingResult } from '@/types'
import { AiChip, InfoRow, ResultBar } from '@/components/Marks'

/**
 * 手写体识别明细 —— 「结论条 → 事实清单 → 处理动作」三段骨架。
 *
 * 不再内嵌「手写区域定位（原图裁剪）」：左侧常驻主视图切到 AI 批注时已有「手写体识别区」标注框，
 * 这里再裁一张图属重复，也是四项里唯一的双栏结构（已按统一方案移除）。
 */
export default function HandwritingRecognition({
  result,
  onAdopt,
}: {
  result: HandwritingResult
  onAdopt?: (text: string) => void
}) {
  /**
   * 结论里出现「不一致 / 需复核」时转需关注档 —— 手写转录本身是客观检出（中性），
   * 但与印章落章区域矛盾时属于要人工介入的情形。
   * 注：真实实现应由后端给出结构化字段（如 `consistent`），此处按文案判定仅为原型便利。
   */
  const inconsistent = /不一致|复核/.test(result.conclusion)

  return (
    <div>
      {/* ① 结论条 */}
      <ResultBar
        status={inconsistent ? 'risk' : 'info'}
        message={result.conclusion}
        detail="转录文本可直接带入「回函结果填写」页的「回函结果不相符处的描述」"
      />

      {/* ② 事实清单 */}
      <div style={{ background: 'var(--c-fill-light)', borderRadius: 8, padding: '8px 12px' }}>
        <InfoRow
          label="识别区域"
          value={`「${result.region}」`}
          hint="手写内容所在栏位"
          confidence={result.confidence}
        />
        <InfoRow label="转录字数" value={`${result.text.length} 字`} />
      </div>

      {/* 转录文本 —— 保留手写体字形，便于与原件对照 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px' }}>
        <span className="section-title" style={{ fontSize: 13 }}>
          转录文本
        </span>
        <AiChip confidence={result.confidence} label="OCR" />
      </div>
      <div className="handwriting-zone" style={{ padding: '10px 12px', lineHeight: 2 }}>
        {result.text}
      </div>

      {/* ③ 处理动作 */}
      <div style={{ marginTop: 12 }}>
        <Button size="small" type="primary" ghost onClick={() => onAdopt?.(result.text)}>
          采纳并带入描述
        </Button>
      </div>
    </div>
  )
}
