import { useMemo, useState } from 'react'
import { Button, Segmented, Tooltip } from 'antd'
import { FileSearchOutlined } from '@ant-design/icons'
import type { ConsistencyTable, ConsistencyTableRow } from '@/types'
import { compareCell, parseAmount, type CellState } from '@/utils/consistency'
import { AiChip, ResultBar } from '@/components/Marks'

/** 视角：全部数据表格 / 只看有差异的表 */
type ViewKey = 'all' | 'diff'

/** 并排的哪一侧 */
type Side = 'sent' | 'replied'

/** 一对**已对齐**的行（发函行 ↔ 回函行，按表格的 `keyColumns` 配对） */
interface RowPair {
  id: string
  sent?: ConsistencyTableRow
  replied?: ConsistencyTableRow
  /** 逐列的比对结论（长度 = 列数；未参与比对的列恒为 `same`） */
  states: CellState[]
  /** 本行参与比对的单元格数 */
  compared: number
  /** 本行不一致的单元格数 */
  diffCount: number
}

/** 一张表的对齐结果 */
interface AlignedTable {
  table: ConsistencyTable
  pairs: RowPair[]
  /** 全表参与比对的单元格数 */
  compared: number
  /** 全表不一致的单元格数 */
  diffCount: number
}

/**
 * 回函一致性检测 —— 「结论条 → **逐表忠实并排对比**」。
 *
 * ## 形态（v2.69 重做，v2.70 补大类与「查看原件」）
 *
 * 发函件里除「信息证明无误 / 信息不符」签章区之外的**每一张数据表格**都是一组
 * （**张数随识别结果而定，不在代码里写死** —— 真实样例 `fahan-cswl0526.pdf` 是
 * 「4 大类 / 6 张子表」，且**每张列数各不相同**：6 / 5 / 6 / 5 / 5 / 2）。
 * 组标题先给**大类**（原件里的大项标题，如「1. 销售与未结算」）、再给子表名；
 * 组内左＝**发函文件识别结果**、右＝**回函文件识别结果**，两张独立表。
 *
 * ## 两条硬口径
 *
 * ① **原件怎么排，界面就怎么排** —— 行列**逐单元格照实展示**（不归一化、不丢列、不重排）。
 *    此前把 20 条事项压成「事项 / 期间 / 科目 / 金额」一张平表，等于把原件的表格结构丢掉了，
 *    用户没法把「文件里那张表」与「界面上这张表」对上 —— 而核验页的职责正是
 *    「拿着 AI 结论去原件上找依据」。
 * ② **不一致的单元格打红框**（描边 + 浅红底 + 深档红字 + 悬停给差异额）；单向缺失的那一侧
 *    显示「未列示」/「无此项」并同样框出。判定口径与拍平记录**共用** `@/utils/consistency`，
 *    因此「结论条说几项不符」与「表里框了几处」必然一致。
 *
 * 差异是**客观事实**（回函金额与发函底稿对不上），不需要逐行采纳，故不设操作列；
 * 差异说明的去向是「回函结果填写」页，这里只用结论条点一句。
 */
