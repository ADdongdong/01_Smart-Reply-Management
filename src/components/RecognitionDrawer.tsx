import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Select, Space } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DoubleRightOutlined,
  FilePdfOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { stagesOf } from '@/mock/recognition'
import { RECOVERY_ACTIONS } from '@/services/mockRecognition'
import { TYPE_RULE, evaluateMatch, isRecognitionPending } from '@/services/replyRule'
import { ASSIGN_SOURCE_LABEL } from '@/services/bankMatch'
import { MATCH_LEVEL_LABEL } from '@/components/BankTextRecognition'
import { CANDIDATE_RECORDS } from '@/mock/confirmations'
import BankTextRecognition from '@/components/BankTextRecognition'
import FullscreenModal from '@/components/FullscreenModal'
import { StatusTag } from '@/components/StatusTag'
import { checkFaceSheets } from '@/services/faceSheet'
import type { BatchFaceSheet, RecognitionStage, RecognitionTask, ReplyRecord, RiskLevel } from '@/types'

/**
 * 智能识别工作台。
 *
 * **形态已由右侧 920px 抽屉改为「全屏两栏工作区」**（文件名保留 `RecognitionDrawer.tsx`，
 * 避免改名牵动各处 import）：
 *   · 容器 —— 复用 `FullscreenModal`（即 `.fs-modal`：标题栏 / 内容区 / 固定底栏 / 100vw×100vh）；
 *   · 顶条 —— 「继续追加回函文件」上传条（常驻，可继续追加）；
 *   · 左栏 —— 识别队列（一个归属项一张可点卡片，独立纵向滚动）；
 *   · 右栏 —— 选中项的完整详情（归属匹配 / AI 检测点 / 风险与结论 / 人工核验 / 失败重试）；
 *   · 底栏 —— 识别进度与动作（最小化 / 完成并查看结果）。
 *
 * 关闭入口仍为三处：右上角 ×、Esc、底栏「最小化」；三者都走 `CLOSE_RECOGNITION`，
 * 语义不变 —— 最小化后由右下角 `FloatingProgress` 悬浮卡接管。原先「点遮罩即最小化」
 * 的行为随抽屉一起消失（全屏工作区不需要遮罩）。
 *
 * 业务契约（state / actions / store / mock / services）一律不改。
 */

/* ------------------------------------------------------------------ */
/* 共用小组件                                                          */
/* ------------------------------------------------------------------ */

/** 阶段状态图标 */
function StageIcon({ status }: { status: RecognitionStage['status'] }) {
  if (status === 'done')
    return <CheckCircleFilled style={{ color: 'var(--c-risk-low)', fontSize: 13 }} />
  if (status === 'running')
    return <LoadingOutlined style={{ color: 'var(--c-primary)', fontSize: 13 }} />
  if (status === 'failed')
    return <CloseCircleFilled style={{ color: 'var(--c-risk-high)', fontSize: 13 }} />
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: '1px solid var(--c-border)',
      }}
    />
  )
}

/**
 * 队列卡片状态圆点：
 *   · 归属已出结论但**待人工动作**（建议归属 / 待指定）—— 主色实心点（与既有 matchNeedsAction 口径一致）；
 *   · 其余按任务/阶段状态取图标。
 * 队列内一律不用横向进度条 —— 只用圆形图标 + 文字计数。
 */
function TaskDot({ task, needsAction }: { task: RecognitionTask; needsAction: boolean }) {
  if (needsAction) {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--c-primary)',
          flexShrink: 0,
        }}
      />
    )
  }
  const running = task.stages.some((s) => s.status === 'running')
  const allDone = task.stages.every((s) => s.status === 'done')
  if (task.status === 'failed') return <StageIcon status="failed" />
  if (task.status === 'success' || allDone) return <StageIcon status="done" />
  if (running) return <StageIcon status="running" />
  return <StageIcon status="waiting" />
}

/** 详情分组 —— 参照 Ant Design Pro 详情页：分组标题（16 / 600）+ 发丝线分隔，不卡片套卡片 */
function Section({ title, count, children }: { title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ paddingTop: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
          paddingBottom: 8,
          borderBottom: '1px solid var(--c-hairline)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--c-text-1)' }}>{title}</h3>
        {count != null && (
          <span className="num" style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
            {count}
          </span>
        )}
      </div>
      <div style={{ paddingTop: 12 }}>{children}</div>
    </section>
  )
}

