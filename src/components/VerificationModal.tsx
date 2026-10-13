import { useEffect, useState } from 'react'
import { App, Button } from 'antd'
import { CheckOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { AiReviewKey, ReplyRecord } from '@/types'
import { useApp } from '@/store/AppStore'
import {
  aiReviewItemsOf,
  aiReviewStateOf,
  aiReviewTip,
  isAiReviewAvailable,
} from '@/config/aiReview'
import FullscreenModal from '@/components/FullscreenModal'
import VerificationPanel from '@/components/VerificationPanel'
import { RiskTag, VerifyBadge } from '@/components/Marks'

/**
 * AI 智能核验（从列表「AI 核验事项」列的事项标签点进来的**详情弹窗**）。
 *
 * ## 它承担什么（v3.28 起变了）
 *
 * 原先本页**只读** —— 「看」在这里、「定」在「回函结果填写」页，用户要跨两个界面才能办完一件事。
 * v3.28 按用户口径改成**看与定同屏**：打开即落在被点的那一项上，页脚给
 * 「**采纳识别数据**」与「**不采纳识别数据**」两个动作 ——
 * 「这三个字段点击可查看识别的详情，详情中，需要有按钮：采纳识别数据，不采纳识别数据」。
 *
 * ## 两个动作的语义（用户拍板，别改）
 *
 * · **采纳** —— 采用 AI 结论；该结论会在「回函结果填写」页**自动带出**到对应字段
 *   （映射见 `config/aiReview` 的 `aiReviewPrefill`）；
 * · **不采纳** —— **只标记「已看过、不采用」**，不带入任何值，由人工自己在结果页填。
 *
 * 两者都写 `ReplyRecord.aiReview`（含**处理人与时间**）—— 列表上那一枚标签随即由
 * 「待核验」变为「已处理」（打勾）。**"已完成核验"这条留痕（核验人 / 核验时间）仍只在
 * 「确认回函快递信息」时打**，与本处的处理留痕是两件事：一个是"这项 AI 结论我看过了"，
 * 一个是"这封回函我核验过了"。
 *
 * 内容抽在 `VerificationPanel` 里，因而同一份检测明细也能被结果填写页内嵌复用
 * （在那里看明细不会卸载结果填写弹窗、不会丢草稿）。
 */
export default function VerificationModal({
  open,
  record,
  initialKey,
  onClose,
}: {
  open: boolean
  record?: ReplyRecord
  /**
   * 从列表「AI 核验事项」列点进来的那一项（v3.28）—— 打开即定位到它，
   * 页脚的「采纳 / 不采纳」也按它决定作用于哪一项。
   */
  initialKey?: AiReviewKey
  onClose: () => void
}) {
  const { dispatch } = useApp()
  const { message } = App.useApp()

  const items = record ? aiReviewItemsOf(record.type) : []
  /** 被点的那一项 → 它对应的核验页签（`config/aiReview` 是这层对应的唯一出处） */
  const initialPanelKey = items.find((i) => i.key === initialKey)?.panelKey
  /** 当前页签 —— 面板会随用户切页签上报，页脚动作跟着走 */
  const [panelKey, setPanelKey] = useState<string | undefined>(initialPanelKey)
  useEffect(() => {
    setPanelKey(initialPanelKey)
  }, [initialPanelKey, open])

  if (!record) return null
  const v = record.verification

  /* 页签 → 事项（反查）：页脚那两个动作永远作用于"当前正在看的那一项" */
  const item = items.find((i) => i.panelKey === panelKey)
  const state = item ? aiReviewStateOf(record, item.key) : undefined
  /** 该项有没有 AI 结论可采纳（没有就别给一个点了没反应的按钮） */
  const available = item ? isAiReviewAvailable(record, item.key) : false

  const decide = (status: 'adopted' | 'ignored') => {
    if (!item) return
    dispatch({ type: 'REVIEW_AI_ITEM', recordId: record.id, key: item.key, status })
    message.success(
      status === 'adopted'
        ? `已采纳「${item.label}」的识别数据 —— 将在「回函结果填写」页自动带出`
        : `已标记「${item.label}」不采纳 —— 不带入任何值，由你自行填写`,
    )
    /*
     * **表过态就收工**（v3.29）—— 用户：「每个字段点进去后，无论点击采纳识别数据，还是不采纳
     * 识别数据，**都自动退出弹窗**」。
     *
     * 进这个弹窗只为办一件事（看依据 → 表态），办完就走；留在原地既不必要，还会让人怀疑
     * "是不是没生效、要不要再点一次"。列表上那一项随即由「待核验」变为「已处理」，
     * 要改判随时可以再点进来 —— 这里不是"关掉就没了"的确认框。
     */
    onClose()
  }

  return (
    <FullscreenModal
      open={open}
      title="AI 智能核验"
      subtitle={v ? `${record.confirmationNo} · ${record.entity}` : record.confirmationNo}
      extra={v ? <RiskTag level={v.riskLevel} reasons={v.riskReasons} /> : undefined}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {item ? (
            <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
              {state ? (
                <>
                  <CheckOutlined style={{ color: 'var(--c-risk-low)', marginRight: 4 }} />
                  {item.label}：{aiReviewTip(state)}
                </>
              ) : available ? (
                <>看完依据后在这里表态 —— 采纳或不采纳都算把这一项办完</>
              ) : (
                <>本次未识别到该项结论，可标记不采纳后由人工填写</>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
              核验确认与留痕在「确认回函快递信息」时完成
            </span>
          )}
          <span style={{ marginLeft: 'auto' }} />
          {/*
            去掉「核验进度 6/6」（v2.25）：计数是系统内部指标，用户看不出它的含义；
            AI 究竟查了哪几项，本页正文已经逐项列出，不需要再给一个数。
          */}
          {v && (
            <VerifyBadge status={record.verifyStatus} by={record.verifiedBy} at={record.verifiedAt} />
          )}
          {item && (
            <>
              <Button
                icon={<CloseCircleOutlined />}
                /* 已标记不采纳时不必再点一次（可改判，但按钮不重复表达当前态） */
                type={state?.status === 'ignored' ? 'primary' : 'default'}
                ghost={state?.status === 'ignored'}
                onClick={() => decide('ignored')}
              >
                不采纳识别数据
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!available}
                title={available ? undefined : '本次未识别到该项结论，没有可采纳的数据'}
                onClick={() => decide('adopted')}
              >
                采纳识别数据
              </Button>
            </>
          )}
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <VerificationPanel
        /* 换一项打开时重挂载，页签与左侧取景都回到"被点的那一项"（v3.28） */
        key={`${record.id}:${initialPanelKey ?? ''}`}
        record={record}
        initialKey={initialPanelKey}
        onItemChange={setPanelKey}
      />
    </FullscreenModal>
  )
}
