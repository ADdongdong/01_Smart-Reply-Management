import type { RecognitionStage, RecognitionTask, StageKey, UploadBatch } from '@/types'

/**
 * 检测点归属的**识别批次**（v2.42：两条链路并行发起）。
 *
 * 真实实现里这是两台引擎、两套算力：
 * · **批一** —— **OCR + 大模型**：四要素（`bankText`，它本身就是归属匹配的输入）与
 *   **印章区域**（是否有印章 / 名称是否与被询证单位一致）；
 * · **批二** —— **MinerU 整表识别**：14 项询证事项表格（`consistency`）。
 *
 * 二者**没有依赖关系**（批一要的是页面上的文字与印章像素，批二要的是表格区域），
 * 所以**并行发起**——这正是效率的来源：MinerU 那一路最慢，让它与批一同时开跑，
 * 而不是等归属确认完才开始。
 *
 * **唯一的例外是印章两项的「结论」**（见 `canStart` 的闸门）：它们虽有技术前提，
 * 但「名称是否一致」的判据是「印章名 vs **系统内那封函证的被询证单位**」——
 * 归属未定时无从比对。故它们**可以建位、但不能先于 `match` 出结论**。
 * 这延续 v2.33「结论不得先于归属」：那时列表里还没有这条记录，抛出风险用户无处处理。
 */
const BATCH_OF: Record<StageKey, 1 | 2> = {
  match: 1,
  bankText: 1,
  sealExists: 1,
  sealNameMatch: 1,
  consistency: 2,
  /* 以下仅往来函证（银行侧不出现，见 mock/recognition.ts 的 STAGES_BANK_P2） */
  handwriting: 1,
  crossPageSeal: 1,
  expressSheet: 1,
}

/**
 * 批二 / 印章项能否**开跑** —— 闸门只在「这个检测点的结论依赖归属」时才关。
 *
 * 往来函证不适用（它的归属在切分界面就已确定，进工作台时 `match` 早已完成），
 * 故本闸门对往来是空操作（零回归）。
 */
function canStart(stages: RecognitionStage[], key: StageKey, stages0: RecognitionStage[]): boolean {
  if (key !== 'sealExists' && key !== 'sealNameMatch') return true
  const match = stages0.find((s) => s.key === 'match') ?? stages.find((s) => s.key === 'match')
  /* 归属失败时解锁 —— 否则这封回函会永远卡住，用户连印章情况都看不到 */
  return !match || match.status === 'done' || match.status === 'failed'
}

/**
 * 推进一个识别任务 —— **按批次并行**（v2.42）。
 *
 * 每个 TICK 在**两条批次通道上各推进一项**：批一（四要素 / 印章）与批二（14 项表格）
 * 同时前进。单批次的类型（往来函证的全部检测点都在批一）行为与改造前**完全一致**：
 * `BATCH_OF` 把它们都归到批 1，于是每次仍只推进一项 —— 串行，零回归。
 *
 * 返回新的任务对象与「本次是否有变化」标记。
 */
export function advanceTask(task: RecognitionTask): { task: RecognitionTask; changed: boolean } {
  if (task.status === 'failed') return { task, changed: false }

  const stages = task.stages.map((s) => ({ ...s }))
  const original = task.stages
  let changed = false
  let plannedFailed = false

  for (const lane of [1, 2] as const) {
    const idx = stages.findIndex(
      (s) =>
        BATCH_OF[s.key] === lane &&
        (s.status === 'waiting' || s.status === 'running') &&
        /* 闸门只拦「尚未开跑」的项；已经在跑的不打断 */
        (s.status === 'running' || canStart(stages, s.key, original)),
    )
    if (idx === -1) continue
    const current = stages[idx]
    changed = true

    // 刚进入该检测点
    if (current.status === 'waiting') {
      if (task.plannedFailure === current.key) {
        current.status = 'failed'
        current.percent = 100
        plannedFailed = true
        continue
      }
      current.status = 'running'
      current.percent = 10 + Math.round(Math.random() * 12)
      continue
    }

    // 推进该检测点
    current.percent = Math.min(100, current.percent + 20 + Math.round(Math.random() * 22))
    if (current.percent >= 100) {
      current.percent = 100
      current.status = 'done'
    }
  }

  if (!changed) return { task, changed: false }

  const allSettled = stages.every((s) => s.status === 'done' || s.status === 'failed')
  const anyFailed = stages.some((s) => s.status === 'failed')
  return {
    task: {
      ...task,
      stages,
      status: plannedFailed ? 'failed' : allSettled ? (anyFailed ? 'failed' : 'success') : 'pending',
      needManual: plannedFailed || anyFailed || task.needManual,
    },
    changed: true,
  }
}

