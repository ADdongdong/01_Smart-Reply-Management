import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { App, Button, Col, Empty, Input, Row, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudUploadOutlined,
  FileExcelOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { EXPRESS_IMPORT_RESULT } from '@/mock/expressImport'
import { buildBankItemsForRecord } from '@/mock/confirmations'
import ExpressImportDrawer from '@/components/ExpressImportDrawer'
import type { ConfirmationType, ReplyProgress, ReplyRecord, RiskLevel } from '@/types'
import VerificationModal from '@/components/VerificationModal'
import RecordDetailModal from '@/components/RecordDetailModal'
import ReplyDocEntryModal from '@/components/ReplyDocEntryModal'
import ReplyResultModal from '@/components/ReplyResultModal'
import { RiskTag, VerifyBadge, VerifyProgress } from '@/components/Marks'
import { afterPaint } from '@/utils/afterPaint'
import { buildQuickConfirmMap } from '@/utils/quickConfirm'

/** 四个业务入口的全屏弹窗 */
type ModalKind = 'view' | 'verify' | 'doc' | 'result'

/* ------------------------------------------------------------------ */
/* 回函进度 —— 用户视角的「下一步要做什么」                              */
/* ------------------------------------------------------------------ */

/** 进度文字色 —— 使用深一档语义色，保证 12px 文字对比度达标 */
/** 进度文字统一墨色（颜色只走底色），已完成退灰 */
const PROGRESS_COLOR: Record<ReplyProgress, string> = {
  待确认快递信息: 'var(--c-text-1)',
  待填写回函结果: 'var(--c-text-1)',
  已完成: 'var(--c-text-3)',
}

const PROGRESS_HINT: Record<ReplyProgress, string> = {
  待确认快递信息:
    'AI 已识别并归属到函证，等待人工核对回函快递信息 —— 这一步同时完成 AI 核验的人工确认与留痕（唯一的核验签字动作）',
  待填写回函结果: '回函快递信息已确认，等待填写回函结果 —— AI 核验结论已带入表单，采纳或修改后保存',
  已完成: '回函快递信息与回函结果均已人工确认',
}

/* ------------------------------------------------------------------ */
/* 列表行模型：一封函证一行                                             */
/* ------------------------------------------------------------------ */

interface ConfirmationRow {
  confirmationNo: string
  entity: string
  type: ConfirmationType
  /** 最终有效回函 —— 该函证最近一次收到回函的那条记录 */
  main: ReplyRecord
  /** 该函证的全部回函，最新在前 */
  history: ReplyRecord[]
}

/**
 * 把扁平的回函记录按函证归并成列表行。
 *
 * 「最终有效」= 回函时间最新的那条记录。这样新回函进来后自动成为最终有效，
 * 历史回函自动降级为「已被覆盖」，无需额外维护状态字段。
 */
function groupByConfirmation(records: ReplyRecord[]): ConfirmationRow[] {
  const map = new Map<string, ReplyRecord[]>()
  records.forEach((r) => {
    const list = map.get(r.confirmationNo)
    if (list) list.push(r)
    else map.set(r.confirmationNo, [r])
  })
  return [...map.entries()].map(([confirmationNo, list]) => {
    const asc = [...list].sort((a, b) =>
      (a.replyDate ?? a.sendDate).localeCompare(b.replyDate ?? b.sendDate),
    )
    const main = asc[asc.length - 1]
    return {
      confirmationNo,
      entity: main.entity,
      type: main.type,
      main,
      history: [...asc].reverse(),
    }
  })
}

/** 单次回函的结论摘要（用于历次回函列表） */
function conclusionOf(r: ReplyRecord): { text: string; danger: boolean } {
  const v = r.verification
  if (!v) return { text: '未核验', danger: false }
  if (!v.seal.hasSeal) return { text: '未检出印章', danger: true }
  if (v.seal.region === '信息不符区') return { text: '不相符', danger: true }
  // 银行函证的差异体现在「询证事项逐项核对」上，而非往来科目的一致性比对
  if (r.type === '银行函证') {
    const diff = buildBankItemsForRecord(r).filter((i) => !i.match).length
    return diff > 0 ? { text: `询证事项 ${diff} 项差异`, danger: true } : { text: '相符', danger: false }
  }
  if (v.consistency.diffCount > 0) return { text: `${v.consistency.diffCount} 项差异`, danger: true }
  return { text: '相符', danger: false }
}

/** 展开区的字段块 —— 浅灰底小方块，label 灰字在上、value 墨字在下，按网格排列 */
function FieldCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--c-neutral-bg)',
        borderRadius: 'var(--radius-control)',
        padding: '6px 10px',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.6 }}>{label}</div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--c-text-1)',
          lineHeight: 1.7,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/** 浅底无边框小标签 —— 避免描边标签在密集列表里堆出线条 */
