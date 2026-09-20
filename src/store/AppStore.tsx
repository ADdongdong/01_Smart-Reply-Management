import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import type { ExpressImportResult, RecognitionTask, ReplyRecord, UploadBatch } from '@/types'
import { BANK_ITEMS_QS, REPLY_RECORDS } from '@/mock/confirmations'
import { advanceBatch } from '@/services/mockRecognition'
import dayjs from 'dayjs'

/** 演示用当前用户 —— 所有人工核验留痕都记在他名下 */
const CURRENT_USER = '张审计'

interface AppState {
  records: ReplyRecord[]
  batches: UploadBatch[]
  /** 识别工作台抽屉是否展开 */
  recognitionOpen: boolean
  /** 悬浮进度卡是否显示 */
  floatingVisible: boolean
  /** 识别完成后需要高亮闪烁的函证（按函证编号） */
  flashRowId: string | null
  /** 操作指引弹窗是否展开 —— **不自动弹出**，只由「操作指引」入口 / 顶部问号图标手动打开 */
  onboardingVisible: boolean
  /** 演示数据是否已加载 */
  demoLoaded: boolean
  /** 快递数据导入结果（不做步骤化处理，直接展示匹配代入结果） */
  expressResult: ExpressImportResult | null
  expressOpen: boolean
}

type Action =
  | { type: 'START_BATCH'; batch: UploadBatch }
  | { type: 'TICK' }
  | { type: 'OPEN_RECOGNITION' }
  /**
   * 关闭识别工作台抽屉。
   *
   * **用户语义是「最小化」而不是「取消」** —— 它只收起抽屉，识别任务照常继续，
   * 并由右下角的悬浮进度卡接管（`FloatingProgress`，可再点「展开」召回）。
   * 底栏「最小化」按钮、点抽屉外部、标题栏 `×`、`Esc` 四条入口都走这里。
   */
  | { type: 'CLOSE_RECOGNITION' }
  | { type: 'SET_FLOATING'; visible: boolean }
  | { type: 'CLEAR_FLASH' }
  | { type: 'OPEN_ONBOARDING' }
  | { type: 'CLOSE_ONBOARDING' }
  | { type: 'IMPORT_EXPRESS'; result: ExpressImportResult }
  | { type: 'CLOSE_EXPRESS' }
  | { type: 'CONFIRM_ASSIGN'; taskId: string }
  | { type: 'MANUAL_MATCH'; taskId: string; confirmationNo: string; entity: string }
  | { type: 'RETRY_TASK'; taskId: string }
  | { type: 'SKIP_TASK'; taskId: string }
  | { type: 'CONFIRM_DOC'; recordId: string; patch?: Partial<ReplyRecord> }
  /**
   * 编辑态：修改**已确认过**的回函快递信息。
   * 与 CONFIRM_DOC 的差别只有两点 —— 不推进回函进度、不重打核验留痕：
   * 同一件事不设两处签字，编辑只写内容与「最近修改」留痕。
   */
  | { type: 'UPDATE_DOC'; recordId: string; patch: Partial<ReplyRecord> }
  /** 编辑态：修改**已填写过**的回函结果（保持原进度，已归档的仍是已完成） */
  | { type: 'UPDATE_RESULT'; recordId: string; patch: Partial<ReplyRecord> }
  | { type: 'SUBMIT_RESULT'; recordId: string; patch?: Partial<ReplyRecord> }
  | { type: 'REMOVE_CONFIRMATION'; confirmationNo: string }

const initialState: AppState = {
  records: REPLY_RECORDS,
  batches: [],
  recognitionOpen: false,
  floatingVisible: false,
  flashRowId: null,
  /**
   * 操作指引**不自动弹出**（默认关闭）。
   * 进入页面即弹会打断正在用它的人，而且刷新一次弹一次；
   * 需要时从主操作行的「操作指引」按钮、或顶部导航的问号图标手动打开。
   */
  onboardingVisible: false,
  demoLoaded: false,
  expressResult: null,
  expressOpen: false,
}

