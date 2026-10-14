/**
 * 像素网格加载器 —— 上游 **beautifului.dev `Loading State`** 的移植（v2.57 引入，2026-10-14 换成上游原样）。
 *
 * 上游那个件 = **像素网格加载器 + 微光标签（shimmer）+ 实时计时器**，用于「Agent 正在跑」这类
 * 不知道要等多久的等待。三条设计约束：
 *
 * · **方格按人字波前错相**（延迟表 `(c + |r-1|) * 90ms`）：中间一行先亮，上下两行各晚 90ms × 列 ——
 *   于是看着像"扫过去"。**整排同步闪会读成故障**，错相才读成"有条不紊地干活"；
 * · **配等宽数字计时**（`--in-num` 的 `tabular-nums`），逐帧变化不抖动，
 *   否则计时数字会左右跳、比不动更难读；
 * · **完成态定格为静态图案**（`.is-done`）——「干完了」这件事用**停止运动**表达，
 *   比换一个图标更准、也更符合这套语言。
 *
 * 动效全部走 `opacity`（合成层），无 JS 逐帧；`prefers-reduced-motion` 下由 `insight.css` 整体降级为静态。
 */

/**
 * **chevron 延迟表**（逐字照搬上游）：列错相 90ms ＋ 离中间行的距离。
 *
 * ```
 * r = ⌊i/3⌋, c = i mod 3  ⇒  delay = (c + |r - 1|) * 90   // ms
 * ```
 * 9 格的延迟因此是 `[90,180,270, 0,90,180, 90,180,270]` —— 中间一行先亮。
 */
function chevronDelay(i: number): number {
  const r = Math.floor(i / 3)
  const c = i % 3
  return (c + Math.abs(r - 1)) * 90
}

/**
 * **只有那 3×3 像素网格**（不带文案 / 计时）—— 给"位置很小、旁边已经有字"的地方用，
 * 例如列表「智能核查状态」列的「正在核查」标签里。
 */
export function PixelGridLoader({
  /** 进行中 / 已完成 —— 完成后方格定格 */
  done = false,
  /** Dots 变体（格子取圆角）—— 上游的四种图案之一 */
  round = false,
}: {
  done?: boolean
  round?: boolean
}) {
  return (
    <span
      className={`px-grid${done ? ' is-done' : ''}${round ? ' is-round' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="px-grid__cell"
          /* 相位偏移走 CSS 变量，避免为每格写一条 animation-delay */
          style={{ ['--d' as string]: `${chevronDelay(i)}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * 加载状态整行 —— **网格 + 微光文案 + 读秒**（上游那个件的完整形态）。
 *
 * 计时文案由**调用方驱动**（界面层单一 `setInterval`），组件不自己起定时器 ——
 * 多个实例各起一个定时器会让读秒不同步。
 */
export function PixelLoader({
  /** 进行中 / 已完成 —— 完成后方格定格 */
  done = false,
  /** 计时文案，如「17.7s」。由**界面层统一驱动**，组件不自己起定时器 */
  timeText,
  /** 主文案，如「正在识别回函」「识别完成」 */
  label,
  /** 次要说说明，如「已归档 3 封」 */
  note,
}: {
  done?: boolean
  timeText?: string
  label?: string
  note?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ color: 'var(--in-primary)', display: 'inline-flex' }}>
        <PixelGridLoader done={done} />
      </span>

      {/* 微光文案 —— 上游的 shimmer 是 1.4s；站内那套（`insight.css` 的 `.shimmer-text`）
          时序略慢，这里继续用它，保持与「识别区标题」同一手感 */}
      {label && (
        <span className={done ? 'insight-sub' : 'shimmer-text'} style={{ fontSize: 13 }}>
          {label}
        </span>
      )}

      {timeText && (
        <span className="in-num" style={{ fontSize: 13, color: 'var(--in-text-2)' }}>
          {timeText}
        </span>
      )}

      {note && (
        <span style={{ fontSize: 12, color: 'var(--in-text-3)', marginLeft: 'auto' }}>{note}</span>
      )}
    </div>
  )
}
