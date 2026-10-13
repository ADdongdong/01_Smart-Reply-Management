import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import type {
  AiReviewKey,
  ConfirmationType,
  ExpressImportResult,
  RecognitionTask,
  ReplyRecord,
  UploadBatch,
} from '@/types'
import { BANK_ITEMS_QS, BANK_VERIFY_FALLBACK, REPLY_RECORDS, fallbackVerification } from '@/mock/confirmations'
import { makeSegmentTask, makeStages } from '@/mock/recognition'
import { advanceBatch } from '@/services/mockRecognition'
import { TYPE_RULE } from '@/services/replyRule'
import dayjs from 'dayjs'

/** 演示用当前用户 —— 所有人工核验留痕都记在他名下 */
const CURRENT_USER = '张审计'

interface AppState {
  records: ReplyRecord[]
  batches: UploadBatch[]
  /**
   * **归属界面**是否展开（v2.57）。
   *
   * 与 `insightOpen` 是**两个互斥的独立界面**，不再共用一个"工作台"开关 ——
   * 用户的要求是「界面的解耦，匹配单独的界面」，且
   * 「识别的界面点击确定后，就回到主界面，智能识别放在右下角，用户需要主动点击，
   * 才会去到智能识别的界面查看」。
   */
  assignOpen: boolean
  /**
   * **智能识别界面**是否展开（v2.57）—— 由主界面右下角的进度卡主动点入。
   * 与 `assignOpen` 互斥（同一时刻只挂载一个全屏界面，省内存、也避免两层遮罩叠加）。
   */
  insightOpen: boolean
  /**
   * 当前识别的**入口类型**（往来函证 / 银行函证）。
   * 由列表页的两个上传入口在打开时指定 —— 上传时类型即已确定，
   * 两个界面据此渲染标题 / 演示数据，不再靠系统事后判类型。
   */
  recognitionType: ConfirmationType
  /**
   * 悬浮进度卡是否显示。
   *
   * **只由"一次性事件"置真**（v3.09 起）：启动批次、归属确认/重切后启动阶段二、重试；
   * 之后**只有两种情况会置假**：用户点 ✕ 收起、或全部跑完 2.6s 后自动收起。
   * ⚠️ 别在 `TICK` 里按"还有批次在跑"重新置真 —— 那会让 ✕ 失效（每 600ms 弹回来）。
   */
  floatingVisible: boolean
  /** 识别完成后需要高亮闪烁的函证（按函证编号） */
  flashRowId: string | null
  /**
   * **刚写入列表的那些函证**（按函证编号，v3.29）—— 「识别完成一条 → 加入回函表单」
   * 这个动作要**看得见**（用户：「我要看见，识别完成一条数据，一条函证数据加入回函表单的交互」）。
   *
   * 与 `flashRowId` 的分工：那条是「**这一行变了**」（阶段二回填结论后的闪烁提醒），
   * 本条是「**这一行是刚来的**」—— 列表据此给新行做**滑入 + 高亮一闪**的插入动效。
   *
   * 是个**数组**而不是单值：同一个 tick 里可能有多封一起跑完（`TICK` 的落库是 forEach），
   * 存单值会让先落的几行没动效。由列表在动效播完后派 `CLEAR_INSERTED` 清空 ——
   * 清掉才能让同一封（重新识别后再次入表）**再播一次**。
   */
  insertedRowIds: string[]
  /** 操作指引弹窗是否展开 —— **不自动弹出**，只由「操作指引」入口 / 顶部问号图标手动打开 */
  onboardingVisible: boolean
  /** 演示数据是否已加载 */
  demoLoaded: boolean
  /** 快递数据导入结果（不做步骤化处理，直接展示匹配代入结果） */
  expressResult: ExpressImportResult | null
  expressOpen: boolean
  /**
   * **归属界面的初稿是否由「智能识别」给出**（v3.26）。
   *
   * 银行侧切分有两条路（详见 `AssignView` 的 `baseDraft` 与 5.2 的「两种模式」）：
   * · `false`（默认，手动模式）→ 初稿 = **整份一段**，函证切点留给用户自己切；
   * · `true`（智能模式）→ 初稿 = **识别结果直接落成的切分**：按每封的页区间切好、
   *   归属按四要素匹配预填、快递单号随面单段带出、面单页各自成段 —— 用户确认即可，
   *   也可以像手动一样改。
   *
   * 它**只在"起批次"与"用户在归属界面主动点智能识别"这两个时刻被置真**，
   * 且**不参与后续回写**：一旦用户在界面上动过切分，草稿就归人工（v3.23 的口径
   * 「已切分过的，识别结果到达后不再另做切分，按人工的切分为准」）。
   */
  aiDraft: boolean
}

