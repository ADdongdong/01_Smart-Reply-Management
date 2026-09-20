import { Button } from 'antd'
import type { ReplyRecord } from '@/types'
import FullscreenModal from '@/components/FullscreenModal'
import VerificationPanel from '@/components/VerificationPanel'
import { RiskTag, VerifyBadge, VerifyProgress } from '@/components/Marks'

/**
 * AI 智能核验（列表页入口的弹窗形态）。
 *
 * **本页只读 —— 用于查看 AI 的判断依据**，不承担确认动作：
 * 「已人工核验」的留痕统一在「确认回函快递信息」（回函快递信息录入）时一次性打掉，
 * 同一件事不设两处签字，用户也就不会困惑「该点哪个」。
 *
 * 内容抽在 `VerificationPanel` 里，因而同一份检测明细也能被结果填写页内嵌复用
 * （在那里看明细不会卸载结果填写弹窗、不会丢草稿）。
 */
export default function VerificationModal({
  open,
  record,
  onClose,
}: {
  open: boolean
  record?: ReplyRecord
  onClose: () => void
}) {
  if (!record) return null
  const v = record.verification

  return (
    <FullscreenModal
      open={open}
      title="AI 智能核验"
      subtitle={v ? `${record.confirmationNo} · ${record.entity}` : record.confirmationNo}
      extra={v ? <RiskTag level={v.riskLevel} reasons={v.riskReasons} /> : undefined}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
            本页用于查看 AI 的判断依据；核验确认与留痕在「确认回函快递信息」时一次性完成
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {v && (
            <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
              核验进度 <VerifyProgress done={v.completedModules} total={v.totalModules} risk={v.riskLevel} />
              <span style={{ marginLeft: 10 }}>
                <VerifyBadge status={record.verifyStatus} by={record.verifiedBy} at={record.verifiedAt} />
              </span>
            </span>
          )}
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <VerificationPanel record={record} />
    </FullscreenModal>
  )
}
