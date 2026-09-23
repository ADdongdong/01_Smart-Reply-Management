import { Button, Input, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DownOutlined, ReloadOutlined, RightOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { BankItemGroup, BankItemRow } from '@/types'

/**
 * 询证事项逐项核对 —— **分组表**（v2.40）。
 * ------------------------------------------------------------------
 * 为什么是分组而不是一张平表：真实回函里**每一项各是一张列结构互不相同的子表**
 * （银行存款 11 列、托管的证券 5 列，没有一列共通），且**一项可能多行**
 * （银行存款 3 个账户、已贴现商业汇票 4 张）。所以形态是
 * 「**可折叠分组 + 组内标准子表 + 五列对照**」：
 *
 *   组标题 = 序号 + 项名 + 结论摘要 + 组级动作
 *   组内   = 标识列（该组的天然主键） + 系统数据 → AI 识别值 → 回函值 → 差异 → 结论
 *
 * **币种 / 利率 / 起止日期这类描述性字段不进对照** —— 否则银行存款会是 11 + 5 = 16 列。
 *
 * ## 两个模式（分工一句话：「核验页看，结果页采纳」）
 * · `view`（AI 智能核验页）—— **纯只读**：无输入框、无一键应用、无重新识别。
 *   那页的场景是「拿着结论去原件上核对依据」，能改反而让人不确定该在哪改。
 * · `edit`（回函结果填写页）—— 回函值可编辑，**差异与结论实时重算**；
 *   一键应用**不覆盖已人工改过的行**（否则人工核对白做）。
 *
 * ## 识别失败时的出路（v2.39 §3）
 * 表格数据走 **MinerU 整表识别**，是链路里最慢、最易超时的一环。失败时：
 * · 组标题给「**重新识别**」—— **组级动作**，因为 MinerU 只能重跑整张表；
 * · 回函值列**可直接手填** —— 失败补录就在表内完成，不必另开录入界面。
 */
export default function BankItemsTable({
  groups,
  mode = 'view',
  onReplyChange,
  onApplyGroup,
  onRerunGroup,
}: {
  groups: BankItemGroup[]
  mode?: 'view' | 'edit'
  /** 回函值变更 —— 由父级写回并**实时重算** `diff` / `match` */
  onReplyChange?: (groupId: string, rowId: string, value: number | null) => void
  /** 组级「应用 AI 识别值」 */
  onApplyGroup?: (groupId: string) => void
  /** 组级「重新识别」 */
  onRerunGroup?: (groupId: string) => void
}) {
  const editable = mode === 'edit'

  return (
    <div>
      {groups.map((g) => (
        <GroupCard
          key={g.id}
          group={g}
          editable={editable}
          onReplyChange={onReplyChange}
          onApplyGroup={onApplyGroup}
          onRerunGroup={onRerunGroup}
        />
      ))}
    </div>
  )
}

/** 结论摘要 —— 组标题右侧那句「3 个账户 · 1 项不符」，让人不展开也知道这组要不要看 */
function summarize(g: BankItemGroup): string {
  if (g.stat === 'empty') return '本份回函未列示'
  if (g.stat === 'run') return '识别中…'
  if (g.stat === 'fail') return '识别失败，待人工补录'
  const diff = g.rows.filter((r) => r.match === false).length
  const pending = g.rows.filter((r) => r.match === null).length
  const unit = g.keyLabels[0].includes('账户') || g.keyLabels[0].includes('票') ? '笔' : '条'
  return [
    `共 ${g.rows.length} ${unit}`,
    diff > 0 ? `${diff} 项不符` : '全部相符',
    pending > 0 ? `${pending} 项待核` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 每条记录一行 —— 结论标签。三种态各有文案，不把「待核」混同于「相符」 */
function MatchTag({ match }: { match: boolean | null }) {
  if (match === null) return <span className="muted">待核</span>
  return match ? (
    <span style={{ color: 'var(--c-risk-low-text)' }}>相符</span>
  ) : (
    <span style={{ color: 'var(--c-risk-high-text)', fontWeight: 500 }}>不相符</span>
  )
}

function GroupCard({
  group: g,
  editable,
  onReplyChange,
  onApplyGroup,
  onRerunGroup,
}: {
  group: BankItemGroup
  editable: boolean
  onReplyChange?: (groupId: string, rowId: string, value: number | null) => void
  onApplyGroup?: (groupId: string) => void
  onRerunGroup?: (groupId: string) => void
}) {
  const diffCount = g.rows.filter((r) => r.match === false).length
  /** 有 AI 值且尚未人工改过（回函值 == AI 值）才允许一键应用，避免"应用了但什么都没变" */
  const applicable = editable && g.stat === 'done'

  /**
   * 标识列宽 —— **必须显式给**。
   * 此前只给了五个金额列的固定宽（合计 590px），而结果填写页右栏只有约 530px，
   * antd 于是把**没有宽度的标识列**压缩到近乎为零 —— 表现为「账户名称 / 银行账号 / 币种」
   * 三列的文字被挤掉、只剩几个残字（用户报的 bug）。
   * 宽度不足由表格**横向滚动**承担（见 `<Table scroll>`），不再牺牲标识列。
   */
  const KEY_COL_W = g.keyLabels.length <= 2 ? 132 : 118

  const columns: ColumnsType<BankItemRow> = [
    /* ① 标识列 —— 该组的天然主键，行配对与人工核对都靠它 */
    ...g.keyLabels.map((label, i) => ({
      title: label,
      key: `k${i}`,
      width: KEY_COL_W,
      ellipsis: true,
      render: (_: unknown, r: BankItemRow) => <span>{r.keys[i] ?? '—'}</span>,
    })),
    /* ② 系统数据（发函）—— 来自格式一 / 格式二 */
    {
      title: '系统数据',
      key: 'sent',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, r: BankItemRow) => (
        <span className="num">{r.sentAmount != null ? r.sentAmount.toLocaleString('zh-CN') : '—'}</span>
      ),
    },
    /* ③ AI 识别值 —— **独立成列是为了让人看出自己改了什么**，没有它就分不清"差异是 AI 看错还是我改的" */
    {
      title: (
        <span>
          AI 识别值
          <Tooltip title="AI 从回函原件识别出的金额（未人工修改前的原始值）；你的修改只改「回函值」，这里始终保留 AI 的原始读数">
            <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--c-text-3)' }}>ⓘ</span>
          </Tooltip>
        </span>
      ),
      key: 'ai',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, r: BankItemRow) => (
        <span className="num" style={{ color: 'var(--c-text-3)' }}>
          {r.aiAmount != null ? r.aiAmount.toLocaleString('zh-CN') : g.stat === 'run' ? '…' : '—'}
        </span>
      ),
    },
    /* ④ 回函值 —— 比对的实际输入，AI 值到达即预填、人工可改（edit 模式） */
    {
      title: '回函值',
      key: 'reply',
      width: editable ? 150 : 120,
      align: 'right' as const,
      render: (_: unknown, r: BankItemRow) =>
        editable ? (
          <Input
            size="small"
            /* 失败组也要能填 —— 补录就在表内完成 */
            disabled={g.stat === 'run'}
            value={r.replyAmount != null ? String(r.replyAmount) : ''}
            placeholder={g.stat === 'run' ? '识别中' : '待填'}
            onChange={(e) => {
              const raw = e.target.value.replace(/[,\s]/g, '')
              if (raw === '') return onReplyChange?.(g.id, r.id, null)
              const n = Number(raw)
              if (!Number.isNaN(n)) onReplyChange?.(g.id, r.id, n)
            }}
          />
        ) : (
          <span className="num">{r.replyAmount != null ? r.replyAmount.toLocaleString('zh-CN') : '—'}</span>
        ),
    },
    /* ⑤ 差异 —— 回函值 − 系统数据；人工改回函值后由父级实时重算 */
    {
      title: '差异',
      key: 'diff',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, r: BankItemRow) =>
        r.diff == null ? (
          <span className="muted">—</span>
        ) : r.diff === 0 ? (
          <span className="num muted">0</span>
        ) : (
          <span className="num" style={{ color: 'var(--c-risk-high-text)', fontWeight: 500 }}>
            {r.diff > 0 ? '+' : ''}
            {r.diff.toLocaleString('zh-CN')}
          </span>
        ),
    },
    /* ⑥ 结论 */
    {
      title: '结论',
      key: 'match',
      width: 90,
      render: (_: unknown, r: BankItemRow) => <MatchTag match={r.match} />,
    },
  ]

  return (
    <div
      style={{
        border: '1px solid var(--c-hairline)',
        borderRadius: 8,
        marginBottom: 10,
        overflow: 'hidden',
      }}
    >
      {/* 组标题 —— 结论摘要前置，不展开也知道这组要不要看 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--c-neutral-bg)',
        }}
      >
        {g.stat === 'empty' ? (
          <RightOutlined style={{ fontSize: 10, color: 'var(--c-text-3)' }} />
        ) : (
          <DownOutlined style={{ fontSize: 10, color: 'var(--c-text-3)' }} />
        )}
        <span className="num" style={{ color: 'var(--c-text-3)', fontSize: 12 }}>
          {g.itemNo}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{g.item}</span>
        {diffCount > 0 && (
          <span className="tag tag-risk" style={{ flexShrink: 0 }}>
            {diffCount} 项不符
          </span>
        )}
        <span
          className="muted"
          style={{ fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}
        >
          {summarize(g)}
        </span>
        {/* 组级动作 —— MinerU 是整表识别，只能重跑整张表，故动作挂在组上 */}
        {g.stat === 'fail' && onRerunGroup && (
          <Button
            size="small"
            type="link"
            icon={<ReloadOutlined />}
            style={{ padding: 0, height: 'auto', fontSize: 12 }}
            onClick={() => onRerunGroup(g.id)}
          >
            重新识别
          </Button>
        )}
        {applicable && onApplyGroup && (
          <Button
            size="small"
            type="link"
            icon={<ThunderboltOutlined />}
            style={{ padding: 0, height: 'auto', fontSize: 12 }}
            onClick={() => onApplyGroup(g.id)}
          >
            应用 AI 识别值
          </Button>
        )}
      </div>

      {/* 组体 */}
      {g.stat === 'empty' ? (
        <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--c-text-3)' }}>
          如需补充，请在下方「其他」处说明。
        </div>
      ) : g.stat === 'run' ? (
        <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--c-text-3)' }}>
          正在识别本组表格（MinerU 整表识别，完成后自动刷新）……
        </div>
      ) : (
        <>
          {g.stat === 'fail' && (
            <div
              style={{
                padding: '8px 12px',
                fontSize: 12,
                color: 'var(--c-risk-high-text)',
                background: 'var(--c-risk-high-bg)',
              }}
            >
              本组表格识别失败 —— 可在「重新识别」重试，或**直接在下方「回函值」列手工录入**（录入后差异与结论实时重算）。
            </div>
          )}
          <Table<BankItemRow>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={g.rows}
            columns={columns}
            /* 宽度不够时**横向滚动**，而不是把列压扁（标识列文字被遮盖的根因就在这里） */
            scroll={{ x: 'max-content' }}
            rowClassName={(r) => (r.match === false ? 'row-risk-high' : '')}
          />
        </>
      )}
    </div>
  )
}
