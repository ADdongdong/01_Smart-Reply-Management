import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Button,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudUploadOutlined,
  FileExcelOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { EXPRESS_IMPORT_RESULT } from '@/mock/expressImport'
import { DEMO_LABEL, PRESET_BATCHES } from '@/mock/recognition'
import { TYPE_RULE, consistencyOf, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import { AI_REVIEW_MATCH_CARRIER, aiReviewStateOf } from '@/config/aiReview'
import { replyTaskEntryPanelKeyOf } from '@/config/replyTasks'
import AiReviewCell from '@/components/AiReviewCell'
import { SmartCheckProgress, SmartCheckStatus } from '@/components/SmartCheckCells'
import SplitEntryModal from '@/components/SplitEntryModal'
import type { SplitFileInfo } from '@/components/SplitEntryModal'
import BankUploadModal from '@/components/BankUploadModal'
import type { BankUploadFile } from '@/components/BankUploadModal'
import ExpressImportDrawer from '@/components/ExpressImportDrawer'
import type {
  AiReviewKey,
  ConfirmationType,
  RecognitionTask,
  ReplyProgress,
  ReplyRecord,
} from '@/types'
import VerificationModal from '@/components/VerificationModal'
import RecordDetailModal from '@/components/RecordDetailModal'
import ReplyDocEntryModal from '@/components/ReplyDocEntryModal'
import ReplyResultModal from '@/components/ReplyResultModal'
import { MatchTag, ProgressSteps } from '@/components/Marks'
import { StatusTag } from '@/components/StatusTag'
import { afterPaint } from '@/utils/afterPaint'

/** 四个业务入口的全屏弹窗 */
type ModalKind = 'view' | 'verify' | 'doc' | 'result'

/* ------------------------------------------------------------------ */
/* 回函进度 —— 用户视角的「下一步要做什么」                              */
/* ------------------------------------------------------------------ */

/**
 * 进度列的悬停说明 —— **只补一句「为什么」**，不复述按钮动作（动作已直写在操作列）。
 *
 * v2.45 精简：原文案每段都是一整句流程描述（如「这一步同时完成 AI 六项检测的人工确认与留痕
 * —— 全流程唯一的核验签字动作」），与弹窗页脚同义重复了两处。
 */
const PROGRESS_HINT: Record<ReplyProgress, string> = {
  待确认快递信息: '确认即完成核验留痕',
  待填写回函结果: '「核查事项复核」里采纳的值已带入表单，采纳或修改后保存即归档',
  /* v3.28：「更多」已移除 —— 步骤条本身随时可点开（回看 / 补正都走它） */
  已完成: '如需修正，点本列的步骤条打开对应步骤；改后仍保持「已完成」并记录修改人与时间',
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
}

const EMPTY_FILTER: FilterState = {}

/**
 * 回函管理列表 —— **按函证类型分页**（v3.05，用户要求）。
 *
 * 往来函证与银行函证在真实系统里是**两张控制表、两个菜单**，不会同页展示，
 * 故这里由路由传入 `type`，一个组件渲染一类：
 * · 列表只归并本类函证；
 * · 主操作行只有**本类的那一个**上传入口（原来两队并列，是"同页混展示"的残留）；
 * · 页面头写明是哪一类，并给一个到另一类的切换（原型没有外层菜单，用切换控件代表另一个菜单）。
 */
export default function ReplyList({ type }: { type: ConfirmationType }) {
  /* `modal` 随删除入口一并移除（v3.28）—— 列表已没有二次确认类动作 */
  const { message } = App.useApp()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  /** 本页是银行还是往来 —— 页面头 / 列标题 / 上传入口都据此变 */
  const isBank = type === '银行函证'

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
    /**
     * 打开核验详情时**落在哪一页签**（v3.28 立；v3.31 起由列表那一格传入"第一个未完成的事项"；
     * v3.33 起改传**页签 key**）—— 因为待办现在也包含"回函结果必填项"，而它落在核验页
     * 第 4 项（「回函结果补充」）而不是任何一个 AI 页签上，见 `replyTaskEntryPanelKeyOf`。
     * 详情页据此直接落在它上面，省掉"进去再在页签里找一遍"。
     */
    panelKey?: string
  } | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  /*
   * 新入表的行播完插入动效后**清掉标记**（v3.29）。
   *
   * 为什么必须有这一步、而不是让标记一直挂着：动效本身是一次性的（`animation` 播完即止），
   * 但**不清理就没法再播**—— 同一封函证走「重新识别」会再次入表，那时 `insertedRowIds`
   * 里若已有它，`row-insert` 类不会重新挂上，行就"悄悄出现"了。
   * 清除放在**过渡结束后**（1600ms > CSS 里 900ms 的动效时长），避免动画途中被摘掉。
   */
  useEffect(() => {
    if (!state.insertedRowIds.length) return
    const t = window.setTimeout(() => dispatch({ type: 'CLEAR_INSERTED' }), 1600)
    return () => window.clearTimeout(t)
  }, [state.insertedRowIds, dispatch])
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
   * 银行回函上传「确定」—— 直接开始识别并进入**归属界面**（`START_BATCH` 会一并置 `assignOpen`）。
   * 不再多一次「确认归属」：银行回函无需切分，上传弹窗的「确定」即用户的一次明确表态，
   * 与该类型在工作台内靠四要素算归属的机制不冲突。
   */
  const onBankUploadConfirm = (files: BankUploadFile[], faceSheetLast: boolean) => {
    setBankUpload(false)
    const batch = PRESET_BATCHES[TYPE_RULE['银行函证'].presetBatchId]()
    const first = files[0]
    dispatch({
      type: 'START_BATCH',
      /* `faceSheetLast` 由①上传弹窗指定（v2.83）：为真时②的切分初稿会把末页预切成面单段 */
      batch: first ? { ...batch, fileName: first.name, fileSize: first.size, faceSheetLast } : { ...batch, faceSheetLast },
      uploadType: '银行函证',
    })
    message.success('已开始识别 —— 请切分这份回函并逐段指定归属，点「确定」后回列表等结果')
  }

  /** 银行弹窗里的「用演示数据体验」—— 与上传同路，只是用内置批次 */
  const onBankDemo = () => {
    setBankUpload(false)
    dispatch({
      type: 'START_BATCH',
      batch: PRESET_BATCHES[TYPE_RULE['银行函证'].presetBatchId](),
      uploadType: '银行函证',
    })
    message.success('已开始识别 —— 请切分这份回函并逐段指定归属，点「确定」后回列表等结果')
  }

  /**
   * 银行弹窗里的**「智能识别」**（v3.26）—— 与上传同路，差别只在 `aiDraft: true`：
   * 归属界面的初稿直接是识别结果（切分 + 归属 + 快递单号），用户确认即可。
   *
   * ⚠️ 这条路的可用性取决于客户侧 AI 资源（识别率 / 速度）——**没文件也能点**，
   * 原型按内置样例题跑；真实施时若不启用，把弹窗里这个入口去掉即可（手动路完全不受影响）。
   */
  const onBankSmartSplit = (files: BankUploadFile[], faceSheetLast: boolean) => {
    setBankUpload(false)
    const batch = PRESET_BATCHES[TYPE_RULE['银行函证'].presetBatchId]()
    const first = files[0]
    dispatch({
      type: 'START_BATCH',
      batch: first ? { ...batch, fileName: first.name, fileSize: first.size, faceSheetLast } : { ...batch, faceSheetLast },
      uploadType: '银行函证',
      aiDraft: true,
    })
    message.success('智能识别完成 —— 切分、归属与快递单号都已就绪，请核对后点「确定」')
  }

  /**
   * 往来回函：① 选好文件 → 启动批次并进**归属界面**（v2.60）。
   *
   * 此前这里是两步（① 文件识别录入 → ② 数据核对弹窗），核对点「确定」才启动识别。
   * 现在把「数据核对」并入了**归属界面**（`AssignView`）—— 因为它与银行侧的归属
   * 本来就是**同一件事**（用户原话：「往来函证，这一步，就是在把回函文件和函证数据
   * 进行匹配，点了确定以后，就开始智能识别了」）。
   *
   * 并的收益不只是少一次弹窗：两步时用户核完切分、点确定，**又被推到一个写着
   * 「本批回函已全部归属完成」的全屏界面**（因为往来的归属由二维码定死，那个界面
   * 没有待办可做）—— 现在这个冗余屏没有了，核完直接点「确定」回列表。
   */
  const onSplitFileConfirm = (v: { file?: SplitFileInfo; faceSheetLast?: 'yes' | 'no' }) => {
    setSplit(null)
    const batch = PRESET_BATCHES[TYPE_RULE['往来函证'].presetBatchId]()
    /* 「每段尾部是否还有一页快递面单」随批次带下去（v2.76）—— 归属界面的切分结果据此把
     * **段尾面单识别出的快递单号**显示在每一段上（此前这一项只是个校验项、没有下游消费者） */
    const merged = { ...batch, faceSheetLast: v.faceSheetLast === 'yes' }
    dispatch({
      type: 'START_BATCH',
      batch: v.file ? { ...merged, fileName: v.file.name, fileSize: v.file.size } : merged,
      uploadType: '往来函证',
    })
    message.success('已开始识别 —— 请先核对切分与归属，点「确定」后回列表等结果')
  }

  /**
   * 往来弹窗里的「用演示数据体验」（v3.06）—— 与「下一步」**同一条路**，只是用内置批次。
   *
   * 「最后页是否快递面单」按演示批次的**实际形态**给定（A 批 9 页 / 3 段，每段尾部各一页面单），
   * 不在演示路径上弹这个必选项：演示的意图是"没文件也能一步看到结果"。
   */
  const onCurrentDemo = () => {
    setSplit(null)
    dispatch({
      type: 'START_BATCH',
      batch: { ...PRESET_BATCHES[TYPE_RULE['往来函证'].presetBatchId](), faceSheetLast: true },
      uploadType: '往来函证',
    })
    message.success('已开始识别 —— 请先核对切分与归属，点「确定」后回列表等结果')
  }

  /* ------------------------- 归并、筛选与排序 ------------------------- */

  /* 只归并**本类**函证 —— 两类是不同的控制表，不混在一页（v3.05） */
  const rows = useMemo(
    () => groupByConfirmation(state.records).filter((r) => r.type === type),
    [state.records, type],
  )

  const total = rows.length

  /*
   * **记录 → 识别任务**（2026-10-14）—— 「智能核查状态 / 智能核查进度」两列要读**过程**
   * （任务上的 `stages`），而记录上只有**事实**（结论、留痕）。两者的桥是 `task.recordId`
   * （落库时写回任务，见 `finalizeTask`）。
   *
   * 用 Map 而不是每次 `find`：这一页每 tick 都会重渲染（`TICK` 600ms），
   * 两列 × 每行各 `find` 一次是 N×M 次线性扫。
   *
   * **查不到就是没有任务** —— 演示种子行与历史数据都不是本次核查产生的，
   * 组件按"核查早已跑完"处理（见 `SmartCheckCells` 的口径）。
   */
  const taskByRecordId = useMemo(() => {
    const map = new Map<string, RecognitionTask>()
    state.batches.forEach((b) =>
      b.tasks.forEach((t) => {
        if (t.recordId) map.set(t.recordId, t)
      }),
    )
    return map
  }, [state.batches])

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
        /* 风险筛选随「AI 风险」列一并移除（2026-10-14，用户：「去掉 AI 风险列，完整去掉」）——
           列的取值与文案原本就和筛选项同源（`RISK_MAP`，已随该列删除），列没了筛选也就没有对象 */
        return true
      })
      /*
       * **只按回函时间倒序（v3.12）** —— 原来还有一条「待人工确认的排在前面」。
       * 那一条的后果是：**某行一旦处理完就不再"待人工确认"，当场跳到列表别处**
       * （用户要求：「如果某个函证数据完成了，也不要修改整体表单数据的顺序」）。
       * 「还有哪几封没处理」由行内步骤条表达即可（v3.20 起页面头不再给统计），
       * 不需要靠"随时重排行序"来提示 —— 排序键只留**不因处理动作而变**的那一个。
       */
      .sort((a, b) =>
        (b.main.replyDate ?? b.main.sendDate).localeCompare(a.main.replyDate ?? a.main.sendDate),
      )
  }, [rows, filter])

  const activeChips = useMemo(() => {
    const chips: { key: keyof FilterState; label: string }[] = []
    if (filter.keyword) chips.push({ key: 'keyword', label: `关键字：${filter.keyword}` })
    if (filter.sendMethod) chips.push({ key: 'sendMethod', label: `发函方式：${filter.sendMethod}` })
    if (filter.progress) chips.push({ key: 'progress', label: `回函信息录入进度：${filter.progress}` })
    return chips
  }, [filter])

  const query = () => setFilter(form)
  const reset = () => {
    setForm(EMPTY_FILTER)
    setFilter(EMPTY_FILTER)
  }

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

  /*
   * 删除入口随「更多」一并移除（v3.28，用户要求"去掉更多和更多下的所有操作"）——
   * 原先这里的 `confirmDelete` 与 `REMOVE_CONFIRMATION` 已无人调用。
   * 动作本身在 store 里保留备用，将来若改用别处承载删除（如查看详情内的次要动作），
   * 把这段确认弹窗接回去即可，不必重写。
   */

  /* ------------------------------------------------------------------ */
  /* 「回函是否相符」取值 —— 列表列用                                     */
  /* ------------------------------------------------------------------ */

  /**
   * 相符性判定已收敛到 `evaluateMatch`（`services/replyRule.ts`）单一出口：
   * · 人工填写过回函结果 → 以人工值为准；
   * · 银行函证 → 只看「回函 × 系统内询证事项逐项核对」（印章不作相符性依据）；
   * · 往来函证 → 印章落章区域判定（口径不变）。
   * 返回值里仍有 `byAi`，但**列表的「回函是否相符」已不再用它**（v3.29）：
   * 那一格现在只分「未确认 / 待人工判定 / 已确认后的结论」三态，不再靠 `✦` 与虚线教人读来源
   * （用户：「是否相符，不需要 ai 标识和虚线，这个是否相符，就是用户确认之后的结果」）。
   * `byAi` 仍供「回函结果填写」页等处使用。
   */
  const matchOf = evaluateMatch

  /* ------------------------- 列定义 ------------------------- */
  /* 说明：不使用组间竖分隔线 —— 分组信息由列顺序与表头文字承担 */

  const columns: ColumnsType<ConfirmationRow> = [
    /* ---------- 函证信息 ---------- */
    {
      /* 银行函证的被询证单位就是银行，故这一页把「（银行）」写进表头（v3.05） */
      title: isBank ? '被询证单位（银行）' : '被询证单位',
      key: 'entity',
      /*
       * 196 → 190（2026-10-14，为两张宽列让位，但只让 6px）。
       *
       * ⚠️ 这列**必须按最长的单位名量**：实测「国泰君安证券股份有限公司」（12 字）内容宽约 170，
       * 一度收到 170 ⇒ 那一行**溢出列外**（就是它把表格挤出一截）。196 的余量是给长名的，
       * 不是给"最常见的名字"的 —— 与「操作」列要量失败行是同一条教训。
       */
      width: 190,
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
      /* 类型标签去掉了（v3.05）：本页只有一类函证，每行再标「往来 / 银行」是重复信息 */
      width: 124,
      render: (_, row) => <span className="num">{row.confirmationNo}</span>,
    },
    /* ---------- 智能核查状态 / 进度（2026-10-14 新增两列） ---------- */
    /*
     * 用户原话：「上传完函证回函、切分完点完确认以后，**函证回函数据直接落入表格**，
     * 智能核查过程的显示的位置，**放在表单中**，因此表单要增加两个字段：① 智能核查状态：
     * 未开始、正在核查（需要有动效）、已核查；② 智能核查进度：类似 AI 核验事项字段展示的内容，
     * 每识别完一个智能核查项，该项前面加一个完成标识。核查进度要和真实核查进度进行联动，动态展示」。
     *
     * **位置：紧跟「函证编号」之后、业务结论之前** —— 这两列回答的是"这一行现在能不能看"，
     * 是结论的**前置条件**：核查没跑到那一步时，「回函是否相符」本来就没有结论可显示
     * （那格此刻显示中性「识别中」）。故顺序是「是谁 → **核到哪了** → 结论 → 人处理了没有 → 下一步」。
     *
     * **两列数据都来自识别任务**（`taskByRecordId`），随 `TICK` 每 600ms 重算 —— 这就是用户要的
     * 「和真实核查进度联动、动态展示」；跑完那一刻旗子**全变蓝**、状态定格为「已核查」。
     */
    {
      title: '智能核查状态',
      key: 'smartCheckStatus',
      width: 120,
      render: (_, row) => <SmartCheckStatus task={taskByRecordId.get(row.main.id)} />,
    },
    {
      title: '智能核查进度',
      key: 'smartCheckProgress',
      /*
       * **350**（2026-10-14 由 330 加宽）—— 标识从 12px 加大到 20px 后，实测内容宽由 321
       * 涨到 **339**，加右内边距 8 需要 **347**，故取 350。
       * （此前口径：内容 307 + 两侧内边距 ⇒ 330 —— 这条列宽一直是**按实测内容反推**的，
       * 见表格那处「列宽合计」的注释；若不跟着加，长出来的那 6px 会**压到右边那列上**。）
       * 它与右边「核查事项复核」共用同一份事项清单；但 v3.31 起右边那格**只报一条状态**
       * （不再逐项），故"两列都得放得下全部项、否则一列换行另一列不换行"那条约束已作废 ——
       * 逐项只在本列，本列的宽度只需按**它自己**的内容量（即上面这个 350）。
       */
      width: 350,
      render: (_, row) => (
        <SmartCheckProgress task={taskByRecordId.get(row.main.id)} type={row.main.type} />
      ),
    },
    /* ---------- 回函是否相符 ---------- */
    /*
     * 用户诉求（v2.25）：「人工核验」列前面的 6/6 从用户角度不直观 ——
     * 6/6 是**系统内部的检测点计数**，而业务人员看列表最想知道的是「**这封回函到底相符吗**」。
     * 故独立成列：给结论 + 区分结论**来自 AI 建议还是人工确认**（不相符时悬停看原因）。
     *
     * 位置：紧随「被询证单位 / 函证编号」——
     * 相符与否是首位业务结论（2026-10-14 之前它后面还跟着「AI 风险」列，该列已移除）。
     */
    {
      title: '回函是否相符',
      key: 'match',
      width: 130,
      render: (_, row) => {
        /*
         * **识别失败**的行（v3.29）—— 不显示相符性结论：识别没过，结论无源，
         * 硬套一个「相符 / 不相符」比留空更误导。用中性档（不是红档）：
         * 红在站内是"判定了不相符"的意思，而这里恰恰是**没判出来**（见 `MatchTag` 的档位口径）。
         */
        if (row.main.recognitionFailed) {
          return (
            <StatusTag
              tone="neutral"
              tip={
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>{row.main.recognitionFailReason ?? '识别失败'}</div>
                  <div style={{ marginTop: 2 }}>
                    该封未得出识别结论 —— 可在「操作」列点「重新识别」重跑，或直接人工核对
                  </div>
                </div>
              }
            >
              识别失败
            </StatusTag>
          )
        }
        const m = matchOf(row.main)
        return (
          <MatchTag
            matched={m.matched}
            basis={m.basis}
            reasons={m.reasons}
            type={row.main.type}
            pending={isRecognitionPending(row.main)}
            /*
             * 这一格是「**用户确认之后的那个结果**」（v3.29）—— 故把承载相符性的那一项
             * （往来＝印章识别 / 银行＝回函是否相符检测）在「核查事项复核」里的处置结果传给它：
             * 未处理 ⇒ 「未确认」，不采纳 ⇒ 「待人工判定」，采纳 ⇒ 如实给结论。
             * 结果页自己填过 `resultInfo.matched` 也算确认过（人工值优先，与 `evaluateMatch` 一致）。
             */
            review={aiReviewStateOf(row.main, AI_REVIEW_MATCH_CARRIER[row.main.type])?.status}
            filled={row.main.resultInfo?.matched != null}
          />
        )
      },
    },
    /* ---------- AI 风险列已移除（2026-10-14） ---------- */
    /*
     * 用户原话：「**去掉 AI 风险列，完整去掉**」⇒ 列、筛选项（含条件 chip 与 `FilterState.risk`）
     * 一并删除；`RiskTag` / `RISK_MAP` / `RISK_ORDER` 已于 2026-10-14 随「AI 风险」一并删除（
     * 核验详情顶部仍挂着一枚，见 `VerificationModal`）。
     *
     * 三条连带后果（都是有意的、不是漏改）：
     * · **列表上不再有任何风险表达** —— 风险等级此后只在核验详情里可见；
     * · v3.29 刚加的那枚灰色「识别错误」随列一起消失 —— 识别失败的信号仍在两处：
     *   「回函是否相符」列写中性「识别失败」、操作列给「重新识别」；
     * · 「行首不加红色竖条」那条旧口径（2026-09-20 定，理由是"风险等级已由本列表达"）
     *   **不再有依据**，但也不因此把竖条加回来 —— 见表格 `rowClassName` 处的说明。
     */

    /*
     * v2.37 移除「人工核验」列 —— 它与「回函进度」列是**同一事实的两种画法**：
    /*
     * v2.37 移除「人工核验」列 —— 它与「回函进度」列是**同一事实的两种画法**：
     * `verifyStatus` 只在「确认回函快递信息」的首次确认时置为 verified，
     * 而同一次 dispatch 也把进度推到「待填写回函结果」，二者严格一一对应
     * （待确认快递信息 = 待核验；待填写回函结果 / 已完成 = 已核验）。
     *
     * 既然每个环节都要人工签字，「签过字」就是**默认背景、不是信息量** ——
     * 同一件事在相邻两列各说一遍，只会多占 104px 与一次扫视。
     * 核验人 / 核验时间**下沉到展开行的「留痕」区块**（审计要留痕，列表不必占一列）。
     * （2026-10-14 补充：那块留痕也已撤掉，这几项在任何列表位置都不再展示 —— 数据仍在记录上。）
     */

    /* ---------- 核查事项复核（v3.28 立，v3.29 定名「AI 核验事项」，v3.30 改今名） ---------- */
    /*
     * 用户口径：「表单数据，需要增加一个 ai 识别字段区域，该区域包含 1、回函一致性识别
     * 2、印章识别 3、手写体识别……每一条回函数据，是由多个需要用户完成的 todo 事项完成的，
     * 完成所有的核验事项，这个回函数据任务就完成」。
     *
     * 位置：**紧邻「回函是否相符」之后、回函进度之前**（2026-10-14 之前它前面还有「AI 风险」列，
     * 该列已移除）—— 阅读主线是「谁（被询证单位）→ 结论（相不相符）→ **AI 给了什么、我处理了没有**
     * → 下一步做什么」。放在进度之前，是因为这些待办正是"往下走"之前必须先过的关；
     * 进度列只回答"流程走到哪一步"。
     *
     * 清单按类型取（往来三项 / 银行两项），见 `config/aiReview` —— 那里是单一数据源，
     * 事项详情页与「回函结果填写」页读的是同一份，不各写一套。
     *
     * **列名（v3.29 定稿「AI 核验事项」）** —— 这一格的名字改过三轮，第三轮才落定：
     *
     * ① 原名「AI 识别」：用户判定它"看不出这件事要人来定"——
     *    「**AI 识别这个字段，这个名字，用户不能直接感知到这个是需要人去确定的**」；
     * ② 改为「AI 待确认」：保留来源、点明要你点头，但只说了"机器给的东西要你确认"，
     *    **没说完这件事的终局**；
     * ③ 试过**随复核进度动态翻转**（未做完＝「AI 核验事项（待复核）」、全做完＝
     *    「AI 核验事项（已人工复核 ✓）」，按本类全部函证的处置情况算）——
     *    用户否掉：「**样子也不太对，列名还叫 AI 核验事项吧，然后也不动态变化了**」。
     *    否得有道理：列名是**列的标识**，不是一枚会变的仪表 —— 表头随数据变脸，
     *    用户两次看同一列会以为换了列；而且"做完没有"本就是**逐行**的事实，
     *    行内那一格（`AiReviewCell`）已经说了，表头再汇总一次是第二处表达。
     *
     * 现名「**核查事项复核**」（v3.30 改）：用户原话「AI 核验事项字段改成：核查事项复核」——
     * 名字点出**要人做的动作**（复核）而不是**内容来源**（AI）：来源已由格内那枚 `✦`
     * 与详情里的识别依据交代，而这一列存在的理由就是"等你复核"。
     * 它仍**不预设**这一列已办还是待办 —— 状态由格内的勾选框 + 状态词表达，
     * 表头只管"这一列是什么"（与上面「智能核查状态」列的分工不冲突：那一列是**机器**跑到哪，
     * 这一列是**人**复核到哪）。
     *
     * ## v3.31：格内由"逐项清单"收成"整条状态"
     *
     * 用户原话：「**这一列就展示：待复核、已复核**。……因为前面已经有 AI 核查进度展示具体进行了
     * 哪些 AI 核查项目，所以，这里就不展示具体的哪些核查项了，只需要告诉用户，要去做 AI 核查。」
     *
     * 于是"具体有哪几项、哪几项还没做"交给左边「智能核查进度」列（机器逐项），这一格只回答
     * "**人这边还有没有要做的事**"：`待复核 · 剩 N 项` / `已复核`。格内的详略与悬停明细见
     * `AiReviewCell` 的头注释，整条状态的判定口径见 `config/aiReview` 的 `aiReviewSummaryOf`。
     */
    {
      title: '核查事项复核',
      key: 'aiReview',
      /*
       * 沿革：236（v3.28 建）→ 300（v3.29）→ 360（2026-10-14）→ 480（v3.30）→ **160**（v3.31）。
       *
       * 中间那三版都是按"**3 项并列**"的内容宽反推的（v3.30 那版：3 项文字链 + 勾选框 + 状态词
       * ＝ 473px ⇒ 480）。v3.31 格内收成**一个状态**，内容只剩：
       * **勾选框 16 + 「待复核」3 字 ≈ 39 + 「· 剩 3 项」≈ 48 + `✦` 10 + 三处 4px 间距 12
       * + 两侧内边距 16 ≈ 145** ⇒ 取 **160**。
       * 与那三版同一条教训：列宽按**最坏那一行**量（这里是"待复核 + 剩 3 项"那一行），
       * 不按"最常见的样子"量 —— 见「操作」列与「被询证单位」两处的注释。
       */
      width: 160,
      render: (_, row) => (
        <AiReviewCell
          record={row.main}
          /*
           * 点这一格 → 进原来那套 AI 智能核验详情，**默认落在第一个未复核项**
           * （`aiReviewEntryOf`；全部复核完则落第一项）—— 省掉"进去再在页签里找一遍"。
           * 详情内照旧可切页签逐项复核，页脚采纳 / 不采纳后自动关窗（v3.29 口径）。
           */
          onOpen={() =>
            setActiveModal({
              kind: 'verify',
              recordId: row.main.id,
              /* 落点＝**第一个未完成的事项**（AI 项 → 它自己的页签；必填项 → 第 4 项） */
              panelKey: replyTaskEntryPanelKeyOf(row.main),
            })
          }
        />
      ),
    },
    /* ---------- 是否重新发函 —— 该列已移除（v3.28） ---------- */
    /*
     * 用户要求：「是否重新发函字段，不展示，因为下方的下拉内容，用户点开后可以看到是否重新发函」。
     *
     * 它表达的是「该函证有几次回函」这一**客观事实**，而展开行的「回函记录」表本就逐次列出
     * （第 N 次 / 当前有效），v3.28 起又在「回函次序」列补了一枚「重新发函」标签 ——
     * 信息一点没少，却省下 112px 的常驻列。
     *
     * 沿革（v2.26 立、v2.53 两种取值都给标识、v3.28 移除）：它一度是**倒数第二个字段**，
     * 那是"列表要承担全部事实"的思路；现在列表承担的是**待办与结论**，事实类信息下沉到展开行。
     */
    /* ---------- 回函进度 ---------- */
    /*
     * 位置（用户指定）：**倒数第一个字段、紧邻操作列**。
     * 这样「进度 → 下一步：xxx」与右侧操作列的主按钮**相邻可读** ——
     * 读到「下一步做什么」时，动作就在紧右边，不需要横向来回找。
     */
    {
      title: '回函信息录入进度',
      key: 'progress',
      /* v2.51：两行文字 → 步骤条（两个步骤 + 分隔 + 箭头），需要更宽一点，176 → 200 */
      width: 200,
      render: (_, row) => {
        const p = row.main.replyProgress
        return (
          <Tooltip title={PROGRESS_HINT[p]}>
            {/*
             * 步骤条（v2.51）—— 三个进度值 = **两个步骤的三种完成组合**（见 `ProgressSteps`）。
             *
             * 步骤名可点：未完成的用于推进、已完成的用于回看，与操作列主按钮**走同一入口**
             * （`setActiveModal`），故不新增路径、也不会出现「两处入口行为不一致」。
             * 已完成行因此多出两个回看入口 —— 原先只能从「更多」里找。
             */}
            <span style={{ display: 'inline-flex', cursor: 'help' }}>
              <ProgressSteps
                /*
                 * 两步的完成证据**各自给**（v3.12）—— 见 `ProgressSteps` 的说明。
                 * 它们与 `replyProgress` 是两回事：进度只表达"下一步做什么"。
                 */
                expressConfirmed={row.main.verifyStatus === 'verified'}
                /*
                 * 「回函结果」的完成证据 = **有 `resultInfo` 或进度已是「已完成」**。
                 * 后半截是给**存量数据**留的：演示数据（以及历史落库的行）里"已完成"
                 * 并不都带着 `resultInfo` —— 实测漏了这一截就会让那些行**掉勾**
                 * （回归检查当场逮到：广东证券那行曾显示「快递信息 ✓ / 回函结果 ○」）。
                 */
                resultFilled={!!row.main.resultInfo || row.main.replyProgress === '已完成'}
                onOpenExpress={() => setActiveModal({ kind: 'doc', recordId: row.main.id })}
                onOpenResult={() => setActiveModal({ kind: 'result', recordId: row.main.id })}
              />
            </span>
          </Tooltip>
        )
      },
    },
    /* ---------- 操作 ---------- */
    /*
     * 「查看」—— **每行只剩这一个**（v3.28：连「更多」也去掉了）。
     *
     * 用户原话：「操作界面，去掉更多和更多下的所有操作」。那四项的去处各自都有落点，
     * 所以不是"功能被删掉"，而是**同一件事不再有第二处入口**：
     *   · **AI 核验** → 并进「核查事项复核」格 —— 点那一格直接进核验详情（默认落在**第一个未复核项**），
     *     比从下拉里先进门、再在页签里找一项少两步；
     *   · **回函快递信息 / 回函结果** → 「回函进度」列的步骤条本来就能点（v2.51 起，
     *     v3.12 起两步各自独立、任何阶段都可进），下拉里那两个入口是它的第二处副本；
     *   · **删除** → 一并去掉（用户明确要求"去掉更多下的所有操作"）。
     *     动作 `REMOVE_CONFIRMATION` 在 store 里**保留备用**（将来若改用别处承载删除，不必重写）。
     *
     * 沿革：主按钮在 v2.52 移除（与步骤条重复）→ v3.28 把「更多」也移除，操作列由 120 收到 60 →
     * **v3.29 收回 120**：识别失败的行要多一枚「重新识别」（那是它唯一的出路），60 放不下两枚。
     */
    {
      title: '操作',
      key: 'action',
      /*
       * 60 → 120（v3.29：失败行要多一枚「重新识别」）→ **130**（2026-10-14 实测修正）。
       *
       * 这一列的宽度**不能按"没失败的行"量**：失败那一行才是它的最宽状态
       * （查看 28 + 间距 4 + 「重新识别」图标 14 + 文字 56 ≈ 114，加两侧内边距 16 ⇒ 130）。
       * 一度按 120 给，实测失败行的「重新识别」被 sticky 列裁掉半截 —— 量宽度要量"最坏那一行"，
       * 这条教训与 v2.49 那次「用户指了位置就必须量那个位置」是同一类。
       */
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            style={{ padding: '0 2px' }}
            onClick={() => setActiveModal({ kind: 'view', recordId: row.main.id })}
          >
            查看
          </Button>
          {/*
           * 「重新识别」（v3.29 立；2026-10-14 改口径）—— 只给**核查失败**的行。
           *
           * 它把这一封退回核查队列重跑（见 `RETRY_TASK`）：**行留在原地**，随即退回「核查中」
           * （结论清空、失败标记清空），「智能核查进度」列的旗子**重新一面面由灰转蓝**，跑完定格。
           * 原先是"当即从列表撤下、跑完作为新的一行入表"—— 那是"没识别完不写列表"年代的做法；
           * 现在数据本来就在表里（入表时机已提前），撤下再插回来反而让人以为数据变了，
           * 而**变的只是核查结果**。
           */}
          {row.main.recognitionFailed && (
            <Button
              type="link"
              size="small"
              style={{ padding: '0 2px' }}
              icon={<ReloadOutlined />}
              onClick={() => {
                const task = state.batches
                  .flatMap((b) => b.tasks)
                  .find((t) => t.recordId === row.main.id)
                if (task) dispatch({ type: 'RETRY_TASK', taskId: task.id })
              }}
            >
              重新识别
            </Button>
          )}
        </Space>
      ),
    },
  ]

  /* ------------------------- 展开行 ------------------------- */
  /* 说明：历次回函区块使用浅底而非边框 —— 展开区已有一层卡片，不再嵌套第二个框 */

  /**
   * 回函记录表的列宽模板（v2.38：展开行就是这一张表，当前有效 + 历史**合成同一张**）。
   * 见 `expandedRowRender` 的注释：改造前是「当前有效字段网格 + 历史回函表」，
   * 等于把详情页的字段堆进列表，而那些字段的去处其实都已另有。
   */
  /*
   * 列宽（v3.36 调）：第 1 列要同时放得下「第 N 次 + 当前有效 + 重新发函」三样（约 190px），
   * 原来是 118px + 三个 `fr` —— 三枚记号被挤到换行、顺带把编号挤成两截（用户截图指出的）。
   * 其余各列按内容给最小宽度：编号 14 位 / 日期 19 位 / 单号 17 位，够放就不折行。
   */
  const REPLY_GRID =
    '190px minmax(150px, 1.2fr) 104px minmax(132px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 56px'

  /* 列序（v3.37）：回函次序 · 发函记录编号 · 发函方式 · 回函快递公司 · 快递单号 · 回函数据登记时间 · 回函情况 · 操作
   * —— 发函侧两项跟在编号后（都来自函证系统），回函侧三项（公司 / 单号 / 登记时间）连读。
   *
   * ⚠️ **不展示「回函日期」**（v3.37 末，用户：「去掉回函日期，只保留回函数据登记日期即可」）：
   * 两个时间在同一个位置都摆一遍，用户要先分辨哪个是函件上的、哪个是系统登记的；
   * 实务上真正被引用的是**登记时间**（谁什么时候把这封回函录进系统），故只留它。
   * 字段本身没删（`ReplyRecord.replyDate` 仍在，函件与物流、查看函证里照用）。 */

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
        {/* 窄屏放不下时**横向滚动**（v3.36）—— 原来是 hidden，最后几列会被直接裁掉 */}
        <div style={{ overflowX: 'auto' }}>
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
            {/*
             * 两列表头带说明（v3.36）—— 用户：「这两个字段的含义和由来需要澄清」。
             * 含义与由来直接在列头悬停里给，不额外占版面（原先这两列只有干巴巴一个名字，
             * 「编号为什么有第二种写法」「当前有效那行为什么是 —」都无处可问）。
             */}
            <Tooltip title="本次回函对应的是哪一次发函 —— 一封函证可以发多次函，每次发函一个编号。编号由发函登记时产生、回函落库时随记录带入，用来把「这次回函」对上「那次发函」，与「回函次序」是同一件事的两种表达。">
              <span className="col-help">发函记录编号</span>
            </Tooltip>
            <span>发函方式</span>
            <span>回函快递公司</span>
            <span>快递单号</span>
            <span>回函数据登记时间</span>
            <Tooltip title="这一次回函的相符性结论，与主表「回函是否相符」列同源（往来＝印章落章区域判定；银行＝询证事项逐项核对）。当前有效那一次不在这里重复 —— 主表那一列已经给了它；识别未落定时写「识别中」。">
              <span className="col-help">回函情况</span>
            </Tooltip>
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <span>第 {seq} 次</span>
                  {isCurrent && (
                    <StatusTag size="sm" tone="primary">
                      当前有效
                    </StatusTag>
                  )}
                  {/*
                   * 「重新发函」标签（v3.28）—— 列表上那列已移除（用户：「是否重新发函字段，
                   * 不展示，因为下方的下拉内容，用户点开后可以看到是否重新发函」），
                   * 于是这个事实在这里补上：**共几次回函**在表头上、「这一次算不算数」在上一枚标签，
                   * 本枚回答的是它为什么会有第二次 —— 因为第一次的回函不足以为据。
                   */}
                  {times > 1 && (
                    <StatusTag
                      size="sm"
                      tone="neutral"
                      tip={`该函证共 ${times} 次回函，本行呈现最新一次；历次回函在展开行`}
                    >
                      重新发函
                    </StatusTag>
                  )}
                </span>
                <span className="num nowrap-ellipsis" title={h.sendRecordNo}>
                  {h.sendRecordNo}
                </span>
                <span>{h.sendMethod}</span>
                <span className="nowrap-ellipsis" title={h.expressCompany ?? undefined}>
                  {h.expressCompany ?? '—'}
                </span>
                <span className="num nowrap-ellipsis" title={h.expressNo ?? undefined}>
                  {h.expressNo ?? '—'}
                </span>
                <span className="num">{h.registeredAt ?? '—'}</span>
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
                              note: `这是第 ${seq} 次回函，已被后续回函覆盖，仅供参考；当前有效为第 ${times} 次。本页为只读查看；如需修改，请在列表行的「回函信息录入进度」列点开对应步骤（补正的是当前有效那一次）。`,
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
          · AI 核验结论（含「查看核验详情」按钮与「AI 识别中」提示行）→ 行内「核查事项复核」格
            （v3.28：原先是从操作列「更多 → AI 核验」进、再在页签里找一项）——
            核验是「拿着结论去原件上核对依据」的动作，配着 AI 批注看才是它该有的样子；
          · 核验 / 修改留痕 → 本表下方的一行小字（见下）。
        */}

        {/*
         * **原先这里还有一行留痕小字，已于 2026-10-14 去掉（用户：「去掉这部分的说明」）** ——
         * 内容是「归属来源 自动归属 · 核验人 … · 核验时间 … · 最近修改 …（谁）」，
         * 排在回函记录表下方，字号 12、三级灰。
         *
         * 去掉的代价（写下来，免得日后有人以为是漏了）：**审计复核时那句「这封凭什么
         * 是这家银行 / 谁在什么时候核过它」，列表上再也看不到** —— 展开行只剩记录本身
         * （回函次序 / 记录编号 / 回函日期 / 快递单号 / 回函情况 / 查看）。
         * 数据层**一个字没删**：`assignSource` / `verifiedBy` / `verifiedAt` /
         * `lastEditedBy` / `lastEditedAt` 仍随记录落库并可追溯，将来若改在别处承载
         * （例如「查看函证」工作区的信息区、或核验详情弹窗的页脚），这几个字段直接取用即可。
         */}
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
            <div>上传{isBank ? '银行' : '往来'}函证回函文件后，匹配成功的函证会自动进入本列表</div>
            {/* 空态也只给本类的那一个入口（v3.05：两类各一页） */}
            <div style={{ marginTop: 8 }}>
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => openUpload(type)}>
                {isBank ? '上传银行函证回函' : '上传往来函证回函'}
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
       * 页面头 —— 标题 + 统计。
       *
       * **面包屑已去掉**（v3.29，用户：「去掉这块的内容」）：原型顶部导航条早就删了
       * （集成进真实系统后由外层提供），那三截「函证系统 / 回函管理 / 往来函证回函」
       * 是照着 Ant Design Pro 详情页摆的**层级线索** —— 但本原型只有这两页、
       * 且右侧就有「往来函证 / 银行函证」切换器，路径信息**三处重复**。
       * 真实系统里"我在哪"由外层菜单回答，本页只需回答"这是哪一类、有几封"。
       * 统计从工具栏右端的 13px 灰字提升上来，也不再与分页重复。
       */}
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-head__title">
            {isBank ? '银行函证回函' : '往来函证回函'}
            {/*
             * v3.20：只留总数，「待人工确认 / 已完成」两段统计去掉
             * （用户：「上面不需要人工确认，已完成，这些字样」）——
             * 「还有哪几封没处理」由行内进度步骤条表达，比一个总数更具体。
             */}
            <small>
              共 <b className="num">{total}</b> 封函证
            </small>
          </h1>
        </div>
        {/*
         * 到另一类的切换（v3.05）—— 两类是**两个菜单**，真实系统由外层导航承担；
         * 原型没有外层菜单，故在这里给一个等价的入口，否则进了一类就回不到另一类。
         */}
        <Segmented
          style={{ marginLeft: 'auto' }}
          value={isBank ? 'bank' : 'wanglai'}
          onChange={(v) => navigate(v === 'bank' ? '/reply/bank' : '/reply/wanglai')}
          options={[
            { label: '往来函证', value: 'wanglai' },
            { label: '银行函证', value: 'bank' },
          ]}
        />
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
          {/* 两个下拉统一 140px —— 此前是 130 / 150 / 140 三种宽度，
              同一行控件左边界不齐，扫视时看着像没对齐
              （2026-10-14：「AI 风险」下拉随该列一并移除，本行由三个变两个） */}
          <Col flex="140px">
            <Select
              allowClear
              placeholder="发函方式"
              style={{ width: '100%' }}
              value={form.sendMethod}
              onChange={(v) => setForm({ ...form, sendMethod: v })}
              /* 选项按本类取（v3.37）—— 往来 3 项、银行 4 项（多「电子函证」） */
              options={TYPE_RULE[type].sendMethods.map((v) => ({ label: v, value: v }))}
            />
          </Col>
          <Col flex="140px">
            <Select
              allowClear
              placeholder="回函信息录入进度"
              style={{ width: '100%' }}
              value={form.progress}
              onChange={(v) => setForm({ ...form, progress: v })}
              options={(['待确认快递信息', '待填写回函结果', '已完成'] as ReplyProgress[]).map(
                (v) => ({ label: v, value: v }),
              )}
            />
          </Col>
          {/* 「AI 风险」筛选随列一并移除（2026-10-14）—— 留着就是个筛不出东西的下拉 */}
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
         * 上传入口 —— **只留本类的那一个**（v3.05）。
         *
         * 原来两类按钮**并列在同一页**（v2.27 的形态），那是"两类同页混展示"的残留：
         * 往来函证与银行函证是两张控制表，真实系统里各是一个菜单、各有各的列表与入口。
         * 现在两类各一页，本页只有本类入口；点进去后走哪套流程由 `TYPE_RULE` 决定
         * （往来是「文件识别录入 → 回函归属」两步，银行是单弹窗 + 手工切分）。
         */}
        {isBank ? (
          <Tooltip
            title={
              <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>接收银行函证回函（只需回函件）</div>
                <div>· 格式一 / 格式二数据已存于函证系统，识别回函后直接与系统数据逐项核对</div>
                <div>
                  · 检测（<b>4 项</b>）：阶段一「识别四要素」；阶段二「询证事项逐项核对 / 是否有印章 /
                  印章名称与被询证单位一致」——<b>不检测手写体</b>，也<b>不检测骑缝章</b>
                </div>
                <div>· 无二维码，归属靠你在「回函归属」界面<b>手工切分 + 逐段指定</b>（四要素仅作参考）</div>
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
        ) : (
          <Tooltip
            title={
              <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>接收带二维码的往来函证回函</div>
                <div>· 检测：发函回函一致性 / 印章 / 手写体 / 快递面单</div>
                <div>· 按右上角二维码<b>预切分</b>；切分与归属在「回函归属」界面由你核对或改</div>
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
        )}

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

        {/*
         * 「● 识别中，结果将自动写入列表」这一句**已移除**（v3.28）——
         * 「哪几封在认、认到哪一项」有它自己的去处：v3.28 起先是识别区逐封交代，
         * 2026-10-14 起改为**每行自己的「智能核查状态 / 进度」两列**（更具体：行内看得到），
         * 本行再挂一句笼统的"识别中"是同一件事的第二处表达（项目一路在清理这类重复）。
         */}
        </div>
      </div>

      {/*
       * 独立识别区**已撤除**（2026-10-14）—— 用户把口径整个调过来：
       * 「智能核查过程的显示的位置，**放在表单中**」（即表格里那两列），
       * 不再需要页面上单开一块。组件 `RecognitionProgressBoard` **保留备用、不再挂载**
       * （与 v3.28 退役的悬浮卡 / 全屏识别界面同一处置）。
       */}

      {/* 表格 */}
      <div className="panel" style={{ padding: '4px 0' }}>
        <Table<ConfirmationRow>
          size="small"
          rowKey="confirmationNo"
          columns={columns}
          dataSource={data}
          /* 列宽合计：190+124+120+350+130+160+200+130 = 1404
             （「AI 风险」84 于 2026-10-14 随该列移除；同一天新增「智能核查状态」120 +「智能核查进度」330，
             并把「被询证单位 / 函证编号 / 回函是否相符 / 操作」各收一点、把两张宽列按**实测内容宽**
             反推加宽：进度列内容 307 + 内边距 ⇒ 330，「AI 核验事项」内容 341 ⇒ 360。
             不这么给的直接后果是**宽列的文字压到右边那列上**，2026-10-14 实测溢出 31px。
             同日再调一次：进度列的标识由 12px 加到 20px，内容宽 321 → 339，列宽 330 → 350。
             v3.30 再调一次：「核查事项复核」列每项多了状态词与更大的勾选框，内容 ≈ 473 ⇒ 480，
             合计随之 1604 → 1724。
             v3.31：该格由"逐项清单"收成"整条状态"（内容 ≈ 145 ⇒ 160），合计 1724 → **1404** ——
             这是这一列四次调整里**唯一一次收窄**，也是第一次让整表在常见视口下不再横向滚动。）
             此前依次去掉「是否重新发函」112、新增「AI 核验事项」（v3.28 建 236，v3.29 加宽到 300）、
             操作列 v3.28 收到 60、v3.29 失败行要「重新识别」又收回 120）。
             `scroll.x` **取合计值本身（1404）**：给它一条比合计更大的最小值没用 ——
             2026-10-14 试过 1600，1680 视口下反而**多出一条横向滚动条**（实测 scrollWidth 1640）：
             antd 会再加一份滚动条补偿，越界就那么几像素。取合计值、让各列按容器富余等比放宽即可。
             窄屏（< 合计）则按 1404 横向滚动，各列不再被压扁。 */
             scroll={{ x: 1404 }}
          locale={{ emptyText: emptyNode }}
          /* 行首不加「高风险」红色竖条（2026-09-20 用户要求去掉；2026-10-14 起「AI 风险」列
             也移除了，那条"风险已由本列表达"的理由不再成立 —— 但**不因此恢复竖条**：
             用户当时要的是"列表干净"，不是"换个地方显示风险"；风险等级此后只在核验详情里看）。
             `row-risk-high` 保留给明细表的「差异行 / 未匹配行」——
             那些表没有独立的风险列，需要左侧标记做视觉定位。 */
          /*
           * 两种行上动效，含义不同（别混）：
           * · `row-insert` —— **这一行是刚写入的**（v3.29）：滑入 + 主色高亮一闪，
           *   让「识别完成一条 → 加入回函表单」这个动作看得见；
           * · `row-flash`  —— **这一行变了**（阶段二回填结论后的闪烁提醒）。
           */
          rowClassName={(row) =>
            [
              state.insertedRowIds.includes(row.confirmationNo) ? 'row-insert' : '',
              state.flashRowId === row.confirmationNo ? 'row-flash' : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
          pagination={{
            size: 'small',
            pageSize: 10,
            showSizeChanger: false,
            /* 不再显示「共 N 条」—— 页面标题下已有「共 N 封函证」，
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
      <VerificationModal
        open={activeModal?.kind === 'verify'}
        record={activeRecord}
        /*
         * 从列表那一格点进来的：直接定位到**第一个未完成的事项**所在页签
         * （AI 项 → 它自己的页签；必填项 → 第 4 项「回函结果补充」），
         * 并在页脚给「采纳 / 不采纳」（v3.28；落点口径 v3.33 见 `replyTaskEntryPanelKeyOf`）。
         */
        initialPanelKey={activeModal?.kind === 'verify' ? activeModal.panelKey : undefined}
        onClose={closeModal}
      />
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

      {/*
        往来回函上传（v2.60 起**只剩一步**）—— 选文件即启动识别、并进「归属界面」核对切分。
        原先的「② 数据核对」弹窗已并入归属界面：它与银行侧的归属是同一件事
        （把回函文件与函证数据匹配），拆成两个界面反而让用户多做一次确认。
      */}
      <SplitEntryModal
        open={split?.step === 'entry'}
        onCancel={() => setSplit(null)}
        onNext={onSplitFileConfirm}
        demoLabel={DEMO_LABEL[TYPE_RULE['往来函证'].presetBatchId]}
        onDemo={onCurrentDemo}
      />

      {/* 「上传银行函证回函」小弹窗（v2.47）—— 银行不切分、无需额外字段，选完文件即开始识别 */}
      <BankUploadModal
        open={bankUpload}
        onCancel={() => setBankUpload(false)}
        onConfirm={onBankUploadConfirm}
        onSmartSplit={onBankSmartSplit}
        demoLabel={DEMO_LABEL[TYPE_RULE['银行函证'].presetBatchId]}
        onDemo={onBankDemo}
      />
    </div>
  )
}
