import { useMemo, useState } from 'react'
import { Alert, App, Button, Input, Modal, Radio, Table, Tag, Tooltip, Upload } from 'antd'
import {
  FileExcelOutlined,
  InfoCircleFilled,
  PaperClipOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { buildBankItemsForRecord, buildSubjectEntriesForRecord } from '@/mock/confirmations'
import PdfPreview from '@/components/PdfPreview'
import FullscreenModal from '@/components/FullscreenModal'
import VerificationPanel from '@/components/VerificationPanel'
import { AiChip, ResultBar } from '@/components/Marks'
import type { BankItemEntry, CrossSealChoice, SubjectEntry } from '@/types'

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

  const entries = useMemo(() => (record ? buildSubjectEntriesForRecord(record) : []), [record])
  const bankItems = useMemo(() => (record ? buildBankItemsForRecord(record) : []), [record])
  const bankDiffCount = bankItems.filter((b) => !b.match).length

  /**
   * AI 推导「函证结果是否相符」：
   *   往来函证 —— 由印章落章区域判定；
   *   银行函证 —— 印章落章区域 + 询证事项逐项核对结果，存在差异即判不相符。
   */
  const aiMatched = useMemo(() => {
    if (!v) return undefined
    if (!v.seal.hasSeal) return undefined
    const bySeal = v.seal.region === '信息证明无误区'
    if (record?.type === '银行函证') return bySeal && bankDiffCount === 0
    return bySeal
  }, [v, record?.type, bankDiffCount])

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

  /** 四项必填 —— 未处理时保存被拦下，并明确指出是哪几项（而非按钮点不动却说不出原因） */
  const missingRequired = () => {
    const miss: string[] = []
    if (matched === undefined) miss.push('函证结果是否相符')
    if (sealConsistent === undefined) miss.push('回函盖章是否与被询证方名称一致')
    if (officialSeal === undefined) miss.push('是否为公章')
    if (crossSeal === undefined) miss.push('是否有骑缝章')
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
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：回函函证文件（放大展示） */}
        <div style={{ flex: 1.15, minWidth: 0 }}>
          <div className="panel" style={{ padding: 10 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              回函函证
            </div>
            <PdfPreview
              confirmationNo={record.confirmationNo}
              entity={record.entity}
              showRegions
              activeRegion={v?.seal.region}
              sealBoxes={v?.seal.boxes ?? []}
              handwriting={v?.handwriting?.text}
              height={620}
            />
          </div>
        </div>

        {/* 右：结果表单 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/*
           * AI 核验结论 —— 只作**建议**展示：默认不填入下方表单，人工点「采纳」才进入。
           * 三项统一为「结论条 → 依据 → 采纳动作」骨架（与核验页明细同一套），
           * 区块命名与「AI 核验」入口对齐 —— 让用户知道这些结论就是 AI 核验出来的。
           */}
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

              {/* 相符性 —— 由印章位置决定 */}
              <ResultBar
                status={aiMatched === undefined ? 'info' : aiMatched ? 'ok' : 'risk'}
                message={
                  aiMatched === undefined ? '无法判定（未检出印章）' : aiMatched ? '相符' : '不相符'
                }
                detail={
                  aiMatched === undefined
                    ? '未在回函文件任何页检出印章，建议退回被询证方补盖后再归档'
                    : `依据：印章盖于「${v.seal.region}」${
                        isBank
                          ? bankDiffCount > 0
                            ? ` + 询证事项逐项核对 ${bankDiffCount} 项差异`
                            : ' + 询证事项逐项核对全部相符'
                          : v.consistency.diffCount > 0
                            ? ` + 一致性比对 ${v.consistency.diffCount} 项金额差异`
                            : ''
                      }`
                }
                extra={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <AiChip confidence={v.seal.confidence} />
                    <Button
                      size="small"
                      type={adopted.matched ? 'default' : 'primary'}
                      ghost={!adopted.matched}
                      disabled={aiMatched === undefined}
                      onClick={() => {
                        setMatched(aiMatched)
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

              {/* 是否有骑缝章 */}
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

              {/* 不相符描述 —— 手写体转录全文可见（要看内容才能决定是否采纳） */}
              {v.handwriting && (
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
                <span>完整核验明细（一致性比对 / 印章 / 手写体 / 银行文本）</span>
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
                <Tooltip title="依据函证业务规则：印章盖在「信息证明无误」区判定为相符；盖在「信息不符」区判定为不相符">
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
                  placeholder="请描述不符项目及差异缘由，可由上方「手写体识别」一键带入"
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
                <span className="muted" style={{ fontSize: 12 }}>
                  ⓘ 建议值见上方 AI 核验结论
                </span>
              </div>

              {/* 是否有骑缝章 */}
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

          {/* 银行函证：询证事项逐项核对（替代往来函证的科目余额分录） */}
          {isBank && (
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

              <Table<BankItemEntry>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={bankItems}
                rowClassName={(r) => (!r.match ? 'row-risk-high' : '')}
                columns={[
                  {
                    title: '询证事项',
                    dataIndex: 'item',
                    width: 190,
                    render: (t: string, r) => (
                      <span>
                        <span className="muted num" style={{ marginRight: 6 }}>
                          {r.itemNo}
                        </span>
                        {t}
                      </span>
                    ),
                  },
                  {
                    title: '发函金额',
                    dataIndex: 'sentAmount',
                    width: 140,
                    align: 'right',
                    render: (val: number | null) => (
                      <span className="num">{val ? val.toLocaleString('zh-CN') : '—'}</span>
                    ),
                  },
                  {
                    title: '回函金额（元）',
                    dataIndex: 'repliedAmount',
                    width: 160,
                    align: 'right',
                    render: (val: number | null, r) => (
                      <Input
                        size="small"
                        defaultValue={val ? val.toLocaleString('zh-CN') : ''}
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
                  {
                    title: '核对结论',
                    dataIndex: 'match',
                    width: 96,
                    render: (m: boolean) => (
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          fontSize: 12,
                          border: 'none',
                          color: 'var(--c-text-1)',
                          background: m ? 'var(--c-risk-low-bg)' : 'var(--c-risk-high-bg)',
                        }}
                      >
                        {m ? '相符' : '不一致'}
                      </Tag>
                    ),
                  },
                  {
                    title: '备注',
                    dataIndex: 'note',
                    render: (t?: string) => (
                      <span className="muted" style={{ fontSize: 13 }}>
                        {t ?? '—'}
                      </span>
                    ),
                  },
                ]}
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
