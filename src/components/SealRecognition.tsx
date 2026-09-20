import { Button, Tooltip } from 'antd'
import type { SealResult } from '@/types'
import { InfoRow, ResultBar } from '@/components/Marks'

/**
 * 印章识别明细 —— 「结论条 → 事实清单 → 处理动作」三段骨架。
 *
 * 印章定位的可视化由 AI 核验页**左侧常驻主视图**承担（切到本项时自动切为 AI 批注视图），
 * 这里只呈现检测字段与判定，不内嵌第二个 PDF 预览（同屏两个 PDF 既占空间又让人分不清该看哪个）。
 */
export default function SealRecognition({ seal, entity }: { seal: SealResult; entity: string }) {
  const regionIsMismatch = seal.region === '信息不符区'

  /* ① 结论：一句话讲清「印章落在哪、因此回函结果应判为什么」，不复述业务规则 */
  const status = !seal.hasSeal || regionIsMismatch ? 'risk' : 'ok'
  const conclusion = !seal.hasSeal
    ? '未检出印章 · 回函结果无法判定，建议退回补盖公章'
    : regionIsMismatch
      ? '印章落于「信息不符」区 → 回函结果应为「不相符」'
      : '印章落于「信息证明无误」区 → 回函结果应为「相符」'

  return (
    <div>
      <ResultBar status={status} message={conclusion} />

      {/* ② 事实清单 */}
      <div style={{ background: 'var(--c-fill-light)', borderRadius: 8, padding: '8px 12px' }}>
        <InfoRow
          label="是否盖章"
          value={seal.hasSeal ? '已盖章' : '未盖章'}
          tone={seal.hasSeal ? 'ok' : 'risk'}
          confidence={0.99}
        />
        <InfoRow
          label="印章数量"
          value={`${seal.sealCount} 枚`}
          hint={seal.sealCount > 1 ? '存在多枚印章，建议确认是否均有效' : undefined}
        />
        <InfoRow
          label="骑缝章"
          value={seal.crossPageSeal ? `有（${seal.crossPageSealCount} 处）` : '未检出'}
          tone={seal.crossPageSeal ? 'ok' : 'risk'}
          hint={!seal.crossPageSeal ? '多页回函建议加盖骑缝章' : undefined}
          confidence={seal.crossPageSealCount ? 0.94 : 0.9}
        />
        <InfoRow label="印章类型" value={seal.sealType} confidence={0.97} />
        <InfoRow label="印章名称" value={seal.sealName} confidence={seal.confidence} />
        <InfoRow
          label="与被询证单位一致"
          value={seal.nameMatched ? '一致' : '不一致'}
          tone={seal.nameMatched ? 'ok' : 'risk'}
          hint={seal.nameMatched ? undefined : `发函单位：${entity}`}
          confidence={0.96}
        />
        <InfoRow
          label="落章区域"
          value={seal.region}
          tone={regionIsMismatch ? 'risk' : 'ok'}
          hint="决定回函结果是否相符"
          confidence={0.92}
        />
      </div>

      {/* ③ 处理动作 */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <Button size="small" type="primary" ghost>
          采纳该判定
        </Button>
        <Tooltip title="人工覆盖后系统会记录为「人工判定」，并保留 AI 原始结论">
          <Button size="small">人工判定为相符</Button>
        </Tooltip>
        <Button size="small">人工判定为不相符</Button>
      </div>
    </div>
  )
}
