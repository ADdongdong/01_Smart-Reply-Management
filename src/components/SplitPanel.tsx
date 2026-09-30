import { useMemo, useState } from 'react'
import { Button, Input, InputNumber, Radio, Select } from 'antd'
import { CarOutlined, EditOutlined } from '@ant-design/icons'
import type { PageSegment } from '@/types'
import { Section } from '@/components/recognition/shared'
import { checkExpressNo } from '@/utils/expressNo'
import { pageRangeOf } from '@/utils/pageRange'
import { cutsByCount, cutsByCustomRanges, cutsByFixedPages, segmentsOfCuts } from '@/utils/pageSplit'

/** 归属下拉里"尚未指定"的取值 —— 与 `RecognitionTask.confirmationNo` 的约定一致 */
export const UNASSIGNED = '待指定'

/**
 * 归属下拉里「**这一段的角色是快递面单**」的取值（v2.83，**仅银行侧**提供）。
 *
 * 银行常见「多封函证 + 一张面单」—— 同一家银行按年度回函（21 / 22 / 23 / 24 年 1-6 月），
 * 几封装在**同一个快递**里，于是**一个快递单号对应多个函证编号**。
 *
 * 做法：把面单页**切成独立一段**、在这一段上标本值，由它**管辖它前面的那些函证段**
 * （"直到上一个面单段为止"，所以一次扫了几个包裹也成立）。
 * 那些段显示的单号是**继承**来的：**值只存在面单段这一处**，改一处即全改 ——
 * 既不用在 4 行里各改一遍，也不会被"与他段重复必有一处读错"的查重规则误报。
 *
 * 往来不提供该选项：它的面单页是**每段自己的尾页**（一对一），不单独成段 —— 用户要求往来逻辑不变。
 */
