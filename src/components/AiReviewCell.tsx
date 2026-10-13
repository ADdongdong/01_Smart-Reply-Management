import { CheckOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { aiReviewStateOf, aiReviewTip, isAiReviewAvailable, type AiReviewItem } from '@/config/aiReview'
import type { AiReviewKey, ReplyRecord } from '@/types'

/**
 * 列表「AI 核验事项」事项区 —— **一条回函的待办清单**（v3.28 立题，v3.29 两轮换形态）。
 *
 * ## 它表达什么
 *
 * 用户的口径：「每一条回函数据，是由多个需要用户完成的 todo 事项完成的，完成所有的核验事项，
 * 这个回函数据任务就完成」。于是每行按类型列出该条函证的 AI 识别事项（往来三项 / 银行两项，
 * 见 `config/aiReview`）。
 *
 * ## 形态怎么收敛到「一行蓝色文字」（v3.29）
 *
 * 三轮都在减：
 * ① v3.28 —— 三枚同规格的**浅底小标签**，未处理与已处理只差「虚线 vs 实线 + 一枚小勾」，
 *    用户判「太不明显、交互感很差」；
 * ② 上一轮 —— 改成**勾选清单**：白底描边 + 空心勾选框 + 首位一枚「待办 N」计数，
 *    未处理的"很吵"、处理完的退到背景里；
 * ③ 上一轮 —— 用户又砍一刀：「**AI 识别去掉待办 3 这个标签**，并且这里要更宽一些……这些可以换成
 *    蓝色或者别的字体，让用户一眼能看出来可以点。**不要做成按钮的这种形式**」；
 * ④ 本轮 —— 又补三条：「没有**科技感**和 AI 感」+「**后面要加上 AI 的标识**」+
 *    「还是要有 **todo 的标识**」（四个方案里选了**前置小圆环**）。
 *
 * 现在每项 = **前置圆环 + 蓝色文字 + 后置 `✦`**：
 * · **未处理** —— 主色文字（列表里唯一一片蓝，一眼就是"这里可以点"）+ 前置**主色空心圆环**；
 * · **已处理** —— 灰字 + 圆环变**实心 + 白勾**。**不采纳也是灰字** ——
 *   "处理过"是同一个事实，采纳与否只由**圆环的颜色**区分（绿 = 已采纳、灰 = 标记不采纳）；
 * · 文字后面跟一枚 `✦` —— 全站统一的 AI 产出标记，同时是个诚实声明：
 *   这一项的内容是机器认出来的、不是你填的；悬停时还会有一道亮色沿文字扫过（"AI 正在读"）。
 *
 * 为什么删掉「待办 N」那枚计数：它是"还有几件事没做"的汇总，而**未处理的项本身就有记号**——
 * 数一数空心圆环有几枚即可；挂一枚实心主色小徽标反而成了整格里最重的东西，与本轮"轻"的取向相反。
 *
 * ⚠️ 视觉上不再是按钮，但**DOM 仍是 `<button>`**：项目规范要求可点元素能 Tab 聚焦、
 * 有焦点环、键盘可触发（用 `<span onClick>` 会把这些全丢掉）。只是把外观重置成文字链接。
 *
 * ## 点击做什么
 *
 * 点任意一项 → 打开识别详情并**直接落在这一项**上（`onOpen`），详情页脚才给「采纳 / 不采纳」。
 * **刻意不做"列表上就地采纳"**：核验的口径是「拿着结论去原件上核对依据」
 * （见 §5.3 与 `VerificationPanel` 的说明），就地一键采纳会把这个动作抽掉，
 * 变成"没看依据就签字"。故列表只负责"让你看见还有哪几件没做 + 一步进到那一件"。
 */
export default function AiReviewCell({
  record,
  items,
  onOpen,
}: {
  record: ReplyRecord
  /** 该类型的事项清单（由 `config/aiReview` 给，调用处只负责取） */
  items: AiReviewItem[]
  /** 点某一项 → 打开识别详情并定位到它 */
  onOpen: (key: AiReviewKey) => void
}) {
  return (
    <span className="ai-review">
      {items.map((item) => {
        const state = aiReviewStateOf(record, item.key)
        const handled = !!state
        const adopted = state?.status === 'adopted'
        /* 没有 AI 结论时仍可点开（看依据 / 标记已处理），只是「采纳」按钮会是禁用的 */
        const available = isAiReviewAvailable(record, item.key)

        return (
          <Tooltip
            key={item.key}
            title={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{item.hint}</div>
                <div style={{ marginTop: 2 }}>
                  {state
                    ? `已处理：${aiReviewTip(state)}`
                    : available
                      ? '待核验 —— 点击查看识别详情，可采纳或不采纳'
                      : '本次未识别到该项结论 —— 点击可查看详情并标记已处理'}
                </div>
              </div>
            }
          >
            <button
              type="button"
              className={`ai-review__link${handled ? ' is-done' : ''}${adopted ? ' is-adopted' : ''}`}
              aria-label={`${item.label}（AI 核验事项）：${handled ? '已处理' : '待核验'}`}
              onClick={() => onOpen(item.key)}
            >
              {/*
               * **todo 标识**（v3.29，用户在四个方案里选了「前置小圆环」）——
               * 未处理 = 主色**空心圆环**（"这件事等你做"），已处理 = 实心圆 + 白勾。
               * 与右侧「回函进度」列的圆点语言同族（那列也是"空心圆 → 勾"），
               * 用户不必学第二套记号；差异只在未处理时的颜色：那一列是中性灰，
               * 这一列走**主色** —— 因为这一列的东西**是等你处理的**，不是"还没轮到"。
               */}
              <span className="ai-review__dot" aria-hidden="true">
                {handled && <CheckOutlined />}
              </span>
              {item.label}
              {/*
               * **每项自带 AI 标识**（v3.29，用户：「这三个 AI 识别的字段，还是没有科技感和 AI 感，
               * 首先……**后面要加上 AI 的标识**」）—— 用全站统一的 AI 产出标记 `✦`（与 `AiChip`、
               * `StatusTag` 的 `mark` 同一个符号），**按用户原话挂在文字后面**。
               * 它同时是个诚实声明：这一项的内容是机器认出来的，不是你填的。
               */}
              <span className="ai-review__ai" aria-hidden="true">
                ✦
              </span>
            </button>
          </Tooltip>
        )
      })}
    </span>
  )
}
