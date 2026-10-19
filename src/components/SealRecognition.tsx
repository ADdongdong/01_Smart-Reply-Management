import { Input, Radio } from 'antd'
import type { ReplyResultInfo, SealResult } from '@/types'
import { InfoRow, ResultBar } from '@/components/Marks'
import { AiResultHead, ManualConfirm, ManualRow } from '@/components/ManualConfirm'
import { RESULT_NOTE_FIELDS, RESULT_REQUIRED_FIELDS, type ResultFieldKey } from '@/config/replyTasks'

/**
 * 印章识别明细 —— **左「✦ AI 识别结果」、右「✎ 人工确认」两栏**（v3.34）。
 *
 * ## 左栏：结论条 → 事实清单（v2.65 起只读）
 *
 * 印章定位的可视化由核验页**左侧常驻主视图**承担（批注层恒为显示，v3.35 起不再有视图切换），
 * 这里只呈现检测字段与判定，不内嵌第二个 PDF 预览（同屏两个 PDF 既占空间又让人分不清该看哪个）。
 *
 * **没有「处理动作」段（v2.65 移除）**：那一版核验页整体只读，采纳在「回函结果填写」页做。
 * 现在动作回来了，但落点在**页脚**（采纳 / 不采纳识别数据），本栏仍是纯"看依据"。
 *
 * ## 右栏：人工确认（v3.34）
 *
 * 用户口径：「**后面需要有一列让用户去填写人工确认的数据**」，且「印章识别，涉及到回函盖章
 * 是否相符，这个如果确认是不符的话，回函结果填写是需要填写不符说明的，印章与被询证单位名称
 * 不一致时，回函结果也需要填写不相符说明，这两个字段，也需要加入到这个页面」。
 *
 * 所以右栏给的**就是回函结果里那几个字段**（同名字段、同选项，草稿态）：
 * · 往来 —— 回函盖章是否与被询证方名称一致 / 是否为公章 / 是否有骑缝章，外加**名称不一致的原因**
 *   （`RESULT_NOTE_FIELDS.sealReason`）。
 *   ⚠️ **「函证结果是否相符」不在本页**（v3.47 起，用户口径：「往来函不需要这部分，原型删除就行」）——
 *   往来相符性由落章区域判定（R-01），这一格原先挂在本页，现只在「回函结果填写」页填；
 * · 银行 —— 印章不参与相符性判定（R-01：只由「询证事项逐项核对」决定，那一格在
 *   「回函是否相符检测」页里给）；且 v3.48 起**只核两件事**：有没有盖章、章名与被询证单位一致否 ——
 *   印章数量 / 印章类型 / 落章区域 / 是否为公章在银行侧全部不核（用户口径：这四项去掉）。
 *
 * ⚠️ **「回函结果不相符处的描述」不在本页**（v3.35 末，用户口径：「在印章识别的地方，把这个
 * 字段去掉。**这是手写体识别时候需要填写的**」）—— 它一度被放到本页"相符性"的下面（当时的口径是
 * "不符说明放在落章区域这块"），但该字段的正主是**手写体识别**：不符说明写的是原件上手写的那段话，
 * 本页只管印章本身。故两句说明分家：**不相符描述 → 手写体识别页；名称不一致原因 → 本页**。
 *
 * 采纳 AI 结论时，`VerificationModal` 会把左栏的值抄进这一栏（见 `aiReviewAdoptPatchOf`）。
 *
 * **按类型分流（v2.39 / v2.41）**：
 * · **骑缝章** —— 自 v2.39 起**仅往来函证检测**（R-03），银行侧**不渲染**该行；
 * · **结论条** —— 往来侧印章落章区域**决定**相符性（落「信息不符」区 → 回函结果应为不相符）；
 *   银行侧只讲印章本身，不讲"回函结果应判为什么"。
 */
