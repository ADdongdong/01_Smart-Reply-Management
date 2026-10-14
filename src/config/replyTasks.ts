import { aiReviewItemsOf, aiReviewStateOf } from '@/config/aiReview'
import type { AiReviewKey, ConfirmationType, ReplyRecord, ReplyResultInfo } from '@/types'

/**
 * **一条回函的全部事项** —— 单一数据源（v3.33）。
 *
 * ## 它解决什么
 *
 * v3.33 之前，"这条回函做完了没有"有**两套各算各的口径**：
 * · 「核查事项复核」列看的是 AI 核查项表没表态（`ReplyRecord.aiReview`）；
 * · 「回函结果填写」页看的是必填字段填没填（`ReplyRecord.resultInfo`）。
 *
 * 于是同一条回函在列表上可能是"待复核"，在结果页却已经"保存并归档"，用户得自己在脑子里
 * 对齐两套账；而两处本就服务于同一件事（用户：「一条回函 = 一串 todo，做完所有事项这单才算完成」）。
 *
 * 用户拍板（v3.33）：「**合成一套总判定** —— 一条回函完成 = AI 核查项全部表态 + 回函结果必填全部有值，
 * 两处显示永远一致」，并要求两个入口互通：
 * · 在核验页把剩下的填完 → 回函结果也随之标为完成；
 * · 在结果页做完 → 「核查事项复核」也随之标为完成。
 *
 * 本文件就是那一套判定：**别处不许再自己算一遍**。
 *
 * ## 事项的构成
 *
 * ```
 * 一条回函的 todo
 * ├── AI 核查项（往来 3 / 银行 2）—— 口径见 `config/aiReview`，本文件只做汇总
 * └── 回函结果必填项（往来 4 / 银行 3）—— 口径见下面的 `RESULT_REQUIRED_FIELDS`
 * ```
 *
 * 两者都**逐项**判定（不只看"整类做完没有"），这样列表那一格才能算出"还剩几项"，
 * 核验页也才知道"缺的是哪一项"。
 *
 * ## 与「归档」的分界（重要）
 *
 * 这里判定的是**事项做完了没有**；**归档**（`replyProgress` 变成「已完成」）是另一件事，
 * 仍由结果页的「保存并归档」或核验页第 4 项的保存动作在**总判定达成时**触发
 * （用户 v3.33 口径：核验页填齐即等于归档）。两者不要混写。
 */

/** 事项的两类来源 */
export type ReplyTaskKind = 'ai' | 'field'

/** 回函结果的必填字段名 —— 与 `ReplyResultInfo` 的键一一对应 */
export type ResultFieldKey = 'matched' | 'sealConsistent' | 'officialSeal' | 'crossSeal'

export interface ResultField {
  key: ResultFieldKey
  /** 字段标签 —— 与结果页表单上的写法**逐字一致**（两处显示同一件事，不许各写一个名字） */
  label: string
  /** 核验页第 4 项里补填时用的选项（与结果页 Radio 相同） */
  options: { label: string; value: boolean | string }[]
}

/**
 * 必填项清单（按类型）—— 与结果页 `missingRequired()` 的判定**必须同源**。
 *
 * 为什么按类型分流：**银行函证不检测骑缝章**（v2.39，R-03 限定往来），
 * 那一项在银行行不渲染、也不该要求人工填（"系统不检测的项不该要求人工填"）。
 * 结果页那处注释记着这条来由，这里照搬同一口径。
 */
export const RESULT_REQUIRED_FIELDS: Record<ConfirmationType, ResultField[]> = {
  往来函证: [
    {
      key: 'matched',
      label: '函证结果是否相符',
      options: [
        { label: '相符', value: true },
        { label: '不相符', value: false },
      ],
    },
    {
      key: 'sealConsistent',
      label: '回函盖章是否与被询证方名称一致',
      options: [
        { label: '是', value: true },
        { label: '否', value: false },
      ],
    },
    {
      key: 'officialSeal',
      label: '是否为公章',
      options: [
        { label: '是', value: true },
        { label: '否（财务章等其他印章）', value: false },
      ],
    },
    {
      key: 'crossSeal',
      label: '是否有骑缝章',
      options: [
        { label: '是', value: 'yes' },
        { label: '否', value: 'no' },
        { label: '不适用（单页回函）', value: 'na' },
      ],
    },
  ],
  银行函证: [
    {
      key: 'matched',
      label: '函证结果是否相符',
      options: [
        { label: '相符', value: true },
        { label: '不相符', value: false },
      ],
    },
    {
      key: 'sealConsistent',
      label: '回函盖章是否与被询证方名称一致',
      options: [
        { label: '是', value: true },
        { label: '否', value: false },
      ],
    },
    {
      key: 'officialSeal',
      label: '是否为公章',
      options: [
        { label: '是', value: true },
        { label: '否（财务章等其他印章）', value: false },
      ],
    },
  ],
}

/**
 * **两个"说明类"回函结果字段**（v3.34）。
 *
 * 它们与上面那几项的区别：**不是必填项**（没有差异就没有说明可写），
 * 但用户同样要求"每一步都要有出处"—— 回函盖章不符、印章名称与被询证单位不一致时，
 * 这两句话就是人工在核验现场写下的依据。故核验页的人工确认栏要用它们，
 * 名字从这一份取，**不许在核验页另写一个**（同一件事两个名字，最后必然对不上）。
 */
export const RESULT_NOTE_FIELDS = {
  diffDesc: '回函结果不相符处的描述',
  sealReason: '盖章不一致处原因描述',
} as const