/**
 * 推进整个批次 —— **双通道并行**（v2.28 两阶段识别）。
 *
 * 每个 TICK 在两条通道上各推进一个任务，以兑现「逐份确认、逐份开跑、互不阻塞」：
 *   · **对应通道**（`phase === 1`）：仍在识别四要素与归属的份；
 *   · **细查通道**（`phase === 2`）：归属已确认、正在跑其余检测项的份。
 * 每条通道内部仍**串行推进**（保证「正在处理哪一封」清晰可见）。
 *
 * 单阶段类型（往来函证）任务恒为 `phase === 1`，行为与改造前完全一致（零回归）。
 */
export function advanceBatch(batch: UploadBatch): { batch: UploadBatch; running: boolean } {
  const canAdvance = (t: RecognitionTask) =>
    t.status === 'pending' && t.stages.some((s) => s.status !== 'failed' && s.status !== 'done')

  const targets = new Set<number>()
  const matchIdx = batch.tasks.findIndex((t) => t.phase === 1 && canAdvance(t))
  if (matchIdx >= 0) targets.add(matchIdx)
  const detailIdx = batch.tasks.findIndex((t) => t.phase === 2 && canAdvance(t))
  if (detailIdx >= 0) targets.add(detailIdx)

  if (!targets.size) {
    return { batch: { ...batch, status: 'done' }, running: false }
  }

  const tasks = batch.tasks.map((t, i) => (targets.has(i) ? advanceTask(t).task : t))
  const stillRunning = tasks.some(
    (t) => t.status === 'pending' && t.stages.some((s) => s.status !== 'done' && s.status !== 'failed'),
  )
  return {
    batch: { ...batch, tasks, status: stillRunning ? 'running' : 'done' },
    running: stillRunning,
  }
}

/** 阶段进度百分比（用于进度条） */
export function taskPercent(task: RecognitionTask): number {
  const total = task.stages.length
  const done = task.stages.reduce((acc, s) => acc + (s.status === 'done' ? 100 : s.status === 'failed' ? 100 : s.status === 'running' ? s.percent : 0), 0)
  return Math.round(done / total)
}

export function isTaskFinished(task: RecognitionTask): boolean {
  return task.status === 'success' || task.status === 'failed'
}

/**
 * 识别失败时的可执行动作。
 *
 * **`consistency` 是银行侧最容易失败的一项**（v2.39 §3）：它的表格数据由 **MinerU**
 * 整表识别，是整条链路里**最慢、也最容易超时**的一环。因此它的恢复动作里必须有
 * 「**手工录入核对数据**」—— 让这封函证能继续归档，而不是卡在识别上看不到出路。
 * （`bankText` 走 OCR / 大模型，失败只需重跑四要素。）
 */
export const RECOVERY_ACTIONS: Record<StageKey, string[]> = {
  match: ['确认归属', '改派到其他函证', '标记为待处理'],
  consistency: ['重新执行一致性比对', '重新识别询证事项表格', '手工录入核对数据', '转人工逐项核对'],
  sealExists: ['重新执行印章检测', '人工确认盖章情况'],
  /* 仅往来函证（R-03） */
  crossPageSeal: ['重新检测骑缝章', '人工确认骑缝章'],
  sealNameMatch: ['重新比对印章名称', '人工核对印章名称'],
  handwriting: ['重新执行手写体识别', '转人工转录'],
  /* v2.39：`bankText` 现在是阶段一的「识别四要素」 */
  bankText: ['重新识别四要素', '按四要素重新匹配归属'],
  /* 仅往来函证 —— 银行面单是独立文件，不走回函件识别 */
  expressSheet: ['重新识别面单', '手动填写快递单号'],
}

/**
 * 上传提示**不再出现在识别工作台内**（v2.30 删除）——
 * 文件形态（往来=带二维码的拼接 PDF；银行=只需回函件，格式一/格式二数据已存于系统）、
 * 归属方式与检测项，统一由**列表页两个上传入口的悬停说明**表达一次即可，
 * 工作台里再铺三行属重复且分散注意力。
 */
