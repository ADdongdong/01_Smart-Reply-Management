import { useState, type ReactNode } from 'react'
import { Alert, Tooltip } from 'antd'
import {
  AuditOutlined,
  CompressOutlined,
  DownOutlined,
  ExpandOutlined,
  HighlightOutlined,
  SafetyCertificateOutlined,
  UpOutlined,
} from '@ant-design/icons'
import type { ConsistencyTable, ReplyRecord } from '@/types'
import type { PageRange, PreviewMode } from '@/config/preview'
import {
  browserSentSampleUrlOf,
  letterPagesOf,
  sampleFileOf,
  sentSampleFileOf,
} from '@/config/preview'
import { TYPE_RULE, isRecognitionPending } from '@/services/replyRule'
import { buildBankItemGroups, buildBankItemsForRecord } from '@/mock/confirmations'
import BankItemsTable from '@/components/BankItemsTable'
import ConsistencyDiff from '@/components/ConsistencyDiff'
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
 *   发函栏**不带 AI 批注**（印章框 / 落章区 / 手写区全在回函件上），故它没有视图切换。
 * · **右侧核验内容**：检测项切换（拟物图标 + 名称）→ 选中项的完整明细。
 *   点某张表的「查看原件」→ 两栏原件**同时**跳到该表所在页并高亮（核对成本最低的路径）。
 *
 * **银行函证只有回函栏** —— 银行只上传回函件，发函数据（格式一 / 格式二）存于函证系统、
 * 没有文件；该分支查 `TYPE_RULE[type].sentFilePreview`，不写内联类型判断。
 *
 * **不含弹窗壳与关闭逻辑**：既可由全屏弹窗承载（列表「AI 核验」入口），
 * 也可被结果填写页内嵌（看明细时不丢已填草稿）。
 *
 * **不承担确认职责**：本面板只是「看依据」，核验留痕统一在「确认回函快递信息」时打 ——
 * 同一件事不设两处签字，也就不存在「该点哪个」的困惑。
 */
export default function VerificationPanel({ record }: { record?: ReplyRecord }) {
  /** 回函栏的视图模式（受控）—— 核验页默认直接看批注，因为核验的就是 AI 判定依据 */
  const [previewMode, setPreviewMode] = useState<PreviewMode>('annotated')
  /** 当前展开的核验项 */
  const [activeKey, setActiveKey] = useState('consistency')
  /** 只看一件：被放大的那一栏（null = 双栏均分） */
  const [zoomed, setZoomed] = useState<'sent' | 'replied' | null>(null)
  /**
   * 当前聚焦的表 + 定位令牌（v2.70）—— 点右侧「查看原件」时更新。
   * 令牌自增是为了**同一张表能反复点**：只改 `page` 时 React 不会重跑定位。
   */
  const [focus, setFocus] = useState<{ table: ConsistencyTable; token: number } | null>(null)

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

  const items: {
    key: string
    title: string
    /** 拟物图标 —— 一眼能对上「这项查的是什么」 */
    icon: ReactNode
    /** 需关注的项，图标以红档提示（不额外加色点） */
    risk?: boolean
    children: ReactNode
  }[] = [
    {
      key: 'consistency',
      /* 名称按类型取：往来=发函回函一致性检测；银行=询证事项逐项核对 */
      title: rule.consistencyLabel,
      icon: <AuditOutlined />,
      risk: isBank ? bankItemsDiff > 0 : diffCount > 0,
      children: isBank ? (
        <BankItemsTable groups={bankItemGroups} mode="view" />
      ) : (
        <ConsistencyDiff
          tables={tables}
          confidence={v.consistency.confidence}
          onFocusTable={(t) => setFocus((prev) => ({ table: t, token: (prev?.token ?? 0) + 1 }))}
        />
      ),
    },
    {
      key: 'seal',
      title: '印章识别',
      icon: <SafetyCertificateOutlined />,
      risk: !sealNormal,
      /* 银行函证：不渲染骑缝章行（v2.39 起 R-03 限定往来），结论条也不推导相符性 */
      children: <SealRecognition seal={v.seal} entity={record.entity} isBank={isBank} />,
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
            title: '手写体识别',
            icon: <HighlightOutlined />,
            children: <HandwritingRecognition result={v.handwriting} />,
          },
        ]
      : []),
  ]

  const current = items.find((it) => it.key === activeKey) ?? items[0]

  /**
   * 点选核验项 —— 印章识别依赖批注层，自动切到批注视图；
   * 同时**清掉联动的聚焦与高亮**：上一个检测项的定位留在新页签上没有意义。
   */
  const selectItem = (key: string) => {
    setActiveKey(key)
    setFocus(null)
    /*
     * **页签联动左侧预览的默认取景**（v3.04，用户要求）：
     * · 「印章识别 / 手写体识别」看的是**回函件本身** —— 印章框、落章区、手写区都长在回函上，
     *   发函用印件那边连批注都没有（`hideViewToggle`）⇒ **回函件放大、发函用印件折叠**，
     *   把左侧整个让给真正要看的那一件；
     * · 「发函回函一致性检测」要看**两件对照** ⇒ 回到**双栏均分**。
     *
     * **只改"默认值"，不锁死**：本函数只在**切页签**时跑，用户在同页签里手动展开 / 折叠
     * （`PreviewPane` 右上角那个按钮）之后不会被覆盖回去。
     */
    setZoomed(key === 'consistency' ? null : 'replied')
    /* 除了"两件对照"，其余检测项看的都是 AI 批注（手写体识别同样依赖批注层） */
    if (key !== 'consistency') setPreviewMode('annotated')
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
                /* 印章 / 落章区 / 手写区都在回函件上，发函件没有批注可看 —— 连切换一起隐掉 */
                hideViewToggle
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
              showRegions
              activeRegion={v.seal.region}
              sealBoxes={v.seal.boxes}
              handwriting={rule.detectHandwriting ? v.handwriting?.text : undefined}
              page={repliedAbs?.start ?? 1}
              locateToken={focus?.token ?? 0}
              markRange={repliedAbs}
              markLabel={markLabel}
              height="100%"
              viewMode={previewMode}
              onViewModeChange={setPreviewMode}
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
        {/* 分段控件式切换：浅底轨道 + 选中项白色浮起（不用描边与彩色字，避免生硬） */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
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
        </div>

        {current.children}
      </div>
    </div>
  )
}
