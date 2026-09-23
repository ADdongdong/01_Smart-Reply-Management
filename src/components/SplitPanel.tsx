import { useMemo, useState } from 'react'
import { Button, Input, InputNumber, Radio, Select } from 'antd'
import type { PageSegment } from '@/types'
import { Section } from '@/components/recognition/shared'
import { pageRangeOf } from '@/utils/pageRange'
import { cutsByCount, cutsByCustomRanges, cutsByFixedPages, segmentsOfCuts } from '@/utils/pageSplit'

/** 归属下拉里"尚未指定"的取值 —— 与 `RecognitionTask.confirmationNo` 的约定一致 */
export const UNASSIGNED = '待指定'

type SplitMode = 'fixed' | 'custom' | 'count'

/**
 * 拆分方式 + 切分结果（v2.62）—— 「回函归属」界面的右栏。
 *
 * ## 上段：拆分方式（批量）
 *
 * 照用户给的参考界面：三种方式（按固定页数 / 按自定义范围 / 按文档数量均分），
 * 选一种、填参数、点「按此方式切分」一次性重切。
 *
 * **为什么是「选 + 应用」两步，而不是改参数就即时重切**：即时重切有个隐患 ——
 * 用户拿剪刀一页页微调完，手滑碰到某个参数，整份切分就被批量方式覆盖了。
 * 分成两步后，"批量重切"始终是一次明确的动作，**微调不会被误伤**。
 *
 * ## 下段：切分结果（每段一行 + 归属下拉）
 *
 * 每段一行，直接挂一个归属下拉 —— 这是用户明确选定的做法
 * （「每段一个下拉，从函证清单里选」）：切分与归属在同一个动作里完成，
 * 不必"先切完、再去另一处逐段点选归属"。
 *
 * 下拉的候选来自**同类型的候选函证清单**（银行批次不列往来函证，反之亦然）。
 */
export default function SplitPanel({
  pageCount,
  segments,
  activeIndex,
  onPickSegment,
  onCutsChange,
  assigns,
  onAssign,
  candidates,
}: {
  pageCount: number
  /** 当前切分结果 */
  segments: PageSegment[]
  activeIndex: number
  onPickSegment: (index: number) => void
  /** 批量方式重切 */
  onCutsChange: (cuts: number[]) => void
  /** 段序 → 函证编号（`UNASSIGNED` 表示待指定） */
  assigns: Record<number, string>
  onAssign: (index: number, confirmationNo: string) => void
  /** 可归属的候选函证（已按当前函证类型筛过） */
  candidates: { confirmationNo: string; entity: string }[]
}) {
  const [mode, setMode] = useState<SplitMode>('fixed')
  const [perPage, setPerPage] = useState(1)
  const [count, setCount] = useState(2)
  const [customText, setCustomText] = useState('')

  /** 按当前方式算出的切分（`null` = 自定义范围填得不对，不能应用） */
  const nextCuts = useMemo(() => {
    if (mode === 'fixed') return cutsByFixedPages(pageCount, perPage)
    if (mode === 'count') return cutsByCount(pageCount, count)
    return cutsByCustomRanges(customText, pageCount)
  }, [mode, pageCount, perPage, count, customText])

  /**
   * 按当前方式算出的**段数** —— 注意是段数不是切点数（切点 = 段数 − 1）。
   * 这里统一走 `segmentsOfCuts` 数一次，免得两种口径各写一遍、早晚对不上。
   */
  const nextSegmentCount = nextCuts ? segmentsOfCuts(pageCount, nextCuts).length : 0

  const hint =
    mode === 'fixed'
      ? `将拆分为 ${nextSegmentCount} 段`
      : mode === 'count'
        ? `将平均拆分为 ${count} 段（每段约 ${Math.ceil(pageCount / Math.max(1, count))} 页）`
        : nextCuts
          ? `将拆分为 ${nextSegmentCount} 段`
          : `请填写如「1-4, 5-8, ${pageCount > 11 ? '9-12' : `${pageCount}`}」，需完整覆盖 1-${pageCount} 页`

  const options = [
    { value: UNASSIGNED, label: '待指定' },
    ...candidates.map((c) => ({
      value: c.confirmationNo,
      label: `${c.entity} · ${c.confirmationNo}`,
    })),
  ]

  return (
    <div className="split-panel">
      <Section title="拆分方式" count={`共 ${pageCount} 页`}>
        <div className="split-panel__modes">
          <Radio checked={mode === 'fixed'} onChange={() => setMode('fixed')}>
            按固定页数拆分
          </Radio>
          {mode === 'fixed' && (
            <div className="split-panel__param">
              <InputNumber
                size="small"
                min={1}
                max={pageCount}
                value={perPage}
                onChange={(v) => setPerPage(v ?? 1)}
                style={{ width: 72 }}
              />
              <span className="split-panel__param-suffix">页</span>
            </div>
          )}

          <Radio checked={mode === 'custom'} onChange={() => setMode('custom')}>
            按自定义范围拆分
          </Radio>
          {mode === 'custom' && (
            <div className="split-panel__param">
              <Input
                size="small"
                value={customText}
                placeholder={`如：1-4, 5-8, 9-${pageCount}`}
                onChange={(e) => setCustomText(e.target.value)}
              />
            </div>
          )}

          <Radio checked={mode === 'count'} onChange={() => setMode('count')}>
            按文档数量均分
          </Radio>
          {mode === 'count' && (
            <div className="split-panel__param">
              <InputNumber
                size="small"
                min={1}
                max={pageCount}
                value={count}
                onChange={(v) => setCount(v ?? 2)}
                style={{ width: 72 }}
              />
              <span className="split-panel__param-suffix">段</span>
            </div>
          )}
        </div>

        <div className="split-panel__hint">{hint}</div>

        <Button
          block
          type="primary"
          disabled={!nextCuts}
          onClick={() => nextCuts && onCutsChange(nextCuts)}
        >
          按此方式切分
        </Button>
      </Section>

      <Section title="切分结果" count={`共 ${segments.length} 段`}>
        <div className="split-rows">
          {segments.map((seg, i) => (
            <div
              key={`${seg.pageStart}-${seg.pageEnd}`}
              className={`split-rows__item${i === activeIndex ? ' is-active' : ''}`}
              onClick={() => onPickSegment(i)}
            >
              <div className="split-rows__head">
                <span className="split-rows__idx">段 {i + 1}</span>
                <span className="split-rows__range num">{pageRangeOf(seg)}</span>
                <span className="split-rows__pages">
                  {seg.pageEnd - seg.pageStart + 1} 页
                </span>
              </div>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={assigns[i] ?? UNASSIGNED}
                onChange={(v) => onAssign(i, v)}
                options={options}
                /* 候选里带单位全称，比触发框宽 —— 让浮层按内容撑开，不截断 */
                popupMatchSelectWidth={false}
              />
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