type Action =
  /**
   * 启动一个识别批次（v2.57：一并置 `assignOpen = true` → 自动进入**归属界面**）。
   * `uploadType` 由**上传弹窗**给出 —— 类型在上传那一刻就已确定（v2.47 起），
   * 不必再另外发一次 `OPEN_RECOGNITION`（分两次 dispatch 会让工作台先按旧类型渲染一帧）。
   */
  | {
      type: 'START_BATCH'
      batch: UploadBatch
      uploadType?: ConfirmationType
      /** v3.26：本次上传是否已用「智能识别」（初稿直接落成切分结果，见 `AppState.aiDraft`） */
      aiDraft?: boolean
    }
  | { type: 'TICK' }
  /**
   * 在**归属界面里**应用「智能识别」（v3.26）—— 初稿换成识别结果（切分 + 归属 + 单号）。
   * 只置这一个标志：真正的初稿由 `AssignView` 的 `baseDraft` 按它算出来，
   * 因此**用户此前的手工改动会自然被丢弃**（那是用户主动点它时的预期），
   * 而"AI 不回写人工成果"这条约束由"初稿只在没动过时生效"保证。
   */
  | { type: 'APPLY_AI_DRAFT' }
  /**
   * 打开**归属界面**（v2.57）。`uploadType` 由上传入口指定（缺省按「往来函证」处理）。
   */
  | { type: 'OPEN_ASSIGN'; uploadType?: ConfirmationType }
  /**
   * 关闭**归属界面** —— 即用户点「确定」或右上角 ×。
   *
   * 关闭后**不自动打开识别界面**：识别在后台继续，由右下角进度卡接管；
   * 要不要去看由用户主动点（用户明确要求「用户需要主动点击，才会去到智能识别的界面查看」）。
   */
  | { type: 'CLOSE_ASSIGN' }
  /**
   * **放弃本次上传**（v3.10）—— 归属界面右上角 ✕ / Esc 触发（与「确定」= 提交相对）。
   *
   * 退出即放弃：归属界面的切分与归属是**草稿**（不落 store，见 `AssignView` 的 `Draft`），
   * 没点「确定」就没有提交（口径：**归属未确定绝不落库**），所以批次本身也该一起丢掉 ——
   * 否则它会 ① 在后台把识别白跑完；② 让 `pendingAssignCount > 0`，使右下角进度卡
   * **永远收不起来**（自动收起逻辑明确排除"还有待归属"）；③ 卡片上写着「正在对应 N 份」
   * 却**没有任何入口回到归属界面**（`OPEN_ASSIGN` 全项目无人派发）。
   */
  | { type: 'DISCARD_BATCH'; fileName: string }
  /** 打开**智能识别界面**（由右下角进度卡点入） */
  | { type: 'OPEN_INSIGHT' }
  /** 关闭**智能识别界面** —— 回到主界面，识别任务不受影响 */
  | { type: 'CLOSE_INSIGHT' }
  | { type: 'SET_FLOATING'; visible: boolean }
  | { type: 'CLEAR_FLASH' }
  /** 插入动效播完 —— 由列表在过渡结束后派发（见 `AppState.insertedRowIds`） */
  | { type: 'CLEAR_INSERTED' }
  | { type: 'OPEN_ONBOARDING' }
  | { type: 'CLOSE_ONBOARDING' }
  | { type: 'IMPORT_EXPRESS'; result: ExpressImportResult }
  | { type: 'CLOSE_EXPRESS' }
  | { type: 'CONFIRM_ASSIGN'; taskId: string }
  | { type: 'MANUAL_MATCH'; taskId: string; confirmationNo: string; entity: string }
  /**
   * 提交「回函归属」界面的**手动切分**（v2.62）—— 用户点「确定」时发一次。
   *
   * 载荷是**这份文件的完整切分结果**（段 = 页区间 + 归属），而不是"某段改了什么"：
   * 切分是"整份文件被分成哪几段"这件事的一个整体状态，逐段下发 delta 会让
   * "删除一段、把两段并成一段"这类操作没有对应的 delta 可发。
   *
   * 为什么要**在确定时才提交**、而不是每动一下剪刀就写库：切分是编辑动作，
   * 中间态（比如批量切了 11 段、还没归完）不该落进任务列表 —— 那会让后台识别
   * 按一个用户并不认可的分段去跑。`AssignView` 的草稿因此是纯本地的。
   */
  | {
      type: 'COMMIT_SPLIT'
      fileName: string
      segments: {
        pageStart: number
        pageEnd: number
        /** `待指定` = 该段未归属（不写入回函列表） */
        confirmationNo: string
        entity?: string
        /**
         * 段尾面单的单号（v2.78）—— 可能是识别的、也可能是**人工在切分结果里补/改的**。
         * 它属于段，所以随切分结果一起下发，落到任务的 `expressNo` 上。
         */
        expressNo?: string
        /**
         * 这一段**就是快递面单页**（v3.22）—— 面单段现在**照提交**（v2.83 时是不提交的，
         * 见 `makeSegmentTask` 的入参说明）：面单页是**识别结果**，只有任务记着它；
         * 不提交 ⇒ 识别界面看不到「快递面单」组、重开归属界面还会退化成"未识别到快递面单"。
         */
        faceSheetPage?: boolean
      }[]
    }
  | { type: 'RETRY_TASK'; taskId: string }
  | { type: 'SKIP_TASK'; taskId: string }
  /**
   * 人工对列表「AI 核验事项」某一项的处置（v3.28）—— 采纳 / 不采纳。
   *
   * 采纳 = 采用 AI 结论（在「回函结果填写」页自动带出）；不采纳 = 只标记「已看过、不采用」、
   * 不带入任何值。两者都写 `ReplyRecord.aiReview` 与处理留痕，列表上该项随即呈已处理态。
   */
  | { type: 'REVIEW_AI_ITEM'; recordId: string; key: AiReviewKey; status: 'adopted' | 'ignored' }
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
  /* 两个界面都不在初始态 —— 归属界面由上传/有段待归属时打开，识别界面由右下角主动点入 */
  assignOpen: false,
  insightOpen: false,
  recognitionType: '往来函证',
  floatingVisible: false,
  flashRowId: null,
  insertedRowIds: [],
  /**
   * 操作指引**不自动弹出**（默认关闭）。
   * 进入页面即弹会打断正在用它的人，而且刷新一次弹一次；
   * 需要时从主操作行的「操作指引」按钮、或顶部导航的问号图标手动打开。
   */
  onboardingVisible: false,
  demoLoaded: false,
  expressResult: null,
  expressOpen: false,
  /* 默认**手动模式**（初稿 = 整份一段）：智能识别那条路要用户/上传弹窗明确点过才走 */
  aiDraft: false,
}

