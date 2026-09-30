import { useMemo, useState } from 'react'
import { Button, Input, InputNumber, Radio, Select } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type { PageSegment } from '@/types'
import { Section } from '@/components/recognition/shared'
import { checkExpressNo } from '@/utils/expressNo'
import { pageRangeOf } from '@/utils/pageRange'
import { cutsByCount, cutsByCustomRanges, cutsByFixedPages, segmentsOfCuts } from '@/utils/pageSplit'

/** 归属下拉里"尚未指定"的取值 —— 与 `RecognitionTask.confirmationNo` 的约定一致 */
export const UNASSIGNED = '待指定'

type SplitMode = 'fixed' | 'custom' | 'count'

/**
 * 归属下拉的候选项（v2.72）。
 *
 * 三个字段都要进界面：**只看函证编号，人认不出这是哪封函证**（用户：「函证编号后面要跟上
 * （被审计单位名称 + 被询证单位名称）」）。被询证单位是往来侧真正要核对的对象（对手方公司），
 * 被审计单位是本项目的主体 —— 一封函证的完整称呼由这三段构成。
 */
export interface AssignCandidate {
  confirmationNo: string
  /** 被询证单位（往来＝对手方公司；银行＝银行名称） */
  entity: string
  /** 被审计单位名称 */
  auditedEntity: string
}

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
  batchPanelOpenByDefault,
  showSegmentExpress,
  expressValues,
  onExpressChange,
  onRequestPreview,
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
  candidates: AssignCandidate[]
  /** 「拆分方式」初始是否展开 —— 按类型给（`TYPE_RULE.batchPanelOpenByDefault`，见那里的理由） */
  batchPanelOpenByDefault: boolean
  /** 每段尾部是否带一页快递面单（`UploadBatch.faceSheetLast`）—— 决定是否显示段尾面单的快递单号 */
  showSegmentExpress: boolean
  /** 段序 → 段尾面单单号（识别的或人工改过的；`undefined` = 没读到） */
  expressValues: Record<number, string | undefined>
  /** 人工补/改某段的单号 */
  onExpressChange: (index: number, value: string) => void
  /**
   * 请求把**某页**的放大预览钉在屏幕上（v2.79）—— `null` 表示撤销该请求。
   *
   * 点「改」单号时调它：用户接下来要**眼睛看面单、手在输入框里敲**，
   * 而"悬停即预览、移开即消失"的机制在这里帮倒忙（预览会消失、还正好压住输入框）。
   * 锚点是那一行 —— 切分板据此把预览摆在**不挡右侧面板**的位置并与这行对齐。
   */
  onRequestPreview: (page: number | null, anchor: HTMLElement | null) => void
}) {
  const [mode, setMode] = useState<SplitMode>('fixed')
  const [perPage, setPerPage] = useState(1)
  const [count, setCount] = useState(2)
  const [customText, setCustomText] = useState('')
  /** 拆分方式的展开态 —— 只作初值用一次，之后完全由用户控制（不是受控于 props） */
  const [batchOpen, setBatchOpen] = useState(batchPanelOpenByDefault)

  /**
   * 正在就地编辑单号的那一段（`null` = 没有）。
   *
   * **只有「未识别到 / 异常」的段会给「改」按钮** —— 判定见 `@/utils/expressNo`，
   * 那里写了为什么不做"逐段人工核对"：这一步的注意力该花在切分与归属上。
   */
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')

  const startEdit = (i: number, value: string | undefined, anchor: HTMLElement | null) => {
    setEditingIndex(i)
    setEditingText(value ?? '')
    /*
     * 把这一段的**最后一页（面单页）**钉出来给用户照着填（v2.79）。
     * 锚点传这一行 —— 切分板会据此把预览摆到**不挡右侧面板**的位置并与这行对齐，
     * 这样用户能一边看面单一边在输入框里敲（悬停那套机制在这个场景里会互相打架）。
     */
    onRequestPreview(segments[i]?.pageEnd ?? null, anchor)
  }
  /**
   * 提交（回车 / 失焦）。
   *
   * **不撤销钉出来的预览**（v2.79）：用户填完往往还要照着面单核一眼"我敲对了吗"，
   * 预览留着更顺手；关不关由他自己点 ✕ / Esc。
   * （配套：预览靠**悬停**平移，不抢输入框焦点，所以"边看边填"不会被打断。）
   */
  const commitEdit = () => {
    if (editingIndex == null) return
    onExpressChange(editingIndex, editingText.trim())
    setEditingIndex(null)
  }
  /** Esc 取消编辑 —— 预览一并撤掉（Esc 在用户心里就是"退出"） */
  const cancelEdit = () => {
    setEditingIndex(null)
    onRequestPreview(null, null)
  }

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

  /*
   * 下拉的两种文案（v2.73）—— **触发框窄、浮层宽，两者内容刻意不同**：
   *
   * · **触发框**只放「**被询证单位 · 函证编号**」：这两段才是核对时要看的
   *   （被询证单位＝这封回函的对家、函证编号＝精确主键），而且**长度可控** ——
   *   右栏是固定宽，文案长度一旦跟着数据走，栏宽就被迫跟着数据走（用户明确不要）。
   * · **浮层**再补上**被审计单位**：它在整批里是**恒定的同一个值**（所有候选都一样），
   *   逐行重复等于噪音；但作为"完整称谓"仍有参考价值 —— 放临时浮层最合适，浮层宽不影响布局。
   */
  const shortLabelOf = (c: AssignCandidate) => `${c.entity} · ${c.confirmationNo}`
  const fullLabelOf = (c: AssignCandidate) =>
    `${c.entity} · ${c.confirmationNo} · ${c.auditedEntity}`

  const options = [
    { value: UNASSIGNED, label: '待指定', shortLabel: '待指定' },
    ...candidates.map((c) => ({
      value: c.confirmationNo,
      label: fullLabelOf(c),
      shortLabel: shortLabelOf(c),
    })),
  ]

  return (
    <div className="split-panel">
      <Section
        title="拆分方式"
        count={`共 ${pageCount} 页`}
        collapsible
        open={batchOpen}
        onToggle={() => setBatchOpen((v) => !v)}
      >
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
                /* 触发框只显示 `shortLabel`（被询证单位 · 函证编号），浮层里显示完整称谓 —— 
                 * 见 `options` 上方注释：右栏宽度是固定的，不能让文案长度决定它 */
                optionLabelProp="shortLabel"
                /* 浮层里带完整称谓，比触发框宽 —— 让浮层按内容撑开，不截断 */
                popupMatchSelectWidth={false}
              />
              {/*
               * 段尾面单的快递单号（v2.76 立、v2.78 加校验与人工修改）。
               *
               * 口径（用户拍板：「对于异常的，或者没识别出来的，标记出来，可以改，别的就不管了」）：
               * **正常的只读**、**「未识别到 / 异常」的标出来并可就地改** —— 判定与理由见
               * `@/utils/expressNo`（一句话：这一步的注意力该花在切分与归属上，
               * 不该要求用户逐段比对一串数字）。
               */}
              {showSegmentExpress &&
                (() => {
                  const value = expressValues[i]
                  /* 查重时把自己那一项排除掉 */
                  const others = Object.entries(expressValues)
                    .filter(([k]) => Number(k) !== i)
                    .map(([, v]) => v ?? '')
                  const check = checkExpressNo(value, others)

                  if (editingIndex === i) {
                    return (
                      <div className="split-rows__express is-editing">
                        <span>段尾面单 · 快递单号</span>
                        <Input
                          size="small"
                          autoFocus
                          value={editingText}
                          placeholder="填面单上的快递单号"
                          style={{ width: 190 }}
                          onChange={(e) => setEditingText(e.target.value)}
                          onPressEnter={commitEdit}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                      </div>
                    )
                  }

                  return (
                    <div className={`split-rows__express${check.status === 'ok' ? '' : ' is-flagged'}`}>
                      <span>段尾面单 · 快递单号</span>
                      <span className="num">{value?.trim() || '未识别到'}</span>
                      {check.status !== 'ok' && (
                        <>
                          <span className="split-rows__express-why">{check.reason}</span>
                          <Button
                            type="link"
                            size="small"
                            style={{ padding: 0, height: 'auto', fontSize: 12 }}
                            icon={<EditOutlined />}
                            onClick={(e) =>
                              startEdit(
                                i,
                                value,
                                (e.currentTarget.closest('.split-rows__item') as HTMLElement | null) ?? null,
                              )
                            }
                          >
                            改
                          </Button>
                        </>
                      )}
                    </div>
                  )
                })()}
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
