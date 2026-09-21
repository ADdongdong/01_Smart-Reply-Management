import { useState, type ReactNode } from 'react'
import { Alert, Table } from 'antd'
import {
  AuditOutlined,
  BankOutlined,
  HighlightOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import type { BankItemEntry, ReplyRecord } from '@/types'
import type { PreviewMode } from '@/config/preview'
import { TYPE_RULE, isRecognitionPending } from '@/services/replyRule'
import { buildBankItemsForRecord } from '@/mock/confirmations'
import ConsistencyDiff from '@/components/ConsistencyDiff'
import SealRecognition from '@/components/SealRecognition'
import BankTextRecognition from '@/components/BankTextRecognition'
import HandwritingRecognition from '@/components/HandwritingRecognition'
import PdfPreview from '@/components/PdfPreview'

/**
 * AI 批注图例 —— 常驻主视图下方，说明各类标注框的含义（口径与标注层一致）。
 * **按类型区分**：银行函证不检测手写体、落章区域也不参与相符性判定，图例不得出现相应表述。
 */
function annotationLegend(record: ReplyRecord): string {
  if (TYPE_RULE[record.type].matchBy === 'consistencyOnly') {
    return 'AI 批注图例：蓝框＝检出的印章位置　绿框＝印章位于常规签章位置（仅作风险参考）　红框＝异常印章　（银行函证相符性由询证事项逐项核对决定，与印章位置无关，且不检测手写体）'
  }
  return 'AI 批注图例：蓝框＝检出的印章位置　蓝虚线＝手写体识别区　绿框＝相符判定（印章落于「信息证明无误」）　红框＝异常印章或不相符　灰虚线＝未命中的落章区域'
}

/**
 * 银行函证：询证事项逐项核对明细（只读）。
 * 回函识别结果与**系统内已存的格式一 / 格式二数据**逐项比对 —— 这是银行函证相符性的唯一依据。
 */
function BankItemsDiff({ items }: { items: BankItemEntry[] }) {
  return (
    <Table<BankItemEntry>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={items}
      rowClassName={(r) => (!r.match ? 'row-risk-high' : '')}
      columns={[
        {
          title: '询证事项',
          dataIndex: 'item',
          width: 180,
          render: (t: string, r) => (
            <span>
              <span className="muted num" style={{ marginRight: 6 }}>
                {r.itemNo}
              </span>
              {t}
            </span>
          ),
        },
        {
          title: '系统数据（发函）',
          dataIndex: 'sentAmount',
          align: 'right',
          width: 140,
          render: (n: number | null) => <span className="num">{n?.toLocaleString() ?? '—'}</span>,
        },
        {
          title: '回函金额',
          dataIndex: 'repliedAmount',
          align: 'right',
          width: 140,
          render: (n: number | null) => <span className="num">{n?.toLocaleString() ?? '—'}</span>,
        },
        {
          title: '核对结论',
          dataIndex: 'note',
          render: (note: string | undefined, r) => (
            <span style={{ color: r.match ? 'var(--c-risk-low-text)' : 'var(--c-risk-high-text)' }}>
              {r.match ? '一致' : '存在差异'}
              {note && <span className="muted"> · {note}</span>}
            </span>
          ),
        },
      ]}
    />
  )
}

/**
 * AI 核验只读面板 —— 左右分栏：
 *
 * · **左侧常驻预览**：可随时切「原始文件 / AI 批注」—— 核验的核心动作就是
 *   「拿着 AI 结论去原文上核对依据」，两者同屏才能边看边对。
 * · **右侧核验内容**：检测项切换（拟物图标 + 名称）→ 选中项的完整明细。
 *
 * **不含弹窗壳与关闭逻辑**：既可由全屏弹窗承载（列表「AI 核验」入口），
 * 也可被结果填写页内嵌（看明细时不丢已填草稿）。
 *
 * **不承担确认职责**：本面板只是「看依据」，核验留痕统一在「确认回函快递信息」时打 ——
 * 同一件事不设两处签字，也就不存在「该点哪个」的困惑。
 */
export default function VerificationPanel({
  record,
  /** 预览高度 —— 内嵌到弹窗内时可调低以适配可用空间 */
  previewHeight = 620,
}: {
  record?: ReplyRecord
  previewHeight?: number
}) {
  /** 左侧主视图模式（受控）—— 核验页默认直接看批注，因为核验的就是 AI 判定依据 */
  const [previewMode, setPreviewMode] = useState<PreviewMode>('annotated')
  /** 当前展开的核验项 */
  const [activeKey, setActiveKey] = useState('consistency')

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
          description="归属已确认，系统正在异步识别其余检测项（询证事项逐项核对 / 印章 / 快递面单），完成后本页自动刷新。"
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
  /** 询证事项逐项核对（银行函证）—— 相符性的唯一数据来源 */
  const bankItemsForRecord = buildBankItemsForRecord(record)
  const bankItemsDiff = bankItemsForRecord.filter((i) => !i.match).length
  const rows = v.consistency.rows
  const diffCount = v.consistency.diffCount
  const sealNormal = v.seal.hasSeal && v.seal.region !== '信息不符区'

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
        <BankItemsDiff items={bankItemsForRecord} />
      ) : (
        <ConsistencyDiff rows={rows} confidence={v.consistency.confidence} />
      ),
    },
    {
      key: 'seal',
      title: '印章识别',
      icon: <SafetyCertificateOutlined />,
      risk: !sealNormal,
      children: <SealRecognition seal={v.seal} entity={record.entity} />,
    },
    ...(rule.detectBankText && v.bankText
      ? [
          {
            key: 'bank',
            title: '银行函证文本识别',
            icon: <BankOutlined />,
            risk: v.bankText.level === 'manual',
            children: <BankTextRecognition result={v.bankText} />,
          },
        ]
      : []),
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

  /** 点选核验项 —— 印章识别依赖批注层，自动切到批注视图 */
  const selectItem = (key: string) => {
    setActiveKey(key)
    if (key === 'seal') setPreviewMode('annotated')
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {/* ——— 左：常驻预览（原始文件 / AI 批注 共用同一画布） ——— */}
      <div style={{ flex: 1.15, minWidth: 0 }}>
        <PdfPreview
          confirmationNo={record.confirmationNo}
          entity={record.entity}
          showRegions
          activeRegion={v.seal.region}
          sealBoxes={v.seal.boxes}
          handwriting={rule.detectHandwriting ? v.handwriting?.text : undefined}
          height={previewHeight}
          viewMode={previewMode}
          onViewModeChange={setPreviewMode}
        />
        <div style={{ fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.9, marginTop: 8 }}>
          {annotationLegend(record)}
        </div>
      </div>

      {/* ——— 右：检测项切换 + 明细 ——— */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
