import { useMemo, useState } from 'react'
import { Button, Input, Progress, Table, Tag } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { BankCandidate, BankTextResult, MatchLevel } from '@/types'

/**
 * 银行函证**归属操作面板** —— 只在**需要人工介入**时出现（建议归属 / 待人工指定）。
 *
 * 银行回函由银行自行制作、文件内没有系统二维码，只能按「银行名称 + 被审计单位名称 +
 * 函证起始日期 + 函证截止日期」四要素定位唯一一封函证。系统算得的结果给用户选，
 * 但**归属本身不再展示明细**（见下）。
 *
 * ## 为什么不再展示四要素对照表（v2.45）
 *
 * 需求文档 5.1 有一条既有的呈现原则：**归属匹配属系统内部处理，不暴露内部步骤，
 * 只给最终结果（归到哪封函证）**。往来函证一直照此执行 —— 工作台里归属只有一行结论。
 * 而本组件此前把「要素 / 回函识别值 / 发函底稿值 / 核对」整片铺开，偏离了该原则：
 * 用户判断「归得对不对」只需要知道**归到了哪封**，四要素的逐项比对是系统的活。
 * 四要素的识别进度另在识别队列与任务头部可见，不缺这一处。
 *
 * ## 现在只负责两件事
 * · **候选函证表**（含搜索、匹配度、命中要素）—— 这是「选择用的」，是待人工指定时
 *   唯一的操作入口，必须保留；
 * · **动作按钮** —— 确认归属 / 改派 / 选择归属 / 确认不属于本期。
 *
 * 归属来源徽标已移除：任务头部本就有「归属来源」一项（`RecognitionDrawer` 的 `Kv`），
 * 而本组件只在归属未定时渲染，那时也还没有来源可标。
 */

/** 档位 → 用户可读的归属状态词（识别队列卡片标题与本组件共用，避免各自造词） */
export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = {
  auto: '自动归属',
  confirm: '建议归属',
  manual: '待指定归属',
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
  /** 采纳系统建议的归属 */
  onConfirm?: () => void
  /** 改派 / 指定归属 */
  onAssign?: (candidate: BankCandidate) => void
  /** 候选为空时，确认该回函不属于本期控制表 */
  onReject?: () => void
}

export default function BankTextRecognition({
  result,
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

  /** 有候选项才需要人工操作 —— 无候选时走「确认不属于本期」出口（在候选表空态里） */
  const canOperate = !!result.candidates

  return (
    <div>
      {/*
       * ① 动作栏 —— **只放动作按钮**。归属结论（匹配到哪封 / 需人工指定）已在识别进度的
       * 「归属匹配」行表达过一次；四要素对照表已于 v2.45 移除（归属匹配只给结果）。
       */}
      {canOperate && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {level === 'confirm' && (
            <>
              <Button size="small" type="primary" ghost onClick={onConfirm}>
                确认归属
              </Button>
              <Button size="small" onClick={() => setExpandOverride(!showCandidates)}>
                {showCandidates ? '收起候选' : '改派'}
              </Button>
            </>
          )}
          {level === 'manual' && (
            <Button size="small" onClick={() => setExpandOverride(!showCandidates)}>
              {showCandidates ? '收起候选' : '选择归属'}
            </Button>
          )}
        </div>
      )}

      {/* ② 候选函证 —— 需要改派 / 指定时才展开（这是待人工指定时唯一的操作入口，必须保留） */}
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
