import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Input, Radio, Tooltip } from 'antd'
import {
  AuditOutlined,
  CompressOutlined,
  DownOutlined,
  ExpandOutlined,
  FormOutlined,
  HighlightOutlined,
  SafetyCertificateOutlined,
  UpOutlined,
} from '@ant-design/icons'
import type { ConsistencyTable, ReplyRecord, ReplyResultInfo } from '@/types'
import type { PageRange } from '@/config/preview'
import {
  browserSentSampleUrlOf,
  letterPagesOf,
  sampleFileOf,
  sentSampleFileOf,
} from '@/config/preview'
import { aiReviewItemsOf, aiReviewStateOf, aiReviewTip } from '@/config/aiReview'
import { RESULT_EXTRA_PANEL_KEY, RESULT_NOTE_FIELDS, RESULT_REQUIRED_FIELDS } from '@/config/replyTasks'
import { TYPE_RULE, isRecognitionPending } from '@/services/replyRule'
import { buildBankItemGroups, buildBankItemsForRecord } from '@/mock/confirmations'
import BankItemsTable from '@/components/BankItemsTable'
import ConsistencyDiff from '@/components/ConsistencyDiff'
import ReplyResultExtraPanel from '@/components/ReplyResultExtraPanel'
import { AiResultHead, ManualConfirm, ManualRow } from '@/components/ManualConfirm'
import SealRecognition from '@/components/SealRecognition'
/* v2.39：「银行函证文本识别」不再作为独立检测点，本页不再引用 BankTextRecognition（组件仍被识别工作台的归属匹配区使用） */
import HandwritingRecognition from '@/components/HandwritingRecognition'
import PdfPreview from '@/components/PdfPreview'


/*
 * v2.40：原 `BankItemsDiff`（扁平平表）已由 `BankItemsTable`（分组表）替代 ——
 * 真实回函里每一项各是一张列结构互不相同的子表（银行存款 11 列、托管的证券 5 列）、
 * 且一项可能多行，扁平结构装不下。本页为**只读**模式：无输入框、无一键应用、无重新识别
 * （「核验页看，结果页采纳」—— 那页的场景是拿着结论去原件上核对依据，能改反而让人不确定该在哪改）。
 */

/** 预览栈里一栏的呈现态：双栏各半 / 本栏放大 / 本栏收起成一行 */
type PaneMode = 'half' | 'full' | 'collapsed'

/** 把「该封内的相对页号」换算成文件里的**绝对页号区间** */
function absPages(base: number, rel?: PageRange): PageRange | undefined {
  return rel ? { start: base + rel.start - 1, end: base + rel.end - 1 } : undefined
}

/** 标题行里的「本封第 X-Y 页」 */
function pageNote(r: PageRange): string {
  return r.start === r.end ? `本封第 ${r.start} 页` : `本封第 ${r.start}-${r.end} 页`
}

/**
 * 预览栈里的一栏 —— **标题行 + 预览画布**。
 *
 * 标题行交代三件事：这一栏是**哪一份文件**（发函用印件 / 回函件）、**具体哪个文件**（文件名）、
 * **本封占哪几页**（多封拼在一个文件里时，这行是唯一能看出「哪几页属于这封」的地方）；
 * 右侧一个按钮负责「只看这一件 / 恢复双栏 / 展开」。
 */
function PreviewPane({
  label,
  file,
  note,
  mode,
  position,
  onToggle,
  children,
}: {
  label: string
  file: string
  note?: string
  mode: PaneMode
  /** 该栏在栈里的位置 —— 收起态那个展开箭头的方向据此定（上栏向下展开、下栏向上展开） */
  position: 'top' | 'bottom'
  /** 不传即不渲染切换按钮（只有一栏的银行函证） */
  onToggle?: () => void
  children?: ReactNode
}) {
  const collapsed = mode === 'collapsed'
  const tip = mode === 'full' ? '恢复双栏' : collapsed ? '展开' : `只看${label}`

  return (
    <section className={`pv-pane is-${mode}`}>
      <header className="pv-pane__head">
        <span className="pv-pane__label">{label}</span>
        <span className="pv-pane__file num" title={file}>
          {file}
        </span>
        {note && <span className="pv-pane__note">{note}</span>}
        {onToggle && (
          <Tooltip title={tip}>
            <button type="button" className="pv-pane__toggle" onClick={onToggle} aria-label={tip}>
              {mode === 'full' ? (
                <CompressOutlined />
              ) : collapsed ? (
                position === 'top' ? (
                  <DownOutlined />
                ) : (
                  <UpOutlined />
                )
              ) : (
                <ExpandOutlined />
              )}
            </button>
          </Tooltip>
        )}
      </header>
      {!collapsed && <div className="pv-pane__canvas">{children}</div>}
    </section>
  )
}