/**
 * 取某个函证的核验结果 —— **两级来源**（v2.55）。
 *
 * · `REPLY_RECORDS` —— 预置演示数据自带（如齐商银行的 `VERIFY_QS`）；
 * · `BANK_VERIFY_FALLBACK` / `fallbackVerification` —— **候选函证的兜底**。
 *
 * **为什么必须有兜底**：银行函证是两阶段类型，落库时 `verification` 刻意留空
 * （否则第二次回函会在阶段一就显示上一份的结论，「识别中」态无法成立），
 * 由阶段二回填，而回填走的正是本函数。若这封函证不在演示数据里
 * （**「上传后才归属」的函证全都属于这类**），就会回填 `undefined`，
 * 表现为「回函结果填写」页里 **「AI 核验结论」整块不渲染** ——
 * 用户反馈「为什么中国建设银行没有 AI 识别的是否采用的内容」即此。
 * 齐商银行有，只因它恰好带着 `VERIFY_QS` 预置在演示数据里，**不是它特殊**。
 *
 * `type` 参与兜底：银行函证要有 `bankText`、往来函证要有 `handwriting`（两者形状不同）。
 */
function lookupVerification(confirmationNo: string, type: ConfirmationType) {
  return (
    REPLY_RECORDS.find((r) => r.confirmationNo === confirmationNo)?.verification ??
    BANK_VERIFY_FALLBACK[confirmationNo] ??
    fallbackVerification(type)
  )
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
function applyRecognizedReply(
  records: ReplyRecord[],
  task: RecognitionTask,
): { records: ReplyRecord[]; recordId: string } {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const same = records.filter((r) => r.confirmationNo === task.confirmationNo)
  const base = same[same.length - 1]
  const best = task.bankMatch?.candidates?.[0]
  const twoPhase = TYPE_RULE[task.type].twoPhase
  const recordId = `${task.confirmationNo}-${same.length + 1}`
  /*
   * **识别有失败项**（v3.29）—— 这封照样入表，但**任何核验结论都不写**：
   * 识别没过，结论就是无源的。风险等级同理记 `none`（否则会继承上一条回函的风险，
   * 让"识别失败"这一行看起来像已经判过）。
   */
  const failed = task.status === 'failed'
  /*
   * 本条的**核验结论**（两阶段类型落库时留空、等阶段二回填；其余沿用历史回函或取兜底，
   * 见 `lookupVerification`）。**风险等级与它同源** —— 见下面 `risk` 的说明。
   */
  const verification =
    twoPhase || failed
      ? undefined
      : (base?.verification ?? lookupVerification(task.confirmationNo, task.type))

  const created: ReplyRecord = {
    id: recordId,
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
    /*
     * 两阶段类型（银行函证）此刻**只落库四要素与状态**，核验数据等阶段二回填 ——
     * 刻意**不继承** `base?.verification`：否则同一函证的第二次回函在阶段一会
     * 立刻显示上一份回函的结论，「识别中」态就无法成立（本改造最容易踩的坑）。
     */
    /*
     * **AI 风险与核验结论同源**（v3.29 修）。
     *
     * 原先是 `base?.risk ?? 'none'` —— 只看历史回函。于是**首次回函的往来函证**
     * （没有历史回函，演示里上传的那几封全是）风险恒写成 `none`，列表上一直显示「未核验」——
     * 而同一行为的 `verification.riskLevel` 明明已有结论、「回函是否相符」也已给出结论，
     * 一格里说"有结论"、另一格里说"没核验"，自相矛盾。
     *
     * 现在与 `verification` 走同一个来源：有历史就沿用它的风险（与沿用它的结论是同一口径），
     * 没有就用本条拿到的核验结论里的风险等级。
     * 识别失败的那封仍然记 `none` —— 识别没过，任何结论都是无源的。
     */
    risk: twoPhase || failed ? 'none' : (base?.risk ?? verification?.riskLevel ?? 'none'),
    verifyStatus: 'pending',
    aiFilled: true,
    /*
     * 归属来源留痕（v2.64）—— 从识别任务上带过来，随记录长期保留。
     * 归属界面上手工切出的段记 `manual-assign`（见 `makeSegmentTask`），与「指定归属」同一口径，
     * **不冒充系统自动归属** —— 这条正是审计复核时要看的那句"凭什么是这家银行"。
     */
    assignSource: task.assignSource,
    periodStart: base?.periodStart ?? best?.periodStart,
    periodEnd: base?.periodEnd ?? best?.periodEnd,
    /*
     * 「识别中」标记**失败的那封不置真**（v3.29）—— 它的识别已经结束了（只是没成功），
     * 置真会让这行在列表里永远显示「识别中」（阶段二是"成功才回填"，失败本就不会回填）。
     */
    recognitionPending: twoPhase && !failed,
    /* `bankItems`（询证事项逐项核对）由阶段二回填，两种类型在落库时都不写 */
    verification,
    /* 识别失败标记 + 原因 —— 列表据此把那行标成「识别失败」并给「重新识别」 */
    recognitionFailed: failed || undefined,
    recognitionFailReason: failed ? task.failReason : undefined,
  }
  return { records: [...records, created], recordId }
}

function findTask(state: AppState, taskId: string): RecognitionTask | undefined {
  return state.batches.flatMap((b) => b.tasks).find((t) => t.id === taskId)
}

/**
 * 这封函证的**全部检测项是否都跑完了**（v3.28 立，v3.29 改判据）。
 *
 * **判据**：单阶段类型（往来函证）—— 全部检测项**尘埃落定**即可（成功或失败都算，见 `stagesSettled`）；
 * 两阶段类型（银行函证）—— 还必须**已经跑到阶段二并且阶段二也尘埃落定**。
 *
 * ## 为什么把闸加到这一层
 *
 * 原口径是「阶段一跑完就落库、行上标『识别中』、阶段二跑完再刷新结论」。用户看过实际界面后
 * 判定这样不对：**「哪个函证完成智能识别，哪个函证的数据才会在下方展示，而非直接展示所有
 * 上传的回函数据」** —— 半成品的行（结论还没出来、列上全是「识别中」）不该出现在列表里。
 * 于是入表时机后移到「全部检测项跑完」，识别过程中的那一封改为在**列表页顶部的识别区**
 * 逐封展示（见 `RecognitionProgressBoard`）。
 *
 * 这**不是**把 v3.27 的闸拆掉，而是在其之上再加一层：
 * ① 未提交（`UploadBatch.committed !== true`）→ 一个字都不写；
 * ② 已提交但没跑完 → 仍在写列表这件事上等着（识别照跑、进度照走）。
 */
function isFullyRecognized(task: RecognitionTask): boolean {
  /* v3.29：判据由「成功」改为「**尘埃落定**」—— 失败的那封也要入表（见 `stagesSettled`） */
  if (!stagesSettled(task)) return false
  return TYPE_RULE[task.type].twoPhase ? task.phase === 2 : true
}

/**
 * 这封函证的检测项**是否都已尘埃落定**（v3.29）—— 每一项要么 `done`、要么 `failed`，
 * 没有还在跑的、也没有还没轮到的。
 *
 * ## 为什么把入表判据从「`status === 'success'`」改成它
 *
 * 旧判据的后果是**失败的那封永远进不了列表** —— 它只能一直挂在识别区里（识别区因此也
 * 永远收不起来）。用户的要求是：「识别出错的回函数据，**也落入表单中，支持重新识别**」，
 * 并且「不要阻塞，继续识别后面的内容」。
 *
 * 于是：**失败 = 这次识别的结果之一，不是"没有结果"**。失败的那封照样入表（行上标「识别失败」、
 * 不写核验结论），「操作」列给「重新识别」—— 重跑时它会被撤出列表、回到识别区，跑完再入表。
 *
 * 与「半成品不进列表」并不矛盾：半成品是**还在跑**（有 waiting / running），
 * 而这里要的是**跑完了、只是其中某项没成功**。
 */
function stagesSettled(task: RecognitionTask): boolean {
  return !task.stages.some((s) => s.status === 'waiting' || s.status === 'running')
}

/**
 * 把某个任务的结果写入回函列表，并打上 applied 标记。
 *
 * 只有**归属已确定**、**批次已提交**、且**全部检测项已跑完**的任务才会落库：
 * · 归属 —— 往来函证在建批次时即确定（二维码精确命中），银行函证需 auto 档自动归属、
 *   或人工「确认归属 / 指定归属」后才确定；
 * · 批次已提交 —— 见 `UploadBatch.committed`（v3.27）；
 * · 检测项跑完 —— 见 `isFullyRecognized`（v3.28）。
 *
 * TICK / CONFIRM_ASSIGN / MANUAL_MATCH 三处共用本函数，保证「写入 + 标记」原子完成、不重复写入。
 * 三道闸**都设在这里**而不是各调用点，是为了三条来路口径一致、不会漏掉一条。
 */
function finalizeTask(state: AppState, taskId: string): AppState {
  /*
   * ① **未提交的批次一律不落库**（v3.27）——
   * 「切分与归属决定的是**什么时候写入回函管理列表**」（见 `UploadBatch.committed`）。
   */
  const batch = state.batches.find((b) => b.tasks.some((t) => t.id === taskId))
  if (!batch?.committed) return state

  const task = findTask(state, taskId)
  if (!task || task.applied || !task.assignSource) return state
  if (!task.confirmationNo || task.confirmationNo === '待指定') return state
  /* ② **全部检测项跑完才落库**（v3.28）—— 半成品的行不进列表 */
  if (!isFullyRecognized(task)) return state

  /*
   * 落库前先看这封函证**在列表里有没有**（v3.29）—— 决定用哪种动效：
   * · **没有** ⇒ 这是"一条新的函证数据加入表单"，走**插入动效**（`insertedRowIds`）；
   * · **已有** ⇒ 这是同一封函证的**又一次回函**，行不会新增，只是内容变了 ——
   *   走 `flashRowId`（闪烁提醒"这一行变了"）。硬给它播插入动效是骗人的：
   *   行在原地没动过，位置也没变。
   */
  const existed = state.records.some((r) => r.confirmationNo === task.confirmationNo)

  const { records, recordId } = applyRecognizedReply(state.records, task)
  const batches = state.batches.map((b) => ({
    ...b,
    tasks: b.tasks.map((t) => (t.id === taskId ? { ...t, applied: true, recordId } : t)),
  }))
  return {
    ...state,
    records,
    batches,
    flashRowId: task.confirmationNo,
    insertedRowIds:
      !existed && !state.insertedRowIds.includes(task.confirmationNo)
        ? [...state.insertedRowIds, task.confirmationNo]
        : state.insertedRowIds,
  }
}

/**
 * 把任务推进到**阶段二**（v2.28）：追加阶段二的检测点、状态打回 `pending`。
 *
 * 用「追加 stages」而不是给同一份 stages 加阶段标记 —— 因为
 * `advanceTask` / `taskPercent` / `StagePipeline` 全都只认 `task.stages` 数组，
 * 追加式改造让这三处**零改动**就得到「阶段二进度」。幂等：已在阶段二则原样返回。
 */
function extendToPhase2(task: RecognitionTask): RecognitionTask {
  if (!TYPE_RULE[task.type].twoPhase || task.phase === 2) return task
  return {
    ...task,
    phase: 2,
    status: 'pending',
    stages: [...task.stages, ...makeStages(task.type, 2, task.detailPlan)],
  }
}

/**
 * 启动阶段二 —— 归属一确定（auto 自动归属 / 人工确认 / 人工指定）就立即调用，
 * 兑现用户要的「这一步完成以后，再自动异步识别别的内容」，无需再点任何按钮。
 * 同时把批次状态打回 `running`，让 TICK 定时器重新接管推进。
 */
function startDetailPhase(state: AppState, taskId: string): AppState {
  const task = findTask(state, taskId)
  if (!task || !TYPE_RULE[task.type].twoPhase || task.phase === 2) return state

  const batches = state.batches.map((b) =>
    b.tasks.some((t) => t.id === taskId)
      ? {
          ...b,
          status: 'running' as const,
          tasks: b.tasks.map((t) => (t.id === taskId ? extendToPhase2(t) : t)),
        }
      : b,
  )
  return { ...state, batches, floatingVisible: true }
}

/**
 * 阶段二跑完 → 把核验数据**回填**到该任务对应的回函记录，并清掉「识别中」标记。
 * 幂等：`verificationApplied` 保证只回填一次。
 */
function applyVerification(state: AppState, taskId: string): AppState {
  const task = findTask(state, taskId)
  if (!task || task.verificationApplied || !task.recordId) return state

  const v = lookupVerification(task.confirmationNo, task.type)
  /** 同一函证的历史回函（询证事项沿用，与落库时的口径一致） */
  const prior = state.records
    .filter((r) => r.confirmationNo === task.confirmationNo && r.id !== task.recordId)
    .pop()

  const records = state.records.map((r) =>
    r.id === task.recordId
      ? {
          ...r,
          verification: v,
          bankItems: prior?.bankItems ?? BANK_ITEMS_QS,
          risk: v?.riskLevel ?? r.risk,
          recognitionPending: false,
        }
      : r,
  )
  const batches = state.batches.map((b) => ({
    ...b,
    tasks: b.tasks.map((t) => (t.id === taskId ? { ...t, verificationApplied: true } : t)),
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
        /* 新批次**一律未提交**（v3.27）：切分与归属还没经用户点「确定」，结果不得写入列表 */
        batches: [...state.batches, { ...action.batch, committed: false }],
        /* 上传即进**归属界面**（v2.57）：识别在后台照跑，但用户先做"把回函对应到函证"这一步 */
        assignOpen: true,
        /* 入口类型随批次一起定 —— 上传弹窗知道自己是哪一类，避免工作台先按旧类型渲染一帧 */
        recognitionType: action.uploadType ?? state.recognitionType,
        /* v3.26：初稿来源随批次定 —— 走「智能识别」进来的、进来就是切好的 */
        aiDraft: action.aiDraft === true,
        floatingVisible: true,
      }

    case 'APPLY_AI_DRAFT':
      return { ...state, aiDraft: true }

    case 'TICK': {
      if (!state.batches.some((b) => b.status === 'queued' || b.status === 'running')) return state

      const batches = state.batches.map((batch) => (batch.status === 'done' ? batch : advanceBatch(batch).batch))
      let next: AppState = { ...state, batches }

      /*
       * ⚠️ **只对「已提交」的批次做下面三遍处理**（v3.27）——
       * 未提交（用户还在归属界面、没点「确定」）的批次**只在后台跑阶段一**：
       * 识别照跑、进度照走，但**结果一律不写进回函列表**（见 `UploadBatch.committed`
       * 与 `finalizeTask` 的说明）。少了这道闸就会出现「什么都没切，列表里已经有几行」。
       */
      const allTasks = batches.filter((b) => b.committed).flatMap((b) => b.tasks)

      /*
       * 三遍**幂等**处理 —— 顺序即语义，全部按类型规则查表判分支，不写内联类型判断：
       *   ① **全部检测项跑完**的任务 → **落库**（`applied` 门控保证只写一次）——
       *      闸门细节见 `finalizeTask` / `isFullyRecognized`（v3.28：银行要等阶段二也跑完，
       *      列表里因此**不再有「识别中」的行**；v3.29：**失败的那封也算跑完** ——
       *      带着失败标记入表，"操作"列可「重新识别」，不再永远挂在识别区里）；
       *   ② 阶段一完成且归属已确定 → 银行函证**再启动阶段二**（「先对应、后细查」的自动衔接）；
       *   ③ 阶段二完成 → 回填核验数据（`verificationApplied` 门控）。
       *
       * ② 必须先于 ① 生效：银行任务在阶段一 `success` 的那个 tick 里由 ② 打进阶段二
       * （`status` 打回 `pending`），于是本 tick 的 ① 自然不满足 `isFullyRecognized` ——
       * 落库被推到阶段二跑完那一 tick；届时 ① 与 ③ 在同一次 `next` 串联里先后执行，
       * 核验数据随记录一起就位（`applyVerification` 依赖 `task.recordId`，必须在 ① 之后）。
       */
      allTasks
        .filter((t) => stagesSettled(t) && !!t.assignSource)
        .forEach((t) => {
          next = finalizeTask(next, t.id)
        })

      allTasks
        /*
         * 阶段一**尘埃落定**就进阶段二（v3.29 由「阶段一成功」放宽到「落定」）——
         * 阶段一某一项失败不该把「询证事项逐项核对」这些后面的事一起卡掉
         * （用户：「不要阻塞，继续识别后面的内容」）。判决仍由最终状态承担：
         * 任一项失败 ⇒ 整封为 `failed`，只是**跑完**这件事照常发生。
         */
        .filter((t) => TYPE_RULE[t.type].twoPhase && t.phase === 1 && stagesSettled(t) && !!t.assignSource)
        .forEach((t) => {
          next = startDetailPhase(next, t.id)
        })

      allTasks
        .filter((t) => TYPE_RULE[t.type].twoPhase && t.phase === 2 && t.status === 'success' && !!t.assignSource)
        .forEach((t) => {
          next = applyVerification(next, t.id)
        })

      /*
       * **不再在这里强行把卡片显示回来**（v3.09 修「正在识别时关不掉」）：
       * TICK 每 600ms 一次，原来只要还有批次在跑就把它置回 `true` ——
       * 用户点 ✕ 收起，**600ms 后又自己弹回来**，看起来就是关不掉。
       *
       * 卡片该不该出现，交给**一次性事件**决定：启动批次（`START_BATCH`）、
       * 归属确认或重切后启动阶段二（`CONFIRM_ASSIGN` / `MANUAL_MATCH` / `COMMIT_SPLIT`）、
       * 重试 —— 那几处各自都置了 `true`；TICK 只负责推进进度，不再碰显示状态。
       */
      return next
    }

    case 'OPEN_ASSIGN':
      return {
        ...state,
        assignOpen: true,
        /* 两个全屏界面互斥 —— 打开归属界面时收掉识别界面（省一层遮罩、也省 pdf.js 实例） */
        insightOpen: false,
        recognitionType: action.uploadType ?? state.recognitionType,
      }
    case 'CLOSE_ASSIGN':
      /*
       * 关闭归属界面 → 回主界面。**不自动打开识别界面**：
       * 识别在后台继续，由右下角进度卡接管，要不要去看由用户主动点（v2.57 用户要求）。
       */
      return {
        ...state,
        assignOpen: false,
        floatingVisible: state.batches.some((b) => b.status !== 'done') || state.floatingVisible,
      }
    case 'DISCARD_BATCH': {
      /* 丢掉这一批（连同它的任务）—— 识别随之停跑，卡片按剩余批次重算显隐 */
      const dropped = state.batches.filter((b) => b.fileName === action.fileName)
      const batches = state.batches.filter((b) => b.fileName !== action.fileName)
      /*
       * **把本批已写进列表的记录一并撤回**（v3.27）。
       *
       * 「没点确定就不该有数据」由 `UploadBatch.committed` 那道闸保证，正常路径下这里
       * 没有记录可撤 —— 它是**兜底**：闸只拦"未提交"，万一将来某条路径在提交后仍能
       * 回到归属界面（如新增"重新切分"入口），点 ✕ 退出时这些记录必须跟着走，
       * 否则列表里会留下**出处已消失**的孤儿行（识别任务没了、状态永远停在「识别中」）。
       * 按 `recordId` 精确撤，不动列表里与本批无关的既有数据。
       */
      const recordIds = new Set(
        dropped.flatMap((b) => b.tasks.map((t) => t.recordId).filter((id): id is string => !!id)),
      )
      return {
        ...state,
        batches,
        records: recordIds.size
          ? state.records.filter((r) => !recordIds.has(r.id))
          : state.records,
        assignOpen: false,
        floatingVisible: batches.some((b) => b.status !== 'done'),
      }
    }
    case 'OPEN_INSIGHT':
      return { ...state, insightOpen: true, assignOpen: false }
    case 'CLOSE_INSIGHT':
      return { ...state, insightOpen: false }
    case 'SET_FLOATING':
      return { ...state, floatingVisible: action.visible }
    case 'CLEAR_FLASH':
      return { ...state, flashRowId: null }
    case 'CLEAR_INSERTED':
      return state.insertedRowIds.length ? { ...state, insertedRowIds: [] } : state
    case 'OPEN_ONBOARDING':
      return { ...state, onboardingVisible: true }
    case 'CLOSE_ONBOARDING':
      return { ...state, onboardingVisible: false, demoLoaded: true }

    case 'IMPORT_EXPRESS':
      return { ...state, expressResult: action.result, expressOpen: true }
    case 'CLOSE_EXPRESS':
      return { ...state, expressOpen: false }

    /**
     * 采纳 / 不采纳某一项 AI 识别结论（v3.28）—— 列表「AI 核验事项」列那枚待办标签的落点。
     *
     * **只写 `aiReview`（"人对 AI 结论的表态"）与处理留痕，不动 `resultInfo`**：
     * 表单最终值只能由人在「回函结果填写」页保存时写入（AI 不外写这条底线不变），
     * 采纳的影响体现为那一页的**初值**（见 `config/aiReview.ts` 的 `aiReviewPrefill`）。
     * 重复点同一状态即原样写回、时间更新 —— 那是"最近一次处理"的正确语义。
     */
    case 'REVIEW_AI_ITEM': {
      const at = dayjs().format('YYYY-MM-DD HH:mm:ss')
      return {
        ...state,
        records: state.records.map((r) =>
          r.id === action.recordId
            ? {
                ...r,
                aiReview: {
                  ...r.aiReview,
                  [action.key]: { status: action.status, by: CURRENT_USER, at },
                },
              }
            : r,
        ),
      }
    }

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
                        /* 归属结论只回答「匹配到哪封」——不带匹配度等内部指标（v2.29 文案精简） */
                        conclusion: `已确认归属函证 ${suggested.confirmationNo}`,
                      }
                    : t.bankMatch,
                },
                `已确认归属函证 ${suggested.confirmationNo}`,
              )
            : t,
        ),
      }))

      /*
       * 归属确认 → 先落库，再**立即启动阶段二**（v2.28「先对应、后细查」：
       * 用户点完「确认归属」不用再做任何事，其余检测项自动异步开跑）。
       */
      /* 归属已定 → 落库并立即启动阶段二（识别在后台继续，界面由用户点「确定」关闭） */
      return startDetailPhase(finalizeTask({ ...state, batches }, action.taskId), action.taskId)
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
                        conclusion: `已指定归属函证 ${action.confirmationNo}`,
                      }
                    : t.bankMatch,
                },
                `已指定归属函证 ${action.confirmationNo}`,
              )
            : t,
        ),
      }))

      /* 归属指定 → 先落库，再**立即启动阶段二**（与 CONFIRM_ASSIGN 同一衔接） */
      const assigned = finalizeTask({ ...state, batches }, action.taskId)
      const started = startDetailPhase(assigned, action.taskId)
      /* 界面是否关闭由用户点「确定」决定（v2.57），此处只推进数据 */
      return finished ? started : { ...started, floatingVisible: true }
    }

    /**
     * 提交「回函归属」界面的手动切分（v2.62）。
     *
     * ## 重建规则：**按页区间复用**，对不上才新建
     *
     * 切分结果与既有任务不是"谁覆盖谁"的关系：
     * · 页区间**完全一致**的旧任务 → **原样保留**（它可能已经跑了识别、甚至已落库，
     *   重建会把进度与核验数据全丢掉）；
     * · 区间一致但**归属变了** → 就地改归属，并把 `applied` 置回 false，让 TICK 按新归属重新落库；
     * · 对不上的区间 → 新建一段（`makeSegmentTask`）。
     *
     * 这条"复用优先"正是**初稿从整份一段开始也不丢演示数据**的原因：银行侧用户
     * 按固定页数 4 页一切得到 1-4 / 5-8 / 9-11，恰好与既有三段一一吻合，
     * 三段的识别进度与核验文案都因此被继承下来。
     */
    case 'COMMIT_SPLIT': {
      if (!action.segments.length) return state

      const batches = state.batches.map((b) => {
        if (b.fileName !== action.fileName) return b
        /* 一个旧任务只能被一段复用（否则两段会指向同一个 task.id） */
        const used = new Set<string>()

        const tasks = action.segments.map((seg, i) => {
          const reused = b.tasks.find(
            (t) => !used.has(t.id) && t.pageStart === seg.pageStart && t.pageEnd === seg.pageEnd,
          )
          if (reused) {
            used.add(reused.id)
            if (reused.confirmationNo === seg.confirmationNo) {
              /*
               * 单号被人工补/改过 → **只改这一个字段**（v2.78）：进度、核验数据一律原样保留。
               * 段尾面单的单号是**段级**数据，与归属、识别进度互不影响。
               */
              return reused.expressNo === seg.expressNo
                ? reused
                : { ...reused, expressNo: seg.expressNo }
            }
            /*
             * 归属改了 → 重新落库：原先按旧归属写进列表的那条不能再算数。
             * 注意这里**不回收旧记录** —— 演示里改归属多发生在「待指定」的段上
             * （它们本就没落库，不会产生重复）；已落库再改属于补正行为，
             * 走回函管理里的补正入口。
             */
            return {
              ...reused,
              confirmationNo: seg.confirmationNo,
              matchedEntity: seg.entity ?? reused.matchedEntity,
              expressNo: seg.expressNo,
              /* 面单页标记随切分结果走（v3.22）—— 用户可能刚把某一段标成面单段/取消标记 */
              faceSheetPage: seg.faceSheetPage ?? reused.faceSheetPage,
              assignSource:
                seg.confirmationNo === '待指定' ? undefined : ('manual-assign' as const),
              applied: false,
              recordId: undefined,
            }
          }
          return makeSegmentTask({
            /*
             * 取**批次内任务的类型**而不是 `b.type`：批次的 type 允许是
             * `'自动判定中'`（上传时类型未定），而任务上的 type 一定是确定的两类之一 ——
             * 切分出的新段必须跟着这份文件本来的类型走。
             */
            type: b.tasks[0]?.type ?? state.recognitionType,
            fileName: b.fileName,
            index: i,
            pageStart: seg.pageStart,
            pageEnd: seg.pageEnd,
            confirmationNo: seg.confirmationNo,
            entity: seg.entity,
            expressNo: seg.expressNo,
            faceSheetPage: seg.faceSheetPage,
          })
        })

        return {
          ...b,
          tasks,
          /*
           * **用户点了「确定」= 本批已提交**（v3.27）—— 闸口自此打开：
           * TICK 的三遍处理会把归属已确定的任务写进回函列表（先「识别中」、阶段二跑完自动刷新）。
           */
          committed: true,
          /* 切分变了 → 批次回到 running，让 TICK 重新接管推进 */
          status: b.status === 'done' ? ('running' as const) : b.status,
        }
      })

      /* 归属已定的段立即落库，并**启动阶段二**（与 CONFIRM_ASSIGN / MANUAL_MATCH 同一衔接） */
      let next: AppState = { ...state, batches, floatingVisible: true }
      const committed = next.batches.find((b) => b.fileName === action.fileName)
      for (const task of committed?.tasks ?? []) {
        if (!task.assignSource) continue
        next = startDetailPhase(finalizeTask(next, task.id), task.id)
      }
      return next
    }

    case 'RETRY_TASK': {
      /*
       * **重新识别**（v3.29 起这条不再只是识别区里失败行的按钮 —— 表格里失败的那一行也有它）。
       *
       * 四件事一起做，缺一件就不成立：
       * ① **把任务重打回起点** —— 各检测项回到 `waiting`、清掉预设失败与原因，
       *    否则重跑会在同一项上**立刻再失败一次**（`plannedFailure` 是演示注入的）；
       * ② **阶段也退回阶段一** —— 两阶段类型若已在阶段二，只把 stages 重置为 waiting 是没用的：
       *    `advanceBatch` 按 `t.phase` 分通道挑任务，`phase === 2` 的那封**永远不会被阶段一的
       *    通道挑中**，于是它那几项会永远停在"待×××"。故这里砍掉阶段二追加的那些项并把
       *    `phase` 退回 1，跑完后由 `startDetailPhase` 重新追加（既有机制，不必重写）。
       * ③ **把已落库的那条记录撤下** —— 它正是要"重新识别"的数据，重跑期间不该还留在列表里
       *    （与 v3.27「没识别完不写列表」同一条口径）；跑完会再次入表、并重播插入动效，
       *    所以 `insertedRowIds` 里也要先摘掉它（否则第二次入表不会重新挂上动画类）。
       * ④ **让批次重新跑起来** —— 批次多半已是 `done`，不打回 `running` 就没人推进它。
       */
      const target = findTask(state, action.taskId)
      if (!target) return state
      const phase1Count = makeStages(target.type, 1, target.detailPlan).length

      const batches = state.batches.map((b) =>
        b.tasks.some((t) => t.id === action.taskId)
          ? {
              ...b,
              status: 'running' as const,
              tasks: b.tasks.map((t) =>
                t.id === action.taskId
                  ? {
                      ...t,
                      status: 'pending' as const,
                      phase: 1 as const,
                      needManual: false,
                      plannedFailure: undefined,
                      failReason: undefined,
                      /* 落库标记一并清掉，跑完会作为"新的一行"重新写入 */
                      applied: false,
                      recordId: undefined,
                      verificationApplied: false,
                      stages: t.stages
                        .slice(0, phase1Count)
                        .map((s) => ({ ...s, status: 'waiting' as const, percent: 0 })),
                    }
                  : t,
              ),
            }
          : b,
      )

      return {
        ...state,
        batches,
        records: target.recordId
          ? state.records.filter((r) => r.id !== target.recordId)
          : state.records,
        insertedRowIds: state.insertedRowIds.filter((no) => no !== target.confirmationNo),
        floatingVisible: true,
      }
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
      /* 跳过也是「这一段处理完了」—— 界面是否关闭仍由用户点「确定」决定（v2.57） */
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
                /*
                 * **两步独立、允许反序做**（v3.12）：若用户先把回函结果填了（该行已是「已完成」）、
                 * 之后才回来确认快递信息，进度**不能倒退回「待填写回函结果」** ——
                 * 否则列表会退回一步，而"结果已填"这件事并没有被撤销。
                 */
                replyProgress: r.replyProgress === '已完成' ? '已完成' : '待填写回函结果',
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

    /**
     * 提交并归档「回函结果」。
     *
     * **不再顺带把 `verifyStatus` 置为 `verified`、也不再打核验留痕**（v3.12 修）：
     * 那两个字段是「**确认回函快递信息**」这一步的产物（那一步是全流程唯一的人工核验留痕动作），
     * 与"回函结果填完没有"是**两件独立的事**、两步之间没有必然先后。
     * 原先在这里顺手置上，后果是**结果填完、快递信息那一步在列表里也被打勾**，
     * 而用户其实从没确认过快递信息（用户实测报「前面的快递信息也会默认勾选完成，但实际上并没有完成」）。
     *
     * **进度取值随之收严**：回函结果填完，只有"快递信息"那一步**也已确认**才置「已完成」，
     * 否则**留在「待确认快递信息」**（= 第一个还没做的步骤）。这样「已完成」恒等于"两步都完成"，
     * 而"下一步做什么"仍由进度与步骤条的当前步**一致**表达（步骤条上「回函结果」那格照常打勾）。
     */
    case 'SUBMIT_RESULT':
      return {
        ...state,
        records: state.records.map((r) =>
          r.id === action.recordId
            ? {
                ...r,
                ...action.patch,
                replyProgress: r.verifyStatus === 'verified' ? '已完成' : '待确认快递信息',
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
