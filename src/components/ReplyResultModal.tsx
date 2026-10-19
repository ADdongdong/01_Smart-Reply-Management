import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Input, Radio, Table, Tag, Tooltip } from 'antd'
import { InfoCircleFilled, PlusOutlined } from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { buildBankItemGroups, buildSubjectEntriesForRecord } from '@/mock/confirmations'
import { TYPE_RULE, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import AttachmentField from '@/components/AttachmentField'
import PdfPreview from '@/components/PdfPreview'
import FullscreenModal from '@/components/FullscreenModal'
import BankItemsTable from '@/components/BankItemsTable'
import { AiGlyph, ResultBar } from '@/components/Marks'
import { StatusTag } from '@/components/StatusTag'
import { aiReviewPrefill } from '@/config/aiReview'
import { RESULT_NOTE_FIELDS } from '@/config/replyTasks'
import type {
  BankItemGroup,
  BankItemRow,
  CrossSealChoice,
  ReplyAttachment,
  ReplyRecord,
  ReplyResultInfo,
  SubjectEntry,
} from '@/types'

/**
 * 重算单行 —— 改了「回函值」就必须重算 `diff` 与 `match`，否则分组表自己不可信。
 * 判据与系统一致：有差异即不相符（`services/replyRule.ts` 的 `consistencyOnly`）。
 * 系统无此笔（`sentAmount == null`）时差异无从计算，结论交给人工判定（留 null）。
 */
function recalcRow(row: BankItemRow, replyAmount: number | null): BankItemRow {
  const diff = row.sentAmount == null || replyAmount == null ? null : replyAmount - row.sentAmount
  return {
    ...row,
    replyAmount,
    diff,
    match: diff == null ? null : diff === 0,
  }
}

/**
 * 列表「核查事项复核」里**采纳过**的项 → 本页各字段的「已采纳」标记（v3.28）。
 *
 * 带出来的值需要在本页**看得出是采纳来的**：沿用本页既有的 `adopted` 机制
 * （那条「采纳」按钮会因此显示「已采纳」），并驱动顶部那枚来源标签。
 *
 * **只有"本页还没保存过该字段"时才标** —— 已保存的值是人工上次的判断，
 * 那时它出现在表单里是"回显"，不是"刚带出来"，标成采纳会误导读者的判断依据。
 */
function adoptedFromAiReview(record?: ReplyRecord): Record<string, boolean> {
  const pre = record ? aiReviewPrefill(record) : {}
  const saved = record?.resultInfo
  const out: Record<string, boolean> = {}
  if (pre.matched !== undefined && saved?.matched === undefined) out.matched = true
  if (pre.sealConsistent !== undefined && saved?.sealConsistent === undefined) out.seal = true
  if (pre.officialSeal !== undefined && saved?.officialSeal === undefined) out.official = true
  if (pre.crossSeal !== undefined && saved?.crossSeal === undefined) out.cross = true
  if (pre.diffDesc && !saved?.diffDesc) out.desc = true
  return out
}

export default function ReplyResultModal({
  open,
  recordId,
  onClose,
}: {
  open: boolean
  recordId?: string
  onClose: () => void
}) {
  const { message } = App.useApp()
  const { state, dispatch } = useApp()
  const record = state.records.find((r) => r.id === recordId)
  const v = record?.verification
  const isBank = record?.type === '银行函证'
  /** 本类型的业务规则（检测项 / 文案 / 判据）—— 一律查表，不写内联类型分支 */
  const rule = record ? TYPE_RULE[record.type] : undefined
  /**
   * AI 识别中（v2.28 银行函证两阶段）：归属已确认、阶段二尚未回填。
   * 此时 AI 建议块整体不出现（`v` 为空），改为一条说明；
   * **询证事项表也不能展示** —— `buildBankItemsForRecord` 会回退到内置演示数据，展示出来是误导。
   */
  const recognizing = !!record && isRecognitionPending(record)

  const entries = useMemo(() => (record ? buildSubjectEntriesForRecord(record) : []), [record])

  /**
   * 询证事项分组（v2.40）—— **受控 state**，因为本页要就地编辑回函值并实时重算差异 / 结论。
   * 换记录时按新的记录重新初始化（`recordId` 作依赖，而不是 `record` 对象引用 ——
   * 后者每次 dispatch 都会变，会把用户的编辑冲掉）。
   */
  const [bankItemGroups, setBankItemGroups] = useState<BankItemGroup[]>([])
  useEffect(() => {
    if (!record) return
    setBankItemGroups(recognizing ? [] : buildBankItemGroups(record))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, recognizing])

  /**
   * 差异项计数 —— **从分组派生**，与分组表同源。
   * `run`（识别中）与 `empty`（本份未列示）不参与计数：前者尚未有结论，
   * 后者本就无此行。否则识别中就会算出「0 项差异 → 相符」这种看起来正常的假结论。
   */
  const bankDiffCount = useMemo(
    () =>
      bankItemGroups.reduce(
        (n, g) =>
          g.stat === 'empty' || g.stat === 'run'
            ? n
            : n + g.rows.filter((r) => r.match === false).length,
        0,
      ),
    [bankItemGroups],
  )

  /**
   * 回函值变更 —— **实时重算该行的差异与结论**。
   * 这是分组表可信的前提：若只改数字不重算，会出现
   * 「回函值 900 / 系统数据 1000 / 差异 0」这种自相矛盾的行。
   */
  const handleReplyChange = (groupId: string, rowId: string, value: number | null) => {
    setBankItemGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              rows: g.rows.map((r) => (r.id !== rowId ? r : recalcRow(r, value))),
            },
      ),
    )
  }

  /**
   * 组级「应用 AI 识别值」—— **不覆盖已人工改过的行**。
   * 判据是「回函值 ≠ AI 识别值」即视为人工改过；否则人工核对了半天，一点就白做。
   */
  const handleApplyGroup = (groupId: string) => {
    setBankItemGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              rows: g.rows.map((r) =>
                r.aiAmount == null || r.replyAmount !== r.aiAmount ? r : recalcRow(r, r.aiAmount),
              ),
            },
      ),
    )
    message.success('已应用 AI 识别值（人工修改过的行保持不变）')
  }

  /**
   * 组级「重新识别」—— **组级动作**，因为表格走 MinerU **整表识别**，只能重跑整张表。
   * 演示：`fail → run → done`（1.6s 后回填 AI 值并重算结论）。
   */
  const handleRerunGroup = (groupId: string) => {
    setBankItemGroups((prev) =>
      prev.map((g) => (g.id !== groupId ? g : { ...g, stat: 'run' as const })),
    )
    window.setTimeout(() => {
      setBankItemGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                stat: 'done' as const,
                rows: g.rows.map((r) => recalcRow(r, r.sentAmount)),
              },
        ),
      )
      message.success('本组表格已重新识别完成')
    }, 1600)
  }

  /**
   * AI 推导「函证结果是否相符」—— 调用 `evaluateMatch` **唯一出口**（services/replyRule.ts）：
   *   往来函证 —— 由印章落章区域判定；
   *   银行函证 —— **只看询证事项逐项核对**（回函 × 系统内格式一/二数据），印章不作相符性依据，
   *   印章缺失 / 异常只在核验页的「印章核查」里表达，两者分开表达。
   */
  const suggestion = useMemo(() => (record ? evaluateMatch(record) : undefined), [record])
  const aiMatched = suggestion?.matched ?? null

  /** AI 推导「是否为公章」—— 未检出印章时无法判定 */
  const aiOfficialSeal = useMemo(
    () => (v && v.seal.hasSeal ? v.seal.sealType === '公章' : undefined),
    [v],
  )

  /**
   * AI 推导「是否有骑缝章」。
   * 只有「是 / 否」两态 —— 单页回函不存在骑缝章概念，但页数不在识别输出里，
   * 故第三态「不适用」交给人工在表单中选择。
   */
  const aiCrossSeal = useMemo<'yes' | 'no' | undefined>(
    () => (v && v.seal.hasSeal ? (v.seal.crossPageSeal ? 'yes' : 'no') : undefined),
    [v],
  )

  /**
   * **列表「核查事项复核」里已采纳的值**（v3.28）—— 本页初值的第二来源。
   * 映射规则见 `config/aiReview.ts` 的 `aiReviewPrefill`（与列表事项同一份声明，不另写一套）。
   */
  const aiPrefill: Partial<ReplyResultInfo> = record ? aiReviewPrefill(record) : {}
  /** 其中**真正被带进本页**的字段（已保存值优先，故可能少于此） */
  const fromAiReview = adoptedFromAiReview(record)
  const fromAiReviewCount = Object.keys(fromAiReview).length

  /**
   * 表单初始值 = **已保存过的人工判断值优先 → 列表采纳值 → 空**。
   *
   * 三层口径都要守住：
   *   ① 保存过的值优先回显 —— 否则「修改」变成每次都从 AI 建议重来；
   *   ② 没保存过时，**只带"人在列表上明确采纳过"的值**（v3.28）——
   *      用户口径：「回函结果里的那些智能核验项目，如果在前面的字段中，已经选择了采纳或者不采纳，
   *      就自动带出前面选择的结果」；**标记不采纳的一项一律不带**（那是"我看过、不采用"）；
   *   ③ 都没有则**留空**，绝不默认等于 AI 建议 —— 那等于 AI 自动写入，
   *      与约束 C-03（AI 结果须经人工确认才写入）相悖。
   */
  const [matched, setMatched] = useState<boolean | undefined>(
    record?.resultInfo?.matched ?? aiPrefill.matched,
  )
  const [diffDesc, setDiffDesc] = useState(record?.resultInfo?.diffDesc ?? aiPrefill.diffDesc ?? '')
  const [sealConsistent, setSealConsistent] = useState<boolean | undefined>(
    record?.resultInfo?.sealConsistent ?? aiPrefill.sealConsistent,
  )
  const [sealReason, setSealReason] = useState(record?.resultInfo?.sealReason ?? '')
  /** 是否为公章（非财务章等其他印章） */
  const [officialSeal, setOfficialSeal] = useState<boolean | undefined>(
    record?.resultInfo?.officialSeal ?? aiPrefill.officialSeal,
  )
  /** 是否有骑缝章 */
  const [crossSeal, setCrossSeal] = useState<CrossSealChoice | undefined>(
    record?.resultInfo?.crossSeal ?? aiPrefill.crossSeal,
  )
  /**
   * **三个"人工补充"字段**（v3.34）—— 两个附件 + 一段底稿指引文本。
   *
   * 它们与核验页第 4 项「回函结果补充」**读写同一份数据**（`resultInfo`），
   * 所以本页也必须进 state、随保存一起落库：此前这三行只是"摆了三个上传按钮"，
   * 不读也不写 —— 在本页选了文件，一保存就没了，与核验页那句「两处都能传」对不上。
   */
  const [altTestFiles, setAltTestFiles] = useState<ReplyAttachment[]>(
    record?.resultInfo?.altTestFiles ?? [],
  )
  const [diffAdjustFiles, setDiffAdjustFiles] = useState<ReplyAttachment[]>(
    record?.resultInfo?.diffAdjustFiles ?? [],
  )
  /**
   * 「拟执行的进一步核查程序及底稿指引」—— **文本，不是上传件**（v3.34，用户口径：
   * 「是文本框输入，不是上传附件」）。数据字段是 `procedureNote`（原 `procedureFiles` 已废）。
   */
  const [procedureNote, setProcedureNote] = useState(record?.resultInfo?.procedureNote ?? '')
  /* 采纳标记：列表上采纳过的项一进来就显示「已采纳」，与本页现点「采纳」同形 */
  const [adopted, setAdopted] = useState<Record<string, boolean>>(() =>
    adoptedFromAiReview(record),
  )
  /**
   * 完整核验明细（内嵌只读面板）。
   * 刻意**不走列表页的互斥弹窗状态** —— 若跳转到「AI 核验」弹窗，本弹窗会被卸载，
   * 已填但未保存的草稿会全部丢失；内嵌 Modal 不改变 activeModal，草稿完整保留。
   */
  /** 提交校验：点击保存后若有必填未处理，高亮对应区块 */
  const [showErrors, setShowErrors] = useState(false)

  if (!open || !record) return null

  /**
   * 编辑态 —— 该函证已归档（回函快递信息与回函结果都已确认）。
   * 此时保存只更新回函结果：**保持「已完成」状态、不重打留痕**，
   * 但会留下「最近修改」记录，让「归档后被改动」这件事可追溯。
   */
  const isArchived = record.replyProgress === '已完成'

  const markAdopt = (key: string) => setAdopted((p) => ({ ...p, [key]: true }))

  /**
   * **一键采纳所有**（v3.11）—— 把「AI 核验结论」这一栏里**当前有建议**的项一次性带进表单。
   *
   * 为什么要有它：这一栏固定 5 条（函证结果是否相符 / 印章与被询证单位一致 / 是否为公章 /
   * 是否有骑缝章 / 不相符手写内容识别），**全采是常态、个别不采是例外**，逐条点「采纳」
   * 就是 5 次纯重复劳动 —— 与 v2.36 去掉「回函快递信息」的逐项采纳、v2.40 给询证事项表
   * 加「一键应用 AI 值」是同一条口径：**批量动作要有一键，个别不要靠逐条不点**。
   *
   * 边界（**与逐条点「采纳」完全同效**，不引入第二套规则）：
   * · **只采纳有建议的项** —— 恰好就是各条按钮里 `disabled` 的那几个（没识别到就没什么可采纳）；
   * · 已有值会被建议值覆盖 —— 与逐条点一致，且采纳后仍可改（本栏顶部那句
   *   「默认不填入表单，采纳后仍可修改」照旧成立）；
   * · 银行侧不含「是否有骑缝章」（v2.39 起银行不检测该项），故这里按 `!isBank` 跳过。
   */
  const adoptAll = () => {
    let n = 0
    if (v) {
      if (aiMatched !== null) {
        setMatched(aiMatched)
        markAdopt('matched')
        n += 1
      }
      setSealConsistent(v.seal.nameMatched)
      markAdopt('seal')
      n += 1
      /* 是否为公章仅往来（v3.48：银行不核印章类型，该字段在银行侧不存在） */
      if (!isBank && aiOfficialSeal !== undefined) {
        setOfficialSeal(aiOfficialSeal)
        markAdopt('official')
        n += 1
      }
      if (!isBank && aiCrossSeal !== undefined) {
        setCrossSeal(aiCrossSeal)
        markAdopt('cross')
        n += 1
      }
      if (rule?.detectHandwriting && v.handwriting) {
        setDiffDesc(v.handwriting.text)
        markAdopt('desc')
        n += 1
      }
    }
    message.success(`已采纳全部 AI 建议（${n} 项）`)
  }

  /**
   * 必填 —— 未处理时保存被拦下，并明确指出是哪几项（而非按钮点不动却说不出原因）。
   *
   * **按类型分流**：往来 = 4 项（含「是否有骑缝章」「是否为公章」）；
   * **银行 = 2 项**（相符性 + 章名一致）—— 自 v2.39 起银行不检测骑缝章（R-03 限定往来），
   * v3.48 起银行也不再核印章类型（「是否为公章」随印章数量 / 类型 / 落章区域一并去掉）。
   * 该字段在银行侧不渲染，校验自然也不该要求它（**系统不检测的项不该要求人工填**）。
   */
  const missingRequired = () => {
    const miss: string[] = []
    if (matched === undefined) miss.push('函证结果是否相符')
    if (sealConsistent === undefined) miss.push('回函盖章是否与被询证方名称一致')
    if (!isBank && officialSeal === undefined) miss.push('是否为公章')
    if (!isBank && crossSeal === undefined) miss.push('是否有骑缝章')
    return miss
  }

  return (
    <FullscreenModal
      open={open}
      title="回函结果填写"
      subtitle={`${record.confirmationNo} · ${record.type} · ${record.entity}`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {isArchived ? (
              <>
                <InfoCircleFilled style={{ color: 'var(--c-primary)' }} /> 该函证已归档 ——
                本次修改只更新回函结果，<b>保持「已完成」状态</b>；系统会记录修改人与修改时间
              </>
            ) : (
              <>
                带 <span style={{ color: 'var(--c-risk-high)' }}>*</span> 的必填项处理后方可归档；归档将记录处理人「张审计」与处理时间
              </>
            )}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={() => {
              const miss = missingRequired()
              if (miss.length) {
                setShowErrors(true)
                message.warning(`请先处理必填项：${miss.join('、')}`)
                return
              }
              /*
               * **先铺 `record.resultInfo` 再盖本轮值**（v3.34 修）——
               * store 里 `...action.patch` 是浅合并，`resultInfo` 是**整份替换**：
               * 只写本页这几个字段的话，核验页第 4 项保存的附件 / 底稿指引会被**抹掉**。
               */
              const patch = {
                resultInfo: {
                  ...record.resultInfo,
                  matched,
                  diffDesc,
                  sealConsistent,
                  sealReason,
                  /* 银行侧没有这个字段（v3.48）—— 显式写 undefined，把历史数据里可能存在的值一并清掉 */
                  officialSeal: isBank ? undefined : officialSeal,
                  crossSeal,
                  altTestFiles,
                  diffAdjustFiles,
                  procedureNote,
                },
              }
              if (isArchived) {
                dispatch({ type: 'UPDATE_RESULT', recordId: record.id, patch })
                message.success('回函结果已更新，仍保持「已完成」状态')
                onClose()
                return
              }
              dispatch({ type: 'SUBMIT_RESULT', recordId: record.id, patch })
              message.success('回函结果已保存，该函证流程已完成')
              onClose()
            }}
          >
            {isArchived ? '保存修改' : '保存并归档'}
          </Button>
        </div>
      }
    >
      <div className="result-workspace">
        {/* 左：回函函证文件（放大展示）—— 固定栏，不参与右栏滚动 */}
        <div className="rw-left">
          {/* 面板撑满整栏高度，预览再吃掉标题之外的剩余空间 —— 不猜像素高度 */}
          <div
            className="panel"
            style={{ padding: 10, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <div className="section-title" style={{ marginBottom: 8 }}>
              回函函证
            </div>
            <PdfPreview
              confirmationNo={record.confirmationNo}
              entity={record.entity}
              showRegions
              activeRegion={v?.seal.region}
              sealBoxes={v?.seal.boxes ?? []}
              handwriting={rule?.detectHandwriting ? v?.handwriting?.text : undefined}
              height="100%"
            />
          </div>
        </div>

        {/* 右：结果表单 —— 独立上下滚动，左栏不动 */}
        <div className="rw-right" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/*
           * AI 核验结论 —— 只作**建议**展示：默认不填入下方表单，人工点「采纳」才进入。
           * 三项统一为「结论条 → 依据 → 采纳动作」骨架（与核验页明细同一套），
           * 区块命名与「AI 核验」入口对齐 —— 让用户知道这些结论就是 AI 核验出来的。
           */}
          {recognizing && (
            <Alert
              type="info"
              showIcon
              message="AI 识别中"
              description="其余检测项完成后自动刷新 AI 建议；当前可先人工填写，也可稍后再采纳。"
            />
          )}

          {v && (
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="section-title">
                  <AiGlyph /> AI 核验结论
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  默认不填入表单，采纳后仍可修改
                </span>
                {/*
                  来源标签（v3.28）—— 说明"表单里那几个值不是凭空来的，是你在列表上采纳过的"。
                  用户口径：「回函结果里的那些智能核验项目，如果在前面的字段中，已经选择了采纳……
                  就自动带出前面选择的结果」。带出来后**仍可改**（这里是初值，不是锁定）。
                */}
                {fromAiReviewCount > 0 && (
                  <StatusTag
                    ai
                    size="sm"
                    tone="primary"
                    tip={`已按你在列表「核查事项复核」里的采纳结果带入（${fromAiReviewCount} 项）；不采纳的项不会带值，带进来的也仍可修改`}
                  >
                    已带出列表采纳的 {fromAiReviewCount} 项
                  </StatusTag>
                )}
              </div>

              {/* 相符性 —— 往来按印章落章区域；银行按询证事项逐项核对（依据见 evaluateMatch） */}
              {/*
               * v2.67：五条结论的标题由「结论词」扩写为「完整结论」（用户要求）——
               * 原先「相符」「一致」「否（检出「财务章」）」这类词要连着下面那行依据才读得懂，
               * 且与列表「回函是否相符」列的口径（「相符 / 不相符 / 无法判定」）表述不一。
               * 扩写后每条**单独可读**，无法判定的分支保持原样。
               */}
              <ResultBar
                status={aiMatched === null ? 'info' : aiMatched ? 'ok' : 'risk'}
                message={
                  aiMatched === null ? '无法判定' : aiMatched ? '回函结果相符' : '回函结果不符'
                }
                detail={
                  suggestion?.basis
                    ? `依据：${suggestion.basis}`
                    : '识别数据尚未齐备，暂无法给出建议'
                }
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <Button
                      size="small"
                      type={adopted.matched ? 'default' : 'primary'}
                      ghost={!adopted.matched}
                      disabled={aiMatched === null}
                      onClick={() => {
                        setMatched(aiMatched ?? undefined)
                        markAdopt('matched')
                      }}
                    >
                      {adopted.matched ? '已采纳' : '采纳'}
                    </Button>
                  </span>
                }
              />

              {/* 盖章一致性 */}
              <ResultBar
                status={v.seal.nameMatched ? 'ok' : 'risk'}
                message={v.seal.nameMatched ? '印章与被询证单位一致' : '印章与被询证单位不一致'}
                detail={`依据：印章名称「${v.seal.sealName}」`}
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <Button
                      size="small"
                      type={adopted.seal ? 'default' : 'primary'}
                      ghost={!adopted.seal}
                      onClick={() => {
                        setSealConsistent(v.seal.nameMatched)
                        markAdopt('seal')
                      }}
                    >
                      {adopted.seal ? '已采纳' : '采纳'}
                    </Button>
                  </span>
                }
              />

              {/* 是否为公章 —— 仅往来（v3.48：银行不核印章类型，该字段在银行侧整体去掉） */}
              {!isBank && (
              <ResultBar
                status={aiOfficialSeal === undefined ? 'info' : aiOfficialSeal ? 'ok' : 'risk'}
                message={
                  aiOfficialSeal === undefined
                    ? '无法判定（未检出印章）'
                    : aiOfficialSeal
                      ? '不为财务章'
                      : '为财务章'
                }
                detail={
                  aiOfficialSeal === undefined
                    ? '未在回函文件任何页检出印章'
                    : `依据：检出印章类型为「${v.seal.sealType}」`
                }
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <Button
                      size="small"
                      type={adopted.official ? 'default' : 'primary'}
                      ghost={!adopted.official}
                      disabled={aiOfficialSeal === undefined}
                      onClick={() => {
                        setOfficialSeal(aiOfficialSeal)
                        markAdopt('official')
                      }}
                    >
                      {adopted.official ? '已采纳' : '采纳'}
                    </Button>
                  </span>
                }
              />
              )}

              {/* 是否有骑缝章 —— 仅往来函证（v2.39 起银行不检测骑缝章） */}
              {!isBank && (
                <ResultBar
                  status={aiCrossSeal === undefined ? 'info' : aiCrossSeal === 'yes' ? 'ok' : 'risk'}
                  message={
                    aiCrossSeal === undefined
                      ? '无法判定（未检出印章）'
                      : aiCrossSeal === 'yes'
                        ? `有骑缝章（${v.seal.crossPageSealCount} 处）`
                        : '无骑缝章'
                  }
                  detail={
                    aiCrossSeal === undefined
                      ? '未在回函文件任何页检出印章'
                      : aiCrossSeal === 'yes'
                        ? '依据：多页回函已检出骑缝章'
                        : '依据：多页回函未检出骑缝章；若原件为单页回函，可在下方改为「不适用」'
                  }
                  extra={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <Button
                        size="small"
                        type={adopted.cross ? 'default' : 'primary'}
                        ghost={!adopted.cross}
                        disabled={aiCrossSeal === undefined}
                        onClick={() => {
                          setCrossSeal(aiCrossSeal)
                          markAdopt('cross')
                        }}
                      >
                        {adopted.cross ? '已采纳' : '采纳'}
                      </Button>
                    </span>
                  }
                />
              )}

              {/* 不相符手写内容识别（v2.67 改名，原「不相符处描述」）—— 手写体转录全文可见
                  （要看内容才能决定是否采纳）；银行函证不检测手写体。
                  采纳后仍带入下方表单的「回函结果不相符处的描述」字段。 */}
              {rule?.detectHandwriting && v.handwriting && (
                <ResultBar
                  status="info"
                  message="不相符手写内容识别"
                  detail={v.handwriting.text}
                  extra={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <Button
                        size="small"
                        type={adopted.desc ? 'default' : 'primary'}
                        ghost={!adopted.desc}
                        onClick={() => {
                          setDiffDesc(v.handwriting!.text)
                          markAdopt('desc')
                        }}
                      >
                        {adopted.desc ? '已采纳' : '采纳'}
                      </Button>
                    </span>
                  }
                />
              )}

              {/*
               * 本栏唯一动作：**一键采纳所有**（各结论条上的「采纳」逐个点也等价）。
               *
               * ⚠️ 原「查看完整核验」按钮已删（v3.42，用户：「回函结果这里，删除【查看完整核验】按钮」）——
               * 「拿 AI 结论去原件上核对依据」这件事的入口只留**列表「核查事项复核」格**那一处
               * （它打开的核验页左栏就是原件 + 批注、右栏是逐项依据与人工确认列）；
               * 结果页再开一个看依据的口子，等于同一件事两个入口，用户得点两次才知道哪个是真的。
               */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--c-text-3)',
                }}
              >
                <span>以上结论可逐条采纳，也可</span>
                
                <Button size="small" onClick={adoptAll}>
                  一键采纳所有
                </Button>
              </div>
            </div>
          )}

          {/* 结果表单 */}
          <div className="panel" style={{ padding: 12 }}>
            <div className="section-title" style={{ marginBottom: 12 }}>
              函证结果
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: showErrors && matched === undefined ? 'var(--c-risk-high-bg)' : undefined,
                }}
              >
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  <span style={{ color: 'var(--c-risk-high)' }}>* </span>函证结果是否相符
                </span>
                <Radio.Group
                  value={matched}
                  onChange={(e) => setMatched(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                  options={[
                    { label: '相符', value: true },
                    { label: '不相符', value: false },
                  ]}
                />
                <Tooltip title={rule?.matchRuleHint}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    ⓘ 建议值见上方 AI 核验结论，采纳后仍可修改
                  </span>
                </Tooltip>
              </div>

              {/*
               * 「回函结果不相符处的描述」（v3.34）—— 标签取自 `RESULT_NOTE_FIELDS`：
               * 核验页的一致性检测 / 手写体识别 / 印章识别三处「人工确认」列填的也是这一格，
               * 两处显示同一件事就不许各写一个名字。
               */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  {RESULT_NOTE_FIELDS.diffDesc}
                </span>
                <Input.TextArea
                  rows={3}
                  value={diffDesc}
                  onChange={(e) => setDiffDesc(e.target.value)}
                  placeholder={rule?.diffPlaceholder}
                  style={{ flex: 1 }}
                />
              </div>

              {/*
               * **差异调节表**（v3.32）—— 用户：「回函结果填写，这里还要加一个：差异调节表字段，
               * 支持上传 pdf 和 Excel」。
               *
               * **位置为什么紧跟在「不相符处的描述」下面**：这两项是同一件事的两半 ——
               * 描述说"差在哪"，调节表给"怎么调平的"，人工填完描述顺手就把表挂上来；
               * 若放到本页下方那组上传字段（替代性测试文件 / 拟执行的进一步核查程序）里，
               * 就离它要解释的那段描述隔了四五个字段。
               *
               * **格式锁 PDF / Excel**（用户口径）：`accept` 一头过滤系统文件选择器、一头给浏览器提示，
               * 与按钮文案里的"支持 PDF / Excel"互为表里 —— 只写文案不写 `accept`，
               * 用户仍会选中 xlsx 之外的一堆格式再被拦下。
               *
               * **不设必填**：上传类字段一律不进 `missingRequired()`（本页另一处附件字段同样如此）——
               * 差异调节表是"有差异时才有得传"，把它设成必填会把"相符"的行也堵在归档口。
               *
               * 交互与核验页第 4 项**完全一致**（v3.34）：两处改用同一个 `AttachmentField`
               * （`beforeUpload` 返回 `false` 不真上传、选文件即入列、逐条可删），读写同一份
               * `resultInfo.diffAdjustFiles` —— 同一件事若一个有回显、一个没有，用户只会怀疑哪个坏了。
               */}
              <AttachmentField
                label="差异调节表"
                actionText="上传附件（支持 PDF / Excel）"
                accept=".pdf,.xls,.xlsx"
                files={diffAdjustFiles}
                onChange={setDiffAdjustFiles}
                labelWidth={200}
              />

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background:
                    showErrors && sealConsistent === undefined ? 'var(--c-risk-high-bg)' : undefined,
                }}
              >
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  <span style={{ color: 'var(--c-risk-high)' }}>* </span>回函盖章是否与被询证方名称一致
                </span>
                <Radio.Group
                  value={sealConsistent}
                  onChange={(e) => setSealConsistent(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                  options={[
                    { label: '是', value: true },
                    { label: '否', value: false },
                  ]}
                />
              </div>

              {/* 是否为公章 —— 仅往来（v3.48：银行不核印章类型，该字段在银行侧整体去掉） */}
              {!isBank && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background:
                      showErrors && officialSeal === undefined ? 'var(--c-risk-high-bg)' : undefined,
                  }}
                >
                  <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                    <span style={{ color: 'var(--c-risk-high)' }}>* </span>是否为公章
                  </span>
                  <Radio.Group
                    value={officialSeal}
                    onChange={(e) => setOfficialSeal(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                    options={[
                      { label: '是', value: true },
                      { label: '否（财务章等其他印章）', value: false },
                    ]}
                  />
                  {/* 「ⓘ 建议值见上方 AI 核验结论」已于 v2.45 移除 —— 同一页上方已有一处，不重复 */}
                </div>
              )}

              {/* 是否有骑缝章 —— 仅往来函证（v2.39 起银行不检测骑缝章） */}
              {!isBank && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background:
                      showErrors && crossSeal === undefined ? 'var(--c-risk-high-bg)' : undefined,
                  }}
                >
                  <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                    <span style={{ color: 'var(--c-risk-high)' }}>* </span>是否有骑缝章
                  </span>
                  <Radio.Group
                    value={crossSeal}
                    onChange={(e) => setCrossSeal(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                    options={[
                      { label: '是', value: 'yes' },
                      { label: '否', value: 'no' },
                      { label: '不适用（单页回函）', value: 'na' },
                    ]}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    ⓘ 单页回函选择「不适用」
                  </span>
                </div>
              )}

              {/* 「盖章不一致处原因描述」—— 同上，核验页印章识别的「人工确认」列也填这一格 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  {RESULT_NOTE_FIELDS.sealReason}
                </span>
                <Input.TextArea
                  rows={2}
                  value={sealReason}
                  onChange={(e) => setSealReason(e.target.value)}
                  placeholder="盖章与被询证方名称不一致时填写"
                  style={{ flex: 1 }}
                />
              </div>

              {/*
               * 两个附件字段（v3.34）—— 改用与核验页第 4 项**同一个组件**（`AttachmentField`）：
               * 两处读写同一份 `resultInfo`，形态与交互（选文件即入列、可逐条删、显上传人与时间）
               * 就该一模一样；此前这里是两个"不读不写"的上传按钮，选了文件一保存就没了。
               * `labelWidth` 传 200 是为了与本页其它行（差异说明 / 底稿指引）的标签列对齐。
               */}
              <AttachmentField
                label="替代性测试文件"
                actionText="上传附件（JPG / JPEG / PDF，可多附件）"
                accept=".jpg,.jpeg,.pdf"
                files={altTestFiles}
                onChange={setAltTestFiles}
                labelWidth={200}
              />

              {/* 「拟执行的进一步核查程序及底稿指引」—— 文本输入，不是上传件（v3.34，用户拍板） */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span
                  style={{
                    width: 200,
                    fontSize: 13,
                    color: 'var(--c-text-2)',
                    flexShrink: 0,
                    textAlign: 'right',
                    paddingTop: 5,
                  }}
                >
                  拟执行的进一步核查程序及底稿指引
                </span>
                <Input.TextArea
                  rows={3}
                  value={procedureNote}
                  onChange={(e) => setProcedureNote(e.target.value)}
                  placeholder="例：差异科目逐笔追至明细账与出入库单并留存复印件（底稿索引 D-3-2）"
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>

          {/* 银行函证：询证事项逐项核对（替代往来函证的科目余额分录）—— 识别中不展示（数据尚未识别，回退展示会误导） */}
          {isBank && recognizing && (
            <div className="panel" style={{ padding: 12, fontSize: 13, color: 'var(--c-text-3)' }}>
              询证事项逐项核对将在 AI 识别完成后自动带入（回函识别结果 × 系统内格式一 / 格式二数据）。
            </div>
          )}
          {isBank && !recognizing && (
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="section-title">询证事项逐项核对</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  按标准《银行询证函》固定询证项核对，已自动带入回函识别结果
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  {/*
                   * 加一行（不是上传）—— 原先挂的是 `UploadOutlined`：那枚图标是
                   * **把文件传上来**的意思，而这颗按钮做的是**往表里加一行询证事项**，
                   * 两者在站内都有各自的固定记号（上传 = `CloudUploadOutlined`），
                   * 于是这枚图标既错义、又占了上传的坑。改 `PlusOutlined`（加）。
                   */}
                  <Button size="small" icon={<PlusOutlined />}>
                    新增询证事项
                  </Button>
                </span>
              </div>

              {/*
                v2.40：扁平平表 → **分组表**（`BankItemsTable`，可写模式）。
                真实回函里每一项各是一张列结构互不相同的子表、且一项可能多行，
                所以形态是「可折叠分组 + 组内标准子表 + 五列对照」
                （标识列 / 系统数据 / AI 识别值 / 回函值 / 差异 / 结论）。
                回函值改动后**差异与结论实时重算**；组级「应用 AI 识别值」**不覆盖已人工改过的行**。
              */}
              <BankItemsTable
                groups={bankItemGroups}
                mode="edit"
                onReplyChange={handleReplyChange}
                onApplyGroup={handleApplyGroup}
                onRerunGroup={handleRerunGroup}
              />

              {bankDiffCount > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 10 }}
                  message={
                    <span style={{ fontSize: 13 }}>
                      询证事项存在 <b>{bankDiffCount}</b> 项差异，核实后请填写「回函结果不相符处的描述」
                    </span>
                  }
                />
              )}
            </div>
          )}

          {/* 往来函证：科目余额分录 */}
          {!isBank && (
          <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="section-title">科目余额分录</span>
              <span className="muted" style={{ fontSize: 13 }}>
                已自动带入回函识别的差异科目
              </span>
              <span style={{ marginLeft: 'auto' }}>
                {/* 同上：「加一行」用 `PlusOutlined`，不用上传的那枚 */}
                <Button size="small" icon={<PlusOutlined />}>
                  新增分录
                </Button>
              </span>
            </div>

            <Table<SubjectEntry>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={entries}
              rowClassName={(r) => (!r.match ? 'row-risk-high' : '')}
              columns={[
                { title: '截止日期/所属期间', dataIndex: 'period', width: 150 },
                { title: '科目', dataIndex: 'subject', width: 140 },
                {
                  title: '询证金额',
                  dataIndex: 'sentAmount',
                  width: 140,
                  align: 'right',
                  render: (v: number | null) => <span className="num">{v?.toLocaleString('zh-CN') ?? '—'}</span>,
                },
                {
                  title: '科目金额（元）',
                  dataIndex: 'repliedAmount',
                  width: 150,
                  align: 'right',
                  render: (v: number | null, r) => (
                    <Input
                      size="small"
                      defaultValue={v?.toLocaleString('zh-CN') ?? ''}
                      style={{
                        textAlign: 'right',
                        color: r.match ? undefined : 'var(--c-risk-high)',
                        fontWeight: r.match ? 400 : 600,
                      }}
                    />
                  ),
                },
                {
                  title: '差异',
                  dataIndex: 'diff',
                  width: 120,
                  align: 'right',
                  render: (d: number) => (
                    <span className="num" style={{ color: d === 0 ? 'var(--c-text-3)' : 'var(--c-risk-high)' }}>
                      {d === 0 ? '0' : d.toLocaleString('zh-CN')}
                    </span>
                  ),
                },
              ]}
            />

          </div>
          )}
        </div>
      </div>
    </FullscreenModal>
  )
}
