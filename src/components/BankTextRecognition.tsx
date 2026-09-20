import { useMemo, useState } from 'react'
import { Button, Input, Progress, Table, Tag, Tooltip } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { AssignSource, BankCandidate, BankTextResult, BankTextField, MatchLevel } from '@/types'
import { AiChip, ResultBar } from '@/components/Marks'
import { ASSIGN_SOURCE_LABEL } from '@/services/bankMatch'

/**
 * 银行函证归属匹配明细。
 *
 * 银行回函由银行自行制作、文件内没有系统二维码，只能按「银行名称 + 被审计单位名称 +
 * 函证起始日期 + 函证截止日期」四要素定位唯一一封函证。本组件同时服务两处：
 *   · mode='assign' —— 识别队列内，可确认系统建议的归属、或从候选中改派/指定
 *   · mode='verify' —— AI 核验页内，只读回看当时的匹配结论
 *
 * 结构与其余三项统一：「结论条 → 事实清单（四要素对照 / 候选函证）→ 处理动作」。
 */

/** 档位 → 结论条语义（绿＝已完成归属 / 主色＝流程提示 / 红＝需人工介入） */
const LEVEL_STATUS: Record<MatchLevel, 'ok' | 'info' | 'risk'> = {
  auto: 'ok',
  confirm: 'info',
  manual: 'risk',
}

const LEVEL_TEXT: Record<MatchLevel, string> = {
  auto: '自动归属',
  confirm: '建议归属',
  manual: '待人工指定',
}

/** 归属来源留痕徽标 —— 两种人工操作同走主色，靠标签文字区分；自动归属为中性灰 */
function AssignBadge({ source }: { source: AssignSource }) {
  const tone =
    source === 'auto'
      ? { color: 'var(--c-text-3)', bg: 'var(--c-tag-bg)' }
      : source === 'manual-confirm'
        ? { color: 'var(--c-primary)', bg: 'var(--c-primary-bg)' }
        : { color: 'var(--c-primary)', bg: 'var(--c-ai-bg)' }
  return (
    <Tag
      style={{ marginInlineEnd: 0, fontSize: 12, lineHeight: '18px', border: 'none', color: tone.color, background: tone.bg }}
    >
      {ASSIGN_SOURCE_LABEL[source]}
    </Tag>
  )
}

/** 单要素命中方式标签 —— 只有「命中」给绿，其余（模糊/未命中）同属红档，差异由文字表达 */
function HitTag({ field }: { field: BankTextField }) {
  const kind = field.matched ? (field.fuzzy ? 'fuzzy' : 'exact') : 'miss'
  const map = {
    exact: { text: '精确命中', color: 'var(--c-text-1)', bg: 'var(--c-risk-low-bg)' },
    fuzzy: { text: '模糊命中', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
    miss: { text: '未命中', color: 'var(--c-text-1)', bg: 'var(--c-risk-high-bg)' },
  }[kind]
  return (
    <Tooltip title={field.reason}>
      <Tag style={{ marginInlineEnd: 0, fontSize: 12, border: 'none', color: map.color, background: map.bg }}>
        {map.text}
      </Tag>
    </Tooltip>
  )
}

/** 匹配度配色 —— 满分给绿，部分匹配给红（存在归属错配风险），未匹配退灰 */
function scoreColor(score: number): string {
  if (score >= 0.999) return 'var(--c-risk-low)'
  if (score >= 0.65) return 'var(--c-risk-high)'
  return 'var(--c-text-3)'
}

/** 命中要素的短标签 */
function HitKeys({ keys }: { keys: string[] }) {
  const labels: Record<string, string> = {
    bankName: '银行名称',
    auditedEntity: '被审计单位',
    periodStart: '起始日期',
    periodEnd: '截止日期',
  }
  if (!keys.length) return <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>无</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {keys.map((k) => (
        <Tag key={k} style={{ marginInlineEnd: 0, fontSize: 12, lineHeight: '16px', padding: '0 5px' }}>
          {labels[k] ?? k}
        </Tag>
      ))}
    </span>
  )
}

interface BankTextRecognitionProps {
  result: BankTextResult
  /** assign：识别队列内可操作；verify：AI 核验页只读 */
  mode?: 'assign' | 'verify'
  /** 采纳系统建议的归属 */
  onConfirm?: () => void
  /** 改派 / 指定归属 */
  onAssign?: (candidate: BankCandidate) => void
  /** 候选为空时，确认该回函不属于本期控制表 */
  onReject?: () => void
}

