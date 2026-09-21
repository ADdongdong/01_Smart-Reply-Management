import type {
  AssignSource,
  BankCandidate,
  BankCandidateSource,
  BankFieldInput,
  BankTextField,
  BankTextResult,
  MatchLevel,
} from '@/types'

/**
 * 银行函证归属匹配。
 *
 * 背景：银行回函由银行自行制作、文件内**没有系统二维码**，无法像往来函证那样
 * 精确命中函证编号，只能依据「银行名称 + 被审计单位名称 + 函证起始日期 + 函证截止日期」
 * 四要素定位唯一一封函证。
 *
 * 因此本模块把「匹配」做成一组**纯函数**：归一化 → 加权打分 → 档位判定 → 候选排序。
 * 全部输入输出均为内存计算，不使用随机数，保证同一份回函每次演示结果一致。
 * 后续接入真实后端时，整体替换本模块即可，识别任务的数据结构无需变动。
 */

/* ------------------------------------------------------------------ */
/* 权重与阈值                                                          */
/* ------------------------------------------------------------------ */

/** 四要素权重 —— 银行名称是唯一性关键判据，其余为辅助验证项 */
export const BANK_FIELD_WEIGHTS: Record<string, number> = {
  bankName: 0.5,
  auditedEntity: 0.2,
  periodStart: 0.15,
  periodEnd: 0.15,
}

/** 模糊命中（如回函落款为分支机构、使用简称）的权重折扣 */
export const FUZZY_DISCOUNT = 0.8

/** auto 档：银行名称精确命中且加权总分达到该值 */
export const AUTO_SCORE = 0.999
/** confirm 档：加权总分不低于该值 */
export const CONFIRM_SCORE = 0.65
/** 名称相似度达到该值即判为模糊命中 */
export const FUZZY_SIMILARITY = 0.8

/** 要素展示标签与顺序 */
export const BANK_FIELD_LABELS: Record<string, string> = {
  bankName: '银行名称',
  auditedEntity: '被审计单位名称',
  periodStart: '函证起始日期',
  periodEnd: '函证截止日期',
}

/** 档位文案与语义色 */
export const MATCH_LEVEL_META: Record<MatchLevel, { label: string; tone: 'low' | 'medium' | 'high'; hint: string }> = {
  auto: { label: '自动归属', tone: 'low', hint: '四要素全部匹配，无需人工干预' },
  confirm: { label: '建议归属', tone: 'medium', hint: '银行名称已命中但存在差异，需人工确认' },
  manual: { label: '待人工指定', tone: 'high', hint: '未匹配到可信函证，需人工从候选中指定' },
}

/** 归属来源文案 */
export const ASSIGN_SOURCE_LABEL: Record<AssignSource, string> = {
  auto: '自动归属',
  'manual-confirm': '人工确认',
  'manual-assign': '人工指定',
}

/* ------------------------------------------------------------------ */
/* 归一化                                                              */
/* ------------------------------------------------------------------ */

/** 全角转半角 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/** 银行 / 单位名称中的高频繁体字 → 简体 */
const TRADITIONAL_MAP: Record<string, string> = {
  銀: '银',
  業: '业',
  農: '农',
  國: '国',
  際: '际',
  發: '发',
  財: '财',
  產: '产',
  險: '险',
  證: '证',
  興: '兴',
  華: '华',
  東: '东',
  廣: '广',
  寧: '宁',
  齊: '齐',
  魯: '鲁',
  濟: '济',
  滙: '汇',
  豐: '丰',
  恆: '恒',
  誠: '诚',
  貿: '贸',
}

/** 常见银行简称 → 规范名（命中后按精确命中计） */
const BANK_ALIAS: Record<string, string> = {
  工行: '中国工商银行',
  工商银行: '中国工商银行',
  建行: '中国建设银行',
  建设银行: '中国建设银行',
  农行: '中国农业银行',
  农业银行: '中国农业银行',
  中行: '中国银行',
  交行: '交通银行',
  招行: '招商银行',
  邮储银行: '中国邮政储蓄银行',
  邮政储蓄银行: '中国邮政储蓄银行',
  农商行: '农村商业银行',
}

/** 企业组织形式后缀 —— 比对前剥离（长后缀优先） */
const ENTITY_SUFFIXES = [
  '股份有限公司',
  '有限责任公司',
  '集团股份有限公司',
  '集团有限公司',
  '股份公司',
  '有限公司',
  '集团公司',
  '有限合伙',
  '公司',
]

