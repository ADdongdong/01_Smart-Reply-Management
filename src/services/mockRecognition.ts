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

/** 推进整个批次，返回新批次与是否仍在进行中 */
export function advanceBatch(batch: UploadBatch): { batch: UploadBatch; running: boolean } {
  const activeIdx = batch.tasks.findIndex(
    (t) => t.status === 'pending' && t.stages.some((s) => s.status !== 'failed' && s.status !== 'done'),
  )
  // 失败任务不再推进；串行推进，保证「正在处理哪一封」清晰可见
  const targetIdx = activeIdx >= 0 ? activeIdx : batch.tasks.findIndex((t) => t.status === 'pending')

  if (targetIdx === -1) {
    return { batch: { ...batch, status: 'done' }, running: false }
  }

  const tasks = batch.tasks.map((t, i) => (i === targetIdx ? advanceTask(t).task : t))
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
  bankText: ['重新执行文本识别', '按四要素重新匹配归属'],
  expressSheet: ['重新识别面单', '手动填写快递单号'],
}

/** 文件扩展名 → 业务提示 */
export const UPLOAD_TIPS = [
  '支持往来函证「回函文件 + 快递面单」拼接 PDF（系统按右上角二维码自动切分）',
  '支持银行函证回函 PDF（无二维码，按「银行名称 + 被审计单位 + 函证起止日期」四要素匹配归属，匹配不足时转人工确认）',
  '支持多份文件批量拖入，识别过程异步执行，可边识别边浏览列表',
]