/** 从原始 mock 中取回某个函证的核验结果 */
function lookupVerification(confirmationNo: string) {
  return REPLY_RECORDS.find((r) => r.confirmationNo === confirmationNo)?.verification
}

/**
 * 识别成功后写入回函资料。
 *
 * 归属落点是**函证**：往来函证凭二维码精确命中函证编号，银行函证凭四要素匹配归属，
 * 两者的结论最终都收敛到「这份回函属于哪一封函证」。
 *
 * 每收到一份新的回函，就为该函证登记一条新的回函记录（sendSeq 递增），
 * 「最终有效」由列表按回函时间推导（见 ReplyList 的函证归并），
 * 因此新回函进来后自动成为最终有效，历史回函自动降级为已被覆盖。
 */
function applyRecognizedReply(records: ReplyRecord[], task: RecognitionTask): ReplyRecord[] {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const same = records.filter((r) => r.confirmationNo === task.confirmationNo)
  const base = same[same.length - 1]
  const best = task.bankMatch?.candidates?.[0]

  const created: ReplyRecord = {
    id: `${task.confirmationNo}-${same.length + 1}`,
    sendSeq: same.length + 1,
    sendRecordNo: `待登记-${task.confirmationNo}-${same.length + 1}`,
    confirmationNo: task.confirmationNo,
    entity: task.matchedEntity && task.matchedEntity !== '—' ? task.matchedEntity : (base?.entity ?? '—'),
    type: task.type,
    sendMethod: base?.sendMethod ?? '邮寄发函',
    sendDate: base?.sendDate ?? now,
    replyDate: now,
    replyFile: task.fileName,
    replyProgress: '待确认快递信息',
    hasReplied: true,
    risk: base?.risk ?? 'none',
    verifyStatus: 'pending',
    aiFilled: true,
    periodStart: base?.periodStart ?? best?.periodStart,
    periodEnd: base?.periodEnd ?? best?.periodEnd,
    bankItems: task.type === '银行函证' ? (base?.bankItems ?? BANK_ITEMS_QS) : undefined,
    verification: base?.verification ?? lookupVerification(task.confirmationNo),
  }
  return [...records, created]
}

function findTask(state: AppState, taskId: string): RecognitionTask | undefined {
  return state.batches.flatMap((b) => b.tasks).find((t) => t.id === taskId)
}

/**
 * 把某个任务的结果写入回函列表，并打上 applied 标记。
 *
 * 只有**归属已确定**的任务才会落库：往来函证在建批次时即确定（二维码精确命中），
 * 银行函证需 auto 档自动归属、或人工「确认归属 / 指定归属」后才确定。
 * TICK / CONFIRM_ASSIGN / MANUAL_MATCH 三处共用本函数，保证「写入 + 标记」原子完成、不重复写入。
 */
function finalizeTask(state: AppState, taskId: string): AppState {
  const task = findTask(state, taskId)
  if (!task || task.applied || !task.assignSource) return state
  if (!task.confirmationNo || task.confirmationNo === '待指定') return state

  const records = applyRecognizedReply(state.records, task)
  const batches = state.batches.map((b) => ({
    ...b,
    tasks: b.tasks.map((t) => (t.id === taskId ? { ...t, applied: true } : t)),
  }))
  return { ...state, records, batches, flashRowId: task.confirmationNo }
}

