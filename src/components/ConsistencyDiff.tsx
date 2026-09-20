import { useMemo, useState } from 'react'
import { Segmented, Table, Tag, Tooltip } from 'antd'
import type { ConsistencyRow } from '@/types'
import { AiChip, ResultBar } from '@/components/Marks'

type FilterKey = 'all' | 'match' | 'diff' | 'missing' | 'extra'

/** 状态标签一律「浅底无边框」—— 描边标签会在密集表格里堆出大量线条 */
const STATUS_CFG: Record<ConsistencyRow['match'], { text: string; color: string; bg: string }> = {
  match: { text: '相符', color: 'var(--c-text-1)', bg: 'var(--c-risk-low-bg)' },
  diff: { text: '金额不符', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
  missing: { text: '回函缺失', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
  extra: { text: '回函新增', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
}

const money = (v: number | null) => (v == null ? '—' : v.toLocaleString('zh-CN'))

/**
 * 回函一致性检测明细 —— 「结论条 → 事实清单（逐项金额比对）→」三段骨架的第一、二段。
 *
 * 一致性差异是**客观事实**（回函金额与发函底稿对不上），不需要逐行采纳，因此不设操作列、
 * 也不在表格下方重复一遍「差异明细」—— 差异行由表格标红 + 结论条提示去向即可。
 */
export default function ConsistencyDiff({
  rows,
  confidence,
}: {
  rows: ConsistencyRow[]
  confidence: number
}) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const diffRows = useMemo(() => rows.filter((r) => r.match !== 'match'), [rows])
  const data = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((r) => r.match === filter)
  }, [rows, filter])

  if (!rows.length) {
    return <ResultBar status="info" message="尚无一致性比对结果，请先完成回函文件识别" />
  }

  return (
    <div>
      {/* ① 结论条 —— 只讲结果，不讲比对实现方式 */}
      <ResultBar
        status={diffRows.length ? 'risk' : 'ok'}
        message={
          diffRows.length
            ? `检出 ${diffRows.length} 项金额不符（共核对 ${rows.length} 项）`
            : `${rows.length} 项科目金额与发函底稿全部一致`
        }
        detail={
          diffRows.length
            ? '差异项将在「回函结果填写」页说明，此处仅作逐项呈现'
            : undefined
        }
      />

      {/* ② 事实清单 —— 逐项金额比对 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as FilterKey)}
          options={[
            { label: `全部 ${rows.length}`, value: 'all' },
            { label: `相符 ${rows.filter((r) => r.match === 'match').length}`, value: 'match' },
            { label: `不符 ${diffRows.length}`, value: 'diff' },
            { label: `发函缺失 ${rows.filter((r) => r.match === 'missing').length}`, value: 'missing' },
          ]}
        />
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            整体置信度
          </span>
          <AiChip confidence={confidence} label="AI" />
        </span>
      </div>

      <Table<ConsistencyRow>
        size="small"
        rowKey="id"
        dataSource={data}
        pagination={data.length > 10 ? { pageSize: 10, size: 'small' } : false}
        scroll={{ y: 300 }}
        rowClassName={(r) => (r.match !== 'match' ? 'row-risk-high' : '')}
        columns={[
          { title: '事项', dataIndex: 'item', width: 60 },
          { title: '截止日期/期间', dataIndex: 'period', width: 112 },
          { title: '科目', dataIndex: 'subject', width: 112 },
          {
            title: '发函金额',
            dataIndex: 'sentAmount',
            width: 106,
            align: 'right',
            render: (v: number | null) => <span className="num">{money(v)}</span>,
          },
          {
            title: '回函金额',
            dataIndex: 'repliedAmount',
            width: 110,
            align: 'right',
            render: (v: number | null, r) => (
              <span
                className="num"
                style={{
                  fontWeight: r.match !== 'match' ? 600 : 400,
                  color: r.match !== 'match' ? 'var(--c-risk-high)' : undefined,
                }}
              >
                {money(v)}
              </span>
            ),
          },
          {
            title: '差异',
            width: 92,
            align: 'right',
            render: (_, r) =>
              r.sentAmount != null && r.repliedAmount != null ? (
                <span
                  className="num"
                  style={{ color: r.match !== 'match' ? 'var(--c-risk-high)' : 'var(--c-text-3)' }}
                >
                  {r.repliedAmount - r.sentAmount === 0
                    ? '0'
                    : (r.repliedAmount - r.sentAmount).toLocaleString('zh-CN')}
                </span>
              ) : (
                <span className="muted">—</span>
              ),
          },
          {
            title: '比对结论',
            dataIndex: 'match',
            width: 88,
            render: (m: ConsistencyRow['match'], r) => (
              <Tooltip title={`AI 置信度 ${Math.round(r.confidence * 100)}%`}>
                <Tag
                  style={{
                    marginInlineEnd: 0,
                    fontSize: 12,
                    lineHeight: '16px',
                    padding: '0 5px',
                    border: 'none',
                    color: STATUS_CFG[m].color,
                    background: STATUS_CFG[m].bg,
                  }}
                >
                  {STATUS_CFG[m].text}
                </Tag>
              </Tooltip>
            ),
          },
        ]}
      />
    </div>
  )
}
