import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Input, Modal, Radio, Table, Tag, Tooltip, Upload } from 'antd'
import {
  FileExcelOutlined,
  InfoCircleFilled,
  PaperClipOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { buildBankItemGroups, buildSubjectEntriesForRecord } from '@/mock/confirmations'
import { TYPE_RULE, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import PdfPreview from '@/components/PdfPreview'
import FullscreenModal from '@/components/FullscreenModal'
import VerificationPanel from '@/components/VerificationPanel'
import BankItemsTable from '@/components/BankItemsTable'
import { AiChip, ResultBar } from '@/components/Marks'
import type { BankItemGroup, BankItemRow, CrossSealChoice, SubjectEntry } from '@/types'

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
   *   印章缺失 / 异常仅进入 AI 风险提示，两者分开表达。
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
   * 表单初始值 = **已保存过的人工判断值**（若有）。
   *
   * 两层口径都要守住：
   *   ① 保存过的值优先回显 —— 否则「修改」变成每次都从 AI 建议重来；
   *   ② 没保存过时**留空**，不默认等于 AI 建议 —— 那等于 AI 自动写入，
   *      与约束 C-03（AI 结果须经人工确认才写入）相悖。
   */
  const [matched, setMatched] = useState<boolean | undefined>(record?.resultInfo?.matched)
  const [diffDesc, setDiffDesc] = useState(record?.resultInfo?.diffDesc ?? '')
  const [sealConsistent, setSealConsistent] = useState<boolean | undefined>(
    record?.resultInfo?.sealConsistent,
  )
  const [sealReason, setSealReason] = useState(record?.resultInfo?.sealReason ?? '')
  /** 是否为公章（非财务章等其他印章） */
  const [officialSeal, setOfficialSeal] = useState<boolean | undefined>(
    record?.resultInfo?.officialSeal,
  )
  /** 是否有骑缝章 */
  const [crossSeal, setCrossSeal] = useState<CrossSealChoice | undefined>(
    record?.resultInfo?.crossSeal,
  )
  const [adopted, setAdopted] = useState<Record<string, boolean>>({})
  /**
   * 完整核验明细（内嵌只读面板）。
   * 刻意**不走列表页的互斥弹窗状态** —— 若跳转到「AI 核验」弹窗，本弹窗会被卸载，
   * 已填但未保存的草稿会全部丢失；内嵌 Modal 不改变 activeModal，草稿完整保留。
   */
  const [verifyOpen, setVerifyOpen] = useState(false)
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
   * 必填 —— 未处理时保存被拦下，并明确指出是哪几项（而非按钮点不动却说不出原因）。
   *
   * **按类型分流（v2.41）**：往来 = 4 项（含「是否有骑缝章」）；**银行 = 3 项** ——
   * 自 v2.39 起银行函证不检测骑缝章（R-03 限定往来），该字段在银行行不渲染，
   * 校验自然也不该要求它（**系统不检测的项不该要求人工填**）。
   */
  const missingRequired = () => {
    const miss: string[] = []
    if (matched === undefined) miss.push('函证结果是否相符')
    if (sealConsistent === undefined) miss.push('回函盖章是否与被询证方名称一致')
    if (officialSeal === undefined) miss.push('是否为公章')
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
              const patch = {
                resultInfo: { matched, diffDesc, sealConsistent, sealReason, officialSeal, crossSeal },
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
                  <ThunderboltOutlined style={{ color: 'var(--c-primary)' }} /> AI 核验结论
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  默认不填入表单，采纳后仍可修改
                </span>
              </div>

              {/* 相符性 —— 往来按印章落章区域；银行按询证事项逐项核对（依据见 evaluateMatch） */}
              <ResultBar
                status={aiMatched === null ? 'info' : aiMatched ? 'ok' : 'risk'}
                message={aiMatched === null ? '无法判定' : aiMatched ? '相符' : '不相符'}
                detail={
                  suggestion?.basis
                    ? `依据：${suggestion.basis}`
                    : '识别数据尚未齐备，暂无法给出建议'
                }
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <AiChip confidence={isBank ? 0.96 : v.seal.confidence} />
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
                message={v.seal.nameMatched ? '一致' : '不一致'}
                detail={`依据：印章名称「${v.seal.sealName}」`}
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <AiChip confidence={0.96} />
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

              {/* 是否为公章 */}
              <ResultBar
                status={aiOfficialSeal === undefined ? 'info' : aiOfficialSeal ? 'ok' : 'risk'}
                message={
                  aiOfficialSeal === undefined
                    ? '无法判定（未检出印章）'
                    : aiOfficialSeal
                      ? '是'
                      : `否（检出「${v.seal.sealType}」）`
                }
                detail={
                  aiOfficialSeal === undefined
                    ? '未在回函文件任何页检出印章'
                    : `依据：检出印章类型为「${v.seal.sealType}」`
                }
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <AiChip confidence={0.97} />
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

              {/* 是否有骑缝章 —— 仅往来函证（v2.39 起银行不检测骑缝章） */}
              {!isBank && (
                <ResultBar
                  status={aiCrossSeal === undefined ? 'info' : aiCrossSeal === 'yes' ? 'ok' : 'risk'}
                  message={
                    aiCrossSeal === undefined
                      ? '无法判定（未检出印章）'
                      : aiCrossSeal === 'yes'
                        ? `有（${v.seal.crossPageSealCount} 处）`
                        : '未检出'
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
                      <AiChip confidence={v.seal.crossPageSealCount ? 0.94 : 0.9} />
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

              {/* 不相符描述 —— 手写体转录全文可见（要看内容才能决定是否采纳）；银行函证不检测手写体 */}
              {rule?.detectHandwriting && v.handwriting && (
                <ResultBar
                  status="info"
                  message="不相符处描述"
                  detail={v.handwriting.text}
                  extra={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <AiChip confidence={v.handwriting.confidence} label="OCR" />
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

              {/* 看全文的入口 —— 内嵌只读面板，不卸载本弹窗，草稿不丢 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--c-text-3)',
                }}
              >
                <span>完整核验明细（{rule?.verifyItemsLabel ?? '一致性比对 / 印章'}）</span>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  onClick={() => setVerifyOpen(true)}
                >
                  查看完整核验
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  回函结果不相符处的描述
                </span>
                <Input.TextArea
                  rows={3}
                  value={diffDesc}
                  onChange={(e) => setDiffDesc(e.target.value)}
                  placeholder={rule?.diffPlaceholder}
                  style={{ flex: 1 }}
                />
              </div>

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

              {/* 是否为公章 */}
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  盖章不一致处原因描述
                </span>
                <Input.TextArea
                  rows={2}
                  value={sealReason}
                  onChange={(e) => setSealReason(e.target.value)}
                  placeholder="盖章与被询证方名称不一致时填写"
                  style={{ flex: 1 }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  替代性测试文件
                </span>
                <Upload beforeUpload={() => false} multiple>
                  <Button size="small" icon={<PaperClipOutlined />}>
                    上传附件（JPG / JPEG / PDF，可多附件）
                  </Button>
                </Upload>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 200, fontSize: 13, color: 'var(--c-text-2)', flexShrink: 0, textAlign: 'right' }}>
                  拟执行的进一步核查程序及底稿指引
                </span>
                <Upload beforeUpload={() => false}>
                  <Button size="small" icon={<FileExcelOutlined />}>
                    上传附件（支持 Excel）
                  </Button>
                </Upload>
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
                  <Button size="small" icon={<UploadOutlined />}>
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
                <Button size="small" icon={<UploadOutlined />}>
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

      {/* 内嵌只读核验明细 —— 不改变列表页的互斥弹窗状态，因此本弹窗不卸载、已填草稿不丢 */}
      <Modal
        open={verifyOpen}
        title={`AI 智能核验 · ${record.confirmationNo}`}
        width={1280}
        footer={<Button onClick={() => setVerifyOpen(false)}>关闭</Button>}
        onCancel={() => setVerifyOpen(false)}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflow: 'auto' } }}
      >
        <VerificationPanel record={record} previewHeight={520} />
      </Modal>
    </FullscreenModal>
  )
}
