import { useMemo, useState } from 'react'
import { Button, message } from 'antd'
import { useApp } from '@/store/AppStore'
import FullscreenModal from '@/components/FullscreenModal'
import PageSplitBoard from '@/components/PageSplitBoard'
import SplitPanel, { FACE_SHEET, UNASSIGNED } from '@/components/SplitPanel'
import type { AssignCandidate } from '@/components/SplitPanel'
import { AUDITED_ENTITY, CANDIDATE_SOURCES } from '@/mock/confirmations'
import {
  browserSampleUrlByFileName,
  faceSheetUrlOfFile,
  faceSheetUrlOfPage,
} from '@/config/preview'
import { TYPE_RULE } from '@/services/replyRule'
import { StageIcon } from '@/components/recognition/shared'
import { SmartSplitAction } from '@/components/SmartSplitAction'
import { cutsOfSegments, segmentsOfCuts, toggleCut } from '@/utils/pageSplit'

/** 切分草稿 —— 归属界面是**一次性事务**，草稿不落 store（关掉就该忘掉这次编辑） */
interface Draft {
  /** 草稿属于哪个文件 —— 换文件即作废、回到初稿 */
  file: string
  /** 切点（第 N 页后切一刀）；空数组 = 整份一段 */
  cuts: number[]
  /** 段序 → 用户显式选定的函证编号（未选过的段不在此表，见 `assignOf`） */
  assigns: Record<number, string>
  /**
   * **页号 → 用户手工补/改过的快递单号**（v3.23 由"按段序"改成"按页"）。
   *
   * ## 为什么必须按页记
   *
   * 单号物理上属于**一页**（往来的段尾面单页 / 银行的面单页），而**段序会变** ——
   * 用户点一次剪刀、或用一次「按固定页数拆分」，段序整体移位，挂在段序上的值就跑到
   * 别的段上去了（v3.22 实测：人工填了第 22 页那个号，随后 AI 结果到达再插两刀，
   * 号显示到了第 17 页那一段上 —— 用户看到的就是"识别完和我的不一样了"）。
   * 页不会因为切分而改变，所以值挂在页上就永远不会串位。
   *
   * 这是 `faceSheetPages` 用过的同一套做法（那次也是从段序改成的按页，见其注释）。
   * 取用时看该段的**末页**（`manualOf`）—— 单号总在段的末尾那一页上。
   *
   * **只对"未识别到 / 异常"的段开放修改** —— 判定见 `@/utils/expressNo`，
   * 那里也写了为什么不做"逐段人工核对"。空串是合法值（人主动清空，仍要能改）。
   */
  express: Record<number, string>
  /**
   * 被标成**快递面单页**的页码（v2.83，银行侧）。
   *
   * **按"页"记、不按"段序"记** —— 这是实测踩出来的：角色若挂在段序上，
   * 用户接着按 4 页一切，段序 1 就从"第 17 页那一段"变成了"第 5-8 页那一段"，
   * **面单被标到了别的页上**，而那一段还会因此在提交时被排除掉（连页一起丢）。
   * 页不会因为切分而改变，所以"是不是面单"是**页的属性**：
   * 由面单页组成的段才是面单段 —— 这也和纸面一致（面单就是那几页）。
   */
  faceSheetPages: number[]
}

/**
 * 回函归属（v2.57 立，v2.60 起两类函证共用，**v2.62 改为页级手动切分**）
 *
 * ## 它是什么
 *
 * **独立全屏界面，只做「把这份回函切成几段、每段归到哪封函证」这件事**。
 * 点「确定」提交切分并关闭，之后识别在后台跑、由右下角进度卡接管。
 *
 * ## v2.62 为什么改
 *
 * 用户原话：
 * > ① 往来函证会按照函证右上方的二维码进行切分归属（不需要 ai），但是有可能会识别错误，
 * >   因此需要用户**手动修改切分的内容**；
 * > ② 银行函证使用 ai 去识别内容、然后再切分归属，**效率太低了，用户交互感也很差**，
 * >   因此也**直接让用户手动批量切分 + 手动微调**。
 *
 * 于是撤掉"AI 识别内容 → 得出归属"这条链路（它慢，且用户并不需要看这个过程），
 * 改为**照用户给的参考界面做页级切分**：左侧一页一张缩略图、页间一把剪刀，
 * 右侧选批量拆分方式 + 给每段挂归属。**两类函证用同一套手动切分**，
 * 区别只在初稿 —— 往来按二维码已切好（可微调），银行是整份一段（从头切）。
 *
 * 「AI 核验」不在这里：它是后台自动跑、用户不干涉的查看型内容
 * （用户原话：「用户不会去干涉识别结果，只需要在最后回函管理里选择用不用这个结果就行了」），
 * 与"必须人工判断"的切分归属混在一屏只会把注意力摊薄。
 *
 * ## 切分与归属为什么在同一屏
 *
 * 每段直接挂一个归属下拉（用户选定：「每段一个下拉，从函证清单里选」）——
 * 切完即归完，不必"先切完、再换一处逐段点选归属"。切分是**手段**，归属才是**目的**。
 */
