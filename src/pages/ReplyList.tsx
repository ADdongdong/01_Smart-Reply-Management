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
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { EXPRESS_IMPORT_RESULT } from '@/mock/expressImport'
import { DEMO_LABEL, PRESET_BATCHES } from '@/mock/recognition'
import { TYPE_RULE, consistencyOf, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import { ASSIGN_SOURCE_LABEL } from '@/services/bankMatch'
import { AI_REVIEW_MATCH_CARRIER, aiReviewItemsOf, aiReviewStateOf } from '@/config/aiReview'
import AiReviewCell from '@/components/AiReviewCell'
import RecognitionProgressBoard from '@/components/RecognitionProgressBoard'
import SplitEntryModal from '@/components/SplitEntryModal'
import type { SplitFileInfo } from '@/components/SplitEntryModal'
import BankUploadModal from '@/components/BankUploadModal'
import type { BankUploadFile } from '@/components/BankUploadModal'
import ExpressImportDrawer from '@/components/ExpressImportDrawer'
import type { AiReviewKey, ConfirmationType, ReplyProgress, ReplyRecord, RiskLevel } from '@/types'
import VerificationModal from '@/components/VerificationModal'
import RecordDetailModal from '@/components/RecordDetailModal'
import ReplyDocEntryModal from '@/components/ReplyDocEntryModal'
import ReplyResultModal from '@/components/ReplyResultModal'
import { MatchTag, ProgressSteps, RISK_MAP, RISK_ORDER, RiskTag } from '@/components/Marks'
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
  待填写回函结果: '「AI 核验事项」里采纳的值已带入表单，采纳或修改后保存即归档',
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
  /** 风险筛选 = 风险等级取值（高风险 / 中风险 / 低风险 / 未核验），与「AI 风险」列同一套等级（v3.20） */
  risk?: RiskLevel
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
     * 从「AI 核验事项」列某一项打开核验详情时携带（v3.28）——
     * 详情页据此**直接落在被点的那一项**上，省掉"进去再在页签里找一遍"。
     */
    itemKey?: AiReviewKey
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
        /*
         * 风险筛选 = **按当前的风险等级逐档匹配**（高风险 / 中风险 / 低风险 / 未核验，v3.20）。
         * 此前只有「有风险（高+中）」「仅高风险」两档 —— 那是 v2.28 中风险还并入红档年代的口径，
         * 与「AI 风险」列的三色三档对不上（想只看中风险、或想看还没核验的行，都选不出来）。
         */
        if (filter.risk && m.risk !== filter.risk) return false
        return true
      })
      /*
       * **只按回函时间倒序（v3.12）** —— 原来还有一条「待人工确认的排在前面」。
       * 那一条的后果是：**某行一旦处理完就不再"待人工确认"，当场跳到列表别处**
       * （用户要求：「如果某个函证数据完成了，也不要修改整体表单数据的顺序」）。
       * 「还有哪几封没处理」由行内步骤条与「AI 风险」列表达即可（v3.20 起页面头不再给统计），
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
    if (filter.progress) chips.push({ key: 'progress', label: `回函进度：${filter.progress}` })
    if (filter.risk) chips.push({ key: 'risk', label: `AI 风险：${RISK_MAP[filter.risk].text}` })
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
      /* 类型标签去掉了（v3.05）：本页只有一类函证，每行再标「往来 / 银行」是重复信息 */
      width: 132,
      render: (_, row) => <span className="num">{row.confirmationNo}</span>,
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
             * （往来＝印章识别 / 银行＝回函是否相符检测）在「AI 核验事项」里的处置结果传给它：
             * 未处理 ⇒ 「未确认」，不采纳 ⇒ 「待人工判定」，采纳 ⇒ 如实给结论。
             * 结果页自己填过 `resultInfo.matched` 也算确认过（人工值优先，与 `evaluateMatch` 一致）。
             */
            review={aiReviewStateOf(row.main, AI_REVIEW_MATCH_CARRIER[row.main.type])?.status}
            filled={row.main.resultInfo?.matched != null}
          />
        )
      },
    },
    {
      title: 'AI 风险',
      key: 'risk',
      width: 84,
      render: (_, row) => {
        /*
         * **识别错误 / 未识别到结论**的行（v3.29，用户要求）——
         * 用户原话：「AI 风险列还是保持不变，如果存在 AI 未识别到或者识别错误的，
         * 则用灰色标签标注：**识别错误**」。
         *
         * 为什么**替代**而不是与风险标签并排：这种行的风险等级在 store 里记 `none`
         * （识别没过，任何结论都无源，见 `finalizeTask`），渲染 `RiskTag` 会显示「未核验」——
         * 读起来像"还没轮到人工看"，而事实是**这一封没认出来**；两枚标签并排则是一件事说两遍。
         *
         * 灰色（`neutral`）是刻意的：红在站内是"判定了高风险"的意思，而这里恰恰是**没判出来**；
         * 与「回函是否相符」列那枚「识别失败」同一个档位口径（同为中性、同为"结论无源"），
         * 只是各自回答本列的问题：那边答"相符性没有结论"，这边答"风险等级没有依据"。
         */
        if (row.main.recognitionFailed) {
          return (
            <StatusTag
              tone="neutral"
              tip={
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>{row.main.recognitionFailReason ?? '未识别到该项结论'}</div>
                  <div style={{ marginTop: 2 }}>
                    本封识别未得出结果，不记风险等级 —— 可在「操作」列点「重新识别」重跑
                  </div>
                </div>
              }
            >
              识别错误
            </StatusTag>
          )
        }
        return (
          <RiskTag
            level={row.main.risk as RiskLevel}
            reasons={row.main.verification?.riskReasons}
            pending={isRecognitionPending(row.main)}
          />
        )
      },
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

    /* ---------- AI 核验事项（v3.28 立，v3.29 定名） ---------- */
    /*
     * 用户口径：「表单数据，需要增加一个 ai 识别字段区域，该区域包含 1、回函一致性识别
     * 2、印章识别 3、手写体识别……每一条回函数据，是由多个需要用户完成的 todo 事项完成的，
     * 完成所有的核验事项，这个回函数据任务就完成」。
     *
     * 位置：**紧邻「AI 风险」之后、回函进度之前** —— 阅读主线是「谁（被询证单位）→ 结论
     * （相符 / 风险）→ **AI 给了什么、我处理了没有** → 下一步做什么」。放在进度之前，
     * 是因为这些待办正是"往下走"之前必须先过的关；进度列只回答"流程走到哪一步"。
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
     *    行内的圆环（`AiReviewCell`）已经逐项说了，表头再汇总一次是第二处表达。
     *
     * 现名「**AI 核验事项**」：说明来源（AI 认出来的）、说明对象（核验事项）、
     * 且**不预设**它已办还是待办 —— 状态由行内逐项的圆环表达，表头只管"这一列是什么"。
     */
    {
      title: 'AI 核验事项',
      key: 'aiReview',
      /*
       * v3.29 由 236 加宽到 **300** —— 事项现在是**一行文字链**（「印章识别 / 发函回函一致性检测 /
       * 手写体识别」，含间隔实测约 300px），用户明确要求两件事：「这里要**更宽一些**」、
       * 「**不要换行，一行搞定**」。故给足宽度一次放完，不再靠折行救。
       * （各列按比例分摊剩余宽度，见表格 `scroll` 处的说明。）
       */
      width: 300,
      render: (_, row) => (
        <AiReviewCell
          record={row.main}
          items={aiReviewItemsOf(row.main.type)}
          onOpen={(itemKey) =>
            setActiveModal({ kind: 'verify', recordId: row.main.id, itemKey })
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
      title: '回函进度',
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
     *   · **AI 核验** → 并进「AI 核验事项」列 —— 点某一项直接落在那一项上，比从下拉里先进门、
     *     再在页签里找一项少两步；
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
      /* 失败行要多一枚「重新识别」—— 60 → 120（两枚链接并排的实际宽度） */
      width: 120,
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
           * 「重新识别」（v3.29）—— 只给**识别失败**的行。
           *
           * 它把这一封退回识别队列重跑（见 `RETRY_TASK`）：行**当即从列表撤下**、回到页面顶部的
           * 识别区逐项再走一遍，跑完再作为"新的一行"入表并播插入动效。
           * 撤下而不是原地刷新，是为了让"这行数据正在被重新识别"这件事没有歧义 ——
           * 它的结论已经作废，留在列表里只会让人以为它还有效。
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
                              note: `这是第 ${seq} 次回函，已被后续回函覆盖，仅供参考；当前有效为第 ${times} 次。本页为只读查看；如需修改，请在列表行的「回函进度」列点开对应步骤（补正的是当前有效那一次）。`,
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
          · AI 核验结论（含「查看核验详情」按钮与「AI 识别中」提示行）→ 行内「AI 核验事项」列的事项标签
            （v3.28：原先是从操作列「更多 → AI 核验」进、再在页签里找一项）——
            核验是「拿着结论去原件上核对依据」的动作，配着 AI 批注看才是它该有的样子；
          · 核验 / 修改留痕 → 本表下方的一行小字（见下）。
        */}

        {/*
         * 留痕 —— 审计要留痕，但一行小字足够（v2.38 起不再占一整块字段网格）。
         *
         * **三段的次序就是业务时序**（v2.64 起并入「归属来源」）：
         *   归属来源（识别阶段定下"归到哪封"）→ 核验（第一次人工确认）→ 最近修改（归档后补正）。
         * 三段都**按需出现**，全都没有则整行不渲染。
         *
         * 「归属来源」放在**最前**：它是这份回函的**出身**，后两段都是人对它的处置。
         * 它回答的是审计复核时最常被问的那句「**这封凭什么是这家银行的**」——
         * 原先这只留在识别任务上、没有随记录落库，界面上完全看不到。
         */}
        {(() => {
          const traces = [
            main.assignSource ? `归属来源 ${ASSIGN_SOURCE_LABEL[main.assignSource]}` : null,
            main.verifiedAt ? `核验人 ${main.verifiedBy ?? '—'} · 核验时间 ${main.verifiedAt}` : null,
            main.lastEditedAt
              ? `最近修改 ${main.lastEditedAt}${main.lastEditedBy ? `（${main.lastEditedBy}）` : ''}`
              : null,
          ].filter((t): t is string => !!t)
          return (
            traces.length > 0 && (
              /* 整行走等宽数字（中文不受影响），时间戳因此天然对齐 */
              <div className="num" style={{ marginTop: 8, fontSize: 12, color: 'var(--c-text-3)' }}>
                {traces.join(' · ')}
              </div>
            )
          )
        })()}
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
             * 「还有哪几封没处理」由行内进度步骤条与「AI 风险」列表达，比一个总数更具体。
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
              /* 选项 = 当前的风险等级（高风险 / 中风险 / 低风险 / 未核验，v3.20）——
                 取值与文案都来自 `RISK_MAP`，与「AI 风险」列的标签是同一份定义 */
              options={RISK_ORDER.map((l) => ({ label: RISK_MAP[l].text, value: l }))}
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

        <Button
          type="link"
          size="small"
          icon={<QuestionCircleOutlined />}
          style={{ padding: '0 4px', fontSize: 13 }}
          onClick={() => dispatch({ type: 'OPEN_ONBOARDING' })}
        >
          操作指引
        </Button>

        {/*
         * 「● 识别中，结果将自动写入列表」这一句**已移除**（v3.28）——
         * 「哪几封在认、认到哪一项」由识别区逐封交代（`RecognitionProgressBoard`），
         * 本行再挂一句笼统的"识别中"是同一件事的第二处表达（项目一路在清理这类重复）。
         */}
        </div>
      </div>

      {/*
       * 智能识别区（v3.28 立题；v3.29 位置两改）—— 识别过程**长在主页面**上，
       * 逐封一行：哪一封在认、认到哪一项。跑完一封即从本区消失、同时出现在下方表格里
       * （入表闸在 store：`isFullyRecognized`）。有任务才出现、跑完自动淡出收起。
       *
       * **位置**：① 原在页面标题之下 → ② 用户要求「放在表单上，按钮的下方」，于是挂进了
       * 筛选表单卡内 → ③ 用户再要求「不要放在按钮的同一个区域，要和按钮所在的区域、
       * 表单所在的区域**分开**」⇒ 现在是**独立的一块**，夹在**表单卡**与**表格卡**之间。
       *
       * 三次改动的落点其实是同一句：它是**上传动作的结果**，与表单/按钮是"因"与"果"的关系，
       * 所以既不能压在他们上面（顺序反了），也不能塞在他们里面（那是同一块区域里的两件事）。
       * 单独成块之后，页面自上而下正好是：**表单（我要做什么）→ 识别（系统正在做什么）→
       * 表格（做完的成果）**，三段各是各的。
       */}
      <RecognitionProgressBoard />

      {/* 表格 */}
      <div className="panel" style={{ padding: '4px 0' }}>
        <Table<ConfirmationRow>
          size="small"
          rowKey="confirmationNo"
          columns={columns}
          dataSource={data}
          /* 列宽合计：196+132+132+84+300+200+120 = 1164 —— 去掉「是否重新发函」112、
             新增「AI 核验事项」（v3.28 建 236，v3.29 事项改一行文字链后加宽到 300）、
             操作列 v3.28 收到 60、v3.29 失败行要「重新识别」又收回 120。
             `scroll.x` 取 1324（> 合计 1124）只是给窄屏兜一个最小宽度；宽屏下浏览器会按比例
             把剩余空间分给各列（1680 视口下实测 AI 核验事项列约 395px，正好一行放完全部事项）。 */
          scroll={{ x: 1324 }}
          locale={{ emptyText: emptyNode }}
          /* 行首不再加「高风险」红色竖条（2026-09-20 用户要求去掉）：
             风险等级已由「AI 风险」列的状态标签表达，行首再画一条属于重复表达。
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
        /* 从列表事项标签点进来的：直接定位到那一项，并在页脚给「采纳 / 不采纳」（v3.28） */
        initialKey={activeModal?.kind === 'verify' ? activeModal.itemKey : undefined}
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