/** 检测点逐项列表 —— 图标 + 名称 + 结论，末行不画线（无进度条） */
function StageList({ stages }: { stages: RecognitionStage[] }) {
  return (
    <div>
      {stages.map((s) => {
        const color =
          s.status === 'waiting'
            ? 'var(--c-text-3)'
            : s.status === 'running'
              ? 'var(--c-primary)'
              : 'var(--c-text-2)'
        const detail =
          s.detail ?? (s.status === 'running' ? '检测中…' : s.status === 'failed' ? '识别失败' : '待检测')
        return (
          <div key={s.key} className="recognition-stage">
            <span className="recognition-stage__icon">
              <StageIcon status={s.status} />
            </span>
            <span
              style={{
                fontSize: 13,
                color: 'var(--c-text-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={s.label}
            >
              {s.label}
            </span>
            <span style={{ fontSize: 13, color, overflowWrap: 'anywhere' }}>{detail}</span>
          </div>
        )
      })}
    </div>
  )
}

/** 键值对（项头元信息） */
function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--c-text-3)', whiteSpace: 'nowrap' }}>{k}</span>
      <span className={mono ? 'num' : undefined} style={{ fontSize: 13, color: 'var(--c-text-1)' }}>
        {v}
      </span>
    </span>
  )
}