function SoftTag({
  children,
  color,
  bg,
}: {
  children: React.ReactNode
  color: string
  bg: string
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        padding: '0 5px',
        borderRadius: 'var(--radius-tag)',
        fontSize: 11,
        lineHeight: 1,
        color,
        background: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

interface FilterState {
  keyword?: string
  sendMethod?: string
  progress?: string
  risk?: string
}

const EMPTY_FILTER: FilterState = {}

export default function ReplyList() {
  const { modal, message } = App.useApp()
  const { state, dispatch } = useApp()

  const [form, setForm] = useState<FilterState>(EMPTY_FILTER)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  /** 四个业务入口共用一个弹窗状态 —— 保证不会同时打开多个弹窗 */
  const [activeModal, setActiveModal] = useState<{ kind: ModalKind; recordId: string } | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  /** 批量确认的勾选项 —— 存函证编号（列表行粒度是函证，不是单次回函） */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])

  /* ------------------------- 归并、筛选与排序 ------------------------- */

  const rows = useMemo(() => groupByConfirmation(state.records), [state.records])

  /** 待人工确认 = 最终有效回函的 AI 核验结果尚未人工确认 */
  const pendingVerify = rows.filter((r) => r.main.verifyStatus === 'pending').length
  const total = rows.length
  const verifiedCount = total - pendingVerify

  const data = useMemo(() => {
    return rows
      .filter((row) => {
        const m = row.main
        if (filter.keyword) {
          const k = filter.keyword.trim()
          if (
            !row.entity.includes(k) &&
            !row.confirmationNo.includes(k) &&
            !m.sendRecordNo.includes(k)
          )
            return false
        }
        if (filter.sendMethod && m.sendMethod !== filter.sendMethod) return false
        if (filter.progress && m.replyProgress !== filter.progress) return false
        if (filter.risk === 'risk' && !(m.risk === 'high' || m.risk === 'medium')) return false
        if (filter.risk === 'high' && m.risk !== 'high') return false
        return true
      })
      .sort((a, b) => {
        // 待人工确认的排在前面；其次按回函时间倒序（最新的先看）
        const pa = a.main.verifyStatus === 'pending' ? 0 : 1
        const pb = b.main.verifyStatus === 'pending' ? 0 : 1
        if (pa !== pb) return pa - pb
        return (b.main.replyDate ?? b.main.sendDate).localeCompare(a.main.replyDate ?? a.main.sendDate)
      })
  }, [rows, filter])

  /* ------------------------- 无风险件快速通道 ------------------------- */

  /**
   * 判定结果整表算一次再查表。
   * 判定内部要构造十余个预填字段对象，若逐行实时算，会在筛选、输入关键字等高频渲染中反复重算。
   */
  const quickMap = useMemo(() => buildQuickConfirmMap(state.records), [state.records])

  /** 当前筛选结果里可快速确认的封数（供批量操作条提示口径） */
  const quickEligibleCount = useMemo(
    () => data.filter((row) => quickMap.get(row.main.id)?.ok).length,
    [data, quickMap],
  )

  const runQuickConfirm = (recordIds: string[]) => dispatch({ type: 'QUICK_CONFIRM', recordIds })

  /**
   * 如实反馈快速确认的实际生效条数。
   * reducer 会逐条复校，生效条数可能少于请求条数 —— 不给「已确认 N 封」的虚假承诺。
   */
  useEffect(() => {
    const result = state.quickConfirmResult
    if (!result) return
    if (result.applied === 0) {
      message.warning('没有可快速确认的函证，请逐条人工核对')
    } else if (result.applied < result.requested) {
      message.warning(
        `已快速确认 ${result.applied} 封；另有 ${result.requested - result.applied} 封状态已变化，请逐条核对`,
      )
    } else {
      message.success(`已快速确认 ${result.applied} 封，核验人与时间已留痕`)
    }
  }, [state.quickConfirmResult, message])

  const activeChips = useMemo(() => {
    const chips: { key: keyof FilterState; label: string }[] = []
    if (filter.keyword) chips.push({ key: 'keyword', label: `关键字：${filter.keyword}` })
    if (filter.sendMethod) chips.push({ key: 'sendMethod', label: `发函方式：${filter.sendMethod}` })
    if (filter.progress) chips.push({ key: 'progress', label: `回函进度：${filter.progress}` })
    if (filter.risk)
      chips.push({ key: 'risk', label: `AI 风险：${filter.risk === 'risk' ? '有风险' : '仅高风险'}` })
    return chips
  }, [filter])

  const query = () => setFilter(form)
  const reset = () => {
    setForm(EMPTY_FILTER)
    setFilter(EMPTY_FILTER)
  }

  const recognizing = state.batches.some((b) => b.status !== 'done')
  const activeRecord = state.records.find((r) => r.id === activeModal?.recordId)
  /** 关闭时把 key 切回 idle，内容组件随之卸载，避免下一条记录残留上一条的编辑状态 */
  const modalKey = (kind: ModalKind) =>
    activeModal?.kind === kind ? `${kind}-${activeModal.recordId}` : `${kind}-idle`
  /**
   * 关闭弹窗 —— **延后一帧**再卸载。
   *
   * 这里 key 会切回 idle，整棵弹窗子树随即卸载；而此刻第三方组件（AntD 点击波纹、浮层定位等）
   * 仍在测量已被移除的元素，会抛
   * `Cannot read properties of null (reading 'getBoundingClientRect')`。
   * 推迟一帧（≈16ms，用户无感知）让本轮点击交互先走完即可规避。
   * 本函数是四个弹窗唯一的关闭入口，改这一处即全覆盖。
   */
  const closeModal = () => afterPaint(() => setActiveModal(null))

  const toggleExpand = (confirmationNo: string) =>
    setExpandedKeys((keys) =>
      keys.includes(confirmationNo)
        ? keys.filter((k) => k !== confirmationNo)
        : [...keys, confirmationNo],
    )

  const confirmDelete = (row: ConfirmationRow) =>
    modal.confirm({
      title: '确认删除该函证的回函记录？',
      content:
        row.history.length > 1
          ? `函证编号 ${row.confirmationNo}（${row.entity}）共 ${row.history.length} 次回函记录，将一并删除且不可恢复。`
          : `函证编号 ${row.confirmationNo}（${row.entity}）· 发函记录 ${row.main.sendRecordNo}，删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => dispatch({ type: 'REMOVE_CONFIRMATION', confirmationNo: row.confirmationNo }),
    })

  /** 批量快速确认 —— 批量动作必须二次确认，并列明将确认的函证编号与动作内容 */
  const confirmBatchQuick = () => {
    const nos = selectedKeys
    /*
     * 勾选粒度是「函证」，而状态更新粒度是「该函证的最终有效回函」那条记录 —— 这里做一次映射。
     * 映射不到的（记录已被删除等）直接忽略，不让整批动作因此失败。
     */
    const recordIds = nos
      .map((no) => rows.find((r) => r.confirmationNo === no)?.main.id)
      .filter((id): id is string => Boolean(id))

    modal.confirm({
      title: `确认对已选 ${nos.length} 封函证执行快速确认？`,
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <div>
            将标记「已人工核验」（核验人：张审计，记录当前时间），并把回函进度推进到「待填写回函结果」。
          </div>
          <div style={{ marginTop: 6, color: 'var(--c-text-2)' }}>函证编号：{nos.join('、')}</div>
        </div>
      ),
      okText: '确认',
      onOk: () => {
        runQuickConfirm(recordIds)
        setSelectedKeys([])
      },
    })
  }

  /* ------------------------- 列定义 ------------------------- */
  /* 说明：不使用组间竖分隔线 —— 分组信息由列顺序与表头文字承担 */

  const columns: ColumnsType<ConfirmationRow> = [
    /* ---------- 函证信息 ---------- */
    {
      title: '被询证单位（银行）',
      key: 'entity',
      width: 196,
      fixed: 'left',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto', fontSize: 14, fontWeight: 500 }}
          onClick={() => setActiveModal({ kind: 'view', recordId: row.main.id })}
        >
          {row.entity}
        </Button>
      ),
    },
    {
      title: '函证编号',
      key: 'confirmationNo',
      width: 148,
      render: (_, row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="num">{row.confirmationNo}</span>
          <SoftTag color="var(--c-text-2)" bg="var(--c-tag-bg)">{row.type === '银行函证' ? '银行' : '往来'}</SoftTag>
        </span>
      ),
    },
    {
      title: (
        <span>
          回函次数
          <Tooltip title="同一函证多次回函时，以最近一次回函的数据为准；历史回函可在展开行中查看，可不处理">
            <QuestionCircleOutlined
              style={{ marginLeft: 4, fontSize: 12, color: 'var(--c-text-3)' }}
            />
          </Tooltip>
        </span>
      ),
      key: 'replyCount',
      width: 104,
      render: (_, row) => {
        const count = row.history.length
        if (count <= 1)
          return (
            <span className="muted" style={{ fontSize: 13 }}>
              1 次
            </span>
          )
        const expanded = expandedKeys.includes(row.confirmationNo)
        return (
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto', fontSize: 13 }}
            aria-expanded={expanded}
            onClick={() => toggleExpand(row.confirmationNo)}
          >
            {count} 次
            <RightOutlined
              style={{
                fontSize: 9,
                marginLeft: 2,
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform var(--motion-fast) ease-out',
              }}
            />
          </Button>
        )
      },
    },

    /* ---------- 回函进度 ---------- */
    {
      title: '回函进度',
      key: 'progress',
      width: 138,
      render: (_, row) => (
        <Tooltip title={PROGRESS_HINT[row.main.replyProgress]}>
          <span
            style={{ color: PROGRESS_COLOR[row.main.replyProgress], fontSize: 13, cursor: 'help' }}
          >
            {row.main.replyProgress}
          </span>
        </Tooltip>
      ),
    },
    {
      title: 'AI 风险',
      key: 'risk',
      width: 84,
      render: (_, row) => (
        <RiskTag level={row.main.risk as RiskLevel} reasons={row.main.verification?.riskReasons} />
      ),
    },
    {
      title: (
        <span>
          人工核验
          <Tooltip title="六项 AI 检测：发/回函一致性、是否盖章、骑缝章、印章名称一致、手写体（银行函证为银行函证文本）、快递面单">
            <QuestionCircleOutlined
              style={{ marginLeft: 4, fontSize: 12, color: 'var(--c-text-3)' }}
            />
          </Tooltip>
        </span>
      ),
      key: 'verify',
      width: 132,
      render: (_, row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <VerifyProgress
            done={row.main.verification?.completedModules ?? 0}
            total={row.main.verification?.totalModules ?? 6}
            risk={row.main.risk}
          />
          <VerifyBadge
            status={row.main.verifyStatus}
            by={row.main.verifiedBy}
            at={row.main.verifiedAt}
          />
        </span>
      ),
    },

    /* ---------- 操作 ---------- */
    /*
     * 收敛为「一个主按钮 + AI 核验 + 更多」：
     * 主按钮按回函进度直接给出「下一步」，业务人员不必自己判断该点哪个入口；
     * 无风险件的主按钮位让给「一键确认」，有风险件则永远没有快速通道。
     */
    {
      title: '操作',
      key: 'action',
      width: 320,
      fixed: 'right',
      render: (_, row) => {
        const m = row.main
        const quick = quickMap.get(m.id)

        /**
         * 两个业务入口的分工：
         *   · **常驻** —— 已填写过的内容随时可以重新打开查看与修改（这正是「填过就改不了」的根因）
         *   · **高亮** —— 当前该做的那一个用主色承担「下一步」引导，因此不再需要额外的主按钮
         *   · **无风险件**的主色位让给「一键确认」，「回函快递信息」降为普通链接（不出现两个主色按钮）
         *   · **待确认阶段不呈现「回函结果」**：SUBMIT_RESULT 会把核验状态置为已核验，
         *     从该状态进来等于绕过「确认回函快递信息」这个唯一留痕入口（审计底线）
         */
        const awaitingExpress = m.replyProgress === '待确认快递信息'
        const expressHighlight = awaitingExpress && !quick?.ok
        const resultHighlight = m.replyProgress === '待填写回函结果'

        /**
         * 待核验且确有风险原因 → AI 核验入口给提示（哪几封必须看依据）。
         * 已核验的行不再提醒（避免长期噪音）；无风险的行也不需要引导去看。
         */
        const needsVerifyAttention =
          m.verifyStatus === 'pending' && (m.verification?.riskReasons.length ?? 0) > 0

        return (
          <Space size={2}>
            {quick?.ok && (
              <Tooltip title="AI 全项通过且无低置信字段：点击即采纳全部 AI 资料、标记「已人工核验」，并把进度推进到「待填写回函结果」（不跳转，便于先把一批过完）">
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={() => runQuickConfirm([m.id])}
                >
                  一键确认
                </Button>
              </Tooltip>
            )}

            <Tooltip
              title={
                awaitingExpress
                  ? `确认回函快递信息后可填写回函结果${quick?.reason ? `；未走快速通道：${quick.reason}` : ''}`
                  : '可随时打开查看或修改已确认的回函快递信息'
              }
            >
              <Button
                type={expressHighlight ? 'primary' : 'link'}
                ghost={expressHighlight}
                size="small"
                style={expressHighlight ? undefined : { padding: '0 4px' }}
                onClick={() => setActiveModal({ kind: 'doc', recordId: m.id })}
              >
                回函快递信息
              </Button>
            </Tooltip>

            {!awaitingExpress && (
              <Tooltip title="可随时打开查看或修改已填写的回函结果">
                <Button
                  type={resultHighlight ? 'primary' : 'link'}
                  ghost={resultHighlight}
                  size="small"
                  style={resultHighlight ? undefined : { padding: '0 4px' }}
                  onClick={() => setActiveModal({ kind: 'result', recordId: m.id })}
                >
                  回函结果
                </Button>
              </Tooltip>
            )}

            <Tooltip
              title={
                needsVerifyAttention
                  ? `存在 ${m.verification?.riskReasons.length ?? 0} 项风险提示，建议先核对依据`
                  : undefined
              }
            >
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px' }}
                disabled={!m.verification}
                onClick={() => setActiveModal({ kind: 'verify', recordId: m.id })}
              >
                {needsVerifyAttention && (
                  <WarningFilled style={{ color: 'var(--c-risk-high)', marginRight: 2 }} />
                )}
                AI 核验
              </Button>
            </Tooltip>

            <Button
              type="link"
              size="small"
              style={{ padding: '0 4px' }}
              onClick={() => setActiveModal({ kind: 'view', recordId: m.id })}
            >
              查看
            </Button>

            <Button
              type="link"
              size="small"
              danger
              style={{ padding: '0 4px' }}
              onClick={() => confirmDelete(row)}
            >
              删除
            </Button>
          </Space>
        )
      },
    },
  ]

  /* ------------------------- 展开行 ------------------------- */
  /* 说明：历次回函区块使用浅底而非边框 —— 展开区已有一层卡片，不再嵌套第二个框 */

  /** 均分列宽（fr）—— 去掉弹性列后，相邻字段不会再被撑出大片空白 */
  const HISTORY_GRID = '72px 1.3fr 1fr 1.3fr 1.1fr 1.2fr'

  const expandedRowRender = (row: ConfirmationRow) => {
    const { main, history } = row
    const v = main.verification
    const multi = history.length > 1

    return (
      <div style={{ padding: '4px 12px 8px' }}>
        {/* 历次回函 —— 仅多次回函的函证展示 */}
        {multi && (
          <div style={{ marginBottom: 14 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              历次回函
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                （以最新一次为准，历史回函可不处理）
              </span>
            </div>
            <div className="subtle-block" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: HISTORY_GRID,
                  gap: 8,
                  padding: '7px 12px',
                  fontSize: 13,
                  color: 'var(--c-text-3)',
                }}
              >
                <span>回函次序</span>
                <span>发函记录编号</span>
                <span>回函日期</span>
                <span>快递单号</span>
                <span>回函情况</span>
                <span>状态</span>
              </div>
              {history.map((h, i) => {
                const isMain = h.id === main.id
                const c = conclusionOf(h)
                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: HISTORY_GRID,
                      gap: 8,
                      padding: '8px 12px',
                      fontSize: 13,
                      color: isMain ? 'var(--c-text-1)' : 'var(--c-text-3)',
                    }}
                  >
                    <span>第 {history.length - i} 次</span>
                    <span className="num">{h.sendRecordNo}</span>
                    <span className="num">{h.replyDate ?? '—'}</span>
                    <span className="num">{h.expressNo ?? '—'}</span>
                    <span style={{ fontWeight: c.danger ? 600 : undefined }}>{c.text}</span>
                    <span>
                      {isMain ? (
                        <SoftTag color="var(--c-text-1)" bg="var(--c-risk-low-bg)">
                          最终有效
                        </SoftTag>
                      ) : (
                        <span style={{ color: 'var(--c-text-3)' }}>已被覆盖，可不处理</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 函件与物流 */}
        <div style={{ marginBottom: v || main.lastEditedAt ? 12 : 0 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            函件与物流
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
            <FieldCell label="发函方式" value={main.sendMethod} />
            <FieldCell label="快递公司" value={main.expressCompany ?? '—'} />
            <FieldCell label="快递单号" value={<span className="num">{main.expressNo ?? '—'}</span>} />
            <FieldCell label="发函登记" value={<span className="num">{main.sendDate}</span>} />
            <FieldCell label="回函登记" value={<span className="num">{main.replyDate ?? '—'}</span>} />
          </div>
        </div>

        {/* 修改留痕 —— 仅在已归档数据被改动过后出现，不做常驻噪音 */}
        {main.lastEditedAt && (
          <div style={{ marginBottom: v ? 12 : 0 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              修改留痕
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
              <FieldCell label="最近修改" value={<span className="num">{main.lastEditedAt}</span>} />
              <FieldCell label="修改人" value={main.lastEditedBy ?? '—'} />
            </div>
          </div>
        )}

        {/* AI 核验结论 */}
        {v && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="section-title">AI 核验结论</span>
              <span style={{ marginLeft: 'auto' }}>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => setActiveModal({ kind: 'verify', recordId: main.id })}
                >
                  查看核验详情并确认
                </Button>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <FieldCell
                label="回函一致性"
                value={
                  v.consistency.diffCount > 0 ? (
                    <b style={{ fontWeight: 600 }}>{v.consistency.diffCount} 项差异</b>
                  ) : (
                    '全部相符'
                  )
                }
              />
              <FieldCell
                label="印章"
                value={
                  v.seal.hasSeal
                    ? `${v.seal.sealType} · ${v.seal.region}${v.seal.crossPageSeal ? ' · 有骑缝章' : ' · 无骑缝章'}`
                    : '未检出印章'
                }
              />
              {v.bankText && (
                <FieldCell
                  label="银行四要素"
                  value={
                    v.bankText.level === 'confirm'
                      ? '建议归属，需人工确认'
                      : v.bankText.fields.every((f) => f.matched)
                        ? '全部匹配'
                        : '存在不一致'
                  }
                />
              )}
              {v.handwriting && <FieldCell label="手写体" value={`已转录（位于${v.handwriting.region}）`} />}
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ------------------------- 空状态 ------------------------- */

  const emptyNode = (
    <div style={{ padding: '44px 0' }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div style={{ fontSize: 14, color: 'var(--c-text-2)', lineHeight: 2.2 }}>
            <div style={{ fontWeight: 500, color: 'var(--c-text-1)' }}>还没有回函数据</div>
            <div>上传回函文件后，匹配成功的函证会自动进入本列表</div>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              style={{ marginTop: 8 }}
              onClick={() => dispatch({ type: 'OPEN_RECOGNITION' })}
            >
              上传第一份回函文件
            </Button>
          </div>
        }
      />
    </div>
  )

  return (
    <div className="page">
      {/* 筛选区 —— 单行高密度筛选 */}
      <div className="panel" style={{ padding: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="260px">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--c-text-3)' }} />}
              placeholder="被询证单位 / 函证编号 / 发函记录编号"
              value={form.keyword}
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              onPressEnter={query}
            />
          </Col>
          <Col flex="130px">
            <Select
              allowClear
              placeholder="发函方式"
              style={{ width: '100%' }}
              value={form.sendMethod}
              onChange={(v) => setForm({ ...form, sendMethod: v })}
              options={['邮寄发函', '电子发函', '跟函'].map((v) => ({ label: v, value: v }))}
            />
          </Col>
          <Col flex="150px">
            <Select
              allowClear
              placeholder="回函进度"
              style={{ width: '100%' }}
              value={form.progress}
              onChange={(v) => setForm({ ...form, progress: v })}
              options={(['待确认快递信息', '待填写回函结果', '已完成'] as ReplyProgress[]).map(
                (v) => ({ label: v, value: v }),
              )}
            />
          </Col>
          <Col flex="140px">
            <Select
              allowClear
              placeholder="AI 风险"
              style={{ width: '100%' }}
              value={form.risk}
              onChange={(v) => setForm({ ...form, risk: v })}
              options={[
                { label: '有风险（高+中）', value: 'risk' },
                { label: '仅高风险', value: 'high' },
              ]}
            />
          </Col>
          <Col>
            <Space size={8}>
              <Button type="primary" icon={<SearchOutlined />} onClick={query}>
                查询
              </Button>
              <Button icon={<ReloadOutlined />} onClick={reset}>
                重置
              </Button>
            </Space>
          </Col>
        </Row>

        {activeChips.length > 0 && (
          <div
            style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
          >
            <span className="muted" style={{ fontSize: 13 }}>
              已选条件：
            </span>
            {activeChips.map((c) => (
              <Tag
                key={c.key}
                closable
                onClose={() => {
                  const next = { ...form, [c.key]: undefined }
                  setForm(next)
                  setFilter(next)
                }}
                style={{
                  marginInlineEnd: 0,
                  fontSize: 12,
                  border: 'none',
                  background: 'var(--c-primary-bg)',
                }}
              >
                {c.label}
              </Tag>
            ))}
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 'auto', fontSize: 13 }}
              onClick={reset}
            >
              清空
            </Button>
          </div>
        )}

        {/* 操作行 —— 与筛选同卡，避免再多一层容器 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 24,
          }}
        >
        <Tooltip title="往来函证与银行函证已合并为同一入口，系统自动判定类型；此处不再需要先做「回函登记」">
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => dispatch({ type: 'OPEN_RECOGNITION' })}
          >
            上传回函文件
          </Button>
        </Tooltip>

        <Tooltip
          title={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>为往来函证补充快递详细信息</div>
              <div>
                · 上传回函文件时已从快递面单识别出<b>快递单号</b>，并与函证编号建立对应
              </div>
              <div>
                · 在此导入快递数据 Excel（含快递单号、快递公司、地址、姓名、电话等详细信息）
              </div>
              <div>
                · 系统按<b>快递单号</b>匹配，把详细信息写入对应函证
              </div>
            </div>
          }
        >
          <Button
            icon={<FileExcelOutlined />}
            onClick={() => dispatch({ type: 'IMPORT_EXPRESS', result: EXPRESS_IMPORT_RESULT })}
          >
            导入快递数据
          </Button>
        </Tooltip>

        <Button
          type="link"
          size="small"
          icon={<QuestionCircleOutlined />}
          style={{ padding: '0 4px', fontSize: 13 }}
          onClick={() => dispatch({ type: 'OPEN_ONBOARDING' })}
        >
          操作指引
        </Button>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {recognizing && (
            <span style={{ fontSize: 13, color: 'var(--c-primary)' }}>
              ● 识别中，结果将自动写入列表
            </span>
          )}
          <span className="muted" style={{ fontSize: 13 }}>
            共 <b className="num" style={{ fontWeight: 500 }}>{total}</b> 条
            <span style={{ margin: '0 6px', color: 'var(--c-hairline)' }}>·</span>
            待人工确认{' '}
            <b
              className="num"
              style={{
                fontWeight: 500,
                color: pendingVerify ? 'var(--c-text-1)' : undefined,
              }}
            >
              {pendingVerify}
            </b>
            <span style={{ margin: '0 6px', color: 'var(--c-hairline)' }}>·</span>
            已完成人工确认 <b className="num" style={{ fontWeight: 500 }}>{verifiedCount}</b>
          </span>
          </span>
        </div>
      </div>

      {/* 表格 */}
      <div className="panel" style={{ padding: '4px 0' }}>
        {/* 批量操作条 —— 勾选后出现。只有无风险件可勾选，故「已选」恒等于「可批量确认」 */}
        {selectedKeys.length > 0 && (
          <div
            style={{
              margin: '6px 12px 10px',
              padding: '8px 12px',
              borderRadius: 6,
              background: 'var(--c-primary-bg)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 13,
            }}
          >
            <span>
              已选 <b className="num">{selectedKeys.length}</b> 封（均为无风险件）
            </span>
            {data.length > quickEligibleCount && (
              <span className="muted">
                其余 <b className="num">{data.length - quickEligibleCount}</b> 封存在风险提示，需逐条人工核对
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button size="small" onClick={() => setSelectedKeys([])}>
                取消选择
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={confirmBatchQuick}
              >
                批量确认
              </Button>
            </span>
          </div>
        )}

        <Table<ConfirmationRow>
          size="small"
          rowKey="confirmationNo"
          columns={columns}
          dataSource={data}
          scroll={{ x: 1344 }}
          locale={{ emptyText: emptyNode }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys as string[]),
            columnWidth: 36,
            getCheckboxProps: (row) => {
              const check = quickMap.get(row.main.id)
              return {
                disabled: !check?.ok,
                // 置灰原因用原生 title 呈现 —— 悬停即可看到「为什么这封不能批量勾选」
                title: check?.ok ? undefined : (check?.reason ?? '不满足快速确认条件'),
              }
            },
          }}
          rowClassName={(row) =>
            [
              row.main.risk === 'high' ? 'row-risk-high' : '',
              state.flashRowId === row.confirmationNo ? 'row-flash' : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
          pagination={{
            size: 'small',
            pageSize: 10,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            style: { padding: '0 16px' },
          }}
          expandable={{
            columnWidth: 32,
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys as string[]),
            rowExpandable: () => true,
            expandIcon: ({ expanded, onExpand, record }) => (
              <Button
                type="text"
                size="small"
                aria-label={expanded ? '收起详情' : '展开详情'}
                aria-expanded={expanded}
                onClick={(e) => onExpand(record, e)}
                style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                icon={
                  <RightOutlined
                    style={{
                      fontSize: 11,
                      color: expanded ? 'var(--c-primary)' : 'var(--c-text-3)',
                      transform: expanded ? 'rotate(90deg)' : 'none',
                      transition: 'transform var(--motion-fast) ease-out',
                    }}
                  />
                }
              />
            ),
            expandedRowRender,
          }}
        />
      </div>

      {/* 四个业务入口统一为全屏弹窗，共用一个互斥状态 */}
      <VerificationModal open={activeModal?.kind === 'verify'} record={activeRecord} onClose={closeModal} />
      <RecordDetailModal open={activeModal?.kind === 'view'} record={activeRecord} onClose={closeModal} />
      <ReplyDocEntryModal
        key={modalKey('doc')}
        open={activeModal?.kind === 'doc'}
        recordId={activeModal?.recordId}
        onClose={closeModal}
        /* 同样延后一帧：这里会卸载「资料录入」并挂载「结果填写」，属同帧切换 */
        onDone={(id) => afterPaint(() => setActiveModal({ kind: 'result', recordId: id }))}
      />
      <ReplyResultModal
        key={modalKey('result')}
        open={activeModal?.kind === 'result'}
        recordId={activeModal?.recordId}
        onClose={closeModal}
      />
      <ExpressImportDrawer />
    </div>
  )
}
