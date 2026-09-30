import { useMemo, useState } from 'react'
import { Button } from 'antd'
import { useApp } from '@/store/AppStore'
import FullscreenModal from '@/components/FullscreenModal'
import PageSplitBoard from '@/components/PageSplitBoard'
import SplitPanel, { FACE_SHEET, UNASSIGNED } from '@/components/SplitPanel'
import type { AssignCandidate } from '@/components/SplitPanel'
import { AUDITED_ENTITY, CANDIDATE_SOURCES } from '@/mock/confirmations'
import {
  browserSampleUrlByFileName,
  faceSheetPagesOfFile,
  faceSheetUrlOfFile,
  faceSheetUrlOfPage,
} from '@/config/preview'
import { TYPE_RULE } from '@/services/replyRule'
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
   * 段序 → 用户**手工补/改过**的快递单号（未改过的段不在此表，见 `expressOf`）。
   *
   * **只对"未识别到 / 异常"的段开放修改** —— 判定见 `@/utils/expressNo`，
   * 那里也写了为什么不做"逐段人工核对"。
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
   */
  const [previewPin, setPreviewPin] = useState<{ page: number; anchor: HTMLElement } | null>(null)

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
   * 切分草稿。
   *
   * **初稿按类型分**（用户明确指定的做法）：
   * · 往来 —— 二维码已把文件切成几段，人要做的是"核对 + 改错"，故初稿 = 现有分段；
   * · 银行 —— 「整份 1 段，从头手动切」，故初稿 = **一个切点都没有**。
   *   用户用右栏的批量方式或逐页剪刀自己切；此后每段的归属下拉会按**页区间**
   *   自动预填既有识别结果（见 `assignOf`），所以从头切也不会丢演示里的归属线索。
   */
  const baseDraft: Draft = useMemo(() => {
    if (!isTrade) {
      /*
       * 银行：默认「整份 1 段，从头手动切」（整份里可能装着多封函证，只有人能切开）。
       * **但带面单时先把末页预切成一段面单段**（v2.83）：银行常见「多封函证 + 一张面单」，
       * 而面单页在原件里本就是一页独立的东西 —— 预切出来，用户就只需专心把前面的函证切几刀，
       * 不必额外记着"还要把面单也切出来"。
       */
      /*
       * 文件里**已知的面单页**（演示数据给的表；v2.85 起一个文件可能有两个包裹、两张面单）。
       * 有它们就各自预切一刀，让每张面单先是独立的一段；没有就退回「末页是面单」的旧口径。
       */
      const knownPages = faceSheetPagesOfFile(currentFile ?? '')
      const facePages = knownPages.length ? knownPages : batchFaceSheetLast ? [pageCount] : []
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
  }, [currentFile, isTrade, fileTasks, batchFaceSheetLast, pageCount])

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
    return draft.express[src] ?? taskOfSegment(src)?.expressNo
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

  return (
    <FullscreenModal
      open={state.assignOpen}
      title="回函归属"
      subtitle={`${state.recognitionType} · ${currentFile} · 共 ${pageCount} 页`}
      onClose={() => dispatch({ type: 'CLOSE_ASSIGN' })}
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
                 * **面单段不提交**（v2.83）—— 它不是函证，不该生成任务、更不该写进回函列表。
                 * 它的职责只是把单号交给被它管辖的函证段（那些段的 `expressNo` 由 `expressOf` 继承而来）。
                 * 于是"一个快递单号对应多个函证编号"落到数据上就是：**多封函证各自带着同一个单号**，
                 * 而这个单号在界面上只有一处来源、一处可改。
                 */
                segments: segments
                  .map((seg, i) => ({ seg, i }))
                  .filter(({ i }) => !isFaceSheetSegment(i))
                  .map(({ seg, i }) => {
                    const confirmationNo = assignOf(i)
                    return {
                      ...seg,
                      confirmationNo,
                      entity: candidates.find((c) => c.confirmationNo === confirmationNo)?.entity,
                      /* 单号随段提交（可能是识别的、也可能是人工补/改的，v2.78） */
                      expressNo: expressOf(i),
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
            showSegmentExpress={batchFaceSheetLast || faceSheetCount > 0}
            expressValues={Object.fromEntries(segments.map((_, i) => [i, expressOf(i)]))}
            /*
             * 把草稿里那张"人工填过的单号"表原样传下去（v2.93）——
             * **表里有这一项 ⟹ 人填过**，切分结果据此保留「改」入口（机器识别的正常值仍只读）。
             */
            manualExpress={draft.express}
            onExpressChange={(i, v) => patch({ express: { ...draft.express, [i]: v } })}
            /* 银行侧：归属下拉可把某一段标成「快递面单（本文件共用）」（v2.83；往来不提供该选项） */
            allowFaceSheetSegment={!isTrade}
            /* 哪几段是面单段 —— 切分板的"管辖范围/同包裹"等显示都由它自己推导 */
            faceSheetSegments={segments.map((_, i) => i).filter(isFaceSheetSegment)}
            onRequestPreview={(page, anchor) =>
              setPreviewPin(page != null && anchor ? { page, anchor } : null)
            }
          />
        </div>
      </div>
    </FullscreenModal>
  )
}
