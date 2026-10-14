import { Tooltip } from 'antd'
import { aiReviewSummaryOf, aiReviewTip } from '@/config/aiReview'
import type { ReplyRecord } from '@/types'

/**
 * 列表「核查事项复核」格 —— **一条回函的整条复核状态**（v3.28 立题，v3.29 换文字链，
 * v3.30 定名 + 换勾选框，**v3.31 由"逐项清单"收成"整条状态"**）。
 *
 * ## 它表达什么（v3.31 口径，用户原话）
 *
 * > 「这一列就展示：待复核、已复核。这一步从业务逻辑上就是想把识别的结果展示给用户看，
 * > 然后，用户顺便在这里做对 AI 结果的复核工作。**因为前面已经有 AI 核查进度展示具体进行了
 * > 哪些 AI 核查项目，所以，这里就不展示具体的哪些核查项了**，只需要告诉用户，要去做 AI 核查。
 * > 然后，点进去后，还是原来的页面，用户可以再上面切换 tab 去复核识别项。」
 *
 * 于是这一格**只回答一件事：人这边还有没有要做的事**——
 * · **待复核** = 还有核查项没表过态：勾选框为**空方框**、主色，后跟「待复核」；
 * · **已复核** = 全部核查项都表态过：**方框加勾**、灰字「已复核」；**统一一个色**，不再区分
 *   采纳 / 不采纳（用户口径：本列只回答"做完了没有"，采纳与否进详情看）。
 *
 * ⚠️ **格内不再显示「剩 N 项」**（v3.35，用户口径：「**这里不展示剩下几项**」）——
 * v3.31 曾在状态词后跟一句「· 剩 N 项」（那版口径是"不点进去也该知道还剩几件"），现已收掉：
 * 格内只留一个状态词，"还剩哪几件"只在**悬停**里给（见下）。
 *
 * 「具体核查了哪几项」由左边「智能核查进度」列（`SmartCheckCells`，机器逐项：短横 →
 * 像素网格 → 裸勾 / 叉）回答；两列并排的读法因此是「**机器核完没有 → 我要不要复核**」，
 * 同一份清单不再在相邻两格各列一遍。
 *
 * ## 为什么还是勾选框、不用标签
 *
 * 沿用 v3.30 定的口径（用户：「这两个状态，不以标签形式展示，需要用户知道这是待完成的 todo」）：
 * 标签（浅底胶囊）在站内是"状态结论"的语言（同排的「智能核查状态」列就用它），
 * 而这一列是**待办**——勾选框是"待办"最不需要解释的记号（空框 = 没做，打勾 = 做了）。
 *
 * ## 悬停里给明细（用户确认要）
 *
 * 格内不列项、也不报数（v3.35），但**不点进去也该知道是哪些**（用户：从"一眼看清"别退成
 * "点进去才发现"）：
 * · **待复核** —— 列出**未复核项名**，并给一句"点击后逐项复核（详情里可切换核查项）"；
 * · **已复核** —— 逐项列出处置结果（采纳 / 不采纳 · 谁 · 什么时候，见 `aiReviewTip`）。
 *
 * ## 点击做什么
 *
 * 点这一格 → 进原来那套 AI 智能核验详情（`VerificationModal` / `VerificationPanel`），
 * **默认落在第一个未复核项**——落点由调用方用 `aiReviewEntryOf` 算好，`onOpen` 不带参数
 * （见 `ReplyList` 的列定义）。详情里照旧可切页签、页脚采纳 / 不采纳，表态后自动关窗（v3.29）。
 * **刻意不做"列表上就地复核"**：复核的口径是「拿着结论去原件上核对依据」
 * （见 §5.3 与 `VerificationPanel` 的说明），就地一键处理会把这个动作抽掉。
 *
 * ⚠️ 视觉上不再是按钮，但 **DOM 仍是 `<button>`**：项目规范要求可点元素能 Tab 聚焦、
 * 有焦点环、键盘可触发（用 `<span onClick>` 会把这些全丢掉）。
 */
export default function AiReviewCell({
  record,
  onOpen,
}: {
  record: ReplyRecord
  /** 点这一格 → 打开核验详情（落点由调用方按 `aiReviewEntryOf` 算好） */
  onOpen: () => void
}) {
  /** 整条状态：有没有全部复核完、还剩哪几项、已完成那几项分别是什么处置 */
  const { reviewed, pending, done } = aiReviewSummaryOf(record)

  return (
    <Tooltip
      title={
        reviewed ? (
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>已复核全部核查事项</div>
            {done.map(({ item, state }) => (
              <div key={item.key}>
                · {item.label}：{aiReviewTip(state)}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>待复核：{pending.map((i) => i.label).join('、')}</div>
            <div style={{ marginTop: 2 }}>点击后逐项复核 —— 在详情里切换核查项，采纳或不采纳</div>
          </div>
        )
      }
    >
      <button
        type="button"
        className={`ai-review__link${reviewed ? ' is-done' : ''}`}
        /*
         * 无障碍名称把**状态与未复核项**都念出来 —— 格内只剩一个状态词（v3.35 起连「剩 N 项」
         * 也不再显示），读屏用户需要这一个出口。
         */
        aria-label={
          reviewed
            ? '核查事项复核：已复核'
            : `核查事项复核：待复核（${pending.map((i) => i.label).join('、')}）`
        }
        onClick={onOpen}
      >
        {/*
         * **todo 勾选框** —— 待复核 = 空方框，已复核 = 方框 + 勾。
         * 图形取自 Tabler Icons（`square` / `square-check`，经 icon kit 校验存在），
         * 与「智能核查进度」列的 `MARK_PATH` 同一处置：**内联 SVG**、不引整套图标依赖。
         */}
        <span className="ai-review__box" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path
              d={reviewed ? BOX_PATH.done : BOX_PATH.todo}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </span>
        {/* **两个状态**（用户：「这一列就展示：待复核、已复核」）—— 纯文字，不是标签 */}
        <span className="ai-review__state">{reviewed ? '已复核' : '待复核'}</span>
        {/*
         * **不再报数**（v3.35，用户口径：「这里不展示剩下几项」）—— 原先这里跟一句
         * 「· 剩 N 项」，现在格内只剩状态词；"还剩哪几件"挪到悬停里（见上面的 `Tooltip`）。
         */}
        {/*
         * AI 产出标记 `✦`（v3.29 用户要求「后面要加上 AI 的标识」，全站统一符号）：
         * 这一格的"复核"复核的正是 AI 认出来的东西，故保留；它不参与状态表达。
         */}
        <span className="ai-review__ai" aria-hidden="true">
          ✦
        </span>
      </button>
    </Tooltip>
  )
}

/**
 * 两枚勾选框的 path —— **逐字取自 Tabler Icons 上游**（`tabler:square` / `tabler:square-check`，
 * MIT，24×24 画布，圆头描边，stroke-width 2）。
 *
 * 两条都写成**一条 `d`**（勾那一笔用绝对起点 `M9 12`）—— 上游 `square-check` 是两条独立 path，
 * 但本处一个 `<path>` 就够：省一次 DOM 节点，也免得两笔的描边端点各写一遍。
 * （若把上游的相对命令 `m9 12` 直接接在 `z` 后面，基准点会变成子路径起点而不是它原来的
 * 绝对位置 —— 勾会跑偏，故这里显式写成绝对坐标。）
 */
const BOX_PATH = {
  /** 待复核：空方框 */
  todo: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  /** 已复核：方框 + 勾 */
  done: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 12l2 2l4-4',
}