/**
 * AI 核验只读面板 —— 左右分栏：
 *
 * · **左侧常驻预览**：核验的核心动作是「拿着 AI 结论去原文上找依据」，两者同屏才能边看边对。
 *   一致性检测比的是**发函件 × 回函件**，所以左栏铺的是一个**预览栈** ——
 *   上「发函用印件」、下「回函件」（v2.70）。只铺回函件时，用户拿到的其实只有一半依据。
 *   每栏可「只看这一件」（另一栏收成一行标题），用于 A4 竖版页面在半高里看不清时放大核对。
 *   发函栏**不带 AI 批注**（印章框 / 落章区 / 手写区全在回函件上）（批注视图的切换已于 v3.35 取消，这里由"不传批注入参"表达）。
 * · **右侧核验内容**：检测项切换（拟物图标 + 名称）→ 选中项的完整明细。
 *   点某张表的「查看原件」→ 两栏原件**同时**跳到该表所在页并高亮（核对成本最低的路径）。
 *
 * **银行函证只有回函栏** —— 银行只上传回函件，发函数据（格式一 / 格式二）存于函证系统、
 * 没有文件；该分支查 `TYPE_RULE[type].sentFilePreview`，不写内联类型判断。
 *
 * **不含弹窗壳、页脚动作与关闭逻辑**：既可由全屏弹窗承载（列表「核查事项复核」列点进来的详情），
 * 也可被结果填写页内嵌（看明细时不丢已填草稿）。
 *
 * **页脚那两个动作（采纳 / 不采纳识别数据）由承载者渲染**（v3.28）——
 * 面板只负责"看依据"，并在切页签时用 `onItemChange` 把当前项上报给承载者，
 * 由它决定动作作用于哪一项（见 `VerificationModal`）。这样内嵌场景天然没有动作、
 * 也不会出现"两处都能采纳"的分裂。
 *
 * **核验留痕（核验人 / 核验时间）仍只在「确认回函快递信息」时打**，与本处的
 * 「这一项 AI 结论我看过了」是两件事：前者是"这封回函我核验过了"，后者是"这条结论我处置了"。
 */
