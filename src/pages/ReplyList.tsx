import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { App, Button, Col, Dropdown, Empty, Input, Row, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudUploadOutlined,
  DownOutlined,
  FileExcelOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { EXPRESS_IMPORT_RESULT } from '@/mock/expressImport'
import { TYPE_RULE, consistencyOf, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import ExpressImportDrawer from '@/components/ExpressImportDrawer'
import type { ConfirmationType, ReplyProgress, ReplyRecord, RiskLevel } from '@/types'
import VerificationModal from '@/components/VerificationModal'
import RecordDetailModal from '@/components/RecordDetailModal'
import ReplyDocEntryModal from '@/components/ReplyDocEntryModal'
import ReplyResultModal from '@/components/ReplyResultModal'
import { MatchTag, RiskTag, VerifyBadge } from '@/components/Marks'
import { afterPaint } from '@/utils/afterPaint'

/** 四个业务入口的全屏弹窗 */
type ModalKind = 'view' | 'verify' | 'doc' | 'result'

/* ------------------------------------------------------------------ */
/* 回函进度 —— 用户视角的「下一步要做什么」                              */
/* ------------------------------------------------------------------ */

/** 进度文字统一墨色（颜色只走底色），已完成退灰 */
const PROGRESS_COLOR: Record<ReplyProgress, string> = {
  待确认快递信息: 'var(--c-text-1)',
  待填写回函结果: 'var(--c-text-1)',
  已完成: 'var(--c-text-3)',
}

/**
 * 「下一步该做什么」—— **直写在进度列里**，不靠悬停。
 *
 * 这是本轮针对「第一次使用不知道该点哪个」的核心改动：原先进度列只写状态
 * （`待确认快递信息`），用户还得自己把它翻译成一个动作；现在把动作直接写出来，
 * 且**与操作列主按钮文案严格同词** —— 用户在同一行里就能对上「说的就是这个按钮」。
 */
const NEXT_STEP: Record<ReplyProgress, string | null> = {
  待确认快递信息: '确认回函快递信息',
  待填写回函结果: '填写回函结果',
  /** 已完成没有「下一步」—— 修正已填内容走「更多」，不占用主按钮位 */
  已完成: null,
}

/** 进度列的悬停说明 —— 只补充「为什么要这么做」，不重复已经直写出来的动作 */
const PROGRESS_HINT: Record<ReplyProgress, string> = {
  待确认快递信息:
    'AI 已识别并归属到函证。这一步同时完成 AI 六项检测的人工确认与留痕 —— 全流程唯一的核验签字动作',
  待填写回函结果: '回函快递信息已确认。AI 核验结论已带入表单，逐项采纳或修改后保存即归档',
  已完成:
    '回函快递信息与回函结果均已人工确认。如需修正，在「更多」里打开「回函快递信息」或「回函结果」—— 改后仍保持「已完成」，并记录修改人与时间',
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

/** 单次回函的结论摘要（用于历次回函列表）—— 与列表列共用 evaluateMatch 唯一出口 */
function conclusionOf(r: ReplyRecord): { text: string; danger: boolean } {
  if (isRecognitionPending(r)) return { text: '识别中', danger: false }
  if (!r.verification && r.resultInfo?.matched === undefined) return { text: '未核验', danger: false }
  const m = evaluateMatch(r)
  if (m.matched === null) return { text: '无法判定', danger: true }
  if (m.matched) return { text: '相符', danger: false }
  // 不相符的摘要：银行侧给出差异计数（询证事项逐项核对），往来侧为印章落章区域结论
  if (TYPE_RULE[r.type].source === 'bankItems') {
    const c = consistencyOf(r)
    return c.diffCount > 0
      ? { text: `询证事项 ${c.diffCount} 项差异`, danger: true }
      : { text: '不相符', danger: true }
  }
  return { text: '不相符', danger: true }
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
  const { modal } = App.useApp()
  const { state, dispatch } = useApp()

  const [form, setForm] = useState<FilterState>(EMPTY_FILTER)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  /**
   * 四个业务入口共用一个弹窗状态 —— 保证不会同时打开多个弹窗。
   * `note` 只在从展开行的历次回函打开「查看」时携带，用于说明该次回函的语境。
   */
  const [activeModal, setActiveModal] = useState<{
    kind: ModalKind
    recordId: string
    note?: ReactNode
  } | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

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

  /** 有批次在跑，或已有银行回函处于「识别中」（阶段二尚未回填）—— 两种都意味着列表还会自动刷新 */
  const recognizing =
    state.batches.some((b) => b.status !== 'done') || state.records.some((r) => isRecognitionPending(r))
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

  /* ------------------------------------------------------------------ */
  /* 「回函是否相符」取值 —— 列表列用                                     */
  /* ------------------------------------------------------------------ */

  /**
   * 相符性判定已收敛到 `evaluateMatch`（`services/replyRule.ts`）单一出口：
   * · 人工填写过回函结果 → 以人工值为准；
   * · 银行函证 → 只看「回函 × 系统内询证事项逐项核对」（印章不作相符性依据）；
   * · 往来函证 → 印章落章区域判定（口径不变）。
   * 返回 `byAi` 让标签能区分「AI 建议」与「已人工确认」——
   * 这是「AI 只出建议、人工确认才算数」这条底线在列表上的表达。
   */
  const matchOf = evaluateMatch

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
    /* ---------- 回函是否相符 ---------- */
    /*
     * 用户诉求（v2.25）：「人工核验」列前面的 6/6 从用户角度不直观 ——
     * 6/6 是**系统内部的检测点计数**，而业务人员看列表最想知道的是「**这封回函到底相符吗**」。
     * 故独立成列：给结论 + 区分结论**来自 AI 建议还是人工确认**（不相符时悬停看原因）。
     *
     * 位置：紧随「被询证单位 / 函证编号」，排在「AI 风险」之前 ——
     * 相符与否是首位业务结论，先于风险等级这类辅助判断。
     */
    {
      title: '回函是否相符',
      key: 'match',
      width: 132,
      render: (_, row) => {
        const m = matchOf(row.main)
        return (
          <MatchTag
            matched={m.matched}
            byAi={m.byAi}
            basis={m.basis}
            reasons={m.reasons}
            type={row.main.type}
            pending={isRecognitionPending(row.main)}
          />
        )
      },
    },
    {
      title: 'AI 风险',
      key: 'risk',
      width: 84,
      render: (_, row) => (
        <RiskTag
          level={row.main.risk as RiskLevel}
          reasons={row.main.verification?.riskReasons}
          pending={isRecognitionPending(row.main)}
        />
      ),
    },
    /*
     * 只留「是否已人工核验」—— 一个**业务上说得清**的状态。
     *
     * v2.25 修正（用户）：「不展示 6/6 这个数字，因为用户不知道 6/6 是啥、有什么含义。」
     * 那个数字是 **AI 检测点的完成计数**（系统内部指标）：既没有解释、也就没有意义。
     * AI 究竟查了哪几项，在「更多 → AI 核验」页会逐项列出，不需要在列表上用计数暗示。
     */
    {
      title: (
        <span>
          人工核验
          <Tooltip title="是否已完成人工核验。核验人与核验时间在「确认回函快递信息」时留痕；AI 具体查了哪几项，见「更多 → AI 核验」">
            <QuestionCircleOutlined
              style={{ marginLeft: 4, fontSize: 12, color: 'var(--c-text-3)' }}
            />
          </Tooltip>
        </span>
      ),
      key: 'verify',
      width: 104,
      render: (_, row) => (
        <VerifyBadge
          status={row.main.verifyStatus}
          by={row.main.verifiedBy}
          at={row.main.verifiedAt}
        />
      ),
    },

    /* ---------- 是否重新发函 ---------- */
    /*
     * 用户诉求（v2.26）：「还需要增加一列：是否重新发函。如果，有历史的回函记录，则就标记为重新发函。」
     *
     * **判定口径**：该函证**存在历史回函记录**（回函次数 > 1）→ 标记「重新发函」；只有一次回函 → 「—」。
     * 它是**客观事实标记**、不是状态结论，故走中性灰阶（不占用红 / 绿两档语义色）。
     * 悬停说明「共几次回函、本次是第几次」，避免留下一个「没有解释的标记」。
     *
     * 位置（用户指定）：**倒数第二个字段** —— 前面依次是「定位（谁）→ 结论（相符 / 风险 / 核验）」，
     * 这个事实标记收在流程状态之前，不打断前面的阅读主线。
     */
    {
      title: '是否重新发函',
      key: 'resend',
      width: 104,
      render: (_, row) => {
        const times = row.history.length
        if (times <= 1) {
          return (
            <span className="muted" style={{ fontSize: 13 }}>
              —
            </span>
          )
        }
        return (
          <Tooltip
            title={`该函证共 ${times} 次回函；本行呈现最新一次（第 ${times} 次）。历史回函已被覆盖，展开行可查看`}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 20,
                padding: '0 6px',
                borderRadius: 'var(--radius-tag)',
                fontSize: 12,
                lineHeight: 1,
                color: 'var(--c-text-1)',
                background: 'var(--c-tag-bg)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              重新发函
            </span>
          </Tooltip>
        )
      },
    },
    /* ---------- 回函进度 ---------- */
    /*
     * 位置（用户指定）：**倒数第一个字段、紧邻操作列**。
     * 这样「进度 → 下一步：xxx」与右侧操作列的主按钮**相邻可读** ——
     * 读到「下一步做什么」时，动作就在紧右边，不需要横向来回找。
     */
    {
      title: '回函进度',
      key: 'progress',
      width: 176,
      render: (_, row) => {
        const p = row.main.replyProgress
        return (
          <Tooltip title={PROGRESS_HINT[p]}>
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                cursor: 'help',
                lineHeight: 1.25,
              }}
            >
              <span style={{ color: PROGRESS_COLOR[p], fontSize: 13 }}>{p}</span>
              {/*
               * 下一步动作直写在这里，且与操作列主按钮**严格同词**。
               * 已完成没有下一步（修正走「更多」），故这一行不显示 —— 与空着的主按钮位保持一致。
               */}
              {NEXT_STEP[p] && (
                <span style={{ color: 'var(--c-text-3)', fontSize: 12 }}>下一步：{NEXT_STEP[p]}</span>
              )}
            </span>
          </Tooltip>
        )
      },
    },
    /* ---------- 操作 ---------- */
    /*
     * 「下一步 + 查看 + 更多」—— **每行结构完全一致**，只有主按钮文案随进度变化。
     *
     * 收敛的动因：此前操作列有 5 个平铺入口，高亮位置随进度移动，无风险件还会多出
     * 一个「一键确认」——同一列里按钮因行而异，业务人员建立不起稳定记忆，
     * 第一次使用更无从判断「该点哪个、点了会怎样」。现在每行只有三个固定位置：
     *   ① 主按钮 = 「这一步该做什么」（文案与「回函进度」列的小字严格同词）
     *   ② 查看   = 只读看函证
     *   ③ 更多   = 其余入口（回函快递信息 / 回函结果 / AI 核验 / 删除）
     * 下拉里**不放「查看」** —— 外部已有，重复入口正是 v2.15 用户亲自否决过的问题。
     */
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, row) => {
        const m = row.main
        const awaitingExpress = m.replyProgress === '待确认快递信息'

        /**
         * 待核验且确有风险原因 → 需要去看依据的行，在「更多」按钮上给一句悬停说明。
         * 入口虽然收进了下拉，但「哪几封必须看依据」不该完全无声；
         * 不过**不再用图标标记** —— 操作列里的感叹号被判为视觉噪音，
         * 风险等级已在「AI 风险」列用标签表达，此处不重复。
         */
        const needsVerifyAttention =
          m.verifyStatus === 'pending' && (m.verification?.riskReasons.length ?? 0) > 0

        /**
         * 主按钮 = 「这一步该做什么」；文案与「回函进度」列的小字严格同词。
         *
         * **已完成行不显示主按钮** —— 已完成没有「下一步」：修正已填内容是补正行为，
         * 不是流程动作，从「更多」里的「回函快递信息」/「回函结果」进入即可。
         */
        const primary: { text: string; kind: ModalKind } | null =
          m.replyProgress === '待确认快递信息'
            ? { text: '确认回函快递信息', kind: 'doc' }
            : m.replyProgress === '待填写回函结果'
              ? { text: '填写回函结果', kind: 'result' }
              : null

        /** 悬停直接说明「点了会发生什么」—— 不让人靠猜 */
        const primaryHint =
          m.replyProgress === '待确认快递信息'
            ? '点击后：打开回函快递信息逐项确认；确认将标记「已人工核验」并记录核验人与时间，进度推进到「待填写回函结果」'
            : '点击后：打开回函结果填写；处理完必填项并保存后归档，进度变为「已完成」'

        return (
          <Space size={2}>
            {primary && (
              <Tooltip title={primaryHint}>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => setActiveModal({ kind: primary.kind, recordId: m.id })}
                >
                  {primary.text}
                </Button>
              </Tooltip>
            )}

            <Button
              type="link"
              size="small"
              style={{ padding: '0 4px' }}
              onClick={() => setActiveModal({ kind: 'view', recordId: m.id })}
            >
              查看
            </Button>

            <Dropdown
              menu={{
                items: [
                  { key: 'doc', label: '回函快递信息' },
                  /*
                   * 待确认阶段**不呈现**该项（不是禁用）：SUBMIT_RESULT 会把核验状态置为已核验，
                   * 从该状态进入等于绕过「确认回函快递信息」这个唯一的核验留痕入口（审计底线）。
                   */
                  ...(awaitingExpress ? [] : [{ key: 'result', label: '回函结果' }]),
                  { key: 'verify', label: 'AI 核验', disabled: !m.verification },
                  { type: 'divider' as const },
                  { key: 'delete', label: '删除', danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'delete') confirmDelete(row)
                  else setActiveModal({ kind: key as ModalKind, recordId: m.id })
                },
              }}
            >
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px' }}
                title={
                  needsVerifyAttention
                    ? `存在 ${m.verification?.riskReasons.length ?? 0} 项风险提示，建议先核对依据`
                    : undefined
                }
              >
                更多 <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  /* ------------------------- 展开行 ------------------------- */
  /* 说明：历次回函区块使用浅底而非边框 —— 展开区已有一层卡片，不再嵌套第二个框 */

  /**
   * 历史回函表 —— 含只读「查看」列。
   * 历史回函**只能看不能改**：它们已被覆盖、不参与统计，给修改入口只会让人误改到无效数据。
   * 注：列里**不含「状态」**（全表恒为「已被覆盖」，含义上移到区块标题），
   * 也**不含当前有效那一次**（它在上面的「当前有效回函」分组里，避免同一次数据出现两处）。
   */
  const HISTORY_GRID = '72px 1.3fr 1fr 1.3fr 1.1fr 56px'

  const expandedRowRender = (row: ConfirmationRow) => {
    const { main, history } = row
    const v = main.verification
    /** 一致性摘要 —— 按类型取数据源（银行=询证事项逐项核对，往来=发函回函一致性比对） */
    const consistency = consistencyOf(main)
    /** 回函总次数（含本次）—— 用于「第 N 次」的表达 */
    const times = history.length
    /** 历史回函 = 除当前有效之外的那些 */
    const past = history.filter((h) => h.id !== main.id)
    /** 分组内是否还有后续块（决定「函件与物流」的下间距） */
    const grouped = Boolean(v) || Boolean(main.lastEditedAt)

    return (
      <div style={{ padding: '4px 12px 8px' }}>
        {/*
         * 当前有效回函 —— 下面这几块讲的都是**同一次回函**（该函证的最终有效那次），
         * 所以收进一个带标题的分组：标题写明「第几次 + 回函时间」，
         * 读者不必再猜「这几块数据到底属于谁」。
         */}
        <div
          className="subtle-block"
          style={{ padding: '12px 14px', marginBottom: past.length > 0 ? 14 : 0 }}
        >
          <div className="section-title" style={{ marginBottom: 10 }}>
            当前有效回函
            {times > 1 && (
              <span className="muted" style={{ fontWeight: 400 }}>
                　· 第 {times} 次
              </span>
            )}
            {main.replyDate && (
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                　· {main.replyDate}
              </span>
            )}
          </div>

          {/* 函件与物流 */}
          <div style={{ marginBottom: grouped ? 12 : 0 }}>
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

          {/* AI 核验结论 —— 银行函证两阶段：识别中先给提示行，阶段二完成后自动刷新出下方字段 */}
          {isRecognitionPending(main) && (
            <div
              style={{
                fontSize: 13,
                color: 'var(--c-text-3)',
                padding: '8px 10px',
                background: 'var(--c-neutral-bg)',
                borderRadius: 8,
                marginBottom: 8,
              }}
            >
              AI 识别中 —— 归属已确认，其余检测项（询证事项逐项核对 / 印章 / 快递面单）完成后自动刷新结论。
            </div>
          )}
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
                    查看核验详情
                  </Button>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <FieldCell
                  label={consistency.label}
                  value={
                    consistency.diffCount > 0 ? (
                      <b style={{ fontWeight: 600 }}>{consistency.diffCount} 项差异</b>
                    ) : (
                      '全部一致'
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
                {TYPE_RULE[main.type].detectBankText && v.bankText && (
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
                {TYPE_RULE[main.type].detectHandwriting && v.handwriting && (
                  <FieldCell label="手写体" value={`已转录（位于${v.handwriting.region}）`} />
                )}
              </div>
            </div>
          )}
        </div>

        {/*
         * 历史回函 —— 只列**本次之前**的那些（本次已在上面）。
         * 区块**不加外层浅底**（表本身沿用行间发丝线），与上面的浅底分组形成「主（有底）/ 次（无底）」对比。
         */}
        {past.length > 0 && (
          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>
              历史回函
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                （已被覆盖，仅供参考，可不处理）
              </span>
            </div>
            <div style={{ overflow: 'hidden' }}>
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
                <span>操作</span>
              </div>
              {past.map((h) => {
                /* past 已排除本次，用它在原 history 里的位置反推是第几次 */
                const seq = times - history.findIndex((x) => x.id === h.id)
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
                      color: 'var(--c-text-3)',
                      borderTop: '1px solid var(--c-hairline)',
                    }}
                  >
                    <span>第 {seq} 次</span>
                    <span className="num">{h.sendRecordNo}</span>
                    <span className="num">{h.replyDate ?? '—'}</span>
                    <span className="num">{h.expressNo ?? '—'}</span>
                    <span>{c.text}</span>
                    <span>
                      {/* 历史回函只读 —— 给的是「查看」而不是「修改」：它们已被覆盖、不参与统计 */}
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, height: 'auto', fontSize: 13 }}
                        onClick={() =>
                          setActiveModal({
                            kind: 'view',
                            recordId: h.id,
                            note: `这是第 ${seq} 次回函，已被后续回函覆盖，仅供参考；当前有效为第 ${times} 次。本页为只读查看，如需修改请从列表行操作区的「更多」进入。`,
                          })
                        }
                      >
                        查看
                      </Button>
                    </span>
                  </div>
                )
              })}
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
            <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={() => dispatch({ type: 'OPEN_RECOGNITION', uploadType: '往来函证' })}
              >
                上传往来函证回函
              </Button>
              <Button
                icon={<CloudUploadOutlined />}
                onClick={() => dispatch({ type: 'OPEN_RECOGNITION', uploadType: '银行函证' })}
              >
                上传银行函证回函
              </Button>
            </div>
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
        {/*
         * 两个上传入口（v2.27）—— 往来函证与银行函证的智能检测事项差别很大，
         * 从入口就分开：点哪个按钮，工作台就按哪套检测项、上传提示与演示数据呈现，
         * 上传时类型即已确定，不再由系统事后判类型。
         */}
        <Tooltip
          title={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>接收带二维码的往来函证回函</div>
              <div>· 检测：发函回函一致性 / 印章 / 手写体 / 快递面单</div>
              <div>· 按右上角二维码自动切分并归属，无需先做「回函登记」</div>
            </div>
          }
        >
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => dispatch({ type: 'OPEN_RECOGNITION', uploadType: '往来函证' })}
          >
            上传往来函证回函
          </Button>
        </Tooltip>

        <Tooltip
          title={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>接收银行函证回函（只需回函件）</div>
              <div>· 格式一 / 格式二数据已存于函证系统，识别回函后直接与系统数据逐项核对</div>
              <div>· 检测：询证事项逐项核对 / 印章 / 银行函证文本识别（不检测手写体）</div>
              <div>· 无二维码，按「银行名称 + 被审计单位 + 函证起止日期」四要素归属</div>
            </div>
          }
        >
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => dispatch({ type: 'OPEN_RECOGNITION', uploadType: '银行函证' })}
          >
            上传银行函证回函
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
        <Table<ConfirmationRow>
          size="small"
          rowKey="confirmationNo"
          columns={columns}
          dataSource={data}
          scroll={{ x: 1344 }}
          locale={{ emptyText: emptyNode }}
          /* 行首不再加「高风险」红色竖条（2026-09-20 用户要求去掉）：
             风险等级已由「AI 风险」列的状态标签表达，行首再画一条属于重复表达。
             `row-risk-high` 保留给明细表的「差异行 / 未匹配行」——
             那些表没有独立的风险列，需要左侧标记做视觉定位。 */
          rowClassName={(row) => (state.flashRowId === row.confirmationNo ? 'row-flash' : '')}
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
      <RecordDetailModal
        open={activeModal?.kind === 'view'}
        record={activeRecord}
        onClose={closeModal}
        note={activeModal?.kind === 'view' ? activeModal.note : undefined}
      />
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
