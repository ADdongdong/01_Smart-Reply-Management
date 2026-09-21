import type { RecognitionTask, StageKey, UploadBatch } from '@/types'

/**
 * 推进一个识别任务 —— 每次调用前进一个阶段或推进当前阶段进度。
 * 返回新的任务对象与「本次是否有变化」标记。
 */
export function advanceTask(task: RecognitionTask): { task: RecognitionTask; changed: boolean } {
  if (task.status === 'failed') return { task, changed: false }

  const stages = task.stages.map((s) => ({ ...s }))
  const idx = stages.findIndex((s) => s.status === 'waiting' || s.status === 'running')
  if (idx === -1) return { task, changed: false }

  const current = stages[idx]

  // 刚进入该阶段
  if (current.status === 'waiting') {
    if (task.plannedFailure === current.key) {
      current.status = 'failed'
      current.percent = 100
      return {
        task: { ...task, stages, status: 'failed', needManual: true },
        changed: true,
      }
    }
    current.status = 'running'
    current.percent = 10 + Math.round(Math.random() * 12)
    return { task: { ...task, stages, status: 'pending' }, changed: true }
  }

  // 推进当前阶段
  current.percent = Math.min(100, current.percent + 20 + Math.round(Math.random() * 22))
  if (current.percent >= 100) {
    current.percent = 100
    current.status = 'done'
    const isLast = idx === stages.length - 1
    return {
      task: { ...task, stages, status: isLast ? 'success' : 'pending' },
      changed: true,
    }
  }
  return { task: { ...task, stages }, changed: true }
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

/** 识别失败时的可执行动作 */
export const RECOVERY_ACTIONS: Record<StageKey, string[]> = {
  match: ['确认归属', '改派到其他函证', '标记为待处理'],
  consistency: ['重新执行一致性比对', '转人工逐项核对'],
  sealExists: ['重新执行印章检测', '人工确认盖章情况'],
  crossPageSeal: ['重新检测骑缝章', '人工确认骑缝章'],
  sealNameMatch: ['重新比对印章名称', '人工核对印章名称'],
  handwriting: ['重新执行手写体识别', '转人工转录'],
  bankText: ['重新执行四要素文本识别', '按四要素重新匹配归属'],
  expressSheet: ['重新识别面单', '手动填写快递单号'],
}

/**
 * 上传提示**不再出现在识别工作台内**（v2.30 删除）——
 * 文件形态（往来=带二维码的拼接 PDF；银行=只需回函件，格式一/格式二数据已存于系统）、
 * 归属方式与检测项，统一由**列表页两个上传入口的悬停说明**表达一次即可，
 * 工作台里再铺三行属重复且分散注意力。
 */
