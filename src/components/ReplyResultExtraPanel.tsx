import { useEffect, useState } from 'react'
import { Alert, App, Button, Input } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { replyTaskSummaryOf } from '@/config/replyTasks'
import AttachmentField from '@/components/AttachmentField'
import type { ReplyRecord, ReplyResultInfo } from '@/types'

/**
 * 核验页第 4 项「**回函结果补充**」（v3.33）—— 把"不用 AI 的那些回函结果事项"收进核验动线。
 *
 * ## 它解决什么（用户原话）
 *
 * > 「函证结果里面，有这些字段需要填写，必填全部填写了，才算完成了回函结果事项。但是，
 * > 有很多的事项，都是可以从智能识别的人工复核带出来的。所以……在核查事项复核的三个 tab 后，
 * > 再加上一项，把不涉及 AI 识别的回函结果事项中的几个字段可以在最后一个 tab 中填写。
 * > 还剩下了：替代性测试文件，差异调节表，执行进一步核查程序的底稿指引。这三个字段。
 * > 这样子，用户只要点击核查事项复核，也可以通过这一次操作，完成回函结果的事项。」
 *
 * **必填项不在本项问**（v3.35，用户口径：「**这个区域的内容，去掉，因为这块在前面三个 ai 识别项
 * 确认的时候，都会有结果**」）—— 那四项现在各有唯一出处（「印章识别」/「回函是否相符检测」的
 * 人工确认列），于是本项只装 **AI 给不了的两件事**：
 * · **两个附件** —— 替代性测试文件、差异调节表；
 * · **一段文本** —— 拟执行的进一步核查程序及底稿指引（见下）。
 * 三者与结果页读写**同一份** `resultInfo`（附件行见 `components/AttachmentField.tsx`）。
 *
 * ## 本项还是"人工确认列"的保存出口（v3.34）
 *
 * 三个 AI 检测页签右侧各有一列「人工确认」（相符性、印章各类、两句说明），它们写的是
 * **同一份草稿**（由承载者 `VerificationModal` 持有，见其 `draft` 注释），
 * 而这份草稿的保存按钮就在本项这里 —— 用户拍板的口径 A：
 * 「人工列就是 `resultInfo` 的草稿，采纳 = 填初值，落库仍只在保存那一个出口」。
 *
 * 所以本项在核验页里不只是"另加的一个页签"，而是**这次核验的收尾**：前面几项看完、
 * 人工列填完，到这里补上附件与底稿指引，一次「保存」把整条回函结果落库（够条件就顺带归档）。
 *
 * ## 「拟执行的进一步核查程序及底稿指引」为什么是文本框（v3.34，用户拍板）
 *
 * 用户口径：「**这个：拟执行的进一步核查程序及底稿指引，是文本框输入，不是上传附件**」。
 * 这一项要的是**写给人看的做法** —— 准备执行哪些程序、底稿怎么索引；它没有"表"要归档，
 * 挂一个上传按钮既与语义不符，也让人以为"不传个 Excel 就没填过"。故：
 * · 数据层 `procedureFiles`（`ReplyAttachment[]`）→ `procedureNote`（`string`）；
 * · 结果页同一字段同步改成多行输入（两处共读一份，形态也得一致）。
 *
 * ## 保存 = 可能顺带归档（用户拍板）
 *
 * 用户选的口径是「**在核验页填齐即等于归档**，不再需要单独点『保存并归档』」。
 * 所以保存时先算一次"填完之后的总判定"（`replyTaskSummaryOf` 的总判定口径，
 * 见 `config/replyTasks.ts`）：
 * · 达成 → `SUBMIT_RESULT`（**归档**）并关窗，与结果页那个按钮同一动作；
 * · 未达成 → `UPDATE_RESULT`（**只落字段、不推进进度**），留在原地并告诉他**还差哪几项**——
 *   差的那些可能就在左边几个页签里（AI 项还没表态），提示要能指回去。
 *
 * ⚠️ 注意这不是"填一下就归档"：能触发归档的条件是**全部事项都完成**（AI 项全表态 +
 * 必填全有值），比结果页那条"必填填完即可"更严 —— 这正是"一套总判定"的应有之义。
 *
 * ## 为什么保存按钮在本项内、而不是弹窗页脚
 *
 * 页脚那两个按钮（采纳 / 不采纳识别数据）是**AI 事项**的动作（写 `aiReview`，作用于当前页签）；
 * 本项没有 AI 结论可表态，硬塞进页脚会让"当前这项到底在采纳什么"含混。故本项自带保存动作、
 * 页脚在本项下只留说明与「关闭」（见 `VerificationModal`）。
 *
 * ## 版式（v3.34 重排）
 *
 * 原先三块内容一路平铺：标题与说明挤在同一行、字段行之间没有间隔、附件行的标签与按钮
 * 各占一行（一个字段两行高），整页看着"糊在一起"。现在按**分区 + 行线**排：
 * 每区一句标题（说明另起一行）、区内每个字段一行、行间一条发丝线，
 * 与结果页"标签在左、控件在右"的表单口径一致（样式见 `styles/global.css` 的 `.result-extra`）。
 */
