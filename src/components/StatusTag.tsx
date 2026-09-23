import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { Tooltip } from 'antd'

/** 标签档位 —— 与 `global.css` 的 `.status-tag--*` 一一对应 */
export type TagTone = 'high' | 'low' | 'neutral' | 'primary'
/** 两档尺寸：`md` = 20px（表格列内，默认）；`sm` = 16px（行内跟随文字） */
export type TagSize = 'md' | 'sm'

export interface StatusTagProps {
  tone?: TagTone
  size?: TagSize
  /** AI 产出标记 —— 叠加虚线框，与人工确认值区分 */
  ai?: boolean
  /** 前置标记（如 AI 的 `✦`）—— 自动套用更小一号的字号 */
  mark?: ReactNode
  /**
   * 悬停说明 —— **由标签自己承载，而不是在外面再包一层 `<Tooltip>`**。
   *
   * 两个原因：
   * 1. 「标签 + 它的悬停说明」本来就是一件事，拆到调用处会各处写法不一；
   * 2. 实测发现：用 `<Tooltip>` 去包**自定义组件**时，antd 依赖的 `rc-resize-observer`
   *    拿不到 DOM 引用会 fallback 到 `findDOMNode`，在 React 18 下打出 deprecation 警告。
   *    把 Tooltip 收进来后，它的 child 始终是原生 `span`，问题不再出现。
   */
  tip?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * 状态标签 —— 全站统一的小标签（列表列 / 明细 / 徽标共用）。
 *
 * **收敛动因**：同一种「浅底小标签」此前在 `Marks.tsx`（4 处：风险 / 相符 / 核验 × 2）
 * 与 `ReplyList.tsx`（2 处：类型标记 / 重新发函）各写了一遍 inline style ——
 * 高度出现 **16 / 20 两种**，圆角、内边距、字重也各写各的。
 * 现在尺寸与配色**只由 `global.css` 的 `.status-tag*` 定义**，组件侧只负责选档，
 * 改一处即全局生效（此前要改 6 个文件里的 inline style）。
 *
 * **档位与语义的对应（不要跨档混搭底色与文字）**：
 * · `high`    风险高 / 不相符 —— 红档
 * · `low`     风险低 / 相符 —— 绿档
 * · `neutral` 未知 / 未核验 / 识别中 —— 中性灰，**不表达任何业务结论**
 * · `primary` 人工留痕（如「已人工核验」）—— 主色
 *
 * `ai` 为独立修饰位（可与 `low` / `high` 叠加）：表达「这个值是 AI 产的、尚未经人工确认」，
 * 走「浅底 + 1px 虚线」并与人工值拉开——这是「AI 只出建议、人工确认才算数」在界面上的落点。
 */
export const StatusTag = forwardRef<HTMLSpanElement, StatusTagProps>(function StatusTag(
  { tone = 'neutral', size = 'md', ai = false, mark, tip, className, children },
  ref,
) {
  const classes = ['status-tag', `status-tag--${tone}`]
  if (ai) classes.push('status-tag--ai')
  if (size === 'sm') classes.push('status-tag--sm')
  if (className) classes.push(className)

  const node = (
    <span ref={ref} className={classes.join(' ')}>
      {mark != null && <span className="status-tag__mark">{mark}</span>}
      {children}
    </span>
  )

  return tip ? <Tooltip title={tip}>{node}</Tooltip> : node
})