/** 通用文本归一化：全角转半角、去空白与标点、繁转简 */
function baseNormalize(raw: string): string {
  if (!raw) return ''
  let s = toHalfWidth(raw).trim()
  s = s.replace(/[\s]+/g, '')
  s = s.replace(/[（）()【】[\]「」<>《》·,，.。、;；:：'"“”‘’\-—_/\\|]/g, '')
  s = s
    .split('')
    .map((ch) => TRADITIONAL_MAP[ch] ?? ch)
    .join('')
  return s.toLowerCase()
}

/** 剥离企业组织形式后缀，保留字号主体 */
function stripEntitySuffix(s: string): string {
  let out = s
  let changed = true
  while (changed) {
    changed = false
    for (const suf of ENTITY_SUFFIXES) {
      if (out.length > suf.length && out.endsWith(suf)) {
        out = out.slice(0, -suf.length)
        changed = true
        break
      }
    }
  }
  return out
}

/** 银行名称归一化 */
export function normalizeBankName(raw: string): string {
  return stripEntitySuffix(baseNormalize(raw))
}

/** 被审计单位名称归一化 */
export function normalizeEntityName(raw: string): string {
  return stripEntitySuffix(baseNormalize(raw))
}

/**
 * 日期归一化为 YYYY-MM-DD。
 * 兼容 2024-01-01 / 2024/01/01 / 2024.01.01 / 2024年1月1日 / 20240101 五种写法。
 */
export function normalizeDate(raw: string): string {
  if (!raw) return ''
  const s = toHalfWidth(raw).trim()
  if (!s || s === '—' || s === '-') return ''

  const m = s.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  const compact = s.replace(/\D/g, '')
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  }
  return s
}

/* ------------------------------------------------------------------ */
/* 单要素比对                                                          */
/* ------------------------------------------------------------------ */

type HitKind = 'exact' | 'fuzzy' | 'miss'

interface HitResult {
  kind: HitKind
  reason: string
}

/** Levenshtein 编辑距离 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/** 相似度 0~1 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  return 1 - levenshtein(a, b) / max
}

/** 名称类要素（银行名称 / 被审计单位名称）比对 */
function compareName(repliedRaw: string, sentRaw: string, label: string): HitResult {
  const rn = normalizeBankName(repliedRaw)
  const sn = normalizeBankName(sentRaw)
  if (!rn || !sn) return { kind: 'miss', reason: `${label}未能识别` }

  if (rn === sn) {
    return {
      kind: 'exact',
      reason: baseNormalize(repliedRaw) === baseNormalize(sentRaw) ? '与发函底稿一致' : '去企业后缀后完全一致',
    }
  }

  const rc = BANK_ALIAS[rn] ?? rn
  const sc = BANK_ALIAS[sn] ?? sn
  if (rc === sc) return { kind: 'exact', reason: '银行简称与规范名一致' }

  // 一方包含另一方 —— 常见于回函落款为分支行，或使用简称
  if (rn.length >= 2 && sn.length >= 2) {
    if (rn.includes(sn)) return { kind: 'fuzzy', reason: '回函落款疑为分支机构' }
    if (sn.includes(rn)) return { kind: 'fuzzy', reason: '发函名称疑为简称' }
  }

  const sim = similarity(rc, sc)
  if (sim >= FUZZY_SIMILARITY) {
    return { kind: 'fuzzy', reason: '文字存在轻微差异' }
  }
  return { kind: 'miss', reason: '与发函底稿不一致' }
}

/** 日期类要素比对 */
function compareDate(repliedRaw: string, sentRaw: string): HitResult {
  const r = normalizeDate(repliedRaw)
  const s = normalizeDate(sentRaw)
  if (!r || !s) return { kind: 'miss', reason: '日期未能识别' }
  if (r === s) {
    return {
      kind: 'exact',
      reason: toHalfWidth(repliedRaw).trim() === toHalfWidth(sentRaw).trim() ? '与发函底稿一致' : '日期写法归一后一致',
    }
  }
  return { kind: 'miss', reason: '与发函底稿不一致' }
}

/* ------------------------------------------------------------------ */
/* 单封候选打分                                                        */
/* ------------------------------------------------------------------ */

interface FieldDef {
  key: keyof BankFieldInput
  label: string
  sentValue: string
  kind: 'name' | 'date'
  confidence: number
}

interface CandidateEval {
  candidate: BankCandidate
  fields: BankTextField[]
}

function buildFieldDefs(cand: BankCandidateSource): FieldDef[] {
  return [
    { key: 'bankName', label: BANK_FIELD_LABELS.bankName, sentValue: cand.entity, kind: 'name', confidence: 0.94 },
    {
      key: 'auditedEntity',
      label: BANK_FIELD_LABELS.auditedEntity,
      sentValue: cand.auditedEntity,
      kind: 'name',
      confidence: 0.93,
    },
    { key: 'periodStart', label: BANK_FIELD_LABELS.periodStart, sentValue: cand.periodStart, kind: 'date', confidence: 0.93 },
    { key: 'periodEnd', label: BANK_FIELD_LABELS.periodEnd, sentValue: cand.periodEnd, kind: 'date', confidence: 0.92 },
  ]
}

function evalCandidate(input: BankFieldInput, cand: BankCandidateSource): CandidateEval {
  const defs = buildFieldDefs(cand)
  const fields: BankTextField[] = []
  const hitKeys: string[] = []
  let score = 0

  for (const def of defs) {
    const repliedValue = input[def.key] ?? ''
    const hit = def.kind === 'name' ? compareName(repliedValue, def.sentValue, def.label) : compareDate(repliedValue, def.sentValue)
    const weight = BANK_FIELD_WEIGHTS[def.key] ?? 0
    if (hit.kind === 'exact') score += weight
    else if (hit.kind === 'fuzzy') score += weight * FUZZY_DISCOUNT
    if (hit.kind !== 'miss') hitKeys.push(def.key)

    fields.push({
      key: def.key,
      label: def.label,
      value: repliedValue,
      sentValue: def.sentValue,
      matched: hit.kind !== 'miss',
      fuzzy: hit.kind === 'fuzzy',
      confidence: def.confidence,
      repliedNorm: def.kind === 'date' ? normalizeDate(repliedValue) : normalizeBankName(repliedValue),
      sentNorm: def.kind === 'date' ? normalizeDate(def.sentValue) : normalizeBankName(def.sentValue),
      weight,
      reason: hit.reason,
    })
  }

  return {
    candidate: {
      confirmationNo: cand.confirmationNo,
      entity: cand.entity,
      periodStart: cand.periodStart,
      periodEnd: cand.periodEnd,
      score: Math.round(score * 1000) / 1000,
      hitKeys,
      bankNameHit: hitKeys.includes('bankName'),
    },
    fields,
  }
}

/* ------------------------------------------------------------------ */
/* 对外能力                                                            */
/* ------------------------------------------------------------------ */

/** 候选函证按匹配度降序排列 */
export function rankBankCandidates(input: BankFieldInput, sources: BankCandidateSource[]): BankCandidate[] {
  return sources
    .map((src) => evalCandidate(input, src).candidate)
    .sort((a, b) => b.score - a.score || a.confirmationNo.localeCompare(b.confirmationNo))
}

/**
 * 档位判定 —— 全部规则收敛于此，UI 不再自行判断。
 *   auto    银行名称精确命中且总分满分
 *   confirm 银行名称命中（含模糊）且总分不低于阈值
 *   manual  其余情况
 */
export function decideLevel(fields: BankTextField[], score: number): MatchLevel {
  const bank = fields.find((f) => f.key === 'bankName')
  if (!bank?.matched) return 'manual'
  if (score >= AUTO_SCORE && !bank.fuzzy) return 'auto'
  if (score >= CONFIRM_SCORE) return 'confirm'
  return 'manual'
}

/** 对一份银行回函执行四要素匹配，返回匹配明细、档位与候选排序 */
export function scoreBankMatch(input: BankFieldInput, sources: BankCandidateSource[]): BankTextResult {
  const evals = sources.map((src) => evalCandidate(input, src))
  const sorted = [...evals].sort(
    (a, b) => b.candidate.score - a.candidate.score || a.candidate.confirmationNo.localeCompare(b.candidate.confirmationNo),
  )
  const best = sorted[0]

  if (!best) {
    return {
      fields: [],
      conclusion: '不在本期函证控制表内，需人工指定',
      confidence: 0,
      level: 'manual',
      score: 0,
      candidates: [],
      reason: '候选函证为空',
    }
  }

  const { fields } = best
  const level = decideLevel(fields, best.candidate.score)
  const bankField = fields.find((f) => f.key === 'bankName')

  /*
   * 结论文案只回答用户关心的两件事：**匹配上了没 / 匹配到哪封系统函证**。
   * 得分、阈值、命中数、相似度等内部指标一律不进文案（v2.25 原则：
   * 界面上不出现「没有解释就无法理解」的数字），它们仍保留在结构里供逻辑使用。
   */
  let conclusion: string
  let reason: string | undefined

  if (level === 'auto') {
    conclusion = `已匹配到系统函证 ${best.candidate.confirmationNo}`
  } else if (level === 'confirm') {
    conclusion = `建议匹配到系统函证 ${best.candidate.confirmationNo}，请确认`
    reason = bankField?.fuzzy
      ? bankField.reason
      : `未完全匹配的要素：${fields.filter((f) => !f.matched).map((f) => f.label).join('、')}`
  } else {
    conclusion = '未匹配到系统函证，需人工指定'
    reason = bankField?.reason ?? '未匹配到可信的函证'
  }

  return {
    fields,
    conclusion,
    confidence: best.candidate.score,
    level,
    score: best.candidate.score,
    candidates: sorted.map((e) => e.candidate),
    reason,
  }
}
