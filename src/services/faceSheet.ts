import type { BatchFaceSheet, ReplyRecord } from '@/types'

/**
 * 快递面单的配对与交叉校验（v2.42）。
 * ------------------------------------------------------------------
 * 真实形态：**面单是一叠独立的扫描件、随回函件一起上传**。系统只在面单上读
 * **条形码**（快递单号）与**寄件人**，再据此把面单与函证配对。
 *
 * 本轮实现**一条**交叉校验（用户决策：先做数据模型 + 最少的校验，其余四条后续补）：
 * **寄件人 ↔ 被询证单位** —— 这是最能一眼看出「面单配错函证」的一条：
 * 银行回函的寄件人必然是银行本身，若面单寄件人写的是另一家银行，配错了。
 *
 * 后续可沿同一形状追加的四条（结构已在 `FaceSheetCheck.rule` 预留）：
 * ① 单号唯一性（同批次不应出现两个相同单号）；② 一面对多封的合理上限（如 ≤ 10 封）；
 * ③ 寄件日期应早于回函登记日期；④ 收件人是否为项目组（而非其他被审计单位）。
 */

/** 名称归一 —— 去空白与常见后缀，避免「中国银行股份有限公司西安分行」与「中国银行西安分行」误判 */
function normalize(name: string): string {
  return name
    .replace(/[\s（）()·．.、,，]/g, '')
    .replace(/股份有限公司|有限责任公司|有限公司|银行股份/g, '')
    .trim()
}

/**
 * 面单与函证的**配对** —— 从批次任务的归属结果里取。
 *
 * 配对依据是「该任务归属到了哪封函证」（`task.confirmationNo`），
 * **不按单号猜** —— 单号在面单上是唯一的，但一封函证可能在多次回函里换过单号
 * （用户自己寄回的那次）。归属是已确认过的事实，比推断可靠。
 */
export function pairFaceSheets(
  sheets: BatchFaceSheet[],
  tasks: { confirmationNo?: string; expressNo?: string }[],
): BatchFaceSheet[] {
  return sheets.map((s) => {
    const matched = tasks
      .filter((t) => t.confirmationNo && t.expressNo && t.expressNo === s.expressNo)
      .map((t) => t.confirmationNo as string)
    return { ...s, matchedConfirmationNos: Array.from(new Set(matched)) }
  })
}

/**
 * 交叉校验：**寄件人 ↔ 被询证单位**。
 *
 * 三种结论：
 * · 未配对到任何函证 → `warn`（该面单在本批次里没有对应回函，可能是夹带的他项目文件）；
 * · 一对多（一个包裹多封）→ `warn` 但**不判错**：这是**正常业务形态**（银行一次寄回多封），
 *   只提示「共 N 封共用此单号」，让人确认是不是自己预期的那几封；
 * · 寄件人与全部被询证单位都不匹配 → `warn`（最可疑：面单配错了）。
 */
export function checkFaceSheet(sheet: BatchFaceSheet, records: ReplyRecord[]): BatchFaceSheet {
  const targets = records.filter((r) => sheet.matchedConfirmationNos.includes(r.confirmationNo))

  if (!targets.length) {
    return {
      ...sheet,
      check: {
        rule: 'senderMatchesEntity',
        level: 'warn',
        message: '该面单未配对到本批次的任何回函 —— 请确认是否为其他项目文件或需人工指定归属',
      },
    }
  }

  /* 一对多：正常形态，只提示封数 */
  if (targets.length > 1) {
    return {
      ...sheet,
      check: {
        rule: 'senderMatchesEntity',
        level: 'warn',
        message: `一张面单对应 ${targets.length} 封回函（${targets
          .map((t) => t.confirmationNo)
          .join('、')}）—— 同包裹寄回属正常形态，请确认封数无误`,
      },
    }
  }

  const sender = normalize(sheet.sender)
  const entity = normalize(targets[0].entity)
  /* 双向包含即视为一致 —— 「中国银行西安分行」与「中国银行股份有限公司西安分行」应当匹配 */
  const ok = sender.length > 0 && (sender.includes(entity) || entity.includes(sender))

  return {
    ...sheet,
    check: ok
      ? {
          rule: 'senderMatchesEntity',
          level: 'ok',
          message: `寄件人「${sheet.sender}」与被询证单位一致`,
        }
      : {
          rule: 'senderMatchesEntity',
          level: 'warn',
          message: `寄件人「${sheet.sender}」与被询证单位「${targets[0].entity}」不一致 —— 请确认面单是否配错`,
        },
  }
}

/** 对整批面单跑一遍配对 + 校验 */
export function checkFaceSheets(
  sheets: BatchFaceSheet[],
  tasks: { confirmationNo?: string; expressNo?: string }[],
  records: ReplyRecord[],
): BatchFaceSheet[] {
  return pairFaceSheets(sheets, tasks).map((s) => checkFaceSheet(s, records))
}
