import { useMemo, useState } from 'react'
import { Button } from 'antd'
import { useApp } from '@/store/AppStore'
import FullscreenModal from '@/components/FullscreenModal'
import PageSplitBoard from '@/components/PageSplitBoard'
import SplitPanel, { UNASSIGNED } from '@/components/SplitPanel'
import { CANDIDATE_SOURCES } from '@/mock/confirmations'
import { browserSampleUrlByFileName } from '@/config/preview'
import { cutsOfSegments, segmentsOfCuts, toggleCut } from '@/utils/pageSplit'

/** 切分草稿 —— 归属界面是**一次性事务**，草稿不落 store（关掉就该忘掉这次编辑） */
interface Draft {
  /** 草稿属于哪个文件 —— 换文件即作废、回到初稿 */
  file: string
  /** 切点（第 N 页后切一刀）；空数组 = 整份一段 */
  cuts: number[]
  /** 段序 → 用户显式选定的函证编号（未选过的段不在此表，见 `assignOf`） */
  assigns: Record<number, string>
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
   * 切分草稿。
   *
   * **初稿按类型分**（用户明确指定的做法）：
   * · 往来 —— 二维码已把文件切成几段，人要做的是"核对 + 改错"，故初稿 = 现有分段；
   * · 银行 —— 「整份 1 段，从头手动切」，故初稿 = **一个切点都没有**。
   *   用户用右栏的批量方式或逐页剪刀自己切；此后每段的归属下拉会按**页区间**
   *   自动预填既有识别结果（见 `assignOf`），所以从头切也不会丢演示里的归属线索。
   */
  const baseDraft: Draft = useMemo(() => {
    if (!isTrade) return { file: currentFile ?? '', cuts: [], assigns: {} }
    /* 往来：把现有分段还原成切点（`flatMap` 顺便收窄掉缺页码的异常任务） */
    const segs = fileTasks.flatMap((t) =>
      t.pageStart != null && t.pageEnd != null
        ? [{ pageStart: t.pageStart, pageEnd: t.pageEnd }]
        : [],
    )
    return { file: currentFile ?? '', cuts: cutsOfSegments(segs), assigns: {} }
  }, [currentFile, isTrade, fileTasks])

  const [draftState, setDraftState] = useState<Draft | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  /* 草稿属于当前文件才用它，否则回到初稿（换文件 / 首次进入） */
  const draft: Draft =
    draftState && draftState.file === (currentFile ?? '') ? draftState : baseDraft

  const segments = useMemo(() => segmentsOfCuts(pageCount, draft.cuts), [pageCount, draft.cuts])

  /** 可归属的候选函证 —— **按当前函证类型筛**（银行批次不列往来函证，反之亦然） */
  const candidates = useMemo(
    () => CANDIDATE_SOURCES.filter((c) => c.type === state.recognitionType),
    [state.recognitionType],
  )

  /**
   * 段 i 的归属：**用户显式选过就用他的，否则按页区间从既有任务里预填**。
   *
   * 预填的意义在于"从头切也不丢线索"：银行侧初稿是整份一段（没有任何归属），
   * 但用户一旦按固定页数 4 页切成 1-4 / 5-8 / 9-11，这三段与既有识别结果
   * **页区间完全吻合**，下拉就会各自预填上 `QS2024-031` 等 —— 用户确认即可、不必重选，
   * 要改也随时能改。**预填值不是结论**：它只是下拉的初始选项，人仍可改。
   */
  const assignOf = (i: number): string => {
    const picked = draft.assigns[i]
    if (picked) return picked
    const seg = segments[i]
    const matched = fileTasks.find(
      (t) => t.pageStart === seg?.pageStart && t.pageEnd === seg?.pageEnd,
    )
    return matched && matched.confirmationNo !== UNASSIGNED ? matched.confirmationNo : UNASSIGNED
  }

  const specified = segments.filter((_, i) => assignOf(i) !== UNASSIGNED).length
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

  const unspecified = segments.length - specified
  const untouched = !isTrade && segments.length === 1 && pageCount > 1

  return (
    <FullscreenModal
      open={state.assignOpen}
      title="回函归属"
      subtitle={`${state.recognitionType} · ${currentFile} · 共 ${pageCount} 页`}
      onClose={() => dispatch({ type: 'CLOSE_ASSIGN' })}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
            共 <b className="num">{segments.length}</b> 段 · 已指定归属{' '}
            <b className="num">{specified}</b>/{segments.length}
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
                segments: segments.map((seg, i) => {
                  const confirmationNo = assignOf(i)
                  return {
                    ...seg,
                    confirmationNo,
                    entity: candidates.find((c) => c.confirmationNo === confirmationNo)?.entity,
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
          />
        </div>

        {/* 右栏：批量拆分方式 + 切分结果（每段一行 + 归属下拉） */}
        <div className="assign-pane__right">
          <SplitPanel
            pageCount={pageCount}
            segments={segments}
            activeIndex={activeIndex}
            onPickSegment={setActiveIndex}
            onCutsChange={(cuts) => patch({ cuts })}
            assigns={Object.fromEntries(segments.map((_, i) => [i, assignOf(i)]))}
            onAssign={(i, confirmationNo) => patch({ assigns: { ...draft.assigns, [i]: confirmationNo } })}
            candidates={candidates.map((c) => ({ confirmationNo: c.confirmationNo, entity: c.entity }))}
          />
        </div>
      </div>
    </FullscreenModal>
  )
}