export interface ReplyTask {
  /** `ai:<key>` / `field:<key>` —— 稳定且可读，做 React key 与日志排查都用它 */
  id: string
  kind: ReplyTaskKind
  label: string
  /** AI 项：写 `aiReview` 用的 key */
  aiKey?: AiReviewKey
  /** 字段项：读 `resultInfo` 用的键 */
  fieldKey?: ResultFieldKey
}

/** 一条回函的全部事项（AI 项在前、必填项在后，各自保持既定顺序） */
export function replyTasksOf(type: ConfirmationType): ReplyTask[] {
  const ai: ReplyTask[] = aiReviewItemsOf(type).map((item) => ({
    id: `ai:${item.key}`,
    kind: 'ai',
    label: item.label,
    aiKey: item.key,
  }))
  const fields: ReplyTask[] = RESULT_REQUIRED_FIELDS[type].map((f) => ({
    id: `field:${f.key}`,
    kind: 'field',
    label: f.label,
    fieldKey: f.key,
  }))
  return [...ai, ...fields]
}

/**
 * 该事项是否已完成（AI 项看表没表态，字段项看有没有值）。
 *
 * `draft`（v3.34）= 核验页「人工确认」列的草稿，见 `VerificationModal` 的 `draft` 注释：
 * 人已经在人工列里填过、只是还没点保存的字段，不该还算"没填"。
 */
export function isReplyTaskDone(
  record: ReplyRecord,
  task: ReplyTask,
  draft?: Partial<ReplyResultInfo>,
): boolean {
  if (task.kind === 'ai') return !!task.aiKey && !!aiReviewStateOf(record, task.aiKey)
  if (!task.fieldKey) return false
  const v = draft?.[task.fieldKey] ?? record.resultInfo?.[task.fieldKey]
  return v !== undefined
}

export interface ReplyTaskSummary {
  /** 全部事项都完成了 */
  done: boolean
  /** 全部事项（顺序同 `replyTasksOf`） */
  tasks: ReplyTask[]
  /** 还没完成的事项 —— 列表那一格的"剩 N 项"、核验页的"缺哪几项"都取它 */
  pending: ReplyTask[]
  /** 未表态的 AI 核查项 */
  aiPending: ReplyTask[]
  /** 未填的回函结果必填项 */
  fieldPending: ReplyTask[]
}

/**
 * **总判定** —— 「核查事项复核」列、核验页第 4 项、结果页完成度标记三处共读这一份。
 *
 * 空清单（该类型的必填项为空且无 AI 项）算完成：正常数据不会出现，但"没有待办"
 * 逻辑上就是"做完了"，不该反过来说成"待办 0 项"。
 */
export function replyTaskSummaryOf(
  record: ReplyRecord,
  draft?: Partial<ReplyResultInfo>,
): ReplyTaskSummary {
  const tasks = replyTasksOf(record.type)
  const pending = tasks.filter((t) => !isReplyTaskDone(record, t, draft))
  return {
    done: pending.length === 0,
    tasks,
    pending,
    aiPending: pending.filter((t) => t.kind === 'ai'),
    fieldPending: pending.filter((t) => t.kind === 'field'),
  }
}

/**
 * 原 `pendingResultFieldsOf`（v3.33：「核验页第 4 项要补的必填字段」）已于 **v3.35 删除** ——
 * 用户口径：「这个区域的内容，去掉，因为这块在前面三个 ai 识别项确认的时候，都会有结果」。
 * 那几个必填项现在各有唯一出处（「印章识别」/「回函是否相符检测」的人工确认列），
 * 第 4 项不再把同一批字段问第二遍，故这条"还缺哪几项"的判据随之取消。
 * 总判定仍由 `replyTaskSummaryOf` 负责 —— 它同样把核验页草稿算进来。
 */
/**
 * 核验页第 4 项的页签 key（v3.33）—— 「回函结果补充」。
 *
 * 承载者（`VerificationModal`）靠它分辨"当前这一项是 AI 核查事项、还是人工填报项"：
 * 前者页脚给「采纳 / 不采纳识别数据」，后者不给（没有 AI 结论可表态，动作在本项内部）。
 */
export const RESULT_EXTRA_PANEL_KEY = 'result-extra'

/**
 * 从列表点「核查事项复核」格进来时，**默认落在哪一页签**（v3.33，按总判定算）。
 *
 * 这是 v3.31 那个 `aiReviewEntryOf`（只看 AI 项）的升级：总判定把"AI 项没表态"与
 * "必填项没填"视为同一串待办的两种，落点自然要跟着一起走 —— 若还只盯着 AI 项，
 * 就会出现"AI 项都复核完了、只差必填项，点进去却停在第一项，用户还得自己切到第 4 项"的错位。
 *
 * 落点规则：**第一个没完成的事项**。AI 项落到它自己的页签（`panelKey`），
 * 必填项落到第 4 项（`RESULT_EXTRA_PANEL_KEY`）；全部完成则回落第一个 AI 页签。
 *
 * 返回 `undefined` 只在"该类型一项待办都没有"时出现（正常数据不会）——
 * 那时详情弹窗退回它自己的缺省首位。
 */
export function replyTaskEntryPanelKeyOf(record: ReplyRecord): string | undefined {
  const firstPending = replyTaskSummaryOf(record).pending[0]
  if (firstPending?.kind === 'field') return RESULT_EXTRA_PANEL_KEY
  if (firstPending?.aiKey) {
    return aiReviewItemsOf(record.type).find((i) => i.key === firstPending.aiKey)?.panelKey
  }
  return aiReviewItemsOf(record.type)[0]?.panelKey
}