/** 风险与结论 —— 一格一项 */
function VerdictCell({ k, v, tone }: { k: string; v: string; tone?: 'high' | 'low' | 'neutral' }) {
  const color =
    tone === 'high' ? 'var(--c-risk-high-text)' : tone === 'low' ? 'var(--c-risk-low-text)' : 'var(--c-text-1)'
  return (
    <div style={{ background: '#fff', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{k}</div>
      <div style={{ marginTop: 2, fontSize: 14, fontWeight: 500, color }}>{v}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 派生（全部查表 / 复用既有口径，不写内联类型判断与新词）              */
/* ------------------------------------------------------------------ */

const RISK_LABEL: Record<RiskLevel, string> = { high: '高', medium: '中', low: '低', none: '无' }

function riskTone(level?: RiskLevel): 'high' | 'low' | 'neutral' {
  if (level === 'high' || level === 'medium') return 'high'
  if (level === 'low') return 'low'
  return 'neutral'
}

function riskText(level?: RiskLevel): string {
  if (level === 'high' || level === 'medium' || level === 'low') return RISK_LABEL[level]
  return '待人工判定'
}

function matchStageOf(task: RecognitionTask): RecognitionStage | undefined {
  return task.stages.find((s) => s.key === 'match')
}

/** 阶段一是否已完成（银行=四要素识别完成，可开始「对应」） */
function phase1DoneOf(task: RecognitionTask): boolean {
  return stagesOf(task.type, 1).every((k) => task.stages.find((s) => s.key === k)?.status === 'done')
}

/** 归属看板是否**可操作**（建议归属 / 待指定）：四要素完成即可确认 / 改派，且尚未确定归属 */
function canAssignOf(task: RecognitionTask): boolean {
  return (
    task.type === '银行函证' &&
    !!task.bankMatch &&
    matchStageOf(task)?.status === 'done' &&
    phase1DoneOf(task) &&
    !task.assignSource
  )
}

/**
 * AI 智能核验检测点 —— 照 `TYPE_RULE` 取，不写死：**排除「归属匹配」**（它只给结果）。
 *
 * **v2.39 起银行侧的「识别四要素」计入检测点**（用户决策：`bankText` 保留 key、改为
 * 「识别四要素」的语义并计入阶段一 1 项），故不再被排除：
 *   · **往来 = 6 项**：一致性 / 是否印章 / 骑缝章 / 名称一致 / 手写体 / 快递面单；
 *   · **银行 = 4 项**：**识别四要素** / 询证事项逐项核对 / 回函是否有印章 / 印章名称与被询证单位一致
 *     （骑缝章与快递面单自 v2.39 起均不属银行侧，阶段一 1 项 + 阶段二 3 项）。
 */
function verifyItemsOf(task: RecognitionTask): RecognitionStage[] {
  return task.stages.filter(
    (s) =>
      s.key !== 'match' &&
      /*
       * 归属确认**前**：`bankText`（识别四要素）不计入核验区 —— 它的一行结论在识别队列
       * 与任务头部呈现（需求文档 5.1：「任务卡只显示『识别四要素』，其余检测项不铺开，
       * 避免结果先于对应出现」），此处不重复列一次；
       * 归属确认**后**：它作为检测点之一列出 —— 银行 4 项的第一项。
       */
      !(s.key === 'bankText' && !task.assignSource),
  )
}

/** 回函次数 —— 从归属匹配阶段文案中取（「…（第 1 次回函）」），取不到则不展示 */
function replySeqOf(task: RecognitionTask): string | undefined {
  return matchStageOf(task)?.detail?.match(/（(第[^）]*)）/)?.[1]
}

/** 归属匹配的一句话结论（只给结果，不含得分 / 阈值 / 相似度等内部指标） */
function matchLineOf(task: RecognitionTask): string {
  const ms = matchStageOf(task)
  if (task.status === 'failed') return '归属匹配失败'
  if (task.type === '银行函证') {
    if (!task.assignSource) return MATCH_LEVEL_LABEL[task.bankMatch?.level ?? 'manual']
    const entity = task.matchedEntity && task.matchedEntity !== '—' ? ` · ${task.matchedEntity}` : ''
    return `${task.assignSource === 'auto' ? '自动归属' : '已归属'}：${task.confirmationNo}${entity}`
  }
  if (task.assignSource) {
    const seq = replySeqOf(task)
    const entity = task.matchedEntity && task.matchedEntity !== '—' ? ` · ${task.matchedEntity}` : ''
    return `已归属：${task.confirmationNo}${entity}${seq ? ` · ${seq}` : ''}`
  }
  return '待指定归属'
}

/* ------------------------------------------------------------------ */
/* 左栏：识别队列卡片                                                  */
/* ------------------------------------------------------------------ */

function TaskCard({
  task,
  selected,
  record,
  onSelect,
}: {
  task: RecognitionTask
  selected: boolean
  record?: ReplyRecord
  onSelect: () => void
}) {
  const verifyItems = verifyItemsOf(task)
  const verifyDone = verifyItems.filter((s) => s.status === 'done').length
  const needsAction = canAssignOf(task)
  const failed = task.status === 'failed'
  const risk = record?.verification?.riskLevel
  const noText = task.confirmationNo === '待指定' ? '待指定' : task.confirmationNo
  const cls = ['recognition-task', selected ? 'is-selected' : '', failed ? 'is-failed' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={cls} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      {/* 主线：函证编号（待指定时显示「待指定」）+ 被询证单位（仅归属确定后）+ 页码 */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <TaskDot task={task} needsAction={needsAction} />
        <span
          className="num"
          style={{
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
            color: needsAction ? 'var(--c-primary)' : undefined,
          }}
        >
          {noText}
        </span>
        {task.assignSource && task.matchedEntity && task.matchedEntity !== '—' && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--c-text-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {task.matchedEntity}
          </span>
        )}
        {task.pageRange && (
          <span
            className="num"
            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-3)', flexShrink: 0 }}
          >
            {task.pageRange}
          </span>
        )}
      </span>

      {/* 归属结果一句话 */}
      <span
        style={{
          display: 'block',
          marginTop: 6,
          fontSize: 11,
          color: 'var(--c-text-3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={matchLineOf(task)}
      >
        {matchLineOf(task)}
      </span>

      {/* 标签行：类型 / 风险档 / 识别失败 / AI 检测点计数 */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <StatusTag size="sm" tone="neutral">
          {task.type}
        </StatusTag>
        {(risk === 'high' || risk === 'medium' || risk === 'low') && (
          <StatusTag size="sm" tone={riskTone(risk)}>
            风险 {RISK_LABEL[risk]}
          </StatusTag>
        )}
        {failed && (
          <StatusTag size="sm" tone="high">
            识别失败
          </StatusTag>
        )}
        <span className="num" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-3)' }}>
          AI 智能核验 {verifyDone}/{verifyItems.length}
        </span>
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 右栏：选中项详情                                                    */
/* ------------------------------------------------------------------ */

function TaskDetail({
  task,
  record,
  faceSheets = [],
}: {
  task: RecognitionTask
  record?: ReplyRecord
  /** 本批次携带的面单（v2.42，银行侧才有） */
  faceSheets?: BatchFaceSheet[]
}) {
  const { dispatch } = useApp()

  const ms = matchStageOf(task)
  const failed = task.status === 'failed'
  const failedStage = task.stages.find((s) => s.status === 'failed')
  const needsAction = canAssignOf(task)
  /**
   * 归属操作面板的渲染条件 —— **只在需要人工介入时出现**（建议归属 / 待人工指定）。
   * 归属一旦确定，归属区只剩一行结论（见下方 `matchLineOf`），不再有候选、明细或徽标。
   *
   * v2.45：四要素对照表与归属确认前的「识别四要素」逐项一并移除 ——
   * 需求文档 5.1 有既成原则「归属匹配属系统内部处理，不暴露内部步骤，只给最终结果
   * （归到哪封函证）」，往来函证一直照此执行（工作台里只有一行结论），本轮让银行侧对齐。
   * 四要素的识别进度在识别队列与任务头部本就可看，不缺这一处。
   */
  const showAssignPanel = task.type === '银行函证' && !!task.bankMatch && needsAction

  /**
   * 本任务相关的面单（v2.42）—— 只列**配对到本封函证**的那些。
   *
   * 面单一叠随批次上传，但每封回函只需看与自己有关的那张（一对多时多封看到同一张，
   * 这是对的：它们本就是同一个包裹）。校验结论由 `checkFaceSheets` 统一算好，此处只呈现。
   */
  const myFaceSheets = faceSheets.filter((s) => s.matchedConfirmationNos.includes(task.confirmationNo ?? ''))

  const verifyItems = verifyItemsOf(task)
  const verifyDone = verifyItems.filter((s) => s.status === 'done').length
  const verifyAllDone = verifyItems.length > 0 && verifyDone === verifyItems.length

  const recPending = !!record && isRecognitionPending(record)
  const evaluation = record && !recPending ? evaluateMatch(record) : null
  const region = record?.verification?.seal.region
  const riskLevel = record?.verification?.riskLevel
  const reasons = record?.verification?.riskReasons ?? []
  const conclusionText = evaluation
    ? evaluation.matched === true
      ? '相符'
      : evaluation.matched === false
        ? '不相符'
        : '待人工判定'
    : '待人工判定'
  const conclusionTone: 'high' | 'low' | 'neutral' =
    evaluation?.matched === true ? 'low' : evaluation?.matched === false ? 'high' : 'neutral'

  const replySeq = replySeqOf(task)
  /**
   * 发函记录编号：识别任务本身不携带该字段（数据层冻结）。落库后对应的回函记录里，
   * 该值在识别当刻写为「待登记-…」占位，故只在拿到真实编号时展示，否则整项省略。
   */
  const sendRecordNo =
    record?.sendRecordNo && !record.sendRecordNo.startsWith('待登记') ? record.sendRecordNo : undefined

  return (
    <div>
      {/* ① 项头 */}
      <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--c-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="num" style={{ fontSize: 16, fontWeight: 600 }}>
            {task.confirmationNo === '待指定' ? '待指定' : task.confirmationNo}
          </span>
          <StatusTag tone="neutral">{task.type}</StatusTag>
          {/*
            v2.37 移除「已人工核验」标签 —— 工作台里出现的是**刚识别完、等人工确认**的回函，
            「待核验」在这页是默认背景而非异常，标出来反而让人以为出了问题。
            核验状态在列表展开行的「留痕」区块看。
          */}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--c-text-2)' }}>
          {task.assignSource && task.matchedEntity && task.matchedEntity !== '—'
            ? task.matchedEntity
            : '被询证单位：归属未确定'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px', marginTop: 10 }}>
          <Kv k="来源文件" v={task.fileName} />
          {task.pageRange && <Kv k="页码" v={task.pageRange} />}
          {sendRecordNo && <Kv k="发函记录编号" v={sendRecordNo} mono />}
          {replySeq && <Kv k="回函次数" v={replySeq} />}
          {task.assignSource && <Kv k="归属来源" v={ASSIGN_SOURCE_LABEL[task.assignSource]} />}
        </div>
      </div>

      {/* ② 归属匹配 —— 只给结果，不加进度条。四段是**时序**（先归属→再检测→出结论→待人工），
          故标题带 ①–④ 序号（v2.48）：此前四段同样式同样大小，看起来像四个并列模块，
          用户「没太看明白」它们的先后关系。 */}
      <Section title="① 归属匹配" count="系统内部处理，只给结果">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 'var(--radius-control)',
            background: failed ? 'var(--c-risk-high-bg)' : 'var(--c-fill-light)',
          }}
        >
          <span style={{ flexShrink: 0, alignSelf: 'center' }}>
            <TaskDot task={task} needsAction={needsAction} />
          </span>
          <span style={{ fontSize: 13, color: 'var(--c-text-1)' }}>{matchLineOf(task)}</span>
        </div>

        {showAssignPanel && (
          <div style={{ marginTop: 12 }}>
            {/* 待指定 / 建议归属时给候选函证列表供选择 —— 银行回函无二维码，这是人工指定的唯一入口 */}
            <BankTextRecognition
              result={task.bankMatch!}
              onConfirm={() => dispatch({ type: 'CONFIRM_ASSIGN', taskId: task.id })}
              onAssign={(c) =>
                dispatch({
                  type: 'MANUAL_MATCH',
                  taskId: task.id,
                  confirmationNo: c.confirmationNo,
                  entity: c.entity,
                })
              }
              onReject={() => dispatch({ type: 'SKIP_TASK', taskId: task.id })}
            />
          </div>
        )}
      </Section>

      {/* ③ AI 智能核验 —— 检测点逐项 */}
      {verifyItems.length > 0 && (
        <Section title="② AI 智能核验" count={`${verifyDone}/${verifyItems.length} 项检测点`}>
          <StageList stages={verifyItems} />
        </Section>
      )}

      {/* ③′ 快递面单（v2.42）—— 银行侧的面单是独立一叠扫描件、随批次上传 */}
      {myFaceSheets.length > 0 && (
        <Section title="快递面单" count={`本批共 ${myFaceSheets.length} 张，随批次上传`}>
          {myFaceSheets.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid var(--c-hairline)',
                fontSize: 13,
              }}
            >
              <span className="num" style={{ minWidth: 150 }}>
                {s.expressNo}
              </span>
              <span style={{ color: 'var(--c-text-2)' }}>{s.sender}</span>
              {s.check && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: s.check.level === 'ok' ? 'var(--c-text-3)' : 'var(--c-risk-high-text)',
                  }}
                >
                  {s.check.message}
                </span>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* ④ 风险与结论 —— 检测点完成后给出（AI 建议值） */}
      {verifyAllDone && (
        <Section title="③ 风险与结论" count="AI 建议值，尚未经人工核验">
          {region || evaluation ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 1,
                  background: 'var(--c-hairline)',
                  borderRadius: 'var(--radius-control)',
                  overflow: 'hidden',
                }}
              >
                <VerdictCell k="印章落章区域" v={region ?? '待人工判定'} />
                <VerdictCell k="回函结果是否相符" v={conclusionText} tone={conclusionTone} />
                <VerdictCell k="风险等级" v={riskText(riskLevel)} tone={riskTone(riskLevel)} />
              </div>
              {reasons.length > 0 && (
                <ul
                  style={{
                    margin: '10px 0 0',
                    padding: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {reasons.map((r, i) => (
                    <li key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--c-text-2)' }}>
                      <span style={{ color: 'var(--c-text-3)' }}>·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--c-text-3)' }}>
                判定依据：{TYPE_RULE[task.type].matchRuleHint}
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-3)' }}>
              该回函未产出 AI 判定依据，需人工判定。
            </p>
          )}
        </Section>
      )}

      {/* ⑤ 人工核验 —— 只给去向，不再复述「AI 不落库」（标题旁已写） */}
      <Section title="④ 人工核验" count="AI 不自动落库">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-2)' }}>
          请在回函管理列表中逐份核对并完成人工核验。
        </p>
      </Section>

      {/* ⑥ 失败重试 —— 该任务识别失败时，把既有恢复动作放这里 */}
      {failed && failedStage && (
        <Section title="识别失败" count="识别已停止，等待人工处理">
          <div style={{ padding: 12, borderRadius: 'var(--radius-control)', background: 'var(--c-risk-high-bg)' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-risk-high-text)' }}>{task.failReason}</p>
            <Space size={8} wrap style={{ marginTop: 10 }}>
              <Select
                size="small"
                showSearch
                optionFilterProp="label"
                placeholder="手动指定归属的函证"
                style={{ width: 240 }}
                options={CANDIDATE_RECORDS.map((c) => ({
                  label: `${c.confirmationNo}　${c.entity}`,
                  value: c.confirmationNo,
                }))}
                onChange={(v) => {
                  const target = CANDIDATE_RECORDS.find((c) => c.confirmationNo === v)
                  if (!target) return
                  dispatch({
                    type: 'MANUAL_MATCH',
                    taskId: task.id,
                    confirmationNo: target.confirmationNo,
                    entity: target.entity,
                  })
                }}
              />
              <Button size="small" onClick={() => dispatch({ type: 'RETRY_TASK', taskId: task.id })}>
                重新识别
              </Button>
              <Button size="small" type="text" onClick={() => dispatch({ type: 'SKIP_TASK', taskId: task.id })}>
                跳过该页
              </Button>
            </Space>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--c-text-3)' }}>
              可选动作：{(RECOVERY_ACTIONS[failedStage.key] ?? []).join(' / ')}
            </p>
          </div>
        </Section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 主工作台                                                            */
/* ------------------------------------------------------------------ */

export default function RecognitionDrawer() {
  const { state, dispatch, pendingAssignCount } = useApp()
  /** 左栏当前选中项（跨批次，任务 id 全局唯一）；为空时跟随「正在处理」的那一项 */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /** 入口类型由打开工作台的上传入口指定（AppStore.recognitionType）—— 不再按文件名猜测 */
  const rule = TYPE_RULE[state.recognitionType]

  /**
   * 各批次的面单 → 配对 + 交叉校验（v2.42）。
   * 配对依据是**任务的归属结果**（`task.confirmationNo`），不是按单号猜 ——
   * 归属是已确认过的事实，比推断可靠；校验本轮只跑「寄件人 ↔ 被询证单位」一条。
   */
  const checkedFaceSheets = useMemo(() => {
    const map = new Map<string, BatchFaceSheet[]>()
    state.batches.forEach((b) => {
      map.set(
        b.id,
        b.faceSheets?.length ? checkFaceSheets(b.faceSheets, b.tasks, state.records) : [],
      )
    })
    return map
  }, [state.batches, state.records])

  /** 选中任务所属批次的（已校验）面单 */
  const selectedFaceSheets = useMemo(() => {
    if (!selectedId) return []
    const b = state.batches.find((x) => x.tasks.some((t) => t.id === selectedId))
    return b ? checkedFaceSheets.get(b.id) ?? [] : []
  }, [selectedId, state.batches, checkedFaceSheets])

  /**
   * 队列只列**当前入口类型**的批次（v2.48）。
   *
   * 工作台标题按入口类型渲染（如「往来函证回函」），此前队列却列出**所有**批次 ——
   * 用户先后传过两类函证时，就会出现「标题说往来、列表里是银行」的自相矛盾
   * （实测困惑：「上面有往来函证的回函文件……我没太看明白」）。
   * 另一类批次的进度：右下角悬浮卡（`FloatingProgress`，不分类型）或重新从对应入口进入工作台。
   *
   * **`allTasks` / `allDone` / `appliedCount` 等汇总必须基于过滤后的批次** ——
   * 否则底栏会把另一类的进度也算进来，与标题口径再次打架。
   */
  const typeBatches = useMemo(
    () => state.batches.filter((b) => b.type === state.recognitionType),
    [state.batches, state.recognitionType],
  )

  const hasBatch = typeBatches.length > 0
  const allTasks = typeBatches.flatMap((b) => b.tasks)
  const totalTasks = allTasks.length
  const doneTasks = allTasks.filter((t) => t.status === 'success' || t.status === 'failed').length
  const allDone = hasBatch && typeBatches.every((b) => b.status === 'done')
  /** 已实际写入回函管理列表的任务数（归属未确定的不会落库） */
  const appliedCount = allTasks.filter((t) => t.applied).length

  /** 落库后按 recordId 取回对应回函记录 —— 供风险标签、风险与结论区读取（只读，不改 store） */
  const recById = useMemo(() => new Map(state.records.map((r) => [r.id, r])), [state.records])

  /** 默认选中：优先正在处理的那一项，其次失败项，最后第一项 —— 用户一旦点选即固定 */
  const fallbackTask =
    allTasks.find((t) => t.status === 'pending') ??
    allTasks.find((t) => t.status === 'failed') ??
    allTasks[0]
  const selectedTask = allTasks.find((t) => t.id === selectedId) ?? fallbackTask

  /** 对应通道：正在识别四要素与归属的份 */
  const currentTask = allTasks.find(
    (t) => t.phase === 1 && t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
  )
  /** 细查通道：归属已确认、正在跑其余检测项的份（v2.28 两阶段） */
  const detailTask = allTasks.find(
    (t) => t.phase === 2 && t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
  )
  /** 待人工对应的份数（含建议归属与待指定） */
  const awaitingAssignCount = allTasks.filter(
    (t) => t.phase === 1 && t.status === 'success' && !t.assignSource,
  ).length

  /*
   * v2.47：原先这里还有 `handleFiles` / `openPicker` / `onDrop` / `onDragOver` 等
   * **工作台内的上传**逻辑，已整体移除 —— 上传移到列表页的上传弹窗
   * （往来 = `SplitEntryModal`，银行 = `BankUploadModal`），工作台只负责看进度与结果。
   * 原来顺带承担的「拖入 Excel → 导入快递数据」也已由独立的「导入快递数据」入口承载。
   */

  return (
    <FullscreenModal
      open={state.recognitionOpen}
      title="智能识别工作台"
      subtitle={`${state.recognitionType}回函`}
      onClose={() => dispatch({ type: 'CLOSE_RECOGNITION' })}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
            {hasBatch ? (
              <>
                识别进度 <b className="num">{doneTasks}/{totalTasks}</b>
                {currentTask && (
                  <>
                    {' '}· 正在处理：
                    <b style={{ color: 'var(--c-primary)', fontWeight: 600 }}>
                      {currentTask.confirmationNo === '待指定' ? '四要素识别中' : currentTask.confirmationNo}
                    </b>
                  </>
                )}
                {detailTask && (
                  <>
                    {' '}· 正在细查：
                    <b style={{ color: 'var(--c-primary)', fontWeight: 600 }}>{detailTask.confirmationNo}</b>
                  </>
                )}
                {allDone && pendingAssignCount === 0 && (
                  <span style={{ color: 'var(--c-risk-low)' }}>
                    {' '}· 全部完成 —— 请回回函管理列表完成人工核验
                  </span>
                )}
                {awaitingAssignCount > 0 && (
                  <span style={{ color: 'var(--c-text-2)' }}>
                    {' '}· {awaitingAssignCount} 份待对应（确认后自动继续识别）
                  </span>
                )}
              </>
            ) : (
              /* v2.47 起工作台不再承担上传，此分支理论上不可达（打开工作台必有批次），文案与空态对齐 */
              '暂无识别任务'
            )}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {/* 该动作的用户语义是「最小化」：只收起工作台，识别继续进行，由右下角悬浮卡接管。
              语义图标按钮的悬停说明用原生 title（不把 Tooltip 包在自定义组件外，避免 findDOMNode 警告） */}
          <Button
            icon={<DoubleRightOutlined />}
            title="最小化到右下角的识别进度卡"
            onClick={() => dispatch({ type: 'CLOSE_RECOGNITION' })}
          >
            最小化
          </Button>
          <Button
            type="primary"
            disabled={!allDone || pendingAssignCount > 0}
            onClick={() => dispatch({ type: 'CLOSE_RECOGNITION' })}
          >
            {pendingAssignCount > 0 ? `还有 ${pendingAssignCount} 份待对应` : '完成并查看结果'}
          </Button>
        </div>
      }
    >
      {hasBatch ? (
        <div className="recognition-workspace">
          <div className="recognition-workspace__top">
            {/* v2.47：原「继续追加回函文件」上传条已移除 —— 上传统一走列表页的上传弹窗 */}

            {/*
              v2.48 去重：此 Alert 原来在「全部完成」时也显示 success（「识别完成：已归档 N 封…」），
              与底栏的「识别进度 6/6 · 全部完成」说了同一件事。现在**只在仍有待对应时**显示
              warning（那是要用户行动的信号，顶部值得占一条）；全部完成态的信息只在底栏承载一次，
              去向指引（回列表核验）也随之挪到底栏。
            */}
            {allDone && pendingAssignCount > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message="识别完成，仍有回函待对应"
                description={
                  <span style={{ fontSize: 13 }}>
                    还有 <b>{pendingAssignCount}</b> 份{state.recognitionType}回函未与系统内函证对应，
                    <b>确认对应后才会写入回函管理列表并自动继续识别其余检测项</b>，请在左侧逐份处理。
                  </span>
                }
              />
            )}
          </div>

          {/* 两栏：左=识别队列，右=选中项详情 */}
          <div className="recognition-bench">
            <div className="recognition-queue">
              <div className="recognition-queue__head">
                <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                  识别队列 · {typeBatches.length} 个批次 · {totalTasks} 份回函
                </span>
              </div>

              <div className="recognition-queue__list" aria-label="识别队列">
                {typeBatches.map((b) => (
                  <Fragment key={b.id}>
                    {/*
                     * 批次组标题 —— **浅底、不带阴影**，与下方的任务卡（透明底 + 阴影、可点）
                     * 拉开层次：一眼看出「这组卡片属于这个文件」（v2.48）。
                     * 此前批次信息在头部与这里的分隔小字里各出现一次，且两层卡片长得一样，
                     * 用户无从判断谁包含谁（实测：「我没太看明白」）。
                     */}
                    <div className="recognition-queue__group">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <FilePdfOutlined style={{ color: 'var(--c-text-3)', flexShrink: 0 }} />
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                          }}
                          title={b.fileName}
                        >
                          {b.fileName}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="num" style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                          {b.fileSize}
                          {b.pageCount ? ` · ${b.pageCount} 页` : ''}
                        </span>
                        <span className="num" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-3)' }}>
                          {(() => {
                            const done = b.tasks.filter((t) => t.status === 'success').length
                            const failedCount = b.tasks.filter((t) => t.status === 'failed').length
                            return (
                              <>
                                已完成 {done + failedCount}/{b.tasks.length}
                                {failedCount > 0 && <span> · 失败 {failedCount}</span>}
                              </>
                            )
                          })()}
                        </span>
                      </div>
                    </div>
                    {b.tasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        selected={!!selectedTask && t.id === selectedTask.id}
                        record={t.recordId ? recById.get(t.recordId) : undefined}
                        onSelect={() => setSelectedId(t.id)}
                      />
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>

            <div className="recognition-detail">
              {selectedTask && (
                <div style={{ maxWidth: 1080 }}>
                  <TaskDetail
                    task={selectedTask}
                    record={selectedTask.recordId ? recById.get(selectedTask.recordId) : undefined}
                    faceSheets={selectedFaceSheets}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /*
          * 无批次 —— 工作台**不再承担上传**（v2.47）。
          *
          * 此前这里是一个整屏的拖拽上传区 + 演示数据入口，但工作台是「看进度与结果」的地方，
          * 上传属于列表页上传弹窗的职责（与往来的「文件识别录入」弹窗一致）。
          * 故空态退化为一句说明与去向，不再有拖拽区、也不再放演示数据入口
          * （后者已随上传动作移到弹窗里）。
          */
        <div className="recognition-empty">
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-2)' }}>暂无识别任务</div>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--c-text-3)' }}>
            请在回函管理列表选择「上传{state.recognitionType}回函」开始识别。
          </div>
        </div>
      )}
    </FullscreenModal>
  )
}