export default function ReplyResultExtraPanel({
  record,
  value,
  onChange,
  onDone,
}: {
  record: ReplyRecord
  /**
   * **草稿（受控）**（v3.34）—— 由承载者持有，三个页签的人工确认列与这里共用一份。
   * 不传即非受控（结果页内嵌"看明细"那条路），本组件自己存一份、自己保存。
   */
  value?: Partial<ReplyResultInfo>
  /** 草稿变更上报（受控时用） */
  onChange?: (patch: Partial<ReplyResultInfo>) => void
  /** 归档成功后通知承载者（关闭弹窗）—— 与"采纳 / 不采纳后自动关窗"同一体感 */
  onDone?: () => void
}) {
  const { dispatch } = useApp()
  const { message } = App.useApp()

  /**
   * **非受控时的本地草稿**（v3.34）—— 结果页「内嵌看明细」那条路不传 `value`。
   *
   * 受控时（核验页）一切读写都走承载者的草稿：三个页签的人工确认列与第 4 项的保存按钮
   * 必须共用同一份（用户口径 A：「人工列就是 `resultInfo` 的草稿，采纳 = 填初值，
   * 落库仍只在保存那一个出口」），而本组件只承载其中的第 4 项。
   */
  const [inner, setInner] = useState<Partial<ReplyResultInfo>>({})
  const controlled = value !== undefined
  /**
   * 换一条回函（弹窗复用时）重置本地草稿 —— 依赖 `record.id` 而非 `record` 对象引用：
   * 后者每次 dispatch 都会变，会把用户正在填的草稿冲掉（与结果页同一教训）。
   */
  useEffect(() => {
    if (controlled || !record) return
    const info = record.resultInfo
    setInner({
      altTestFiles: info?.altTestFiles ?? [],
      diffAdjustFiles: info?.diffAdjustFiles ?? [],
      procedureNote: info?.procedureNote ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, controlled])

  /** 当前草稿（受控优先）；改一处 —— 受控上报给承载者，非受控落本地 */
  const draft: Partial<ReplyResultInfo> = value ?? inner
  const patch = (p: Partial<ReplyResultInfo>) =>
    onChange ? onChange(p) : setInner((d) => ({ ...d, ...p }))

  /*
   * 此处原有「AI 没带出来的必填项（N）」一区（v3.33 立）—— **v3.35 删除**，用户口径：
   * 「这个区域的内容，去掉，因为这块在前面三个 ai 识别项确认的时候，都会有结果」。
   * 那四项必填现在都有各自的唯一出处：往来的相符性 / 名称一致 / 是否公章 / 骑缝章在
   * 「印章识别」的人工确认列，银行的相符性在「回函是否相符检测」那一项 —— 于是本项只剩
   * “附件 + 底稿指引”这两件 AI 给不了的事，不再把同一批字段问第二遍。
   */
  /** 这一条回函当前的总判定（含草稿）—— 顶部那句"还剩几项"与保存时的归档判定共用它 */
  const summary = replyTaskSummaryOf(record, draft)

  /**
   * 保存 —— **两个出口都带 `from: 'extra'`**：核验页第 4 项是唯一会写 `resultExtraSavedAt`
   * 的地方（页签尾部那枚完成勾靠它点亮 —— 用户口径：「加上保存」）；
   * 其余逻辑不变：先算"填完之后"的总判定，够条件就顺带归档。
   */
  const save = () => {
    /*
     * 先铺 `record.resultInfo` 再盖草稿 —— 结果对象是**整份替换**（store 里 `...action.patch`
     * 是浅合并），不先铺一层就会把草稿之外的字段（如结果页保存的差异说明）抹掉。
     */
    const resultInfo: ReplyResultInfo = { ...record.resultInfo, ...draft }
    /* 先算"填完之后"的总判定 —— 不是先写再读，省一次 dispatch 往返，也不会闪一下旧状态 */
    const after = replyTaskSummaryOf({ ...record, resultInfo })

    if (after.done) {
      dispatch({ type: 'SUBMIT_RESULT', recordId: record.id, patch: { resultInfo }, from: 'extra' })
      message.success('全部事项已完成，回函结果已归档')
      onDone?.()
      return
    }

    dispatch({ type: 'UPDATE_RESULT', recordId: record.id, patch: { resultInfo }, from: 'extra' })
    message.success(
      `已保存 —— 这条回函还剩 ${after.pending.length} 项未完成：${after.pending
        .map((t) => t.label)
        .join('、')}`,
    )
  }

  return (
    <div className="result-extra">
      {/*
       * **一行就够**（v3.35，用户口径：「这块提醒太啰嗦了」）：它只回答"还差几件"，
       * "去哪儿办"由左边三个页签回答，"保存会不会归档"由下面那行回答 ——
       * 在这里复述一遍，只是把一个提示条撑成四行。
       */}
      <Alert
        type={summary.done ? 'success' : 'info'}
        showIcon
        message={
          summary.done
            ? '全部事项已完成'
            : `还剩 ${summary.pending.length} 项未完成（在前三个页签里办）`
        }
      />

      <section className="result-extra__section">
        <div className="result-extra__title">
          附件
          <span className="result-extra__hint">与「回函结果填写」页是同一份数据，两处都能传</span>
        </div>
        <AttachmentField
          label="替代性测试文件"
          actionText="上传附件（JPG / JPEG / PDF，可多附件）"
          accept=".jpg,.jpeg,.pdf"
          files={draft.altTestFiles ?? []}
          onChange={(next) => patch({ altTestFiles: next })}
        />
        <AttachmentField
          label="差异调节表"
          actionText="上传附件（支持 PDF / Excel）"
          accept=".pdf,.xls,.xlsx"
          files={draft.diffAdjustFiles ?? []}
          onChange={(next) => patch({ diffAdjustFiles: next })}
        />
      </section>

      {/*
       * 「拟执行的进一步核查程序及底稿指引」—— **文本，不是上传件**（v3.34，用户拍板）。
       * 单独成区：它要写的是"准备执行什么程序、底稿怎么索引"，与上面两个附件不是一类东西，
       * 放在"附件"区里会让人以为它也要传文件。
       */}
      <section className="result-extra__section">
        <div className="result-extra__title">拟执行的进一步核查程序及底稿指引</div>
        <Input.TextArea
          rows={4}
          value={draft.procedureNote ?? ''}
          onChange={(e) => patch({ procedureNote: e.target.value })}
          placeholder="写清准备执行哪些程序、相应底稿怎么索引"
          className="result-extra__textarea"
        />
      </section>

      <div className="result-extra__actions">
        <span className="muted" style={{ fontSize: 12 }}>
          {summary.done ? (
            <>
              <CheckCircleFilled style={{ color: 'var(--c-risk-low)', marginRight: 4 }} />
              已全部完成 —— 保存即归档（保持已完成状态）
            </>
          ) : (
            '全部事项完成时保存即归档；否则只保存字段、进度不动'
          )}
        </span>
        <Button type="primary" onClick={save}>
          {summary.done ? '保存并归档' : '保存'}
        </Button>
      </div>
    </div>
  )
}