export default function AssignView() {
  const { state, dispatch } = useApp()
  /** 往来函证：初稿由二维码切好；银行函证：整份一段、从头手动切 */
  const isTrade = state.recognitionType === '往来函证'

  const allTasks = useMemo(() => state.batches.flatMap((b) => b.tasks), [state.batches])

  /**
   * 打开界面时定位到哪个文件 —— **优先给"还没归属完"的那个**（那才是要做的事），
   * 都归完则取第一个。不落 store：这是**一次性事务**的选择，关掉就该忘掉。
   */
  const firstPendingFile = allTasks.find((t) => !t.assignSource && t.status !== 'failed')?.fileName
  const currentFile = firstPendingFile ?? allTasks[0]?.fileName ?? null

  /** 当前文件的全部段（含已归属的）—— 缩略图板与初稿都基于它 */
  const fileTasks = useMemo(
    () =>
      allTasks
        .filter((t) => t.fileName === currentFile)
        .sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0)),
    [allTasks, currentFile],
  )

  /**
   * 整份文件的页数 —— **取数据里写定的 `pageCount`**（银行 11 / 往来 9），
   * 而不是样例扫描件的真实页数：用户要切的是"这份 11 页的文件"，
   * 缩略图板以它为准（超出样例实际页数时循环取页，见 `PageSplitBoard` 顶部说明）。
   */
  const pageCount = useMemo(() => {
    const batch = state.batches.find((b) => b.tasks.some((t) => t.fileName === currentFile))
    if (batch?.pageCount) return batch.pageCount
    return Math.max(1, ...fileTasks.map((t) => t.pageEnd ?? 0))
  }, [state.batches, currentFile, fileTasks])

  /**
   * 「改」某个段的快递单号时，请求把**该段最后一页（面单页）**钉在屏幕上（v2.79）。
   *
   * 一处状态、两个使用者：切分板负责画，切分结果负责说"我要看哪一页、对齐到哪一行"。
   * 之所以要钉住而不是靠悬停：用户此刻要**眼睛看面单、手在输入框里敲** ——
   * 悬停预览会随鼠标移开消失、还正好压住输入框。
   *
   * **`n` 是请求序号（v3.08 修）** —— 见下面 `onRequestPreview` 的说明。
   */
  const [previewPin, setPreviewPin] = useState<{ page: number; anchor: HTMLElement; n: number } | null>(
    null,
  )

  /**
   * 本文件所在批次是否**带快递面单**（`UploadBatch.faceSheetLast`）。
   * 同一个字段，两类函证含义不同（v2.83 起银行也用它）：
   * · 往来「是」= **每段**尾部各有一页面单 → 单号带在各段自己身上（一对一）；
   * · 银行「是」= **整份文件**尾部有一页面单 → 它管辖前面的函证段（一对多）。
   */
  const batchFaceSheetLast = useMemo(() => {
    const batch = state.batches.find((b) => b.tasks.some((t) => t.fileName === currentFile))
    return batch?.faceSheetLast === true
  }, [state.batches, currentFile])

  /**
   * **快递面单的识别结果（异步到达）** —— 哪些页是面单页（v3.21）。
   *
   * 判据 = 「这一段被标成面单页」**且** 其「快递面单识别」检测项**已跑完** —— 也就是
   * **结果真的回来了**才算数。到达前恒为空：用户先手工切他的函证段，识别在后台认面单，
   * 两者互不等待（这正是本版要的形态：面单/条码是**纯读**的活，与人的切分动作无依赖）。
   *
   * 注意：**不再猜"末页是面单"**。以前靠一份静态表 + `faceSheetLast` 直接预切，
   * 那份表只在演示环境成立；真实环境得等识别，猜错会把不是面单的页切出成"面单段"。
   */
  const detectedFacePages = useMemo(
    () =>
      fileTasks
        .filter(
          (t) =>
            t.faceSheetPage === true &&
            t.pageStart != null &&
            t.stages.some((s) => s.key === 'expressSheet' && s.status === 'done'),
        )
        .map((t) => t.pageStart as number)
        .sort((a, b) => a - b),
    [fileTasks],
  )

  /**
   * **快递面单识别的总体状态**（v3.22）—— 供归属界面顶部那行状态（图标 + 文字 + 计数）。
   *
   * 为什么需要它：面单段会**自己长出来**（识别结果到达 → 初稿自动重算），此前没有任何反馈 ——
   * 用户既不知道"系统正在认面单"，也不知道"刚多出来的那一段是它加的"。用户原话：
   * 「现在这个演示数据，并不能看到自动识别分包裹的过程」。
   *
   * 口径：以本文件各任务的「快递面单识别」检测项为准（银行批次每个任务都有这一项：
   * 函证段给出"本封所在包裹的面单/单号"，面单页给出"这一页是面单"）。
   */
  const faceSheetScan = useMemo(() => {
    const list = fileTasks.flatMap((t) => t.stages.filter((s) => s.key === 'expressSheet'))
    return {
      failed: list.some((s) => s.status === 'failed'),
      allDone: list.length > 0 && list.every((s) => s.status === 'done'),
    }
  }, [fileTasks])

  /**
   * 切分草稿。
   *
   * **初稿按类型分**（用户明确指定的做法）：
   * · 往来 —— 二维码已把文件切成几段，人要做的是"核对 + 改错"，故初稿 = 现有分段；
   * · 银行 —— 「整份 1 段，从头手动切」，故初稿 = **一个切点都没有**。
   *   用户用右栏的批量方式或逐页剪刀自己切；此后每段的归属下拉会按**页区间**
   *   自动预填既有识别结果（见 `assignOf`），所以从头切也不会丢演示里的归属线索。
   *
   * ## 银行侧的两条路（v3.26）
   *
   * 上面说的是**手动模式**。另一条是**智能模式**（`state.aiDraft`）：系统先认一遍，
   * 把**切分 / 归属 / 快递单号**一次给全 —— 初稿直接**按识别出的每封页区间切好**
   * （面单页本就各自成段），于是：
   * · 归属不用另写 —— 每段的页区间与某封函证的识别结果**完全吻合**，`assignOf` 的下拉
   *   自动预填那个编号（机制早就有，见那里的说明）；
   * · 单号也不用另写 —— 面单段持有单号、被管辖的函证段自动继承（见 `expressOf`）。
   * 所以"智能初稿"要做的只有一件事：**别再用整份一段，改用识别出的页区间**。
   *
   * 两条路的**共同约束**（v3.23）：一旦用户在界面上动过切分，草稿就归人工，
   * 识别结果**不再回写**（`draftState` 一非空，本函数的结果就只是"没动过时的底稿"）。
   */
  const baseDraft: Draft = useMemo(() => {
    if (!isTrade) {
      /*
       * **智能模式**：初稿 = 识别结果的落点。
       *
       * 判据用"任务是否带页区间"（`pageStart/pageEnd`）——那正是识别给出的切分；
       * 面单页任务自然也在其中（`faceSheetPage`），故面单段一并就位。
       * 归属与单号由 `assignOf` / `expressOf` 从这些任务上取（无需在此重复）。
       */
      if (state.aiDraft) {
        const segs = fileTasks.flatMap((t) =>
          t.pageStart != null && t.pageEnd != null
            ? [{ pageStart: t.pageStart, pageEnd: t.pageEnd }]
            : [],
        )
        const facePageList = fileTasks
          .filter((t) => t.faceSheetPage === true && t.pageStart != null)
          .map((t) => t.pageStart as number)
        return {
          file: currentFile ?? '',
          cuts: cutsOfSegments(segs),
          /* 两张表都留空：预填全部由"按页区间查任务"完成（见上方说明） */
          assigns: {},
          express: {},
          faceSheetPages: facePageList,
        }
      }
      /*
       * 银行：默认「整份 1 段，从头手动切」（整份里可能装着多封函证，只有人能切开）。
       *
       * **面单侧只认识别结果**（v3.21）：识别跑完前一个面单段都不预切 ——
       * 用户先手工切他的函证段，识别在后台认面单，互不等待；结果到达时若用户**还没动过**切分，
       * 这里的初稿会**自动重算**（面单页变成独立段），用户只需专心切前面的函证。
       * 若他**已经切过**，绝不覆盖，改成界面顶部一条可一键执行的待办。
       */
      const facePages = detectedFacePages
      return {
        file: currentFile ?? '',
        /*
         * **面单页前后各切一刀**，把它单独隔成一段 —— 面单页在原件里本就是一页独立的东西。
         * 只切"前面一刀"是不够的：那样它只是下一段的第一页，仍然不是独立段（v2.85 实测踩到，
         * 结果第 17 页那张"已识别"的面单根本显示不出来）。
         */
        cuts: facePages.flatMap((p) => [p - 1, p]),
        assigns: {},
        express: {},
        /* 按**页**记（用户后面随便切，它都不会跑偏 —— 见 `Draft.faceSheetPages`） */
        faceSheetPages: facePages,
      }
    }
    /* 往来：把现有分段还原成切点（`flatMap` 顺便收窄掉缺页码的异常任务） */
    const segs = fileTasks.flatMap((t) =>
      t.pageStart != null && t.pageEnd != null
        ? [{ pageStart: t.pageStart, pageEnd: t.pageEnd }]
        : [],
    )
    return {
      file: currentFile ?? '',
      cuts: cutsOfSegments(segs),
      assigns: {},
      express: {},
      /* 往来不把面单页切出来（它的面单页就是各段自己的尾页）—— 故这里恒为空 */
      faceSheetPages: [],
    }
  }, [currentFile, isTrade, fileTasks, detectedFacePages, pageCount, state.aiDraft])

  const [draftState, setDraftState] = useState<Draft | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  /* 草稿属于当前文件才用它，否则回到初稿（换文件 / 首次进入） */
  const draft: Draft =
    draftState && draftState.file === (currentFile ?? '') ? draftState : baseDraft

  const segments = useMemo(() => segmentsOfCuts(pageCount, draft.cuts), [pageCount, draft.cuts])

  /** 段 i 覆盖的页码 */
  const pagesOfSegment = (i: number): number[] => {
    const seg = segments[i]
    if (!seg) return []
    return Array.from({ length: seg.pageEnd - seg.pageStart + 1 }, (_, k) => seg.pageStart + k)
  }

  /**
   * 段 i 是不是**快递面单段**（v2.83，银行侧）—— 它不是一个函证，
   * 而是"本文件共用的一张面单"，职责是**给前面的函证段提供快递单号**。
   *
   * 判据 = 「**这一段的页全都是面单页**」（页的属性，见 `Draft.faceSheetPages`）。
   * 往来侧永远为 false：它的面单页是每段自己的尾页、不单独成段（用户明确要求往来逻辑不变）。
   */
  const isFaceSheetSegment = (i: number) => {
    if (isTrade) return false
    const pgs = pagesOfSegment(i)
    return pgs.length > 0 && pgs.every((pg) => draft.faceSheetPages.includes(pg))
  }

  /**
   * 识别到、但**没有被切成独立段**的面单页（v3.21 立，v3.23 改口径）——
   * 只在"用户已经动过切分"时才会非空。
   *
   * ## 口径（v3.23 用户拍板）
   *
   * 「**如果是用户已经切分过处理过的，识别出来以后，就不再另做切分了，按人工的切分为准**」——
   * 故它只用来出**提示**（见下面那条提示行），**不再提供「切出为面单段」这类系统改切分的入口**：
   * · **没动过**切分 → 初稿照旧自动重算（面单页就是独立段）—— 那是给还没动过的人**出的初稿**，
   *   不算"另做切分"；
   * · **动过** → 一个字都不改，只提示。认同识别结果的话，用页间剪刀切一刀、
   *   或把该段归属改成「快递面单（本文件共用）」即可（提示行里写着这句）。
   */
  const pendingFacePages = useMemo(() => {
    if (!draftState) return []
    return detectedFacePages.filter((p) => !draft.faceSheetPages.includes(p))
  }, [draftState, detectedFacePages, draft.faceSheetPages])

  /**
   * 段 i 由**哪一段面单**管辖 —— 规则一句话：**面单段管辖它前面的段，直到上一个面单段为止**。
   *
   * 所以对"我要找我的面单"这一段来说，答案是**它后面最近的那个面单段**（`j > i` 方向找）——
   * 别顺手往前面找：面单在文件尾部时前面根本没有面单段，会一个都管不到（v2.83 实测踩到）。
   * 取"最近的下一个"而不是"文件里唯一那张面单"，是为了让
   * `函证…面单…函证…面单`（一个 PDF 里扫了两个包裹）也成立：后面那张面单管后半段。
   */
  const governedBy = (i: number): number | null => {
    if (isFaceSheetSegment(i)) return null
    for (let j = i + 1; j < segments.length; j++) if (isFaceSheetSegment(j)) return j
    return null
  }

  /** 可归属的候选函证 —— **按当前函证类型筛**（银行批次不列往来函证，反之亦然） */
  const candidates = useMemo<AssignCandidate[]>(() => {
    /*
     * 候选 = 该类型下**本期函证控制表里的全部函证**，两处来源取并集：
     * · `CANDIDATE_SOURCES` —— 控制表本身；
     * · 已有回函记录 —— 演示数据里两处各只覆盖了一部分（往来侧尤其明显：
     *   候选表是 008/009/010，而演示批次的分段是 006/005/003），**只取其一必然出现
     *   「预填的归属不在下拉里」** —— antd 的 Select 找不到匹配项时会退化成直接显示裸值，
     *   界面上就只剩一个光秃秃的函证编号，被审计单位与被询证单位全都看不到。
     *   （真实系统里控制表本就是全量，这条并集只是把演示数据的缺口补上。）
     */
    const byNo = new Map<string, AssignCandidate>()
    CANDIDATE_SOURCES.filter((c) => c.type === state.recognitionType).forEach((c) =>
      byNo.set(c.confirmationNo, {
        confirmationNo: c.confirmationNo,
        entity: c.entity,
        auditedEntity: c.auditedEntity,
      }),
    )
    state.records
      .filter((r) => r.type === state.recognitionType)
      .forEach((r) => {
        if (byNo.has(r.confirmationNo)) return
        byNo.set(r.confirmationNo, {
          confirmationNo: r.confirmationNo,
          entity: r.entity,
          auditedEntity: AUDITED_ENTITY,
        })
      })
    return [...byNo.values()].sort((a, b) => a.confirmationNo.localeCompare(b.confirmationNo))
  }, [state.recognitionType, state.records])

  /**
   * 与该段**页区间完全一致**的既有任务 —— 归属与快递单号都从它预填。
   * 页区间就是段与段、段与任务之间的天然配对键（切的是什么，任务就是哪一段）。
   */
  const taskOfSegment = (i: number) =>
    fileTasks.find((t) => t.pageStart === segments[i]?.pageStart && t.pageEnd === segments[i]?.pageEnd)

  /**
   * 段 i 的归属：**用户显式选过就用他的，否则按页区间从既有任务里预填**。
   *
   * 预填的意义在于"从头切也不丢线索"：银行侧初稿是整份一段（没有任何归属），
   * 但用户一旦按固定页数 4 页切成 1-4 / 5-8 / 9-11，这三段与既有识别结果
   * **页区间完全吻合**，下拉就会各自预填上 `QS2024-031` 等 —— 用户确认即可、不必重选，
   * 要改也随时能改。**预填值不是结论**：它只是下拉的初始选项，人仍可改。
   */
  const assignOf = (i: number): string => {
    /* 面单段不是一个函证：它的"归属"就是那个角色本身，直接给哨兵值 */
    if (isFaceSheetSegment(i)) return FACE_SHEET
    const picked = draft.assigns[i]
    if (picked) return picked
    const matched = taskOfSegment(i)
    return matched && matched.confirmationNo !== UNASSIGNED ? matched.confirmationNo : UNASSIGNED
  }

  /**
   * 段 i 上**人工填过**的单号（未填过 = `undefined`，人主动清空 = 空串）—— v3.23。
   *
   * 取该段**末页**那一格：单号物理上属于一页（往来的段尾面单页 / 银行的面单页），
   * 用户改了切分之后，值只跟着**那一页**走，不会串到别的段上。
   */
  const manualOf = (i: number): string | undefined => {
    const pgs = pagesOfSegment(i)
    const last = pgs[pgs.length - 1]
    return last == null ? undefined : draft.express[last]
  }

  /**
   * 段 i 的**段尾面单快递单号**：用户手工补/改过就用他改的，否则取该段任务上识别出的值。
   *
   * 未识别到时为 `undefined`（切分结果会标「未识别到」并允许就地补）。
   * **它是段级数据** —— 面单页就是本段最后一页，与"这封函证最近一次回函的单号"是两回事
   * （同一封函证多次回函就有多个单号），所以不取 `ReplyRecord.expressNo`。
   */
  const expressOf = (i: number): string | undefined => {
    /*
     * 被面单段管辖的函证段：**继承那张面单的单号**（v2.83）。
     * 值只存在面单段那一处 —— 一个快递单号对应多个函证编号时，改一处就全都跟着改，
     * 也不会被"与他段重复"的查重规则误报成读错。
     */
    const src = isFaceSheetSegment(i) ? i : (governedBy(i) ?? i)
    return manualOf(src) ?? recognizedOf(src)
  }

  /**
   * 段 i 上**系统识别到的**单号 —— 只在「快递面单识别」这一项**跑完后**才算数（v3.23）。
   *
   * 原先这里是直接读 `task.expressNo`，一进归属界面就有值 —— 而"识别还没结果"这件事
   * 对用户是**没有出口**的：他标了一页面单，界面却已经显示着一个号（还是只读的），
   * 于是「识别期间先把号填上」这条最自然的路根本走不通（用户场景原话：
   * 「**在 ai 识别银行函证快递面单的过程中，用户已经完成了切分和快递面单快递单号录入**」）。
   *
   * 现在与「面单页」同一口径（都在等这个检测项）：没跑完 = 值还没到 = 该行显示「未识别到」、
   * 给「改」入口让用户先填；识别结果到达后，**人工值优先、不覆盖**，并在旁边挂一枚
   * 「系统识别 …」标签作为提醒（见 `SplitPanel`）。
   */
  const recognizedOf = (i: number): string | undefined => {
    const t = taskOfSegment(i)
    if (!t) return undefined
    /*
     * **智能模式下不等门控**（v3.26）：那条路的语义就是"系统已经认完了"（初稿即结果），
     * 若还卡"检测项是否跑完"，用户会看到"已切好的面单段旁边没有单号"，
     * 与上一行「智能识别已应用」自相矛盾。
     */
    const done =
      state.aiDraft || t.stages.some((s) => s.key === 'expressSheet' && s.status === 'done')
    return done ? t.expressNo : undefined
  }

  /** 人工填/改段 i 的单号 —— 写进**该段末页**那一格（见 `Draft.express`） */
  const setManualExpress = (i: number, value: string) => {
    const pgs = pagesOfSegment(i)
    const last = pgs[pgs.length - 1]
    if (last == null) return
    patch({ express: { ...draft.express, [last]: value } })
  }

  /** 面单段数量（银行侧；往来恒为 0）—— 只用于底栏计数文案 */
  const faceSheetCount = segments.filter((_, i) => isFaceSheetSegment(i)).length
  /** 需要归属的段 = 段数减去面单段（面单段不是函证，谈不上归属） */
  const confirmSegments = segments.length - faceSheetCount
  const specified = segments.filter((_, i) => !isFaceSheetSegment(i) && assignOf(i) !== UNASSIGNED).length
  const fileUrl = browserSampleUrlByFileName(currentFile ?? '')

  /* 编辑动作 —— 每次都把 `file` 带上，草稿才有"属于哪个文件"的身份 */
  const patch = (next: Partial<Draft>) =>
    setDraftState({ ...draft, file: currentFile ?? '', ...next })

  /* -------------------- 智能识别（v3.26）：应用 / 重跑 -------------------- */

  /**
   * 等一次"替换确认"：用户**已经动过切分**时，点智能识别不该把他的成果悄悄冲掉
   * （v3.23 的既定口径：人工切分为准、不静默覆盖）。故先问一句，再替换。
   */
  const [replacingAi, setReplacingAi] = useState(false)

  /** 真正应用：置标志 + **丢掉手工草稿** → 初稿换成识别结果 */
  const runAiDraft = () => {
    dispatch({ type: 'APPLY_AI_DRAFT' })
    setDraftState(null)
    setReplacingAi(false)
  }

  /** 5 秒识别跑完 —— 没动过就直接应用；动过则先确认 */
  const handleSmartSplitDone = () => {
    if (draftState) setReplacingAi(true)
    else runAiDraft()
  }

  const handleToggleCut = (afterPage: number) =>
    patch({ cuts: toggleCut(pageCount, draft.cuts, afterPage) })

  if (!state.assignOpen) return null

  /*
   * 本批没有可处理的段 —— 界面**保留**，等用户点「确定」（关闭必须由用户发起，
   * 不允许自动消失：那样用户来不及确认最后一段归到哪里去了）。
   */
  if (!currentFile) {
    return (
      <FullscreenModal
        open
        title="回函归属"
        subtitle={state.recognitionType}
        onClose={() => dispatch({ type: 'CLOSE_ASSIGN' })}
        footer={
          <div style={{ display: 'flex' }}>
            <Button
              type="primary"
              style={{ marginLeft: 'auto' }}
              onClick={() => dispatch({ type: 'CLOSE_ASSIGN' })}
            >
              确定
            </Button>
          </div>
        }
      >
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text-1)' }}>
            本批回函已全部归属完成
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--c-text-2)' }}>
            其余检测项在后台继续识别，完成后结果自动写入回函管理列表 —— 点「确定」返回列表。
          </div>
        </div>
      </FullscreenModal>
    )
  }

  const unspecified = confirmSegments - specified
  /* 银行侧"还没开始切"的判据是**函证段只有 1 段**（带面单时会预切出一段面单，段数不再是 1） */
  const untouched = !isTrade && confirmSegments === 1 && pageCount > 1

  /**
   * **退出（✕ / Esc）= 放弃本次上传**（v3.10）。
   *
   * 切分与归属都只是**草稿**（不落 store），没点「确定」就没有提交（口径：归属未确定绝不落库），
   * 所以退出时把这批一起丢掉 —— 原来的实现里 ✕ 与「确定」在 store 层是**同一个动作**，
   * 后果是：批次还在后台跑识别，而 `pendingAssignCount > 0` 让右下角进度卡**永远收不起来**，
   * 卡片上还写着「正在对应 N 份」，可**没有任何入口回到本界面**（`OPEN_ASSIGN` 无人派发）。
   */
  const discardUpload = () => {
    dispatch({ type: 'DISCARD_BATCH', fileName: currentFile })
    message.info('已放弃本次上传 —— 切分与归属未提交，识别已取消')
  }

  return (
    <FullscreenModal
      open={state.assignOpen}
      title="回函归属"
      subtitle={`${state.recognitionType} · ${currentFile} · 共 ${pageCount} 页`}
      onClose={discardUpload}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
            共 <b className="num">{segments.length}</b> 段
            {faceSheetCount > 0 && (
              <>
                （含 <b className="num">{faceSheetCount}</b> 段快递面单）
              </>
            )}{' '}
            · 已指定归属 <b className="num">{specified}</b>/{confirmSegments}
          </span>
          {unspecified > 0 && (
            <span style={{ fontSize: 13, color: 'var(--c-warn-text, var(--c-text-3))' }}>
              · 还有 <b className="num">{unspecified}</b> 段为「待指定」，确定后这些段不会写入回函列表
            </span>
          )}
          {untouched && (
            <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
              · 尚未切分，左侧点页间剪刀或右栏批量拆分
            </span>
          )}
          <Button
            type="primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              /* 提交切分（重建该文件的任务），再关闭界面 —— 关闭必须由用户发起 */
              dispatch({
                type: 'COMMIT_SPLIT',
                fileName: currentFile,
                /*
                 * **面单段现在照提交**（v3.22 改了 v2.83 的老规矩）。
                 *
                 * v2.83 时不提交，理由是"面单段不是函证，不该生成任务、更不该写进回函列表"——
                 * 那时它只是用户自己划出来放单号的一段，单号已经落在被管辖函证段的 `expressNo` 上。
                 * 但 **v3.21 起模型变了：哪几页是面单是识别结果**，而**只有任务记着它**
                 * （`faceSheetPage`）。不提交就等于把识别结果扔掉，实测两处后果：
                 * ① 识别界面里看不到「快递面单」那一组（用户问的正是"面单识别过程怎么没有标识"）；
                 * ② 重开归属界面时 `detectedFacePages` 为空 → 状态行退化成"未识别到快递面单"，
                 *   面单刀也预切不出来了。
                 * 两条"不写进列表"的约束仍然成立：面单段的 `confirmationNo` 恒为「待指定」，
                 * 落库只认**有归属**的段（见 `COMMIT_SPLIT` 与 `finalizeTask`）。
                 */
                segments: segments.map((seg, i) => {
                  const isFace = isFaceSheetSegment(i)
                  /* 面单段不参与归属 —— 它不是函证，归属下拉在它那一行是隐藏的 */
                  const confirmationNo = isFace ? '待指定' : assignOf(i)
                  return {
                    ...seg,
                    confirmationNo,
                    entity: isFace
                      ? undefined
                      : candidates.find((c) => c.confirmationNo === confirmationNo)?.entity,
                    /* 单号随段提交（可能是识别的、也可能是人工补/改的，v2.78） */
                    expressNo: expressOf(i),
                    faceSheetPage: isFace || undefined,
                  }
                }),
              })
              dispatch({ type: 'CLOSE_ASSIGN' })
            }}
          >
            确定
          </Button>
        </div>
      }
    >
      {/*
       * **初稿来源一行**（v3.26）—— 银行侧切分有两条路，这里交代"当前这份切分是怎么来的"：
       * · 手动：初稿是整份一段（**系统不替用户预判**），也可由系统先认一遍；
       * · 智能：切分 / 归属 / 快递单号都已就绪，用户逐段确认即可，可随时改。
       * 右侧那个动作与**上传弹窗里的入口**共用同一个组件（`SmartSplitAction`）。
       */}
      {!isTrade && (
        <div
          className="assign-draftsrc"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontSize: 13,
            color: 'var(--c-text-2)',
          }}
        >
          {state.aiDraft ? (
            <span>
              <b style={{ color: 'var(--c-primary)' }}>✦ 智能识别已应用</b>
              {' —— '}已切好 <b className="num">{confirmSegments}</b> 封函证 +{' '}
              <b className="num">{faceSheetCount}</b> 段快递面单（<b className="num">{faceSheetCount}</b>{' '}
              个包裹），归属与快递单号已带入，请逐段确认；识别结果同样可以改
            </span>
          ) : (
            <span>
              当前为<b>手动切分</b>（初稿：整份一段）—— 也可由系统先认一遍：
              <b>切分 · 归属 · 快递单号</b>
            </span>
          )}
          {replacingAi ? (
            <>
              <span style={{ color: 'var(--c-risk-high-text)' }}>将用识别结果替换你当前的切分</span>
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px', height: 'auto' }}
                onClick={runAiDraft}
              >
                确认替换
              </Button>
              <Button
                type="text"
                size="small"
                style={{ padding: '0 4px', height: 'auto', color: 'var(--c-text-3)' }}
                onClick={() => setReplacingAi(false)}
              >
                取消
              </Button>
            </>
          ) : (
            <span style={{ marginLeft: 'auto' }}>
              <SmartSplitAction
                size="small"
                compact
                label={state.aiDraft ? '重新智能识别' : '智能识别'}
                onDone={handleSmartSplitDone}
              />
            </span>
          )}
        </div>
      )}

      {/*
       * 快递面单识别状态（v3.22）—— **有图标、有计数**：进行中 / 已完成 / 失败都有交代。
       *
       * 图标走全站统一的 `StageIcon`（圆形状态图标：待检测 ○ / 检测中 ⟳ / 已完成 ✓ / 失败 ✕）——
       * 同一个语言在识别界面里也在用，用户不必学第二套。**不用弹窗、不用 toast**：
       * 正在切分的人不该被打断，一行状态足够。
       */}
      {/*
       * 面单识别状态行 —— **智能模式下不显示**（v3.26）：那条路的初稿已经包含面单段与单号，
       * 再挂一行"正在识别快递面单…（已识别 1 张）"会与"已切好"自相矛盾；
       * 后台识别的真实进度仍可在右下角进度卡里看，信息不丢。
       */}
      {!isTrade && !state.aiDraft && (
        <div
          className="assign-facesheet"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 12,
            fontSize: 13,
            color: 'var(--c-text-2)',
          }}
        >
          <StageIcon
            status={faceSheetScan.failed ? 'failed' : faceSheetScan.allDone ? 'done' : 'running'}
          />
          <span>
            {faceSheetScan.failed
              ? '快递面单识别失败 —— 可在某段的归属下拉里手工标为「快递面单（本文件共用）」'
              : !faceSheetScan.allDone
                ? `正在识别快递面单${
                    detectedFacePages.length ? `（已识别 ${detectedFacePages.length} 张）` : ''
                  }…`
                : detectedFacePages.length === 0
                  ? '未识别到快递面单'
                  : pendingFacePages.length
                    ? `已识别 ${detectedFacePages.length} 张快递面单 —— 其中 ${pendingFacePages.length} 张未切成独立段，按你的切分为准`
                    : `已识别 ${detectedFacePages.length} 张快递面单，已切成独立段 · 归入 ${faceSheetCount} 个包裹`}
          </span>
        </div>
      )}

      {/*
       * 识别结果**异步到达**、而用户已经动过切分 → 出一条**只读提示**（v3.21 立，v3.23 去掉动作）。
       *
       * 为什么不给按钮：用户拍板「已切分过的，识别出来以后就不再另做切分了，按人工的切分为准」——
       * 那就**没有任何"系统改切分"的入口，包括一键**。要手工切的话路径写在提示里（剪刀 / 归属下拉）。
       */}
      {pendingFacePages.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 'var(--radius-control)',
            background: 'var(--c-primary-bg)',
            fontSize: 13,
            color: 'var(--c-text-1)',
          }}
        >
          <span>
            系统识别到第 <b className="num">{pendingFacePages.join('、')}</b> 页是快递面单 ——
            <b>已按你的切分为准，未做任何改动</b>
            ；如需切成独立面单段，用页间剪刀切一刀，或把该段归属改为「快递面单（本文件共用）」。
          </span>
        </div>
      )}

      <div className="assign-pane">
        {/* 主区：页缩略图 + 页间剪刀 —— 切分从"用页码描述"变成"在页面上直接指" */}
        <div className="assign-pane__board">
          <PageSplitBoard
            fileUrl={fileUrl}
            pageCount={pageCount}
            segments={segments}
            activeIndex={activeIndex}
            onToggleCut={handleToggleCut}
            onPickSegment={setActiveIndex}
            pinnedPage={previewPin?.page ?? null}
            pinnedAnchor={previewPin?.anchor ?? null}
            /* 同一段重复点「改」时，只有这个序号会变 —— 否则切分板里的 effect 不重跑（v3.08） */
            pinRequest={previewPin?.n ?? 0}
            /* 面单页从**面单文件**取图（v2.84；v2.85 一个文件里可能有多个包裹、各一张） */
            faceSheetPages={draft.faceSheetPages}
            faceSheetUrls={Object.fromEntries(
              draft.faceSheetPages.map((pg) => [
                pg,
                /*
                 * 该页有**专属面单样例**就用它；没有（用户自己标出来的页）就退到**本文件的那张面单**。
                 * 不退的话会落到「原件未加载」的空态 —— 实测：把第 9 页标成快递面单后点「改」，
                 * 预览窗里就只剩一行"原件未加载"（v2.89 修）。
                 */
                faceSheetUrlOfPage(currentFile ?? '', pg) ?? faceSheetUrlOfFile(currentFile ?? ''),
              ]),
            )}
          />
        </div>

        {/* 右栏：批量拆分方式 + 切分结果（每段一行 + 归属下拉） */}
        <div className="assign-pane__right">
          <SplitPanel
            /* 类型切换（往来↔银行）时强制重挂载 —— 右栏的默认展开态按类型给（`batchPanelOpenByDefault`），
             * 而 `useState` 只取一次初值；靠 `key` 重置是 React 里的标准做法，比再加一个同步 effect 干净 */
            key={state.recognitionType}
            pageCount={pageCount}
            segments={segments}
            activeIndex={activeIndex}
            onPickSegment={setActiveIndex}
            onCutsChange={(cuts) => patch({ cuts })}
            assigns={Object.fromEntries(segments.map((_, i) => [i, assignOf(i)]))}
            onAssign={(i, v) => {
              /*
               * 选「快递面单」= 把这一段覆盖的页全部标成**面单页**；选别的 = 把这些页从面单页里撤掉。
               * **只改 `faceSheetPages` 这一处** —— 段序会随用户继续切分而变化，页不会
               * （见 `Draft.faceSheetPages` 里那个"面单被标到别的页上"的实测教训）。
               */
              const pgs = pagesOfSegment(i)
              const rest = draft.faceSheetPages.filter((pg) => !pgs.includes(pg))
              if (v === FACE_SHEET) {
                const next = { ...draft.assigns }
                delete next[i]
                patch({ faceSheetPages: [...rest, ...pgs].sort((a, b) => a - b), assigns: next })
                return
              }
              patch({ faceSheetPages: rest, assigns: { ...draft.assigns, [i]: v } })
            }}
            candidates={candidates}
            batchPanelOpenByDefault={TYPE_RULE[state.recognitionType].batchPanelOpenByDefault}
            /*
             * 段下单号行（v3.22 修）——**银行侧不再看「末页是面单」那个假定**：
             * 银行：只有已经识别出面单段、或这一段被某张面单管辖时才显示
             * （此前 `batchFaceSheetLast || …` 让银行在**面单还没识别出来**时就对整份文件显示
             * 「段尾面单 · 快递单号 · 未识别到」，与新的"面单页由识别给出、可不在末页"自相矛盾）；
             * 往来：口径不变（回函末页就是面单）。
             */
            showSegmentExpress={isTrade ? batchFaceSheetLast : faceSheetCount > 0}
            expressValues={Object.fromEntries(segments.map((_, i) => [i, expressOf(i)]))}
            /*
             * 把"人工填过的单号"按**段序**整理一份传给切分结果（v2.93；v3.23 起草稿按页存，这里映射一次）——
             * **表里有这一项 ⟹ 人填过**，切分结果据此保留「改」入口（机器识别的正常值仍只读）。
             */
            manualExpress={Object.fromEntries(segments.map((_, i) => [i, manualOf(i)]))}
            /*
             * **系统识别到的单号**（v3.23）—— 与人工值**分开送**，只用于在那一行挂一枚
             * 「系统识别 …」提醒标签（用户要求：「人工填写了快递单号与识别快递单号不同的，
             * 后面需要以标签的形式，给出系统识别内容，作为提醒。但是不更改人手填的快递单号」）。
             * 这里**不做来源收敛**（不继承面单段的值）：这枚标签只回答"系统在**这一段**读到了什么"。
             */
            recognizedExpress={Object.fromEntries(segments.map((_, i) => [i, recognizedOf(i)]))}
            onExpressChange={setManualExpress}
            /* 银行侧：归属下拉可把某一段标成「快递面单（本文件共用）」（v2.83；往来不提供该选项） */
            allowFaceSheetSegment={!isTrade}
            /* 哪几段是面单段 —— 切分板的"管辖范围/同包裹"等显示都由它自己推导 */
            faceSheetSegments={segments.map((_, i) => i).filter(isFaceSheetSegment)}
            /*
             * **每次请求都递增一个序号**（v3.08 修「只有第一次会弹」）。
             *
             * 同一段的「改」每次请求的是**同一个页码、同一个行元素**，而切分板里那个"钉预览"
             * 的 effect 是按「页码 / 锚点」比依赖的 —— 两个值都没变就不重跑，于是
             * **关掉预览后再点「改」，预览不再出现**（用户实测：「只有第一次进入这个界面时会弹出」）。
             *
             * 带上 `n`，每次点击都是一次**新请求**；而"同一页再次请求保留原取景"那条规则
             * （v2.79，用户拖动找到的位置不该白费）在 effect 内照旧生效。
             */
            onRequestPreview={(page, anchor) =>
              setPreviewPin((prev) =>
                page != null && anchor ? { page, anchor, n: (prev?.n ?? 0) + 1 } : null,
              )
            }
          />
        </div>
      </div>
    </FullscreenModal>
  )
}
