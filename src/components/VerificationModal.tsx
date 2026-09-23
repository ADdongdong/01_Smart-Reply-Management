import { Button } from 'antd'
import type { ReplyRecord } from '@/types'
import FullscreenModal from '@/components/FullscreenModal'
import VerificationPanel from '@/components/VerificationPanel'
import { RiskTag, VerifyBadge } from '@/components/Marks'

/**
 * AI 智能核验（列表页入口的弹窗形态）。
 *
 * **本页只读 —— 用于查看 AI 的判断依据**，不承担确认动作：
 * 核验留痕（核验人 + 核验时间）统一在「确认回函快递信息」时一次性打下，
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
            核验确认与留痕在「确认回函快递信息」时完成
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {/*
            去掉「核验进度 6/6」（v2.25）：计数是系统内部指标，用户看不出它的含义；
            AI 究竟查了哪几项，本页正文已经逐项列出，不需要再给一个数。
          */}
          {v && (
            <VerifyBadge status={record.verifyStatus} by={record.verifiedBy} at={record.verifiedAt} />
          )}
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <VerificationPanel record={record} />
    </FullscreenModal>
  )
}
