import type { ReactNode } from 'react'
import { UserOutlined } from '@ant-design/icons'
import { AiGlyph } from '@/components/Marks'

/**
 * 核验页的**两栏结构**：左「✦ AI 识别结果」、右「人工确认」（v3.34）。
 *
 * ## 为什么要把这两栏显摆出来
 *
 * 用户口径（2026-10-14）：「**前面的 AI 识别的结果要标记出来是 ai 识别的，人工填写的要标记
 * 是人工填写**，如果采纳了，则自动把 ai 识别的结果代入到人工填写的字段里面去」。
 *
 * 于是核验页每一项的形态统一成两栏：左边是 AI 给出的事实与结论（只读、带 ✦），
 * 右边是**回函结果里对应的那几个字段**（可写、带人形图标）—— 两者并排，"这个值是谁给的"不再是
 * 一句要靠记忆回答的话；采纳一个动作就把左边抄到右边（见 `VerificationModal.adoptIntoDraft`）。
 *
 * ## 为什么"人工填写的一侧"就是回函结果字段
 *
 * 用户口径：「这样子，**回函结果所有的字段都有出处**了」。所以右侧不是另立一套"核验数据"，
 * 而是 `ReplyResultInfo` 的同名字段（草稿态，落库仍由「保存」统一做）——
 * 字段名、选项都与「回函结果填写」页**逐字同源**（必填项取 `RESULT_REQUIRED_FIELDS`，
 * 说明类取 `RESULT_NOTE_FIELDS`），不在这里另起名字。
 *
 * ## 只读场景
 *
 * 承载者不传草稿时（结果页内嵌"看明细"那条路）右侧整栏不渲染 —— 看明细的地方不该能改数。
 */

/**
 * `✦ AI 识别结果` —— 左栏的栏头。
 *
 * 全站「AI 产出」的记号是 `✦`（见 `Marks.AiGlyph` 的来历），这里把它**显式写成一句话**，
 * 而不是只挂一个符号：核验页是"AI 与人工同屏"的地方，两侧栏头必须一眼可辨。
 */
export function AiResultHead({ note }: { note?: string }) {
  return (
    <div className="manual-head">
      <AiGlyph />
      <span className="manual-head__title">AI 识别结果</span>
      {note && <span className="manual-head__note">{note}</span>}
    </div>
  )
}

/** `人工确认` —— 右栏的栏头 + 控件区 */
export function ManualConfirm({
  note,
  children,
}: {
  /** 栏头右侧的一句说明（可省） */
  note?: string
  children: ReactNode
}) {
  return (
    <section className="manual-col">
      <div className="manual-head">
        <UserOutlined className="manual-head__icon" aria-hidden="true" />
        <span className="manual-head__title">人工确认</span>
        {note && <span className="manual-head__note">{note}</span>}
      </div>
      <div className="manual-col__body">{children}</div>
    </section>
  )
}

/**
 * 人工确认栏里的一行 —— **字段名一行、控件一行**（v3.35）。
 *
 * 为什么不是"标签在左、控件在右"：右栏只有半个屏幕宽，「回函盖章是否与被询证方名称一致」
 * 这类长字段名会把控件挤到最右、中间空一大段，而「是否为公章」这类短名又让控件贴在左边 ——
 * 一列看下来控件忽左忽右（用户：「这个界面太丑了，看起来太难受了，重新排版」）。
 * 单列表单只有一个正确下标法：标签在上、控件在下、控件占满整行。
 */
export function ManualRow({
  label,
  hint,
  children,
}: {
  /** 字段名 —— **与「回函结果填写」页逐字一致**，两处显示同一件事就不许各写一个名字 */
  label: string
  /** 小字补充（可省）—— 跟在字段名后面，太长时随标签一起换行 */
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="manual-row">
      <span className="manual-row__label">
        {label}
        {hint && <span className="manual-row__hint">{hint}</span>}
      </span>
      <span className="manual-row__ctrl">{children}</span>
    </div>
  )
}