export default function ConsistencyDiff({
  tables,
  confidence,
  onFocusTable,
}: {
  tables: ConsistencyTable[]
  confidence: number
  /**
   * 点某张表的「查看原件」（v2.70）—— 把该表回传给调用方，
   * 由调用方驱动左侧「发函用印件 / 回函件」两栏同时跳到该表所在页。
   * 不传则不渲染该入口（本组件自身不碰预览，纯展示层）。
   */
  onFocusTable?: (table: ConsistencyTable) => void
}) {
  const [view, setView] = useState<ViewKey>('all')

  const aligned = useMemo(() => tables.map(alignTable), [tables])

  if (!tables.length) {
    return <ResultBar status="info" message="尚无一致性比对结果，请先完成回函文件识别" />
  }

  const compared = aligned.reduce((n, a) => n + a.compared, 0)
  const diffCount = aligned.reduce((n, a) => n + a.diffCount, 0)
  const diffTables = aligned.filter((a) => a.diffCount > 0)
  const shown = view === 'all' ? aligned : diffTables

  return (
    <div>
      {/* ① 结论条 —— 只讲结果，不讲比对实现方式 */}
      <ResultBar
        status={diffCount ? 'risk' : 'ok'}
        message={
          diffCount
            ? `检出 ${diffCount} 项金额不符（共核对 ${compared} 项）`
            : `${compared} 项金额与发函底稿全部一致`
        }
        detail={
          diffCount
            ? '差异单元格已在下方逐表框出；差异说明在「回函结果填写」页填写'
            : undefined
        }
      />

      {/* ② 工具行 —— 视角切换 + 整体置信度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(v as ViewKey)}
          options={[
            { label: `全部 ${aligned.length} 张表`, value: 'all' },
            { label: `仅看差异 ${diffTables.length} 张表`, value: 'diff' },
          ]}
        />
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            整体置信度
          </span>
          <AiChip confidence={confidence} label="AI" />
        </span>
      </div>

      {/* ③ 逐表并排对比 */}
      {shown.length ? (
        shown.map((a) => <TableBlock key={a.table.id} align={a} onFocusTable={onFocusTable} />)
      ) : (
        <div className="cmp-empty">所有数据表格均与发函底稿一致，无差异项</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 对齐                                                                */
/* ------------------------------------------------------------------ */

/** 行配对键 —— 取该表 `keyColumns` 这几列的原文 */
const keyOf = (t: ConsistencyTable, r: ConsistencyTableRow) =>
  t.keyColumns.map((c) => (r.cells[c] ?? '').trim()).join('\u0001')

/**
 * 把一张表的发函行与回函行**逐行对齐**。
 * 先按键配对；键对不上时退回同序位置（回函是同一封信填回来的，行序本就一致）。
 */
function alignTable(t: ConsistencyTable): AlignedTable {
  const repliedByKey = new Map<string, ConsistencyTableRow>()
  t.repliedRows.forEach((r) => repliedByKey.set(keyOf(t, r), r))

  const used = new Set<string>()
  const pairs: RowPair[] = t.sentRows.map((sent, i) => {
    const replied = repliedByKey.get(keyOf(t, sent)) ?? t.repliedRows[i]
    if (replied) used.add(keyOf(t, replied))
    return makePair(t, `${t.id}-${i}`, sent, replied)
  })
  /* 回函有、发函无的行也照实列出（不能因为匹配不上就悄悄丢掉） */
  t.repliedRows.forEach((r, i) => {
    if (!used.has(keyOf(t, r))) pairs.push(makePair(t, `${t.id}-r${i}`, undefined, r))
  })

  return {
    table: t,
    pairs,
    compared: pairs.reduce((n, p) => n + p.compared, 0),
    diffCount: pairs.reduce((n, p) => n + p.diffCount, 0),
  }
}

function makePair(
  t: ConsistencyTable,
  id: string,
  sent: ConsistencyTableRow | undefined,
  replied: ConsistencyTableRow | undefined,
): RowPair {
  const states: CellState[] = t.columns.map(() => 'same')
  let compared = 0
  let diffCount = 0

  t.comparedColumns.forEach((c) => {
    const sentText = sent?.cells[c] ?? ''
    const repliedText = replied?.cells[c] ?? ''
    const state = compareCell(sentText, repliedText)
    states[c] = state
    /* 两侧都没有金额（如「贵公司欠」整列「-」）→ 不是核对项 */
    if (state === 'same' && parseAmount(sentText) == null) return
    compared++
    if (state !== 'same') diffCount++
  })

  return { id, sent, replied, states, compared, diffCount }
}

/* ------------------------------------------------------------------ */
/* 呈现                                                                */
/* ------------------------------------------------------------------ */

/** 一张表的并排对比 —— 左＝发函识别结果，右＝回函识别结果 */
function TableBlock({
  align,
  onFocusTable,
}: {
  align: AlignedTable
  onFocusTable?: (table: ConsistencyTable) => void
}) {
  const { table, compared, diffCount, pairs } = align
  const ok = diffCount === 0
  /**
   * 组标题右侧的结论摘要 —— 三种情况要分清：
   * · **原件这一项就没有数据行**（如本封函证的「采购与预（应）付账款」只印了表头）→ 说明是原件如此，不是系统没识别；
   * · 有行但没有可比对金额（如「其他事项」空白框）→ 无可比对项；
   * · 正常 → 一致 / 几项不一致。
   */
  const summary =
    compared > 0
      ? ok
        ? `${compared} 项全部一致`
        : `共 ${compared} 项 · ${diffCount} 项不一致`
      : pairs.length === 0
        ? '原件此项无数据'
        : '无可比对项'
  return (
    <section className="cmp-group">
      <header className="cmp-group__head">
        {table.section && <span className="cmp-group__section">{table.section}</span>}
        <span className="cmp-group__title">{table.title}</span>
        {table.unit && <span className="cmp-group__unit">{table.unit}</span>}
        <span className={ok ? 'cmp-group__sum is-ok' : 'cmp-group__sum is-risk'}>{summary}</span>
        {onFocusTable && (
          <Button
            size="small"
            icon={<FileSearchOutlined />}
            onClick={() => onFocusTable(table)}
            title="把左侧两件原件同时定位到这张表所在的页"
          >
            查看原件
          </Button>
        )}
      </header>
      <div className="cmp-pair">
        <TableSide align={align} side="sent" />
        <TableSide align={align} side="replied" />
      </div>
    </section>
  )
}

function TableSide({ align, side }: { align: AlignedTable; side: Side }) {
  const { table, pairs } = align
  const isSent = side === 'sent'
  return (
    <div className="cmp-side">
      <div className="cmp-side__label">{isSent ? '发函文件识别结果' : '回函文件识别结果'}</div>
      <table className="cmp-table">
        {/* 列宽由「列的角色」算权重：配对键列 2 / 比对列 2 / 其余 1 —— 两侧同源，必然对齐 */}
        <colgroup>
          {table.columns.map((_, i) => (
            <col key={i} style={{ width: `${colWidth(table, i)}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} className={table.comparedColumns.includes(i) ? 'is-right' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.id}>
              {table.columns.map((_, i) => (
                <td key={i} className={table.comparedColumns.includes(i) ? 'is-right' : undefined}>
                  <Cell table={table} col={i} pair={p} side={side} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 列宽权重 → 百分比（两侧共用同一份计算结果 ⇒ 同一行必然落在同一水平线上）。
 *
 * 权重按「这一列在比对里承担什么」定：
 * · **比对列 / 配对键列 / 期间列**给 2 —— 金额与期间是这张表的骨肉，不能被挤到换行；
 * · 其余（科目 / 采购内容 / 备注）给 1.6 —— 也要放得下「应付账款」这类短词。
 */
function colWidth(t: ConsistencyTable, i: number): number {
  const weights = t.columns.map((_, idx) => {
    const heavy =
      t.comparedColumns.includes(idx) || t.keyColumns.includes(idx) || t.periodColumn === idx
    return heavy ? 2 : 1.6
  })
  const total = weights.reduce((a, b) => a + b, 0)
  return (weights[i] / total) * 100
}

/** 单元格 —— 未参与比对的列照实展示；不一致的**打红框**（并给出差异额悬停说明） */
function Cell({
  table,
  col,
  pair,
  side,
}: {
  table: ConsistencyTable
  col: number
  pair: RowPair
  side: Side
}) {
  const isSent = side === 'sent'
  const state = pair.states[col] ?? 'same'
  const text = (isSent ? pair.sent : pair.replied)?.cells[col] ?? ''

  if (!table.comparedColumns.includes(col) || state === 'same') {
    return <span className={table.comparedColumns.includes(col) ? 'num' : undefined}>{text}</span>
  }

  /*
   * 单向缺失 —— 缺失的那一侧说明**是这一侧没有**，有值的那一侧把值框出来，
   * 于是「哪两个格子对不上」一眼可见。
   */
  if (state === 'missing') {
    return isSent ? (
      <Tooltip title="回函中未列示此金额（发函有、回函无）">
        <span className="cmp-cell cmp-cell--diff num">{text}</span>
      </Tooltip>
    ) : (
      <Tooltip title="回函未列示 —— 原件此处为空">
        <span className="cmp-cell cmp-cell--diff cmp-cell--absent">未列示</span>
      </Tooltip>
    )
  }
  if (state === 'extra') {
    return isSent ? (
      <Tooltip title="发函底稿中无此金额（回函新增）">
        <span className="cmp-cell cmp-cell--diff cmp-cell--absent">无此项</span>
      </Tooltip>
    ) : (
      <Tooltip title="回函新增 —— 发函底稿中无此金额">
        <span className="cmp-cell cmp-cell--diff num">{text}</span>
      </Tooltip>
    )
  }

  const s = parseAmount(pair.sent?.cells[col] ?? '')
  const r = parseAmount(pair.replied?.cells[col] ?? '')
  const gap = s != null && r != null ? r - s : null
  return (
    <Tooltip
      title={
        gap == null ? '与发函底稿不一致' : `与发函金额相差 ${gap.toLocaleString('zh-CN')} 元`
      }
    >
      <span className="cmp-cell cmp-cell--diff num">{text}</span>
    </Tooltip>
  )
}
