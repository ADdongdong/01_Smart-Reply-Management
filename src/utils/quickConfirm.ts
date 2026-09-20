import type { ReplyRecord } from '@/types'
import { buildPrefillFields } from '@/mock/confirmations'

/**
 * 无风险件快速通道判定（纯函数）。
 * ------------------------------------------------------------------
 * **业务口径：只要有一个提示，就不给快速通道** —— 宁可让业务人员多看一眼，
 * 也不让"AI 说没问题"变成跳过人工判断的理由。
 *
 * 为什么独立成模块：这是一条内控规则，既不属于表现层，也不属于演示数据。
 * 界面用它决定「是否显示一键确认」，store 在真正落库前再用它复校一次 ——
 * 这样"按钮没显示"之外还有第二道防线：过期视图、竞态、后续新增的调用方
 * 都无法把有风险的回函确认掉。
 *
 * 通过条件（需全部满足）：
 *   ① 核验状态为待确认、回函进度为「待确认快递信息」
 *   ② 无任何风险原因，且风险等级为低 / 无
 *   ③ 检测点全部完成
 *   ④ 关键检测点逐项复核：无金额差异 · 有印章 · 章名一致 · 落章区为「信息证明无误」· 检出骑缝章
 *   ⑤ 全部 AI 预填字段置信度 ≥ 90%，且值不为「未识别 / 待填写」
 */
export interface QuickConfirmCheck {
  ok: boolean
  /** 未通过原因（用于悬停提示与批量纳入说明）；通过时为空 */
  reason?: string
}

/** AI 预填字段的置信度门槛 —— 低于此值必须人工看一眼 */
const MIN_CONFIDENCE = 0.9

/** 值为以下占位符说明识别并未真正产出结果，置信度再高也不能当作「识别成功」 */
const MISSING_VALUES = ['未识别', '待填写', '—', '']

const no = (reason: string): QuickConfirmCheck => ({ ok: false, reason })

/** 单条判定：能否一键确认 */
export function checkQuickConfirm(record: ReplyRecord): QuickConfirmCheck {
  if (record.verifyStatus === 'verified') return no('该函证已完成人工核验')
  if (record.replyProgress !== '待确认快递信息') return no('回函快递信息已确认，无需重复确认')

  const v = record.verification
  if (!v) return no('尚无 AI 核验结果')

  // ② 风险总览 —— 有任何一条提示即退出（骑缝章缺失、手写区域不一致等由这里统一兜住）
  if (v.riskReasons.length) return no(`存在风险提示：${v.riskReasons[0]}`)
  if (v.riskLevel !== 'low' && v.riskLevel !== 'none') return no('存在风险提示，需人工逐项核对')

  // ③ 检测点是否跑完
  if (v.totalModules > 0 && v.completedModules < v.totalModules) {
    return no(`检测点未全部完成（${v.completedModules}/${v.totalModules}）`)
  }

  // ④ 关键检测点逐项复核
  if (v.consistency.diffCount > 0) return no(`一致性比对存在 ${v.consistency.diffCount} 项金额差异`)
  if (!v.seal.hasSeal) return no('未检出印章')
  if (!v.seal.nameMatched) return no('印章名称与被询证方名称不一致')
  if (v.seal.region !== '信息证明无误区') return no('印章未落于「信息证明无误」区')
  if (!v.seal.crossPageSeal) return no('多页回函未检出骑缝章')

  // ⑤ AI 预填字段的置信度与完整性
  const weak = buildPrefillFields(record).filter(
    (f) => f.ai && (f.confidence < MIN_CONFIDENCE || MISSING_VALUES.includes(f.value)),
  )
  if (weak.length) {
    return no(`${weak.length} 项 AI 字段置信度不足或未识别：${weak.map((f) => f.label).join('、')}`)
  }

  return { ok: true }
}

/** 批量判定：把一组记录分成「可批量确认」与「需逐条处理」两组，并归集后者原因 */
export function splitByQuickConfirm(records: ReplyRecord[]): {
  eligible: ReplyRecord[]
  ineligible: { record: ReplyRecord; reason: string }[]
} {
  const eligible: ReplyRecord[] = []
  const ineligible: { record: ReplyRecord; reason: string }[] = []

  records.forEach((record) => {
    const check = checkQuickConfirm(record)
    if (check.ok) eligible.push(record)
    else ineligible.push({ record, reason: check.reason ?? '不满足快速确认条件' })
  })

  return { eligible, ineligible }
}

/**
 * 一次性产出「记录 id → 判定结果」映射。
 *
 * 判定内部要构造十余个预填字段对象，若在列表每次渲染时逐行调用，
 * 会在筛选、搜索输入等高频渲染中反复重算 —— 因此由调用方用 useMemo
 * 缓存整表结果，行渲染与批量统计都查表。
 */
export function buildQuickConfirmMap(records: ReplyRecord[]): Map<string, QuickConfirmCheck> {
  return new Map(records.map((record) => [record.id, checkQuickConfirm(record)]))
}