export default function SealRecognition({
  seal,
  entity,
  /** 银行函证 —— 不渲染骑缝章行、结论条也不推导相符性 */
  isBank = false,
  draft,
  onDraftChange,
}: {
  seal: SealResult
  entity: string
  isBank?: boolean
  /** 「人工确认」栏的草稿（不传则整栏不渲染 —— 看明细的地方不该能改数） */
  draft?: Partial<ReplyResultInfo>
  onDraftChange?: (patch: Partial<ReplyResultInfo>) => void
}) {
  const regionIsMismatch = seal.region === '信息不符区'

  /* ① 结论：一句话讲清「印章怎么样」，不复述业务规则 */
  const status = !seal.hasSeal || regionIsMismatch ? 'risk' : 'ok'
  const conclusion = isBank
    ? !seal.hasSeal
      ? '未检出印章 · 建议退回被询证方补盖银行印章'
      : seal.nameMatched
        ? '已盖章，印章名称与被询证单位一致'
        : '印章名称与被询证单位不一致 · 建议核实'
    : !seal.hasSeal
      ? '未检出印章 · 回函结果无法判定，建议退回补盖公章'
      : regionIsMismatch
        ? '印章落于「信息不符」区 → 回函结果应为「不相符」'
        : '印章落于「信息证明无误」区 → 回函结果应为「相符」'

  /**
   * 右栏的字段清单 —— **借必填项表**（`RESULT_REQUIRED_FIELDS`）取标签与选项：
   * 两处显示同一件事，标签/选项必须逐字同源，核验页不另写一套。
   */
  const editable = !!onDraftChange
  const fields = RESULT_REQUIRED_FIELDS[isBank ? '银行函证' : '往来函证']
  const labelOf = (key: ResultFieldKey) => fields.find((f) => f.key === key)?.label ?? key
  const optionsOf = (key: ResultFieldKey) => fields.find((f) => f.key === key)?.options ?? []
  /** 改一格 */
  const patch = (p: Partial<ReplyResultInfo>) => onDraftChange?.(p)

  const facts = (
    <div className="manual-facts">
      <InfoRow
        label="是否盖章"
        value={seal.hasSeal ? '已盖章' : '未盖章'}
        tone={seal.hasSeal ? 'ok' : 'risk'}
      />
      {/*
       * v3.48：银行侧**只核两件事** —— 有没有盖章、章名与被询证单位一致否。
       * 印章数量 / 印章类型 / 落章区域对银行回函没有业务意义（回函专用章是固定格式），
       * 故三项在银行侧整行不渲染（用户口径：「银行的印章核查，对如下项不进行核查，可去掉对应字段」）。
       */}
      {!isBank && (
        <InfoRow
          label="印章数量"
          value={`${seal.sealCount} 枚`}
          hint={seal.sealCount > 1 ? '存在多枚印章，建议确认是否均有效' : undefined}
        />
      )}
      {/* 骑缝章：仅往来函证检测（v2.39 起 R-03 限定往来；银行回函无此业务要求） */}
      {!isBank && (
        <InfoRow
          label="骑缝章"
          value={seal.crossPageSeal ? `有（${seal.crossPageSealCount} 处）` : '未检出'}
          tone={seal.crossPageSeal ? 'ok' : 'risk'}
          hint={!seal.crossPageSeal ? '建议加盖' : undefined}
        />
      )}
      {!isBank && <InfoRow label="印章类型" value={seal.sealType} />}
      <InfoRow label="印章名称" value={seal.sealName} />
      <InfoRow
        label="与被询证单位一致"
        value={seal.nameMatched ? '一致' : '不一致'}
        tone={seal.nameMatched ? 'ok' : 'risk'}
        hint={seal.nameMatched ? undefined : `发函单位：${entity}`}
      />
      {!isBank && (
        <InfoRow label="落章区域" value={seal.region} tone={regionIsMismatch ? 'risk' : 'ok'} />
      )}
    </div>
  )

  return (
    <div className={editable ? 'verify-cols' : undefined}>
      <div>
        <AiResultHead note="对照左侧原件核对" />
        <ResultBar status={status} message={conclusion} />
        {facts}
      </div>

      {editable && (
        <ManualConfirm
          note={
            isBank
              ? '以回函原件为准，逐项确认'
              : '以回函原件为准，逐项确认；相符性在「回函结果填写」页确认'
          }
        >
          {/*
           * ⚠️ **往来侧已无「函证结果是否相符」这一格**（v3.47，用户口径：「往来函不需要这部分，
           * 原型删除就行」—— 他看的是银行侧截图，银行侧保留）。往来不再在这一栏确认相符性，
           * 该字段只在「回函结果填写」页填；本页只管印章本身（是否一致 / 是否公章 / 骑缝章 / 不一致原因）。
           */}
          <ManualRow label={labelOf('sealConsistent')}>
            <Radio.Group
              size="small"
              optionType="button"
              buttonStyle="solid"
              value={draft?.sealConsistent}
              options={optionsOf('sealConsistent')}
              onChange={(e) => patch({ sealConsistent: e.target.value })}
            />
          </ManualRow>
          {/* 名称不一致的原因紧跟名称一致那一格 —— 同一条"谁触发谁"的排法 */}
          <ManualRow label={RESULT_NOTE_FIELDS.sealReason} hint="名称不一致时必写">
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={draft?.sealReason ?? ''}
              onChange={(e) => patch({ sealReason: e.target.value })}
              placeholder="印章名称与被询证方不一致的原因"
            />
          </ManualRow>

          {/* v3.48：银行侧不核印章类型，故「是否为公章」整行不渲染（往来保留） */}
          {!isBank && (
            <ManualRow label={labelOf('officialSeal')}>
              <Radio.Group
                size="small"
                optionType="button"
                buttonStyle="solid"
                value={draft?.officialSeal}
                options={optionsOf('officialSeal')}
                onChange={(e) => patch({ officialSeal: e.target.value })}
              />
            </ManualRow>
          )}
          {!isBank && (
            <ManualRow label={labelOf('crossSeal')}>
              <Radio.Group
                size="small"
                optionType="button"
                buttonStyle="solid"
                value={draft?.crossSeal}
                options={optionsOf('crossSeal')}
                onChange={(e) => patch({ crossSeal: e.target.value })}
              />
            </ManualRow>
          )}
        </ManualConfirm>
      )}
    </div>
  )
}