export const FACE_SHEET = '__face_sheet__'

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
  manualExpress,
  onExpressChange,
  allowFaceSheetSegment,
  faceSheetSegments,
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
  /**
   * 段序 → **用户人工补/改过的**单号（v2.93）—— 只用来判断"这一行的值是机器读的还是人填的"。
   *
   * 传的是草稿里那张表本身（`draft.express`）：**表里有这一项 ⟹ 人填过**（值可能是空串，
   * 那也是人主动清空的，同样该保留「改」）。机器识别的值不在表里 —— 界面上两者应能被区分，
   * 因为**机器读的是原始证据、人要为准；人填的是判断、必须能回头改**。
   */
  manualExpress: Record<number, string>
  /** 人工补/改某段的单号 */
  onExpressChange: (index: number, value: string) => void
  /**
   * 归属下拉里是否提供「快递面单（本文件共用）」这一项（v2.83）—— **银行侧为真，往来为假**。
   * 它同时决定两件事：可把某段标成面单段、以及**不查"与他段重复"**
   * （银行侧多段同一个号是正常形态：一张面单管多封）。
   */
  allowFaceSheetSegment: boolean
  /** 哪些段是**快递面单段**（段序）—— 它们管辖"它前面的段，直到上一个面单段为止" */
  faceSheetSegments: number[]
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
    /*
     * 「快递面单（本文件共用）」（v2.83）：给银行侧一个"这一段不是函证、而是一个包裹的面单"的选项。
     * **复用归属下拉、不新增控件** —— 这个下拉本来就在回答"这一段是什么"，
     * 多一个选项比另放一个角色切换器省认知。
     */
    ...(allowFaceSheetSegment
      ? [{ value: FACE_SHEET, label: '快递面单（本文件共用）', shortLabel: '快递面单（共用）' }]
      : []),
    ...candidates.map((c) => ({
      value: c.confirmationNo,
      label: fullLabelOf(c),
      shortLabel: shortLabelOf(c),
    })),
  ]

  /**
   * 段 i 是否**被某张面单管辖** —— 返回那张面单段的段序，没有则 `null`。
   *
   * 规则「面单段管辖它前面的段，直到上一个面单段为止」—— 换成"我在找管我的那张面单"，
   * 就是**我后面最近的那个面单段**（`j > i` 方向）。往前面找是错的：面单在文件尾部时，
   * 前面的段谁都找不到面单（v2.83 实测踩到）。
   */
  const governingFaceSheetOf = (i: number): number | null => {
    for (let j = i + 1; j < segments.length; j++) if (faceSheetSegments.includes(j)) return j
    return null
  }

  /**
   * 段 → **包裹号**（0 起；`null` = 不属于任何包裹）。
   *
   * 一个"包裹"就是**同一张面单管辖的那几段 + 那张面单段本身**（v2.86 加的分组）——
   * 界面上把它们连成一组画出来，用户一眼能看出"这几封是一个快递寄回来的"，
   * 而不是在一长串同质的段行里自己找关系。面单段是组的**最后一段**（与文件顺序一致）。
   * 最后一张面单之后的段不属于任何包裹（`null`），界面上会明说。
   */
  const groupNoOf: (number | null)[] = (() => {
    const out: (number | null)[] = segments.map(() => null)
    let no = -1
    let start = 0
    segments.forEach((_, i) => {
      if (!faceSheetSegments.includes(i)) return
      no += 1
      for (let j = start; j <= i; j++) out[j] = no
      start = i + 1
    })
    return out
  })()

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

      <Section
        title="切分结果"
        count={
          faceSheetSegments.length
            ? `共 ${segments.length} 段 · 含 ${faceSheetSegments.length} 段快递面单`
            : `共 ${segments.length} 段`
        }
      >
        <div className="split-rows">
          {segments.map((seg, i) => (
            <div
              key={`${seg.pageStart}-${seg.pageEnd}`}
              className={`split-rows__item${i === activeIndex ? ' is-active' : ''}`}
              /*
               * 「同包裹」不再用**左边那条竖线**表达（v2.91，用户否掉了它：「左侧不要有蓝色的竖线」），
               * 改成**每一行都挂一个包裹标签**（见下面的 `split-rows__pkg`，每个包裹一个鲜亮颜色）——
               * 关系依然一眼看得出，但不再是压在最左边的一条色条。
               */
              onClick={() => onPickSegment(i)}
            >
              <div className="split-rows__head">
                <span className="split-rows__idx">
                  {/* 面单段再加一个**快递标识**，扫一眼就认得出哪行是面单 */}
                  {faceSheetSegments.includes(i) && <CarOutlined style={{ marginRight: 4 }} />}
                  段 {i + 1}
                </span>
                {/*
                  **包裹标签（v2.91）**：同一个包裹的**每一行都挂**（用户：「同一个包裹的每个函证页签上，
                  都有一个包裹的标签，用鲜亮的原色标注」）—— 而不是只在组首写一行小字说明。
                  每行都标的好处：视线停在哪一行都能立刻知道它属于哪个包裹，不用往上翻去找组首；
                  颜色由包裹号决定（**同一个包裹同一个色**），原来那条竖线承担的"分组"信息由它接手。
                  `% 8`（v2.93 由 4 档扩到 8 档）：4 档时"包裹 5"会撞回"包裹 1"的蓝，
                  同一份件里两个包裹同色就失去了区分作用；8 档够用（一份件里 8 个包裹已属极端）。
                  超出 8 个则循环复用 —— 可接受，因为**标签上的数字才是主标识**，颜色只是辅助。
                */}
                {groupNoOf[i] != null && (
                  <span className={`split-rows__pkg split-rows__pkg--${groupNoOf[i]! % 8}`}>
                    包裹 {groupNoOf[i]! + 1}
                  </span>
                )}
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
                  const isFace = faceSheetSegments.includes(i)
                  const gov = governingFaceSheetOf(i)
                  /**
                   * 本行属于哪种面单关系（v2.83）：
                   * · `isFace` —— 这一段**就是**快递面单段：单号由它管，异常时可改；
                   * · `gov != null` —— 这一段**被某张面单管辖**：单号是**继承**来的，只读、不给「改」
                   *   （值只有一处来源，要改去改面单段那一行）。
                   */
                  /*
                   * 「继承」= 被别处的面单管着。**面单段本身不算** —— 它就是那张面单，
                   * 不该反过来显示"来自某段的面单"（v2.85 实测：同一段既标面单段、又挂一句
                   * "来自段 4 的面单"，自己指自己，很怪）。
                   */
                  const inherited = gov != null && !isFace
                  /*
                   * 标签**不再写「本文件面单 / 同包裹」**（v2.93，用户：「有了包裹标签了，
                   * 下面就不需要【同包裹】【本文快递面单】这个文字说明了」）——
                   * 分组关系已经由行首那个包裹标签表达，这里只留"这一行是个什么值"。
                   * 往来的「段尾面单」保留：往来没有包裹标签可依赖，这个前缀还得承担说明职责。
                   */
                  const label = isFace || inherited ? '快递单号' : '段尾面单 · 快递单号'
                  /*
                   * **人工填过的值，也要一直留着「改」**（v2.93，用户：「如果是手动填入的快递单号，
                   * 填写后，仍然需要保留修改的入口」）。
                   *
                   * 为什么不能像机器识别的值那样填完就只读：机器读出来的是**原始证据**（读对读错都不由人），
                   * 而人工填的是**人的判断** —— 填错了后面没有任何校验能兜住它（格式合法就不会再报异常），
                   * 所以必须留一个能回头改的口子。
                   */
                  const manual = manualExpress[i] !== undefined
                  /*
                   * 查重时把自己那一项排除掉。
                   * **银行侧不查"与他段重复"** —— 那里"多段同一个号"是正常形态（一张面单管多封），
                   * 照搬往来的规则会把这几封全部标红报错。共号只在面单段那一行校验一次。
                   */
                  const others = allowFaceSheetSegment
                    ? []
                    : Object.entries(expressValues)
                        .filter(([k]) => Number(k) !== i)
                        .map(([, v]) => v ?? '')
                  /* 继承来的值不再二次校验（源头那一行已经校验过） */
                  const check = inherited ? { status: 'ok' as const } : checkExpressNo(value, others)
                  /*
                   * 面单段空值时的措辞（v2.94 修）——**不能照搬"面单条码未读出"**：
                   * 用户手工标成面单的那一页，可能**压根没参与过面单识别**（识别阶段只对"像面单的页"跑条码），
                   * 说"未读出"会让人以为系统识别过、只是没成功。改成一句两种情况都成立的话。
                   */
                  const reason =
                    isFace && check.status === 'unread'
                      ? '这一页没有识别到面单条码 —— 请照预览图上的运单号填写'
                      : check.reason

                  if (editingIndex === i) {
                    return (
                      <div className="split-rows__express is-editing">
                        <span>{label}</span>
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
                      <span>{label}</span>
                      <span className="num">
                        {value?.trim() || (inherited ? '待面单段填入' : '未识别到')}
                      </span>
                      {/*
                        v2.94：**不再写「管辖段 X–Y（N 封）」「来自段 N 的面单」**（用户：「这两句也是多余，
                        【包裹 1】标签已经能说明问题」）—— 谁跟谁同一个包裹由包裹标签表达；
                        而"这个号是谁提供的"由**面单段那一行有单号、其余行没有**自然体现，不必再用文字说一遍。
                      */}
                      {/* 人工填过、且格式没问题：标一句来源，与"机器识别值"区分开（v2.93） */}
                      {manual && !inherited && check.status === 'ok' && (
                        <span className="split-rows__express-why">人工填写</span>
                      )}
                      {/*
                        「改」出现的两个条件，缺一不可：
                        · **值是异常的 / 没识别到** —— 机器识别的正常值只读（别让用户逐段核对一串数字）；
                        · **值是人填过的** —— 人的判断必须能回头改（见上面 `manual` 的说明）。
                      */}
                      {!inherited && (check.status !== 'ok' || manual) && (
                        <>
                          {check.status !== 'ok' && (
                            <span className="split-rows__express-why">{reason}</span>
                          )}
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