export default function VerificationPanel({
  record,
  initialKey,
  activeKey,
  onItemChange,
  draft,
  onDraftChange,
  onResultExtraDone,
}: {
  record?: ReplyRecord
  /**
   * 打开时**直接落在哪一项**（v3.28）—— 取值是页签 key
   * （`consistency` / `seal` / `handwriting` / `result-extra`）。
   *
   * v3.31 起列表那一格不再逐项，点它进来时传的是**第一个未完成的事项**；
   * v3.33 起该落点按**总判定**算（`config/replyTasks` 的 `replyTaskEntryPanelKeyOf`），
   * 因此也可能是第 4 项「回函结果补充」—— 省掉"进去再在页签里找一遍"；
   * 进来之后用户仍可随意切页签。
   *
   * ⚠️ 与下面的 `activeKey` 分工：前者**只在挂载时**取（换一条回函才重来），
   * 后者是**受控的当前项**，换项不该重挂载（重挂载会把左侧预览连同滚动位置一起重置）。
   */
  initialKey?: string
  /**
   * **受控的当前项**（v3.34）—— 传了就以它为准；不传则面板自己管（结果页内嵌即不传）。
   *
   * 为什么要受控：承载者也会换项 —— 采纳 / 不采纳后**自动前进到下一个 AI 核查项**
   * （用户口径：「选择采纳后，调到下一个Ai核查项，而不是退出窗口」，见 `VerificationModal`）。
   * 页签与左侧取景的联动规则收在本组件的 effect 里（跟着 `active` 走），
   * 于是"用户点页签"与"承载者叫它换"走的是同一条路，行为不会两样。
   */
  activeKey?: string
  /** 当前展开项变化时上报（v3.28）—— 承载者据此决定页脚「采纳 / 不采纳」作用于哪一项 */
  onItemChange?: (key: string) => void
  /**
   * **「人工确认」列的草稿**（v3.34）—— 由承载者持有（`VerificationModal`），本组件只往下传。
   *
   * 为什么不放在这里：三个页签各有一列人工确认，而**保存按钮在第 4 项**；
   * 草稿若跟着页签存取，用户切页签就把它丢了。承载者是唯一"三个页签 + 保存动作"都在的地方。
   *
   * 不传（结果页内嵌那种只读场景）时人工确认列**不渲染** —— 看明细的地方不该能改数。
   */
  draft?: Partial<ReplyResultInfo>
  /** 人工确认列改动上报（承载者负责合并进草稿） */
  onDraftChange?: (patch: Partial<ReplyResultInfo>) => void
  /**
   * 第 4 项「回函结果补充」**归档成功**后回调（v3.33）—— 承载者据此关窗（那一项办完即走）。
   */
  onResultExtraDone?: () => void
}) {
  /** 非受控时的当前项 —— 缺省第一项；承载者传了 `activeKey` 就完全听它的 */
  const [innerKey, setInnerKey] = useState(initialKey ?? 'consistency')
  /** 实际的当前项 —— 受控优先 */
  const active = activeKey ?? innerKey
  /**
   * 只看一件：被放大的那一栏（null = 双栏均分）。
   *
   * 初值随 `initialKey` 定 —— 与下面那条 effect 里「页签联动左侧预览」的规则一致：
   * 看「两件对照」的项（一致性检测）要双栏，其余项看的是回函件本身、直接把回函栏放大。
   */
  const [zoomed, setZoomed] = useState<'sent' | 'replied' | null>(
    initialKey && initialKey !== 'consistency' ? 'replied' : null,
  )
  /**
   * 当前聚焦的表 + 定位令牌（v2.70）—— 点右侧「查看原件」时更新。
   * 令牌自增是为了**同一张表能反复点**：只改 `page` 时 React 不会重跑定位。
   */
  const [focus, setFocus] = useState<{ table: ConsistencyTable; token: number } | null>(null)

  /**
   * **换项就重设取景与定位**（v3.34 从 `selectItem` 里挪出来）。
   *
   * 原先这三条只在"用户点页签"时跑；现在承载者也会换项（采纳后自动前进），
   * 若还挂在点击处理里，自动跳过去之后左侧会**留在上一项的取景**上
   * （例如从「一致性检测」跳到「印章识别」，左边却仍是双栏对照）——
   * 一句话：换项的副作用跟着"当前项变了"走，不跟着"是谁改的"走。
   */
  useEffect(() => {
    /* 上一个检测项的定位留在新项上没有意义，一并清掉 */
    setFocus(null)
    /*
     * **页签联动左侧预览的默认取景**（v3.04，用户要求）：
     * · 「印章识别 / 手写体识别」看的是**回函件本身** —— 印章框、落章区、手写区都长在回函上，
     *   发函用印件那边连批注都没有⇒ **回函件放大、发函用印件折叠**，
     *   把左侧整个让给真正要看的那一件；
     * · 「发函回函一致性检测」要看**两件对照** ⇒ 回到**双栏均分**。
     *
     * **只改"默认值"，不锁死**：本 effect 只在**换项**时跑，用户在同一项里手动展开 / 折叠
     * （`PreviewPane` 右上角那个按钮）之后不会被覆盖回去。
     */
    setZoomed(active === 'consistency' ? null : 'replied')
  }, [active])

  if (!record) return null
  const v = record.verification

  /** 未完成识别时降级 —— 承载者（弹窗 / 内嵌）各自保留自己的框架，这里只给内容 */
  if (!v) {
    /* 识别中（银行函证两阶段：归属已确认、其余检测项尚未回填）与非识别态分开表达 */
    if (isRecognitionPending(record)) {
      return (
        <Alert
          type="info"
          showIcon
          message="AI 识别中"
          description="其余检测项完成后本页自动刷新。"
        />
      )
    }
    return (
      <Alert
        type="info"
        showIcon
        message="该函证尚未完成 AI 识别"
        description={`请先通过「上传${record.type}回函」入口完成识别与归档，AI 核验将在归档后自动执行。`}
      />
    )
  }

  /* ------------------------- 核验项（拟物图标 + 名称 + 明细） ------------------------- */

  /** 本类型的业务规则 —— 检测项清单与命名一律查表（services/replyRule.ts） */
  const rule = TYPE_RULE[record.type]
  const isBank = rule.matchBy === 'consistencyOnly'
  /** 询证事项逐项核对（银行函证）—— 相符性的唯一数据来源（拍平视图，仅用于「有几项不符」的计数） */
  const bankItemsForRecord = buildBankItemsForRecord(record)
  const bankItemsDiff = bankItemsForRecord.filter((i) => !i.match).length
  /** 展示用分组（v2.40）—— 与上面的拍平视图**同源**，不会出现「摘要说 1 项差异、表里 2 处」的打架 */
  const bankItemGroups = buildBankItemGroups(record)
  /** 逐表识别与比对结果（v2.69）—— 往来侧一致性检测的展示数据 */
  const tables = v.consistency.tables
  const diffCount = v.consistency.diffCount
  const sealNormal = v.seal.hasSeal && v.seal.region !== '信息不符区'

  /* ------------------------- 左栏两件原件的取件与定位 ------------------------- */

  /** 是否铺「发函用印件」这一栏 —— 查表决定（往来有、银行没有文件） */
  const withSent = rule.sentFilePreview
  /** 本封在这一对样例文件里的整封页区间 —— 用来把表上的「相对页号」换算成绝对页号 */
  const letterPages = letterPagesOf(record.confirmationNo)
  const focusTable = focus?.table
  /** 该表在发函用印件 / 回函件里的绝对页区间；没有聚焦表时为 undefined（不定位也不高亮） */
  const sentAbs = absPages(letterPages.sent.start, focusTable?.sentPages)
  const repliedAbs = absPages(letterPages.replied.start, focusTable?.repliedPages)
  /** 有聚焦表时角标说「本表」，否则这一栏只是在交代「本封占哪几页」 */
  const markLabel = focusTable ? '本表' : '本封'

  /**
   * 银行侧「人工确认」那一格 = 回函结果的「函证结果是否相符」——
   * 标签与选项借必填项表（`RESULT_REQUIRED_FIELDS`），与结果页**逐字同源**。
   */
  const bankMatchedField = RESULT_REQUIRED_FIELDS['银行函证'].find((f) => f.key === 'matched')

  /**
   * 各页签「**人办完了没有**」（v3.35）—— 页签尾部那枚完成勾的判据。
   *
   * · AI 项：`aiReview` 里有这一项即算办完（**采纳或不采纳都算**，与列表「核查事项复核」同判据）；
   * · 第 4 项「回函结果补充」：它不是 AI 事项，按"**这次保存过**"算 —— 用户拍板「加上保存」，
   *   见 `ReplyRecord.resultExtraSavedAt`。
   */
  const doneOf = (panelKey: string): boolean => {
    if (panelKey === RESULT_EXTRA_PANEL_KEY) return !!record.resultExtraSavedAt
    const aiKey = aiReviewItemsOf(record.type).find((i) => i.panelKey === panelKey)?.key
    return !!aiKey && !!aiReviewStateOf(record, aiKey)
  }

  const items: {
    key: string
    title: string
    /** 拟物图标 —— 一眼能对上「这项查的是什么」 */
    icon: ReactNode
    /** 需关注的项，图标以红档提示（不额外加色点） */
    risk?: boolean
    /** **人办完了没有** —— 决定页签尾部要不要点那枚完成勾（见 `doneOf`） */
    done: boolean
    children: ReactNode
  }[] = [
    {
      key: 'consistency',
      done: doneOf('consistency'),
      /* 名称按类型取：往来=发函回函一致性检测；银行=询证事项逐项核对 */
      title: rule.consistencyLabel,
      icon: <AuditOutlined />,
      risk: isBank ? bankItemsDiff > 0 : diffCount > 0,
      children: isBank ? (
        <>
          <AiResultHead note="回函 × 系统内格式一/二数据逐项核对" />
          <BankItemsTable groups={bankItemGroups} mode="view" />
          {/*
           * 银行侧的人工确认给**两格**（v3.35）：
           * · 「函证结果是否相符」—— 银行相符性**只由这一项决定**（R-01：印章不参与判定），
           *   它是回函结果里那枚 `matched` 的唯一出处；
           * · 「回函结果不相符处的描述」—— 银行不做手写体识别、也就没有那个页签，而不相符的
           *   来源正是这里查出来的差异，说明写在这儿（往来侧同一字段在「手写体识别」页）。
           */}
          {onDraftChange && (
            <div style={{ marginTop: 12 }}>
              <ManualConfirm note="逐项核对无误后确认相符性；有差异则写明不相符处">
                <ManualRow label={bankMatchedField?.label ?? '函证结果是否相符'}>
                  <Radio.Group
                    size="small"
                    optionType="button"
                    buttonStyle="solid"
                    value={draft?.matched}
                    options={bankMatchedField?.options ?? []}
                    onChange={(e) => onDraftChange({ matched: e.target.value })}
                  />
                </ManualRow>
                {/*
                 * 「回函结果不相符处的描述」—— 银行侧只能长在这一项（v3.35，用户拍板）：
                 * 银行**不做手写体识别**，也就没有那个页签；而不相符的来源正是「询证事项逐项核对」
                 * 查出来的差异，说明就该写在这里（往来侧同一字段在「手写体识别」页）。
                 */}
                <ManualRow label={RESULT_NOTE_FIELDS.diffDesc} hint="确认不相符时必写">
                  <Input.TextArea
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    value={draft?.diffDesc ?? ''}
                    onChange={(e) => onDraftChange({ diffDesc: e.target.value })}
                    placeholder="差在哪、差多少"
                  />
                </ManualRow>
              </ManualConfirm>
            </div>
          )}
        </>
      ) : (
        <ConsistencyDiff
          tables={tables}
          onFocusTable={(t) => setFocus((prev) => ({ table: t, token: (prev?.token ?? 0) + 1 }))}
        />
      ),
    },
    {
      key: 'seal',
      done: doneOf('seal'),
      title: '印章核查',
      icon: <SafetyCertificateOutlined />,
      risk: !sealNormal,
      /* 银行函证：不渲染骑缝章行（v2.39 起 R-03 限定往来），结论条也不推导相符性 */
      children: (
        <SealRecognition
          seal={v.seal}
          entity={record.entity}
          isBank={isBank}
          draft={draft}
          onDraftChange={onDraftChange}
        />
      ),
    },
    /*
     * 「银行函证文本识别」页签已于 v2.39 移除 —— 它不再是独立检测点：
     * 四要素取值归阶段一的「识别四要素」（归属匹配的输入），各询证项金额并入上面的
     * 「询证事项逐项核对」。二者本就由不同引擎产出（OCR / 大模型 vs MinerU）。
     * 因此本页银行侧检测项为 **2 项**（往来仍为 3 项）。
     */
    /* 手写体仅往来函证检测 —— 按**类型**而非数据有无决定，银行侧即使有残留数据也不展示 */
    ...(rule.detectHandwriting && v.handwriting
      ? [
          {
            key: 'handwriting',
            done: doneOf('handwriting'),
            title: '手写体识别',
            icon: <HighlightOutlined />,
            children: (
              <HandwritingRecognition
                result={v.handwriting}
                draft={draft}
                onDraftChange={onDraftChange}
              />
            ),
          },
        ]
      : []),
    /*
     * **回函结果补充**（v3.33）—— 用户：「在核查事项复核的三个 tab 后，再加上一项，
     * 把不涉及 AI 识别的回函结果事项中的几个字段可以在最后一个 tab 中填写」。
     *
     * 它**不是 AI 核查事项**：没有 `aiReview` 状态，也不该出现「采纳 / 不采纳识别数据」
     * （那两个动作作用于"AI 结论"，这一项里没有结论可采纳）—— 故：
     * · 页签 key 取 `RESULT_EXTRA_PANEL_KEY`，承载者据此换页脚（见 `VerificationModal`）；
     * · 排在 `items` 末尾，即页签栏的**最右一格**，与用户画的那张图一致。
     *
     * 两类函证都有这一项：上传件与必填项跟函证类型无关（银行的必填项本就少一项骑缝章）。
     * 它同时也是"点进核验页就能填完整条回函结果"的那个兜底 —— 缺的必填项在这里补，
     * 不必再跳去结果页。
     */
    {
      key: RESULT_EXTRA_PANEL_KEY,
      done: doneOf(RESULT_EXTRA_PANEL_KEY),
      title: '回函结果补充',
      icon: <FormOutlined />,
      /* 草稿从承载者接过来（受控）—— 三个页签的人工确认列与这里的保存动作共用同一份 */
      children: (
        <ReplyResultExtraPanel
          record={record}
          value={draft}
          onChange={onDraftChange}
          onDone={onResultExtraDone}
        />
      ),
    },
  ]

  const current = items.find((it) => it.key === active) ?? items[0]

  /**
   * **本页的核验留痕**（v3.47 建，v3.48 收窄）—— **只讲当前这一项**：
   * 「项名：采纳 / 不采纳（原因：…）· 谁 · 何时」，由 `aiReviewTip` 生成。
   *
   * 为什么要有它：**不采纳的原因此前只在"悬停列表那一格"里看得到** —— 用户问
   * 「不采纳的原因填完以后在哪里能看到呢」，答案是"得去悬停"未免太隐蔽。
   *
   * ⚠️ **为什么只给当前项**（v3.48，用户口径：「印章核查这里，不要展示别的 AI 核验项的核验留痕内容，
   * 只展示印章核查的…如果目前还没留痕，那就不展示」）：留痕是**这一页**的收尾账，
   * 把别项的处理结果也堆在这里，等于在印章页读到一致性的结论 —— 页签各管一件事，
   * 谁的账记在谁的页上。整条回函的全量处置在列表「核查事项复核」格悬停里看。
   */
  const currentReview = aiReviewItemsOf(record.type).find((i) => i.panelKey === current.key)
  const currentTip = currentReview
    ? aiReviewTip(aiReviewStateOf(record, currentReview.key))
    : undefined

  /**
   * 点选核验项 —— **只管"当前项是谁"**：清定位、按项取景这两件事
   * 已挪到上面那条跟着 `active` 的 effect 里（承载者换项也要同样处理，见其注释）。
   */
  const selectItem = (key: string) => {
    setInnerKey(key)
    /* 上报给承载者（v3.28）—— 页脚的「采纳 / 不采纳」始终作用于**当前这一项** */
    onItemChange?.(key)
  }

  return (
    <div className="verify-workspace">
      {/* ——— 左：原件预览（往来＝发函用印件 + 回函件双栏；银行＝只有回函件） ——— */}
      <div className="vw-left">
        <div className="pv-stack">
          {withSent && (
            <PreviewPane
              label="发函用印件"
              file={sentSampleFileOf(record.confirmationNo)}
              note={pageNote(letterPages.sent)}
              mode={zoomed === 'replied' ? 'collapsed' : zoomed === 'sent' ? 'full' : 'half'}
              position="top"
              onToggle={() => setZoomed((z) => (z === 'sent' ? null : 'sent'))}
            >
              <PdfPreview
                confirmationNo={record.confirmationNo}
                fileUrl={browserSentSampleUrlOf(record.confirmationNo)}
                page={sentAbs?.start ?? 1}
                locateToken={focus?.token ?? 0}
                markRange={sentAbs}
                markLabel={markLabel}
                height="100%"
                /* 上下两件同步滚动（v3.01）—— 同一个分组键，滚一件另一件跟着走 */
                scrollGroup="verify-compare"
              />
            </PreviewPane>
          )}

          <PreviewPane
            label="回函件"
            file={sampleFileOf(record.confirmationNo)}
            note={pageNote(letterPages.replied)}
            mode={
              !withSent
                ? 'full'
                : zoomed === 'sent'
                  ? 'collapsed'
                  : zoomed === 'replied'
                    ? 'full'
                    : 'half'
            }
            position="bottom"
            onToggle={
              withSent ? () => setZoomed((z) => (z === 'replied' ? null : 'replied')) : undefined
            }
          >
            <PdfPreview
              confirmationNo={record.confirmationNo}
              entity={record.entity}
              /*
               * 落章区域框**仅往来**（v3.48）：银行侧不再核「落章区域」，连这两个框
               * （信息证明无误 / 信息不符）也一并撤掉 —— 银行回函原件上本就没有这两个区，
               * 留着框等于把不核查的概念又画回页面上。印章框照旧。
               */
              showRegions={!isBank}
              activeRegion={isBank ? undefined : v.seal.region}
              sealBoxes={v.seal.boxes}
              handwriting={rule.detectHandwriting ? v.handwriting?.text : undefined}
              page={repliedAbs?.start ?? 1}
              locateToken={focus?.token ?? 0}
              markRange={repliedAbs}
              markLabel={markLabel}
              height="100%"
              /* 与上面「发函用印件」同一组 —— 两件同步上下滚动（v3.01） */
              scrollGroup="verify-compare"
            />
          </PreviewPane>
        </div>
        {/*
          此处原有一行「AI 批注图例」（说明蓝框 / 绿框 / 红框 / 虚线各是什么）。
          v2.99 按用户要求删掉：「这个页面去掉红色框子中的内容」——
          各类框的含义已经写在**框本身旁边的标签**上（标注层自己带文案），
          常驻一整行图例既占地方、又是"要读一遍才知道"的说明。
        */}
      </div>

      {/* ——— 右：检测项切换 + 明细 ——— */}
      <div className="vw-right">
        {/*
         * 分段控件式切换（浅底轨道 + 选中项白色浮起）—— 容器下方还挂着一条**分段进度条**（v3.35）。
         *
         * 进度条是绝对定位在页签行下面的轨道：左右内边距与 gap 都与页签一致，
         * 于是**每一格正对着它上面那个页签** —— 「这一项办完没有」看它自己脚下那一格即可，
         * 不必在页签里塞记号（首版那枚完成勾被否：「对勾太丑陋了，能不能试下进度条，
         * 没完成一个进度条往前进一格」）。格数 = 页签数（往来 4 / 银行 3）。
         */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            gap: 4,
            padding: '4px 4px 9px',
            marginBottom: 14,
            background: 'var(--c-neutral-bg)',
            borderRadius: 10,
          }}
        >
          {items.map((it) => {
            const active = it.key === current.key
            return (
              <button
                key={it.key}
                onClick={() => selectItem(it.key)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  font: 'inherit',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 6px',
                  borderRadius: 7,
                  background: active ? '#fff' : 'transparent',
                  boxShadow: active ? 'var(--shadow-card)' : 'none',
                  color: active ? 'var(--c-text-1)' : 'var(--c-text-2)',
                  fontWeight: active ? 500 : 400,
                  transition:
                    'background-color var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast) var(--ease-out)',
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    color: active
                      ? 'var(--c-primary)'
                      : it.risk
                        ? 'var(--c-risk-high)'
                        : 'var(--c-text-3)',
                  }}
                >
                  {it.icon}
                </span>
                {it.title}
              </button>
            )
          })}

          {/* 分段进度条 —— 每办完一项，它那一格推进到主色实心（见页签栏的注释） */}
          <div className="verify-tabs__track" aria-hidden="true">
            {items.map((it) => (
              <span
                key={it.key}
                className={it.done ? 'verify-tabs__seg is-done' : 'verify-tabs__seg'}
              />
            ))}
          </div>
        </div>

        {current.children}

        {/*
         * **核验留痕（本页）** —— 一行，摆在明细下方（用户口径：「加一行台账即可」），
         * 内容只有**当前这一项**自己的处置（v3.48）；该项还没表态就整行不出现 ——
         * 空账不留行（"如果目前还没留痕，那就不展示留痕内容"）。
         */}
        {currentTip && currentReview && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 10,
              borderTop: '1px solid var(--c-hairline)',
              fontSize: 12,
              lineHeight: 1.9,
              color: 'var(--c-text-3)',
            }}
          >
            <span style={{ color: 'var(--c-text-2)' }}>核验留痕：</span>
            {/* 项名取**当前页签的名字**，不取事项标签 —— 银行侧两者不同名
                （页签「询证事项逐项核对」/ 事项标签「回函是否相符检测」），
                台账长在这一页上，就该用这一页的名字 */}
            {`${current.title}：${currentTip}`}
          </div>
        )}
      </div>
    </div>
  )
}
