import { useEffect, useState } from 'react'
import { App, Button, Input, Modal } from 'antd'
import { CheckOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { AiReviewKey, ReplyRecord, ReplyResultInfo } from '@/types'
import { useApp } from '@/store/AppStore'
import {
  aiReviewAdoptPatchOf,
  aiReviewItemsOf,
  aiReviewPrefill,
  aiReviewStateOf,
  aiReviewTip,
  isAiReviewAvailable,
  type AiReviewItem,
} from '@/config/aiReview'
import { RESULT_EXTRA_PANEL_KEY, replyTaskSummaryOf } from '@/config/replyTasks'
import FullscreenModal from '@/components/FullscreenModal'
import VerificationPanel from '@/components/VerificationPanel'
import { RiskTag, VerifyBadge } from '@/components/Marks'

/**
 * 把一段 AI 说明**并进**说明字段 —— 已有内容则分段追加，已包含则不重复（v3.34）。
 *
 * 采纳是"代入"而不是"接管"：`diffDesc` 在站内有多个 AI 出处（一致性差异 / 手写体转录），
 * 覆盖式写入会把别的段落连同人工写下的内容一起抹掉。
 */
function appendSegment(existing: string | undefined, add: string): string {
  const base = existing?.trim()
  if (!base) return add
  return base.includes(add) ? base : `${base}\n\n${add}`
}

/**
 * AI 智能核验（从列表「核查事项复核」列的事项点进来的**详情弹窗**）。
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
 * ## 表过态之后往哪走（v3.34 更新）
 *
 * **前进到下一个未表态的 AI 核查项**，不再退出弹窗 —— 用户口径：「选择采纳后，调到下一个Ai核查项，
 * 而不是退出窗口」（v3.29 那条"办完自动退出"由此作废）；
 * **办完最后一个 AI 核查项则一律落到最后一个页签**「回函结果补充」—— 那是这次核验的收尾页
 * （附件、底稿指引、唯一的「保存」都在那儿，用户口径：「手写体识别，点完采纳识别数据，
 * 或者不采纳填完不采纳说明后，需要调到最后一个 tab」）。详见 `advance` 里的注释。
 *
 * 内容抽在 `VerificationPanel` 里，因而同一份检测明细也能被结果填写页内嵌复用
 * （在那里看明细不会卸载结果填写弹窗、不会丢草稿）。
 */
export default function VerificationModal({
  open,
  record,
  initialPanelKey,
  onClose,
}: {
  open: boolean
  record?: ReplyRecord
  /**
   * 打开时**落在哪一页签**（v3.28 立；v3.31 起传"第一个未完成的事项"；v3.33 起改传**页签 key**）
   * —— 待办现在也包含"回函结果必填项"，而它落在第 4 项（`RESULT_EXTRA_PANEL_KEY`）、
   * 不属于任何 AI 页签，故由承载者按 `replyTaskEntryPanelKeyOf` 算好页签 key 直接传入
   * （本组件不再自己做"事项 → 页签"的换算）。
   * 打开即定位到它，页脚的「采纳 / 不采纳」也按它决定作用于哪一项（切页签时由面板上报、跟着走）。
   * 传 `undefined` 时退回面板自己的缺省首位（正常数据不会走到）。
   */
  initialPanelKey?: string
  onClose: () => void
}) {
  const { dispatch } = useApp()
  const { message } = App.useApp()

  const items = record ? aiReviewItemsOf(record.type) : []
  /** 当前页签 —— 面板会随用户切页签上报，页脚动作跟着走；也是"采纳后自动前进"的落点 */
  const [panelKey, setPanelKey] = useState<string | undefined>(initialPanelKey)
  useEffect(() => {
    setPanelKey(initialPanelKey)
  }, [initialPanelKey, open])

  /**
   * **「人工确认」列的草稿**（v3.34）—— 用户拍板的口径 A：
   * 「人工列就是 `resultInfo` 的草稿，采纳 = 填初值，落库仍只在『保存』那一个出口」。
   *
   * 为什么草稿挂在本组件、而不是各页签自己存：人工列散在三个页签里，**保存按钮却在第 4 项**，
   * 草稿若跟着页签卸载，用户从「印章识别」切到「回函结果补充」就把它丢了。
   *
   * 初值 = **已保存值优先，其次才是已采纳项的带出值**（与结果页那三层优先级同一套口径，
   * 见 `ReplyResultModal` 的表单初值注释）。
   */
  const [draft, setDraft] = useState<Partial<ReplyResultInfo>>({})
  useEffect(() => {
    if (!record) return
    setDraft({ ...aiReviewPrefill(record), ...record.resultInfo })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, open])

  /** 不采纳说明弹窗的目标项（null = 关着）与那格原因 */
  const [ignoreFor, setIgnoreFor] = useState<AiReviewItem | null>(null)
  const [ignoreReason, setIgnoreReason] = useState('')

  if (!record) return null
  const v = record.verification

  /* 页签 → 事项（反查）：页脚那两个动作永远作用于"当前正在看的那一项" */
  const item = items.find((i) => i.panelKey === panelKey)
  const state = item ? aiReviewStateOf(record, item.key) : undefined
  /** 该项有没有 AI 结论可采纳（没有就别给一个点了没反应的按钮） */
  const available = item ? isAiReviewAvailable(record, item.key) : false
  /**
   * 还没办的事（未表态的 AI 项 + 未填的回函结果必填项）—— 页脚那句"还剩 N 项"用它。
   * 自动前进之后，这句话是用户判断"要不要继续点下去"的唯一依据，不能省。
   * 必填项的判定带上草稿：刚在人工列里填过的，不该还算"没填"。
   */
  const remaining =
    items.filter((i) => !aiReviewStateOf(record, i.key)).length +
    replyTaskSummaryOf(record, draft).fieldPending.length

  /** 草稿合并 —— 人工列与"采纳代入"都走它（草稿只在本组件里流转，落库由「保存」统一做） */
  const patchDraft = (patch: Partial<ReplyResultInfo>) => setDraft((d) => ({ ...d, ...patch }))

  /**
   * **采纳 = 把这一项的 AI 结论代进人工确认列**（v3.34，用户口径：
   * 「如果采纳了，则自动把 ai 识别的结果代入到人工填写的字段里面去」）。
   *
   * 两类字段两种处理（都只写草稿）：
   * · **判定类**（是否相符 / 名称是否一致 / 是否公章 / 骑缝章）→ 覆盖为 AI 值；
   * · **说明类**（`diffDesc`）→ **分段追加**，不动人工已经写下的内容 ——
   *   这个字段在站内有多个 AI 出处（一致性差异 / 手写体转录），覆盖等于把别的段写没了。
   */
  const adoptIntoDraft = (key: AiReviewKey) => {
    const { diffDesc, ...rest } = aiReviewAdoptPatchOf(record, key)
    patchDraft({
      ...rest,
      ...(diffDesc ? { diffDesc: appendSegment(draft.diffDesc, diffDesc) } : {}),
    })
  }

  /**
   * **表过态之后往哪走** —— 采纳 / 不采纳共用这一条（v3.34，用户口径：
   * 「选择采纳后，调到下一个Ai核查项，而不是退出窗口」）。
   *
   * 这里是 v3.29「办完自动退出弹窗」的**口径更新**：那条说的是"别把人留在原地怀疑没生效"，
   * 但一条回函有 3 项（银行 2 项），逐项"进来 → 表态 → 被弹出去 → 回列表再点下一格"，
   * 等于把一串待办拆成 N 次进出。改成**就地前进**后，一次点进来就能顺着办完，
   * 且页脚那句"还剩 N 项"会一直指路。
   *
   * **前进次序 = `aiReviewItemsOf` 的机器核查顺序**（页签栏也是这个顺序），
   * 所以"下一项"就是右边紧挨着的那一格，界面上的移动方向与用户预期一致。
   */
  const advance = (fromKey: AiReviewKey, verdict: string) => {
    const next = items.find((i) => i.key !== fromKey && !aiReviewStateOf(record, i.key))
    if (next) {
      setPanelKey(next.panelKey)
      message.success(`${verdict} —— 已跳到下一项「${next.label}」`)
      return
    }

    /*
     * 没有下一个 AI 项 = 刚办完的是**最后一个 AI 核查项** ⇒ **一律落到最后一个页签**
     * 「回函结果补充」（v3.35，用户口径：「手写体识别，点完采纳识别数据，或者不采纳填完
     * 不采纳说明后，**需要调到最后一个 tab**」）。
     *
     * 为什么不像早先那样先判"还有没有必填项"：那一页是**这次核验的收尾** ——
     * 附件、底稿指引、以及唯一的「保存」都在那儿；即便四项必填已在前面的页签里填完，
     * 也该落到那里收尾，而不是让人自己再点一次页签。
     *
     * ⚠️ 这是 v3.34"一件不剩就留在原地"的**口径更新**（那条怕的是替用户关窗）：
     * **不自动关窗这条仍然成立**，只是把落点交给收尾页 —— 页脚此时是第 4 项的说明与「关闭」。
     */
    setPanelKey(RESULT_EXTRA_PANEL_KEY)
    const fieldPending = replyTaskSummaryOf(record, draft).fieldPending.length
    message.success(
      fieldPending > 0
        ? `${verdict} —— AI 核查项已全部处理，请补齐回函结果必填项`
        : `${verdict} —— AI 核查项已全部处理，请补附件与底稿指引后保存`,
    )
  }

  /** 表态 + 前进 —— `note` 只在"不采纳且该项有 AI 结论"时给（见 `aiReviewStateOf` 的 note 注释） */
  const decide = (status: 'adopted' | 'ignored', note?: string) => {
    if (!item) return
    if (status === 'adopted') adoptIntoDraft(item.key)
    dispatch({ type: 'REVIEW_AI_ITEM', recordId: record.id, key: item.key, status, note })
    advance(
      item.key,
      status === 'adopted'
        ? `已采纳「${item.label}」的识别数据`
        : `已标记「${item.label}」不采纳`,
    )
  }

  /**
   * 点「不采纳识别数据」—— **有 AI 结论的项先要一句原因**（用户口径：
   * 「不采纳理由，与回函结果无关系」「没有识别到的，就不用填不采纳原因了」）。
   *
   * 所以只有 `available`（= 该项确实识别出了结论）时才弹窗；没结论可采纳的项
   * 本来就只能不采纳、没什么可解释的，直接表态并前进。
   */
  const askIgnore = () => {
    if (!item) return
    if (!available) {
      decide('ignored')
      return
    }
    setIgnoreReason(state?.status === 'ignored' ? (state.note ?? '') : '')
    setIgnoreFor(item)
  }

  return (
    <>
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
              {/* 自动前进之后要能看出"还差几件、要不要继续点"（v3.34） */}
              {remaining > 0 ? (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--c-text-3)' }}>
                  · 还剩 {remaining} 项
                </span>
              ) : (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--c-risk-low-text)' }}>
                  · 全部事项已办完
                </span>
              )}
            </span>
          ) : panelKey === RESULT_EXTRA_PANEL_KEY ? (
            /*
             * 第 4 项「回函结果补充」（v3.33）—— 它不是 AI 核查事项，页脚没有"采纳 / 不采纳"可给
             * （那两个动作作用于 AI 结论，而这一项里没有结论可采纳），动作在本项内容里
             * （保存 / 保存并归档）。这里只留一句说明，免得用户以为"页脚怎么少了两个按钮"。
             */
            <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
              这一项是人工填报：补附件与底稿指引 —— 动作在右侧内容里
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
                /* 有 AI 结论的项：先弹窗要一句原因（见 `askIgnore`）；没结论的直接表态 */
                onClick={askIgnore}
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
        /*
         * **换一条回函（或换落点重开）才重挂载** —— 页签与左侧取景都回到"被点的那一项"（v3.28）。
         * 注意：**在同一份回函内切换项不重挂载**（`activeKey` 受控即可换项），
         * 否则采纳后自动前进会把左侧预览连同滚动位置一起重置，看着像"整个页面被刷新了一下"。
         */
        key={`${record.id}:${initialPanelKey ?? ''}`}
        record={record}
        initialKey={initialPanelKey}
        /* 受控的当前项 —— 用户点页签与"采纳后自动前进"都经这里（v3.34） */
        activeKey={panelKey}
        onItemChange={setPanelKey}
        /* 「人工确认」列读写的草稿（v3.34）—— 各页签只改草稿，落库由第 4 项的「保存」统一做 */
        draft={draft}
        onDraftChange={patchDraft}
        /* 第 4 项归档成功即关窗（v3.33）：那一项自带"保存 / 保存并归档"，办完无需再留在页面上 */
        onResultExtraDone={onClose}
      />
    </FullscreenModal>

      {/*
       * 「不采纳」的原因 —— **小的确认弹窗，不是页脚里挤一个输入框**（v3.34）。
       *
       * 理由：原因与页脚那一排动作不是一类东西（一个是"对这条 AI 结论的处置说明"，
       * 一个是随时可点的动作）；而且它**只在有 AI 结论时**才需要填（见 `askIgnore`），
       * 常驻在页脚会让"没识别到结论"的那些项也顶着一个用不上的输入框。
       *
       * 内容里点明两件事：① 不采纳**不带入任何值**、回函结果要在人工确认列自己填；
       * ② 这句话会跟着留痕（列表悬停可见），所以别写"再看看"这类没有信息量的话。
       * 它是**必填**（`okButtonProps.disabled`）：没有原因的不采纳等于没留下判断依据。
       */}
      <Modal
        open={!!ignoreFor}
        title={`不采纳「${ignoreFor?.label ?? ''}」的识别数据`}
        width={520}
        okText="确认不采纳"
        cancelText="取消"
        okButtonProps={{ disabled: !ignoreReason.trim() }}
        onCancel={() => setIgnoreFor(null)}
        onOk={() => {
          const reason = ignoreReason.trim()
          if (!reason) return
          setIgnoreFor(null)
          decide('ignored', reason)
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 6 }}>
          不采纳原因描述
        </div>
        <Input.TextArea
          rows={3}
          value={ignoreReason}
          onChange={(e) => setIgnoreReason(e.target.value)}
        />
      </Modal>
    </>
  )
}