/** 更新某任务的 match 阶段结论 */
function withMatchDetail(task: RecognitionTask, detail: string): RecognitionTask {
  return {
    ...task,
    stages: task.stages.map((s) => (s.key === 'match' ? { ...s, status: 'done' as const, percent: 100, detail } : s)),
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'START_BATCH':
      return {
        ...state,
        batches: [...state.batches, action.batch],
        recognitionOpen: true,
        floatingVisible: true,
      }

    case 'TICK': {
      if (!state.batches.some((b) => b.status === 'queued' || b.status === 'running')) return state

      const before = new Map<string, RecognitionTask['status']>()
      state.batches.forEach((b) => b.tasks.forEach((t) => before.set(t.id, t.status)))

      const batches = state.batches.map((batch) => (batch.status === 'done' ? batch : advanceBatch(batch).batch))

      let next: AppState = { ...state, batches }
      // 归属已确定的成功任务自动落库；待确认 / 待指定的任务停在队列里等人工操作
      batches
        .flatMap((b) => b.tasks)
        .filter((t) => before.get(t.id) !== 'success' && t.status === 'success')
        .forEach((t) => {
          next = finalizeTask(next, t.id)
        })

      const anyRunning = batches.some((b) => b.status !== 'done')
      return { ...next, floatingVisible: anyRunning ? true : next.floatingVisible }
    }

    case 'OPEN_RECOGNITION':
      return { ...state, recognitionOpen: true }
    case 'CLOSE_RECOGNITION':
      return {
        ...state,
        recognitionOpen: false,
        floatingVisible: state.batches.some((b) => b.status !== 'done'),
      }
    case 'SET_FLOATING':
      return { ...state, floatingVisible: action.visible }
    case 'CLEAR_FLASH':
      return { ...state, flashRowId: null }
    case 'OPEN_ONBOARDING':
      return { ...state, onboardingVisible: true }
    case 'CLOSE_ONBOARDING':
      return { ...state, onboardingVisible: false, demoLoaded: true }

    case 'IMPORT_EXPRESS':
      return { ...state, expressResult: action.result, expressOpen: true }
    case 'CLOSE_EXPRESS':
      return { ...state, expressOpen: false }

    /** 人工采纳系统建议的归属（confirm 档） */
    case 'CONFIRM_ASSIGN': {
      const task = findTask(state, action.taskId)
      const suggested = task?.bankMatch?.candidates?.[0]
      if (!task || !suggested) return state

      const batches = state.batches.map((b) => ({
        ...b,
        tasks: b.tasks.map((t) =>
          t.id === action.taskId
            ? withMatchDetail(
                {
                  ...t,
                  confirmationNo: suggested.confirmationNo,
                  matchedEntity: suggested.entity,
                  assignSource: 'manual-confirm' as const,
                  needManual: false,
                  failReason: undefined,
                  bankMatch: t.bankMatch
                    ? {
                        ...t.bankMatch,
                        assignSource: 'manual-confirm' as const,
                        conclusion: `已人工确认归属函证 ${suggested.confirmationNo}（系统建议，匹配度 ${Math.round(suggested.score * 100)}%）`,
                      }
                    : t.bankMatch,
                },
                `人工确认采纳系统建议 → 归属函证 ${suggested.confirmationNo}（匹配度 ${Math.round(suggested.score * 100)}%）`,
              )
            : t,
        ),
      }))

      return finalizeTask({ ...state, batches }, action.taskId)
    }

    /**
     * 人工指定归属。
     *  · 银行函证建议/待指定档：识别已跑完，指定后直接落库；
     *  · 归属匹配失败（如未识别到二维码）：重置为待推进，重新走后续核验。
     */
    case 'MANUAL_MATCH': {
      const target = findTask(state, action.taskId)
      if (!target) return state
      const finished = target.status === 'success'

      const batches = state.batches.map((b) => ({
        ...b,
        status: finished || b.status !== 'done' ? b.status : ('running' as const),
        tasks: b.tasks.map((t) =>
          t.id === action.taskId
            ? withMatchDetail(
                {
                  ...t,
                  confirmationNo: action.confirmationNo,
                  matchedEntity: action.entity,
                  assignSource: 'manual-assign' as const,
                  status: finished ? ('success' as const) : ('pending' as const),
                  needManual: false,
                  failReason: undefined,
                  bankMatch: t.bankMatch
                    ? {
                        ...t.bankMatch,
                        assignSource: 'manual-assign' as const,
                        conclusion: `已人工指定归属函证 ${action.confirmationNo}`,
                      }
                    : t.bankMatch,
                },
                `人工指定 → 归属函证 ${action.confirmationNo}`,
              )
            : t,
        ),
      }))

      const next = finalizeTask({ ...state, batches }, action.taskId)
      return finished ? next : { ...next, floatingVisible: true }
    }

    case 'RETRY_TASK': {
      const batches = state.batches.map((b) => ({
        ...b,
        status: b.status === 'done' ? ('running' as const) : b.status,
        tasks: b.tasks.map((t) =>
          t.id === action.taskId
            ? {
                ...t,
                status: 'pending' as const,
                needManual: false,
                plannedFailure: undefined,
                failReason: undefined,
                stages: t.stages.map((s) => ({ ...s, status: 'waiting' as const, percent: 0 })),
              }
            : t,
        ),
      }))
      return { ...state, batches, floatingVisible: true }
    }

    case 'SKIP_TASK': {
      const batches = state.batches.map((b) => {
        const tasks = b.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: 'failed' as const, failReason: '已人工跳过，不纳入本次归档' } : t,
        )
        return {
          ...b,
          tasks,
          status: tasks.every((t) => t.status === 'success' || t.status === 'failed') ? ('done' as const) : b.status,
        }
      })
      return { ...state, batches }
    }

    case 'CONFIRM_DOC':
      return {
        ...state,
        records: state.records.map((r) =>
          r.id === action.recordId
            ? {
                ...r,
                ...action.patch,
                replyProgress: '待填写回函结果',
                verifyStatus: 'verified',
                verifiedBy: CURRENT_USER,
                verifiedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
              }
            : r,
        ),
      }

    /**
     * 编辑态保存 —— 只写内容与「最近修改」留痕。
     *
     * 刻意**不碰** replyProgress / verifyStatus / verifiedBy / verifiedAt：
     * 已归档数据被修正后仍保持「已完成」，核验留痕也不重复产生
     * （同一件事不设两处签字，见需求文档 5.4）。
     */
    case 'UPDATE_DOC':
    case 'UPDATE_RESULT':
      return {
        ...state,
        records: state.records.map((r) =>
          r.id === action.recordId
            ? {
                ...r,
                ...action.patch,
                lastEditedBy: CURRENT_USER,
                lastEditedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
              }
            : r,
        ),
      }

    case 'SUBMIT_RESULT':
      return {
        ...state,
        records: state.records.map((r) =>
          r.id === action.recordId
            ? {
                ...r,
                ...action.patch,
                replyProgress: '已完成',
                verifyStatus: 'verified',
                verifiedBy: r.verifiedBy ?? CURRENT_USER,
                verifiedAt: r.verifiedAt ?? dayjs().format('YYYY-MM-DD HH:mm:ss'),
              }
            : r,
        ),
      }

    case 'REMOVE_CONFIRMATION':
      return {
        ...state,
        records: state.records.filter((r) => r.confirmationNo !== action.confirmationNo),
      }

    default:
      return state
  }
}

interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
  activeBatchCount: number
  /** 识别完成但归属尚未确定（待人工确认 / 指定）的任务数 */
  pendingAssignCount: number
  fastForward: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // 异步识别驱动：每 600ms 推进一次
  useEffect(() => {
    const running = state.batches.some((b) => b.status !== 'done')
    if (!running) return
    const timer = window.setInterval(() => dispatch({ type: 'TICK' }), 600)
    return () => window.clearInterval(timer)
  }, [state.batches])

  const pendingAssignCount = useMemo(
    () => state.batches.flatMap((b) => b.tasks).filter((t) => t.status === 'success' && !t.assignSource).length,
    [state.batches],
  )

  // 识别完成后自动收起悬浮卡；仍有待确认归属的任务时保持可见
  useEffect(() => {
    if (!state.batches.length) return
    if (!state.batches.every((b) => b.status === 'done')) return
    if (pendingAssignCount > 0) return
    const timer = window.setTimeout(() => dispatch({ type: 'SET_FLOATING', visible: false }), 2600)
    return () => window.clearTimeout(timer)
  }, [state.batches, pendingAssignCount])

  const fastForward = useCallback(() => {
    ;[...Array(40)].forEach(() => dispatch({ type: 'TICK' }))
  }, [])

  const activeBatchCount = useMemo(() => state.batches.filter((b) => b.status !== 'done').length, [state.batches])

  const value = useMemo(
    () => ({ state, dispatch, activeBatchCount, pendingAssignCount, fastForward }),
    [state, activeBatchCount, pendingAssignCount, fastForward],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}
