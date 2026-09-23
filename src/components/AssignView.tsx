import { useMemo, useState } from 'react'
import { Button, Table } from 'antd'
import { useApp } from '@/store/AppStore'
import FullscreenModal from '@/components/FullscreenModal'
import PdfPreview from '@/components/PdfPreview'
import SplitResultTable from '@/components/SplitResultTable'
import BankTextRecognition from '@/components/BankTextRecognition'
import { Section, TaskDot, matchLineOf, canAssignOf } from '@/components/recognition/shared'
import { browserSampleUrlByFileName } from '@/config/preview'

/**
 * 归属界面（v2.57 立，v2.60 起**两类函证共用**）
 *
 * ## 它是什么
 *
 * **独立全屏界面，只做「把回函对应到函证」这一件事**。点「确定」即关闭、回主界面，
 * 之后识别在后台跑、由右下角进度卡接管，要不要去看由用户主动点。
 *
 * ## 两类函证是同一件事，但依据不同
 *
 * 用户的原话（往来侧）：「往来函证，这一步，就是在把回函文件和函证数据进行匹配，
 * 点了确定以后，就开始智能识别了」—— 与银行侧的归属**是同一件事**，故共用一个界面：
 *
 * · **银行**：回函由银行自行出具、文件内**没有系统二维码**，只能按四要素算出的档位
 *   由人确认/指定 —— 故要出**候选函证表**供选择；
 * · **往来**：拼接件里每封回函带二维码，切分时**已精确命中**（`assignSource = auto`），
 *   人要做的是**核对切分对不对**（可删掉错误的段）—— 故要出**切分明细表**
 *   （含关联发函记录编号与发函时间，都是核对参照）。
 *
 * **两类都不与 AI 核验同屏**：核验是"后台自动跑、用户不干涉的查看型内容"
 * （用户原话：「用户不会去干涉识别结果，只需要在最后回函管理里选择用不用这个结果就行了」），
 * 与"需要人工判断"的归属混在一屏，会把注意力摊薄。
 *
 * ## 界面分工
 *
 * · **左 = 原始回函预览**：整份铺出（看得到上下文——这封是从哪几页切出来的），
 *   本段描主色边 + 打角标，打开即定位到本段首页；
 * · **右 = 切分结果 + 归属结论**：切分表回答"这份文件的每一页都去哪了"并可点切换；
 *   银行侧追加候选函证表（人工指定归属的唯一入口）；
 * · **底栏 = 进度 + 确定**：银行侧全部段处理完才可点；往来侧归属天然已定，随时可点。
 *
 * ## 视觉基调：浅色
 *
 * 这一步是"对着白纸原件核对"，原件是白纸，深色底会让纸的边界与文字失去参照 ——
 * 视觉必须给内容让位。（智能识别界面自 v2.58 起也是浅色，全站统一。）
 */
