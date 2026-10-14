import { Input } from 'antd'
import type { HandwritingResult, ReplyResultInfo } from '@/types'
import { InfoRow, ResultBar } from '@/components/Marks'
import { AiResultHead, ManualConfirm, ManualRow } from '@/components/ManualConfirm'
import { RESULT_NOTE_FIELDS } from '@/config/replyTasks'

/**
 * 手写体识别明细 —— **左「✦ AI 识别结果」、右「✎ 人工确认」两栏**（v3.34）。
 *
 * ## 左栏
 *
 * 结论条 → 事实清单 → 转录文本（保留手写体字形，便于与原件对照）。
 * 不内嵌「手写区域定位（原图裁剪）」：左侧常驻主视图本身就有「手写体识别区」批注框。
 *
 * ## 右栏（v3.34 新增）
 *
 * 用户口径：「**手写体识别，不采纳的时候，要有不采纳说明，同时，需要有地方去填写人工填写的
 * 不符说明事项内容（即手写体识别内容）**」。
 *
 * 前半句（不采纳说明）落在页脚的「不采纳识别数据」弹窗里（见 `VerificationModal.askIgnore`）；
 * 后半句就是这个右栏 —— 它填的**不是另立一份数据**，而是回函结果里的
 * 「回函结果不相符处的描述」（`RESULT_NOTE_FIELDS.diffDesc`）：
 * AI 的转录是"看到什么"，人工这一栏是"最终写进回函结果的是什么"（可照抄、可改写、可补充）。
 *
 * **没有「处理动作」段（v2.65 移除）** —— 核验页整体只读，采纳与人工判定在别处完成；
 * 采纳动作现在在**页脚**（采纳 = 把左栏转录代进右栏，见 `aiReviewAdoptPatchOf`）。
 */
export default function HandwritingRecognition({
  result,
  draft,
  onDraftChange,
}: {
  result: HandwritingResult
  /** 「人工确认」栏的草稿（不传则整栏不渲染 —— 看明细的地方不该能改数） */
  draft?: Partial<ReplyResultInfo>
  onDraftChange?: (patch: Partial<ReplyResultInfo>) => void
}) {
  /**
   * 结论里出现「不一致 / 需复核」时转需关注档 —— 手写转录本身是客观检出（中性），
   * 但与印章落章区域矛盾时属于要人工介入的情形。
   * 注：真实实现应由后端给出结构化字段（如 `consistent`），此处按文案判定仅为原型便利。
   */
  const inconsistent = /不一致|复核/.test(result.conclusion)
  const editable = !!onDraftChange

  return (
    <div className={editable ? 'verify-cols' : undefined}>
      <div>
        <AiResultHead note="对照左侧原件核对" />
        {/* ① 结论条 —— 原「如需引用这段说明，请在结果页录入」那句已随右栏出现而取消（v3.34）：
            现在就在这儿录，不必再指去另一页 */}
        <ResultBar status={inconsistent ? 'risk' : 'info'} message={result.conclusion} />

        {/* ② 事实清单 */}
        <div className="manual-facts">
          <InfoRow label="识别区域" value={`「${result.region}」`} hint="手写内容所在栏位" />
          <InfoRow label="转录字数" value={`${result.text.length} 字`} />
        </div>

        {/* 转录文本 —— 保留手写体字形，便于与原件对照
            （标题右侧原有一枚 `OCR xx%` 置信度胶囊，2026-10-14「去掉所有的置信度」时移除） */}
        <div style={{ margin: '12px 0 6px' }}>
          <span className="section-title" style={{ fontSize: 13 }}>
            转录文本
          </span>
        </div>
        <div className="handwriting-zone" style={{ padding: '10px 12px', lineHeight: 2 }}>
          {result.text}
        </div>
      </div>

      {editable && (
        <ManualConfirm note="左栏是 AI 看到的字，这一栏是最终写进回函结果的那句话">
          <ManualRow
            label={RESULT_NOTE_FIELDS.diffDesc}
            hint="可照抄左栏转录，也可按原件改写"
          >
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={draft?.diffDesc ?? ''}
              onChange={(e) => onDraftChange?.({ diffDesc: e.target.value })}
              placeholder="人工抄录 / 确认的不符说明事项内容"
            />
          </ManualRow>
        </ManualConfirm>
      )}
    </div>
  )
}
