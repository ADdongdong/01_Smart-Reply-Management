import { useEffect, useRef, useState } from 'react'
import { Button, Progress } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'

/**
 * 「智能识别」动作（v3.26）—— 一个按钮，点下去跑约 5 秒的识别过程，跑完回调 `onDone`。
 *
 * ## 它是什么、不是什么
 *
 * **它不是一个识别算法，而是一段交互壳**：把"点一下 → 系统在认 → 认好了"这个过程演出来，
 * 让用户明白"这一步是系统在替他做切分与归属"。底层到底怎么认（四要素流水线 / 版面理解
 * workflow / 两者混用）**留待实施选型**，因此这里**不出现任何实现词**（不写"OCR""大模型"
 * "四要素"），文案只说结果：**切分 · 归属 · 快递单号**。
 *
 * ## 为什么固定约 5 秒、而不是等真实结果
 *
 * 真实时延取决于客户的 AI 资源（好的几秒、差的可能几十秒甚至更久），而**这条路的可用性
 * 本身就取决于那个时延**（见需求文档的 C-13 / C-14：效率不达标时改用纯手动切分）。
 * 原型把等待演成固定 5 秒，是为了让演示可预期；真实施按实测给进度，别再拿 5 秒当承诺。
 *
 * ## 两处入口共用它（v3.26）
 *
 * · **上传弹窗里**（银行「上传银行函证回函」）—— 最省一步：上传完直接点它，进切分页即已就绪；
 * · **归属界面顶部** —— 手动派进来后想重跑、或先看了文件再决定用 AI，都从这里点。
 *
 * 两处共用同一个组件，是刻意的：**动作与进度反馈在两条路上长得一样**，用户不必学两套。
 * 「跑完」这件事由调用方决定做什么（起批次 / 应用初稿），本组件不管业务。
 */
export function SmartSplitAction({
  onDone,
  size = 'middle',
  label = '智能识别',
  /** 紧凑态：一行内联（归属界面顶部用），不给进度条只给一行进度文字 */
  compact = false,
}: {
  /** 5 秒跑完后的回调 —— 调用方在这里真正"应用识别结果" */
  onDone: () => void
  size?: 'small' | 'middle'
  label?: string
  compact?: boolean
}) {
  const [percent, setPercent] = useState<number | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  /* 跑一轮：100ms 跳一格、约 5 秒到 100%，到点回调并复位 */
  useEffect(() => {
    if (percent == null) return
    if (percent >= 100) {
      const t = window.setTimeout(() => {
        setPercent(null)
        doneRef.current()
      }, 220)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => setPercent((p) => Math.min(100, (p ?? 0) + 2)), 100)
    return () => window.clearTimeout(t)
  }, [percent])

  const running = percent != null

  if (running) {
    return (
      <span
        className="smart-split__running"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          minWidth: compact ? 0 : 260,
          fontSize: 12,
          color: 'var(--c-text-2)',
        }}
      >
        <span style={{ flexShrink: 0 }}>正在智能识别：切分 · 归属 · 快递单号</span>
        {!compact && (
          <Progress
            percent={percent ?? 0}
            size="small"
            showInfo={false}
            style={{ width: 120, margin: 0 }}
            strokeColor="var(--c-primary)"
          />
        )}
        <span className="num" style={{ color: 'var(--c-primary)', flexShrink: 0 }}>
          {percent}%
        </span>
      </span>
    )
  }

  return (
    <Button
      size={size}
      icon={<ThunderboltOutlined />}
      onClick={() => setPercent(0)}
      title={
        '一次把切分、归属与快递单号都识别好，进切分页直接确认（原型固定约 5 秒）——'
        + '识别结果全部可改；客户侧若 AI 资源不足，改用手动切分即可'
      }
    >
      {label}
    </Button>
  )
}
