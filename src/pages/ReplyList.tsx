import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  App,
  Breadcrumb,
  Button,
  Col,
  Dropdown,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd'
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
import { DEMO_LABEL, PRESET_BATCHES } from '@/mock/recognition'
import { TYPE_RULE, consistencyOf, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import SplitEntryModal from '@/components/SplitEntryModal'
import type { SplitFileInfo } from '@/components/SplitEntryModal'
import BankUploadModal from '@/components/BankUploadModal'
import type { BankUploadFile } from '@/components/BankUploadModal'
import SplitCheckModal from '@/components/SplitCheckModal'
import type { SplitSegment } from '@/components/SplitCheckModal'
import ExpressImportDrawer from '@/components/ExpressImportDrawer'
import type { ConfirmationType, ReplyProgress, ReplyRecord, RiskLevel } from '@/types'
import VerificationModal from '@/components/VerificationModal'
import RecordDetailModal from '@/components/RecordDetailModal'
import ReplyDocEntryModal from '@/components/ReplyDocEntryModal'
import ReplyResultModal from '@/components/ReplyResultModal'
import { MatchTag, RiskTag } from '@/components/Marks'
import { StatusTag } from '@/components/StatusTag'
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

/**
 * 进度列的悬停说明 —— **只补一句「为什么」**，不复述按钮动作（动作已直写在操作列）。
 *
 * v2.45 精简：原文案每段都是一整句流程描述（如「这一步同时完成 AI 六项检测的人工确认与留痕
 * —— 全流程唯一的核验签字动作」），与操作列的 `primaryHint`、弹窗页脚同义重复了三处。
 */
const PROGRESS_HINT: Record<ReplyProgress, string> = {
  待确认快递信息: '确认即完成核验留痕',
  待填写回函结果: 'AI 结论已带入表单，采纳或修改后保存即归档',
  已完成: '如需修正，在「更多」里打开对应入口；改后仍保持「已完成」并记录修改人与时间',
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

/* v2.38：原 `FieldCell` 组件（展开行三片字段网格用）已随展开行重做而删除 —— 不留死代码。 */


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
  /**
   * 「切分」两步弹窗（往来函证专属，v2.35）—— 与四个业务弹窗互斥。
   *
   * 往来回函上传的是拼接件，必须先按二维码切分、由业务人员核对归属，**确认之后才打开识别工作台**；
   * 银行回函文件内没有系统二维码、不需要切分，点上传直接进工作台（见 `openUpload`）。
   */
  const [split, setSplit] = useState<{ step: 'entry' | 'check'; file?: SplitFileInfo } | null>(null)

  /** 「上传银行函证回函」小弹窗（v2.47） */
  const [bankUpload, setBankUpload] = useState(false)

  /**
   * 上传入口 —— 按类型分流（v2.35 立，v2.47 修订银行侧）：
   * · 往来函证（`TYPE_RULE.needsSplit`）→ 先走「切分」两步（① 文件识别录入 → ② 数据核对），
   *   在 ② 里点「确定」= 归属即定，**那时才**打开识别工作台；
   * · 银行函证 → **先给上传小弹窗**（不切分、无额外字段，选完文件即开始识别并进工作台）。
   *
   * v2.47 改动：银行侧此前**直接打开全屏工作台**，而工作台在无批次时是几乎空白的上传区 ——
   * 拿一整屏做一个小弹窗就能做完的事，且与往来的入口节奏不一致。现在两类都是
   * 「**弹窗负责选文件，工作台只负责看进度与结果**」。
   */
  const openUpload = (type: ConfirmationType) => {
    if (TYPE_RULE[type].needsSplit) {
      setSplit({ step: 'entry' })
      return
    }
    setBankUpload(true)
  }

  /**
   * 银行回函上传「确定」—— 直接开始识别并进入工作台（`START_BATCH` 会一并置 `recognitionOpen`）。
   * 不再多一次「确认归属」：银行回函无需切分，上传弹窗的「确定」即用户的一次明确表态，
   * 与该类型在工作台内靠四要素算归属的机制不冲突。
   */
  const onBankUploadConfirm = (files: BankUploadFile[]) => {
    setBankUpload(false)
    const batch = PRESET_BATCHES[TYPE_RULE['银行函证'].presetBatchId]()
    const first = files[0]
    dispatch({
      type: 'START_BATCH',
      batch: first ? { ...batch, fileName: first.name, fileSize: first.size } : batch,
      uploadType: '银行函证',
    })
  }

  /** 银行弹窗里的「用演示数据体验」—— 与上传同路，只是用内置批次 */
  const onBankDemo = () => {
    setBankUpload(false)
    dispatch({
      type: 'START_BATCH',
      batch: PRESET_BATCHES[TYPE_RULE['银行函证'].presetBatchId](),
      uploadType: '银行函证',
    })
  }

  /**
   * 「数据核对」点「确定」—— 归属即定。
   *
   * 启动识别批次（类型随入口确定）并随即打开工作台：归属已在切分这一步确认过，
   * 因此识别页打开时六项检测即一起开跑，工作台内不需要再等一次确认。
   */
  const onSplitConfirm = (segments: SplitSegment[]) => {
    const file = split?.file
    setSplit(null)
    const batch = PRESET_BATCHES[TYPE_RULE['往来函证'].presetBatchId]()
    dispatch({
      type: 'START_BATCH',
      batch: file ? { ...batch, fileName: file.name, fileSize: file.size } : batch,
    })
    dispatch({ type: 'OPEN_RECOGNITION', uploadType: '往来函证' })
    message.success(`已写入回函管理列表（${segments.length} 段）—— 已进入识别工作台，六项检测一起开跑`)
  }

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
          <StatusTag size="sm" tone="neutral">
            {row.type === '银行函证' ? '银行' : '往来'}
          </StatusTag>
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
     * v2.37 移除「人工核验」列 —— 它与「回函进度」列是**同一事实的两种画法**：
     * `verifyStatus` 只在「确认回函快递信息」的首次确认时置为 verified，
     * 而同一次 dispatch 也把进度推到「待填写回函结果」，二者严格一一对应
     * （待确认快递信息 = 待核验；待填写回函结果 / 已完成 = 已核验）。
     *
     * 既然每个环节都要人工签字，「签过字」就是**默认背景、不是信息量** ——
     * 同一件事在相邻两列各说一遍，只会多占 104px 与一次扫视。
     * 核验人 / 核验时间**下沉到展开行的「留痕」区块**（审计要留痕，列表不必占一列）。
     */

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
          <StatusTag
            tone="neutral"
            /* v2.45 精简：去掉「已被覆盖」的重复说明（展开行的行内标记已表达） */
            tip={`该函证共 ${times} 次回函，本行呈现最新一次；历次回函在展开行`}
          >
            重新发函
          </StatusTag>
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

        /**
         * 悬停只补「点了会产生什么后果」，**不复述「打开哪个弹窗」** ——
         * 按钮文案（「确认回函快递信息」）本身已经说清它开哪个界面。
         * v2.45 精简：原文案以「点击后：打开…逐项确认；…」起头，属逐字复述操作流程。
         */
        const primaryHint =
          m.replyProgress === '待确认快递信息'
            ? '确认即记录核验人与时间，进度推进到「待填写回函结果」'
            : '处理完必填项并保存后归档，进度变为「已完成」'

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
   * 回函记录表的列宽模板（v2.38：展开行就是这一张表，当前有效 + 历史**合成同一张**）。
   * 见 `expandedRowRender` 的注释：改造前是「当前有效字段网格 + 历史回函表」，
   * 等于把详情页的字段堆进列表，而那些字段的去处其实都已另有。
   */
  const REPLY_GRID = '118px 1.3fr 1.1fr 1.3fr 1.1fr 56px'

  const expandedRowRender = (row: ConfirmationRow) => {
    const { main, history } = row
    /** 回函总次数（含当前有效） */
    const times = history.length

    return (
      <div style={{ padding: '4px 12px 8px' }}>
        {/*
         * 回函记录表 —— 当前有效与历史**合成同一张**（v2.38）。
         * 标题只报事实；「哪一次算数」由表内的「当前有效」行内标记表达，
         * 不再用「上面一块 / 下面一块」的空间关系让人猜。
         * `history` 由 `groupByConfirmation` 保证**最新在前**，故索引 i 的次序是 `times - i`。
         */}
        <div className="section-title" style={{ marginBottom: 8 }}>
          回函记录
          {times > 1 && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              （共 {times} 次，仅最新一次为最终有效）
            </span>
          )}
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: REPLY_GRID,
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
          {history.map((h, i) => {
            const seq = times - i
            const isCurrent = h.id === main.id
            const c = conclusionOf(h)
            return (
              <div
                key={h.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: REPLY_GRID,
                  gap: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  alignItems: 'center',
                  borderTop: '1px solid var(--c-hairline)',
                  color: isCurrent ? 'var(--c-text-1)' : 'var(--c-text-3)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>第 {seq} 次</span>
                  {isCurrent && (
                    <StatusTag size="sm" tone="primary">
                      当前有效
                    </StatusTag>
                  )}
                </span>
                <span className="num">{h.sendRecordNo}</span>
                <span className="num">{h.replyDate ?? '—'}</span>
                <span className="num">{h.expressNo ?? '—'}</span>
                {/* 当前有效那次的相符性行上已有（「回函是否相符」列），此处不重复 */}
                <span>{isCurrent ? '—' : c.text}</span>
                <span>
                  {/* 只读「查看」：历史回函已被覆盖、不参与统计，给修改入口只会让人误改到无效数据 */}
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 'auto', fontSize: 13 }}
                    onClick={() =>
                      setActiveModal(
                        isCurrent
                          ? { kind: 'view', recordId: h.id }
                          : {
                              kind: 'view',
                              recordId: h.id,
                              note: `这是第 ${seq} 次回函，已被后续回函覆盖，仅供参考；当前有效为第 ${times} 次。本页为只读查看，如需修改请从列表行操作区的「更多」进入。`,
                            },
                      )
                    }
                  >
                    查看
                  </Button>
                </span>
              </div>
            )
          })}
        </div>

        {/*
          以下三片字段于 v2.38 移出展开行，去处都已另有（同一份信息只在一个地方承载）：
          · 函件与物流（发函方式 / 快递公司 / 快递单号 / 发函登记 / 回函登记）→「查看函证」工作区顶部基础信息，
            后三项那里本就有；快递单号另在本表的「快递单号」列；
          · AI 核验结论（含「查看核验详情」按钮与「AI 识别中」提示行）→ 行操作区的「更多 → AI 核验」——
            核验是「拿着结论去原件上核对依据」的动作，配着 AI 批注看才是它该有的样子；识别中态由「AI 风险」列表达；
          · 核验 / 修改留痕 → 本表下方的一行小字（见下）。
        */}

        {/* 留痕 —— 审计要留痕，但一行小字足够（v2.38 起不再占一整块字段网格） */}
        {(main.verifiedAt || main.lastEditedAt) && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--c-text-3)' }}>
            {main.verifiedAt && (
              <>
                核验人 {main.verifiedBy ?? '—'} · 核验时间{' '}
                <span className="num">{main.verifiedAt}</span>
              </>
            )}
            {main.verifiedAt && main.lastEditedAt ? ' · ' : null}
            {main.lastEditedAt && (
              <>
                最近修改 <span className="num">{main.lastEditedAt}</span>
                {main.lastEditedBy ? `（${main.lastEditedBy}）` : ''}
              </>
            )}
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
                onClick={() => openUpload('往来函证')}
              >
                上传往来函证回函
              </Button>
              <Button
                icon={<CloudUploadOutlined />}
                onClick={() => openUpload('银行函证')}
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
      {/*
       * 页面头 —— 面包屑 + 标题 + 统计。
       * 顶部导航条已删除（用户决定：集成进真实系统后那部分由外层提供），
       * 于是「我在哪」与「今天还有几件事」两个问题都由这里回答。
       * 统计从工具栏右端的 13px 灰字提升上来，也不再与分页重复。
       */}
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Breadcrumb items={[{ title: '函证系统' }, { title: '回函管理' }]} />
          <h1 className="page-head__title">
            回函管理
            <small>
              共 <b className="num">{total}</b> 封函证 · 待人工确认{' '}
              <b className="num">{pendingVerify}</b> · 已完成 <b className="num">{verifiedCount}</b>
            </small>
          </h1>
        </div>
      </div>

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
          {/* 三个下拉统一 140px —— 此前是 130 / 150 / 140 三种宽度，
              同一行控件左边界不齐，扫视时看着像没对齐 */}
          <Col flex="140px">
            <Select
              allowClear
              placeholder="发函方式"
              style={{ width: '100%' }}
              value={form.sendMethod}
              onChange={(v) => setForm({ ...form, sendMethod: v })}
              options={['邮寄发函', '电子发函', '跟函'].map((v) => ({ label: v, value: v }))}
            />
          </Col>
          <Col flex="140px">
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
            onClick={() => openUpload('往来函证')}
          >
            上传往来函证回函
          </Button>
        </Tooltip>

        <Tooltip
          title={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>接收银行函证回函（只需回函件）</div>
              <div>· 格式一 / 格式二数据已存于函证系统，识别回函后直接与系统数据逐项核对</div>
              <div>
                · 检测（<b>4 项</b>）：阶段一「识别四要素」；阶段二「询证事项逐项核对 / 是否有印章 /
                印章名称与被询证单位一致」——<b>不检测手写体</b>，也<b>不检测骑缝章</b>
              </div>
              <div>· 无二维码，按「银行名称 + 被审计单位 + 函证起止日期」四要素归属</div>
            </div>
          }
        >
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => openUpload('银行函证')}
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

        {/* 统计已上移到页面头；此处只留「识别中」这一条**当下状态**提示 */}
        <span style={{ marginLeft: 'auto' }}>
          {recognizing && (
            <span style={{ fontSize: 13, color: 'var(--c-primary)' }}>
              ● 识别中，结果将自动写入列表
            </span>
          )}
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
          scroll={{ x: 1240 }}
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
            /* 不再显示「共 N 条」—— 工具栏右侧已有一组统计（共 / 待人工确认 / 已完成），
               同一个数字在一屏里出现两次属于纯冗余 */
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

      {/* 「切分」两步弹窗（往来专属，v2.35）—— ① 文件识别录入 → ② 数据核对 → 进入识别工作台 */}
      <SplitEntryModal
        open={split?.step === 'entry'}
        onCancel={() => setSplit(null)}
        onNext={(v) => setSplit({ step: 'check', file: v.file })}
      />
      <SplitCheckModal
        open={split?.step === 'check'}
        file={split?.file}
        onCancel={() => setSplit(null)}
        onConfirm={onSplitConfirm}
      />

      {/* 「上传银行函证回函」小弹窗（v2.47）—— 银行不切分、无需额外字段，选完文件即开始识别 */}
      <BankUploadModal
        open={bankUpload}
        onCancel={() => setBankUpload(false)}
        onConfirm={onBankUploadConfirm}
        demoLabel={DEMO_LABEL[TYPE_RULE['银行函证'].presetBatchId]}
        onDemo={onBankDemo}
      />
    </div>
  )
}
