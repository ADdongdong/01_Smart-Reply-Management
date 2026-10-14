import { useEffect, useMemo, useState } from 'react'
import { Button } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { isRecognitionPending, evaluateMatch } from '@/services/replyRule'
import { verifyItemsOf, matchLineOf, replySeqOf } from '@/components/recognition/shared'
import { PixelLoader } from '@/components/ai/PixelLoader'
import { TaskGroups, type TaskGroup, type TaskRowItem } from '@/components/ai/TaskRows'
import { RecommendationCard } from '@/components/ai/RecommendationCard'
import { ToolChips, type ChipItem } from '@/components/ai/ToolChips'

/**
 * 智能识别界面（v2.57）—— **独立全屏**，只在用户主动点击时进入。
 *
 * ## 定位
 *
 * 这是「看 AI 干了什么」的地方，**只做识别**：检测点逐项、依据、结论。
 * **不含人工核验** —— 用户的原话是「人工核验不放这里面，智能识别这里只做智能识别，
 * 回函结果确认界面，用户拿到结果自己决定用不用这个结果」。
 * 这条边界很关键：把"看"和"决定"分开，避免用户在看过程的界面里被要求签字。
 *
 * ## 视觉：为什么是深色
 *
 * 参考 beautifului.dev 的 AI 原生语言（像素网格加载器 / 可展开轨迹 / 任务行 / 置信度条）。
 * 与站内所有浅色界面**刻意不同调**，因为这一步的性质不同：
 *
 * · 浅色界面（列表、归属界面、结果填写）—— 用户在**处理文书**：看原件、核金额、填结果；
 * · 本界面 —— 用户在**看机器干活**，没有要批注的东西，可以有一个"场"。
 *
 * 深色 + 点阵 + 扫过式微光就是那个"场"：一次换场，呼应「主动点进来才看到」。
 *
 * ## 性能
 *
 * · 与归属界面**互斥挂载**（`assignOpen` / `insightOpen` 不同时为真），
 *   避免两个 pdf.js 实例同时驻留（本界面其实不渲染 PDF，但仍保持互斥以省内存）；
 * · 计时用**界面层单一 `setInterval`**，不在每行各起一个 —— 一行一个定时器会在
 *   多段多检测点时迅速堆起来；
 * · 依据明细**折叠优先**：`TaskRows` 只渲染行，展开才渲染明细。
 */