export default function AssignView() {
  const { state, dispatch } = useApp()
  /** 往来函证：归属在切分时已由二维码确定，人做的是「核对切分」——依据与银行不同 */
  const isTrade = state.recognitionType === '往来函证'

  const allTasks = useMemo(() => state.batches.flatMap((b) => b.tasks), [state.batches])

  /**
   * 待处理的段 —— **跨批次**取（仅银行侧有意义）。
   *
   * 银行侧每条都要人工确认 / 指定；往来侧归属在切分时就由二维码定死了（`assignSource = auto`），
   * 故往来侧这个列表恒为空 —— 底栏与"确定"的可用性据此区分两类（见下）。
   */
  const pending = useMemo(
    () => allTasks.filter((t) => !t.assignSource && t.status !== 'failed'),
    [allTasks],
  )

  /**
   * 当前查看的段。默认取第一段待处理的；用户点切分表可切换。
   *
   * 用 `?? fallback` 而不是把选中项存进 store：归属界面是**一次性事务**，
   * 关掉就该忘掉这次的选择（下次进来重新按"还有哪些没处理"决定看谁），
   * 放 store 会让状态泄漏到下一次。
   */
  const [pickedId, setPickedId] = useState<string | null>(null)

  /**
   * 当前查看的段。
   *
   * **银行**优先给"还没归属的"（那才是要做的事）；**往来**归属已定，直接给第一段。
   * 都不落 store：这个界面是**一次性事务**，关掉就该忘掉这次的选择。
   */
  const current =
    (isTrade ? allTasks.find((t) => t.id === pickedId) : pending.find((t) => t.id === pickedId)) ??
    (isTrade ? allTasks[0] : pending[0]) ??
    allTasks[0]

  /** 同一上传文件切出的全部段（含已处理的）—— 切分表要列全，用户才知道全貌 */
  const fileSegments = useMemo(() => {
    if (!current) return []
    return allTasks
      .filter((t) => t.fileName === current.fileName)
      .sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0))
  }, [current, allTasks])

  /* 该文件已处理 / 待处理 —— 底栏的进度与"确定"可否点，都以此为准 */
  const filePending = fileSegments.filter((t) => !t.assignSource && t.status !== 'failed')
  const processedCount = fileSegments.length - filePending.length

  /**
   * 全站是否还有待归属的段 —— 银行侧「确定」的条件。
   *
   * 用**全站**而不是"本文件"：用户可能在一次会话里处理了多份上传件，
   * 只有都归完，"回主界面等结果"才是完整的状态。
   *
   * **往来侧恒为 false**（归属已由二维码定死），故它的「确定」随时可点 ——
   * 这正是用户说的「点了确定以后，就开始智能识别了」那一步。
   */
  const anyPendingGlobally = pending.length > 0

  const marked =
    current?.pageStart != null && current?.pageEnd != null
      ? { start: current.pageStart, end: current.pageEnd }
      : undefined

  /** 该文件（以及全站）是否还有待归属的段 —— 决定「确定」可否点 */
  const doneFooter = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ marginLeft: 'auto' }} />
      <Button type="primary" onClick={() => dispatch({ type: 'CLOSE_ASSIGN' })}>
        确定
      </Button>
    </div>
  )

  /*
   * **始终渲染**（只要归属界面开着）。
   *
   * 曾经的写法是「没有待归属的段就 `return null`」，那会让界面在**归完最后一段的瞬间自己消失**
   * —— 而用户的要求是「识别的界面**点击确定**后，就回到主界面」，即**关闭必须由用户发起**。
   * 自动消失还有两个副作用：① 用户来不及确认最后一段归到哪里去了；
   * ② `current` 变 undefined 的那一帧会闪一下空白。
   * 故 `current` 缺省时走下面的"全部处理完"完成态。
   */
  if (!state.assignOpen) return null

  /*
   * 本批回函已全部归属完成 —— 界面**保留**，等用户点「确定」。
   * 这一步刻意不给"自动关闭"，理由见上方注释；这里只把内容换成完成态，
   * 并交代下一步会发生什么（识别在后台跑，结果在列表里看）。
   */
  if (!current) {
    return (
      <FullscreenModal
        open
        title="回函归属"
        subtitle={state.recognitionType}
        onClose={() => dispatch({ type: 'CLOSE_ASSIGN' })}
        footer={doneFooter}
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

  return (
    <FullscreenModal
      open={state.assignOpen}
      title="回函归属"
      subtitle={`${state.recognitionType} · ${current.fileName}`}
      onClose={() => dispatch({ type: 'CLOSE_ASSIGN' })}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/*
           * 底栏文案按类型分（v2.60）—— 两类的"还差什么"完全不同：
           * · 银行：要逐段人工确认/指定，故报"已处理 x/y · 还有 N 段待归属"；
           * · 往来：切分时已由二维码定死归属，没有"待归属"这回事，
           *   人做的是核对，故只报段数 + 点确定后会发生什么（用户原话：
           *   「点了确定以后，就开始智能识别了」）。
           */}
          {isTrade ? (
            <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
              共 <b className="num">{fileSegments.length}</b> 段
              <span style={{ marginLeft: 10 }}>
                点「确定」即按此归属写入列表，随后开始智能识别 —— 进度见右下角，可随时查看
              </span>
            </span>
          ) : (
            <>
              <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
                已处理 <b className="num">{processedCount}</b>/{fileSegments.length} 段
              </span>
              {anyPendingGlobally && (
                <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
                  · 还有 <b className="num">{pending.length}</b> 段待归属
                </span>
              )}
            </>
          )}
          <span style={{ marginLeft: 'auto' }} />
          <Button
            type="primary"
            disabled={anyPendingGlobally}
            onClick={() => dispatch({ type: 'CLOSE_ASSIGN' })}
          >
            确定
          </Button>
        </div>
      }
    >
      <div className="assign-pane">
        {/* 左：原始回函预览 —— 整份铺出，本段描边并可定位 */}
        <div className="assign-pane__left">
          <PdfPreview
            confirmationNo={current.confirmationNo}
            fileUrl={browserSampleUrlByFileName(current.fileName)}
            page={current.pageStart ?? 1}
            markRange={marked}
            /* 原件上没有可批注的内容（印章/落章区在识别结果里看），不提供视图切换 */
            hideViewToggle
            height="100%"
          />
        </div>

        {/* 右：切分结果 + 归属匹配 */}
        <div className="assign-pane__right">
          <Section title="切分结果" count={`本文件共切成 ${fileSegments.length} 段`}>
            <SplitResultTable
              tasks={fileSegments}
              activeTaskId={current.id}
              onSelect={setPickedId}
            />
          </Section>

          {/*
           * 往来的归属由二维码精确命中，人做的是"核对切分"，故这块叫「匹配结论」
           * （一行结果即可，不给候选）；银行要人工判断，叫「归属匹配」并给候选表。
           */}
          <Section title={isTrade ? '匹配结论' : '归属匹配'} count="系统内部处理，只给结果">
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 'var(--radius-control)',
                background:
                  current.status === 'failed' ? 'var(--c-risk-high-bg)' : 'var(--c-fill-light)',
              }}
            >
              <span style={{ flexShrink: 0, alignSelf: 'center' }}>
                <TaskDot task={current} needsAction={canAssignOf(current)} />
              </span>
              <span style={{ fontSize: 13, color: 'var(--c-text-1)' }}>{matchLineOf(current)}</span>
            </div>

            {/* 银行回函无二维码，候选表是人工指定归属的唯一入口 */}
            {canAssignOf(current) && current.bankMatch && (
              <div style={{ marginTop: 12 }}>
                <BankTextRecognition
                  result={current.bankMatch}
                  onConfirm={() => dispatch({ type: 'CONFIRM_ASSIGN', taskId: current.id })}
                  onAssign={(c) =>
                    dispatch({
                      type: 'MANUAL_MATCH',
                      taskId: current.id,
                      confirmationNo: c.confirmationNo,
                      entity: c.entity,
                    })
                  }
                  onReject={() => dispatch({ type: 'SKIP_TASK', taskId: current.id })}
                />
              </div>
            )}
          </Section>
        </div>
      </div>
    </FullscreenModal>
  )
}