export default function BankTextRecognition({
  result,
  mode = 'verify',
  onConfirm,
  onAssign,
  onReject,
}: BankTextRecognitionProps) {
  const level: MatchLevel = result.level ?? 'auto'
  const candidates = result.candidates ?? []
  const best = candidates[0]

  /** confirm 档默认收起候选表，点「改派」后展开；manual 档默认展开 */
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null)
  const showCandidates = expandOverride ?? level === 'manual'
  const [keyword, setKeyword] = useState('')

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return candidates
    return candidates.filter(
      (c) => c.confirmationNo.toLowerCase().includes(kw) || c.entity.toLowerCase().includes(kw),
    )
  }, [candidates, keyword])

  const canOperate = mode === 'assign' && !!result.candidates

  return (
    <div>
      {/* ① 结论条 —— 只讲归属结论与判定依据，不复述加权算法 */}
      <ResultBar
        status={LEVEL_STATUS[level]}
        statusText={LEVEL_TEXT[level]}
        message={result.conclusion}
        detail={[
          `匹配得分 ${Math.round((result.score ?? 0) * 100)}%`,
          result.reason ? `判定依据：${result.reason}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        extra={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {result.assignSource && <AssignBadge source={result.assignSource} />}
            {canOperate && level === 'confirm' && (
              <>
                <Button size="small" type="primary" ghost onClick={onConfirm}>
                  确认归属
                </Button>
                <Button size="small" onClick={() => setExpandOverride(!showCandidates)}>
                  {showCandidates ? '收起候选' : '改派'}
                </Button>
              </>
            )}
            {canOperate && level === 'manual' && (
              <Button size="small" onClick={() => setExpandOverride(!showCandidates)}>
                {showCandidates ? '收起候选' : '选择归属'}
              </Button>
            )}
          </span>
        }
      />

      {/* ② 事实清单 · 四要素对照 */}
      <Table<BankTextField>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={result.fields}
        rowClassName={(f) => (f.matched ? '' : 'row-risk-high')}
        columns={[
          { title: '要素', dataIndex: 'label', width: 130 },
          {
            title: '回函识别值',
            dataIndex: 'value',
            render: (v: string, f) => (
              <span>
                <b style={{ fontSize: 13 }}>{v}</b>
                {f.repliedNorm && f.repliedNorm !== v && (
                  <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                    ↗ 归一化：{f.repliedNorm}
                  </span>
                )}
              </span>
            ),
          },
          {
            title: '发函底稿值',
            dataIndex: 'sentValue',
            width: 200,
            render: (v: string) => <span className="muted num">{v}</span>,
          },
          {
            title: '匹配方式',
            dataIndex: 'matched',
            width: 100,
            render: (_: boolean, f) => <HitTag field={f} />,
          },
          {
            title: '权重',
            dataIndex: 'weight',
            width: 70,
            align: 'right' as const,
            render: (w?: number) => <span className="muted num">{w ? `${Math.round(w * 100)}%` : '—'}</span>,
          },
          {
            title: '置信度',
            dataIndex: 'confidence',
            width: 96,
            render: (c: number) => <AiChip confidence={c} />,
          },
        ]}
      />

      {/* ② 事实清单 · 候选函证（需要改派 / 指定时才展开） */}
      {showCandidates && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>候选函证</span>
            <span className="muted" style={{ fontSize: 13 }}>
              按匹配度降序，共 {filtered.length} 封
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <Input
                size="small"
                allowClear
                placeholder="搜索银行名称或函证编号"
                prefix={<SearchOutlined style={{ color: 'var(--c-text-3)', fontSize: 13 }} />}
                style={{ width: 220 }}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </span>
          </div>

          <Table<BankCandidate>
            size="small"
            rowKey="confirmationNo"
            pagination={false}
            dataSource={filtered}
            locale={{
              emptyText: (
                <div style={{ padding: '10px 0' }}>
                  <div style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
                    未匹配到候选函证 —— 该银行可能不在本期函证控制表内
                  </div>
                  {canOperate && onReject && (
                    <Button size="small" style={{ marginTop: 8 }} onClick={onReject}>
                      确认不属于本期，标记为待处理
                    </Button>
                  )}
                </div>
              ),
            }}
            rowClassName={(c) => (c === best && level === 'confirm' ? 'row-ai-suggest' : '')}
            columns={[
              {
                title: '函证编号',
                dataIndex: 'confirmationNo',
                width: 118,
                render: (v: string) => (
                  <b className="num" style={{ fontSize: 13 }}>
                    {v}
                  </b>
                ),
              },
              { title: '被询证银行', dataIndex: 'entity' },
              {
                title: '函证期间',
                dataIndex: 'periodStart',
                width: 158,
                render: (_: string, c) => (
                  <span className="muted num" style={{ fontSize: 13 }}>
                    {c.periodStart} ~ {c.periodEnd}
                  </span>
                ),
              },
              {
                title: '匹配度',
                dataIndex: 'score',
                width: 132,
                render: (s: number) => (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Progress
                      percent={Math.round(s * 100)}
                      size="small"
                      showInfo={false}
                      strokeColor={scoreColor(s)}
                      trailColor="rgba(0,0,0,0.06)"
                      style={{ width: 68, marginBottom: 0 }}
                    />
                    <span className="num" style={{ fontSize: 13, color: scoreColor(s) }}>
                      {Math.round(s * 100)}%
                    </span>
                  </span>
                ),
              },
              {
                title: '命中要素',
                dataIndex: 'hitKeys',
                width: 180,
                render: (keys: string[]) => <HitKeys keys={keys} />,
              },
              ...(canOperate
                ? [
                    {
                      title: '操作',
                      key: 'action',
                      width: 60,
                      render: (_: unknown, c: BankCandidate) => (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto', fontSize: 13 }}
                          onClick={() => onAssign?.(c)}
                        >
                          指定
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
    </div>
  )
}
