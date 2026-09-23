/**
 * 像素网格加载器（v2.57）—— 以方格阵列表达「系统正在工作」。
 *
 * 形态取自 beautifului.dev 的 Loading State（pixel-grid loader with shimmer
 * and elapsed time）。三条设计约束：
 *
 * · **方格按列错相位**（`animation-delay: i * 55ms`），形成扫过的人流式波纹 ——
 *   整排同步闪烁会读成"故障"，错相位才读成"有条不紊地干活"；
 * · **配等宽数字计时**（`--in-num` 的 `tabular-nums`），逐帧变化不抖动，
 *   否则计时数字会左右跳动，比不动更难读；
 * · **完成态定格为静态图案**（`.is-done`）——「干完了」这件事由"停止运动"表达，
 *   比换一个图标更省、也更符合这套语言。
 *
 * 动效全部走 `transform` / `opacity`（合成层），无 JS 逐帧；
 * `prefers-reduced-motion` 下由 `insight.css` 整体降级为静态。
 */
export function PixelLoader({
  /** 进行中 / 已完成 —— 完成后方格定格 */
  done = false,
  /** 方格数量：行阵列的宽度。默认 9（参考站的形态），小尺寸场合可减 */
  cells = 9,
  /** 计时文案，如「57.7s」。由**界面层统一驱动**（单一 setInterval），组件不自起定时器 */
  timeText,
  /** 主文案，如「正在识别」/「识别完成」 */
  label,
  /** 次要说明，如「已归档 3 封」 */
  note,
}: {
  done?: boolean
  cells?: number
  timeText?: string
  label?: string
  note?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className={done ? 'px-grid is-done' : 'px-grid'} style={{ color: 'var(--in-primary)' }}>
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className="px-grid__cell"
            /* 相位偏移靠 CSS 变量传，避免为每格写一条 animation-delay */
            style={{ ['--i' as string]: i }}
          />
        ))}
      </div>

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

/**
 * 圆点相位加载器 —— 小尺寸场合的变体。
 *
 * 右下角悬浮卡只有一条文字的高度，放 9 格阵列会显得笨重（那个尺度下方格读不出"阵列"，
 * 只像几个竖条）。故给一个等价的圆点相位变体，语言一致、体量更小。
 */
export function DotLoader({ color = 'var(--c-primary)' }: { color?: string }) {
  return (
    <span className="px-dots" style={{ color }}>
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ ['--i' as string]: i }} />
      ))}
    </span>
  )
}