export default function InsightView() {
  const { state, dispatch } = useApp()

  /**
   * 本界面要看的任务 —— 归属已确定的那些，**外加面单页**（v3.22）。
   *
   * 归属未定的段不该出现在这里：它们的结论还没成立（"结论不得先于归属"，
   * 见 v2.33 以来的口径），列出来只会出现"待归属"的空行。
   *
   * **面单页是例外，且必须例外**（v3.22）：它不是函证、本来就没有归属，
   * 但它是银行侧一个**真跑过的检测项**（快递面单识别）—— 按"归属非空"过滤会把
   * 它整个从识别界面抹掉，用户在这个"看识别过程"的界面里**看不到面单识别**，
   * 只能回到归属界面才看得到它的结果。这正是用户问的
   * 「快递面单自动识别的过程，和识别结束，是不是需要一个显示的图标来标识」。
   * 它进来后只列 1 项检测（见 `verifyItemsOf`），结论由运单号读没读出来决定。
   */
  const tasks = useMemo(
    () =>
      state.batches
        .flatMap((b) => b.tasks)
        .filter((t) => !!t.assignSource || t.faceSheetPage),
    [state.batches],
  )

  const allStages = useMemo(() => tasks.flatMap((t) => t.stages), [tasks])
  const running = allStages.some((s) => s.status === 'running' || s.status === 'waiting')
  const doneCount = tasks.filter((t) => t.status === 'success').length

  /**
   * 实时计时 —— 界面层单一定时器。
   *
   * 只在**还在跑**时启动，跑完立刻停：一个每秒重渲染的界面在"看结果"时是纯打扰
   * （用户会盯着不动的东西看，而每帧都在重建列表）。
   */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((v) => v + 1), 100)
    return () => window.clearInterval(id)
  }, [running])

  /**
   * 已用时长 —— 各检测点耗时之和 + 本次查看期间的实时增量。
   *
   * 用"检测点耗时之和"而不是墙钟时间：识别是**并行发起**的（批一 OCR / 批二 MinerU，
   * 见 v2.42），按墙钟算会得到一个比用户直觉小得多的数，反而让人怀疑；
   * 而各环节耗时之和表达的是"一共算了多少活"，与"这个过程有多重"一致。
   */
  const baseMs = allStages.reduce((n, s) => n + (s.elapsedMs ?? 0), 0)
  const liveMs = running ? tick * 100 : 0
  const totalMs = baseMs + liveMs

  /* ------------------------- 组装分组与任务行 ------------------------- */

  /** 逐段取回函记录（结论与风险都从落库后的记录读，与列表口径同源） */
  const evaluated = useMemo(
    () =>
      tasks
        .map((t) => {
          const record = t.recordId ? state.records.find((r) => r.id === t.recordId) : undefined
          const pending = !record || isRecognitionPending(record)
          return { task: t, record, evaluation: pending ? null : evaluateMatch(record!), pending }
        }),
    [tasks, state.records],
  )
  const evalById = useMemo(() => new Map(evaluated.map((e) => [e.task.id, e])), [evaluated])

  /**
   * **按函证分组**（v2.61 修正）。
   *
   * 原先把各段的检测点平铺成一列，用户看到的是一屏 18 项（3 封 × 6 项）并问
   * 「**很多重复的识别项，那具体是在识别哪个函证**」。
   * 平铺本身没错（同一套检测逐封跑），**错在没分段**——用户无从判断
   * "这一行属于哪一封"，于是看起来像列表出了错。
   * 现在每封一张卡，**卡头就是答案**（编号 + 被询证单位 + 它自己的结论）。
   */
  const groups: TaskGroup[] = useMemo(
    () =>
      tasks.map((task) => {
        const e = evalById.get(task.id)
        const rows: TaskRowItem[] = verifyItemsOf(task).map((s) => ({
          id: `${task.id}-${s.key}`,
          label: s.label,
          status:
            s.status === 'done'
              ? ('completed' as const)
              : s.status === 'failed'
                ? ('failed' as const)
                : s.status === 'running'
                  ? ('running' as const)
                  : ('waiting' as const),
          percent: s.percent,
          verdict: s.detail,
          elapsedMs: s.elapsedMs,
          details: s.evidence,
        }))

        /**
         * 该封的结论 —— 识别未完成时不给结论（"结论不得先于归属/识别完成"，延续既有口径）。
         *
         * **面单页的"结论"是运单号读没读出来**（v3.22）：它没有回函记录、也就没有相符性可言，
         * 原先会落到 `e?.evaluation == null` 那一支、永远不给结论 —— 一个跑完的检测项
         * 在界面上看不出跑完了。三态与归属界面那行单号一致：
         * 绿「已读出运单号」/ 橙「未读出运单号 · 待人工填写」/ 灰「识别中」。
         */
        const seq = replySeqOf(task)
        const sheetStage = task.faceSheetPage
          ? task.stages.find((s) => s.key === 'expressSheet')
          : undefined
        const verdict = task.faceSheetPage
          ? !sheetStage || sheetStage.status === 'waiting' || sheetStage.status === 'running'
            ? { text: '识别中', tone: 'running' as const }
            : task.expressNo
              ? { text: '已读出运单号', tone: 'low' as const }
              : { text: '未读出运单号 · 待人工填写', tone: 'medium' as const }
          : e?.pending
          ? ({ text: '识别中', tone: 'running' as const })
          : e?.evaluation == null
            ? undefined
            : {
                text:
                  e.evaluation.matched === true
                    ? '相符'
                    : e.evaluation.matched === false
                      ? '不相符'
                      : '待人工判定',
                /* 结论标签的档位看相符性（原 AI 风险等级已于 2026-10-14 删除）：相符绿 / 不相符红 / 待判定中性 */
                tone: (e.evaluation.matched === true
                  ? 'low'
                  : e.evaluation.matched === false
                    ? 'high'
                    : 'neutral') as 'low' | 'high' | 'neutral',
              }

        return {
          id: task.id,
          /*
           * 组头标题 —— **面单页不是函证**（v3.22）：它没有函证编号、也不参与归属，
           * 照旧写「待指定 · 齐商银行股份有限公司」用户读不出这是什么（识别界面里
           * 也不该出现「待指定」这种归属态的词）。页区间仍由副标题给。
           */
          title: task.faceSheetPage
            ? '快递面单'
            : `${task.confirmationNo} · ${task.matchedEntity ?? '—'}`,
          subtitle: [
            task.pageStart != null
              ? task.pageStart === task.pageEnd
                ? `第 ${task.pageStart} 页`
                : `第 ${task.pageStart}-${task.pageEnd} 页`
              : undefined,
            seq,
          ]
            .filter(Boolean)
            .join(' · '),
          verdict,
          rows,
        }
      }),
    [tasks, evalById],
  )

  /** 全部检测点行（计数标签与总耗时用） */
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups])

  /* ------------------------- 结论与来源 ------------------------- */

  /**
   * **需要展开细看的段** —— 建议卡只给这些。
   *
   * 多段时每段都给一张建议卡会互相打岔；而结论已在**组头**标明，
   * 故这里只挑出「有风险」的那些（高/中风险）给详细依据。
   * 全相符时**一张卡都不出现** —— 没有需要用户关注的东西，就不占位置。
   */
  const flagged = useMemo(
    () =>
      evaluated.filter(
        (e) =>
          !e.pending &&
          e.evaluation != null &&
          e.evaluation.matched === false,
      ),
    [evaluated],
  )

  const chips: ChipItem[] = useMemo(() => {
    const total = rows.length
    const ok = rows.filter((r) => r.status === 'completed').length
    const warn = rows.filter((r) => r.status === 'failed').length
    const out: ChipItem[] = [{ text: `${total} 项检测` }]
    if (ok) out.push({ text: `${ok} 项已完成`, tone: 'ok' })
    if (warn) out.push({ text: `${warn} 项需关注`, tone: 'warn' })
    return out
  }, [rows])

  /*
   * 只在被主动打开时挂载（`insightOpen`）。
   *
   * 这一句是**必须的**：识别界面是 `position: fixed; inset: 0` 的全屏层，
   * 若按"有任务就渲染"来，它会在用户上传后**立刻盖在归属界面之上**
   * （银行批次里常有一段是自动归属，`tasks` 立刻非空）——实测踩到过。
   * 全屏层没有"藏起来"的中间态，只能要么挂载要么不挂载。
   */
  if (!state.insightOpen) return null
  if (!tasks.length) return null

  return (
    <div className="insight-stage" style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
      <div className="insight-stage__dots" aria-hidden="true" />
      <div className="insight-stage__glow" aria-hidden="true" />

      <div className="insight-stage__inner">
        {/* 顶栏 */}
        <div className="insight-topbar">
          <span className="insight-title">智能识别</span>
          <span className="insight-sub">
            {state.recognitionType}
            {tasks.length > 1 ? ` · ${tasks.length} 段` : ''} · {rows.length} 项检测
          </span>
          {matchLineOf(tasks[0]) && (
            <span className="insight-sub" style={{ opacity: 0.7 }}>
              {matchLineOf(tasks[0])}
            </span>
          )}
          <Button
            type="text"
            size="small"
            aria-label="关闭智能识别界面"
            style={{ marginLeft: 'auto', color: 'var(--in-text-2)' }}
            icon={<CloseOutlined />}
            onClick={() => dispatch({ type: 'CLOSE_INSIGHT' })}
          />
        </div>

        {/* 主体 */}
        <div className="insight-body">
          <div className="insight-body__inner">
            {/* 进度区 —— 进行中是像素网格 + 实时读秒；完成后定格 */}
            <div className="insight-card" style={{ display: 'flex', alignItems: 'center' }}>
              <PixelLoader
                done={!running}
                label={running ? '正在识别回函' : '识别已完成'}
                timeText={
                  totalMs > 0
                    ? `${(totalMs / 1000).toFixed(1)}s`
                    : undefined
                }
                note={running ? undefined : `已归档 ${doneCount} 封`}
              />
            </div>

            {/* 计数标签 —— 先给体量，再给过程 */}
            <ToolChips items={chips} />

            {/* 检测点逐项 —— **按函证分组**，组头交代"在识别哪一封"及其结论 */}
            <TaskGroups groups={groups} />

            {/*
             * 结论依据（建议卡）—— **只给有风险的那几封**，且卡头标明是哪一封。
             *
             * 这一步是修用户那句「下面的不相符是什么意思」：原先只取第一段做一张全局卡，
             * 多封时用户无从判断"这个不相符是谁的"。现在：
             * · 相符的封不给卡（结论已在组头，无需重复）；
             * · 有风险的封各给一张，卡头写明编号与单位。
             */}
            {flagged.map((f) => (
              <RecommendationCard
                key={f.task.id}
                owner={`${f.task.confirmationNo} · ${f.task.matchedEntity ?? '—'}`}
                verdict={
                  f.evaluation!.matched === true
                    ? '相符'
                    : f.evaluation!.matched === false
                      ? '不相符'
                      : '待人工判定'
                }
                tone={
                  f.evaluation!.matched === true
                    ? 'low'
                    : f.evaluation!.matched === false
                      ? 'high'
                      : 'neutral'
                }
                basis={f.evaluation!.basis}
              />
            ))}

            {/*
             * 「来源卡」区（v2.57 起有、v3.15 移除）—— 用户：「这个区域的内容，删除，不知道是干啥的」。
             *
             * 它逐段列「回函原件 · 0813回函123.pdf · 第 1-3 页 · whzf0010006 · 广东证券股份有限公司」，
             * 想回答"这些结论是拿哪些材料算的"；但**素材与归属在上一屏刚由用户自己逐段确认过**
             * （归属界面每段都标了页区间与命中的函证），此处只是把同一件事再抄一遍 ——
             * 既无新信息，也没有可动作之处，就成了用户眼里"不知道干啥"的一段。
             * "结论读了哪几页"若要看，各检测点的**依据明细**（逐项展开）里本来就有。
             */}
          </div>
        </div>
      </div>
    </div>
  )
}
