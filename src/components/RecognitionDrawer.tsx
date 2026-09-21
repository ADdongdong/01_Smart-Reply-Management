import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Drawer, Select, Space, Tag, Tooltip } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloudUploadOutlined,
  DoubleRightOutlined,
  FilePdfOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { PRESET_BATCHES, stagesOf } from '@/mock/recognition'
import { EXPRESS_IMPORT_RESULT } from '@/mock/expressImport'
import { RECOVERY_ACTIONS, taskPercent } from '@/services/mockRecognition'
import { TYPE_RULE } from '@/services/replyRule'
import { MATCH_LEVEL_LABEL } from '@/components/BankTextRecognition'
import { CANDIDATE_RECORDS } from '@/mock/confirmations'
import BankTextRecognition from '@/components/BankTextRecognition'
import type { RecognitionStage, RecognitionTask } from '@/types'

/* ------------------------- 阶段流水线 ------------------------- */

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
 * 识别进度：
 *   ① 归属匹配 —— 只展示结果（归到哪封函证），不加进度条
 *   ② 检测点逐项进度 —— 标题按阶段取：银行阶段一为「识别四要素」，其余为「AI 智能核验」
 */
function StagePipeline({
  stages,
  /** 阶段标题（缺省「AI 智能核验」；银行函证阶段一传「识别四要素」） */
  verifyTitle,
  /** 归属已跑出结论但**尚未确认**（建议归属 / 待指定）—— 归属行改用主色圆点，提示「待你处理」 */
  matchNeedsAction,
}: {
  stages: RecognitionStage[]
  verifyTitle?: string
  matchNeedsAction?: boolean
}) {
  const matchStage = stages.find((s) => s.key === 'match')
  const verifyStages = stages.filter((s) => s.key !== 'match')
  const verifyDone = verifyStages.filter((s) => s.status === 'done').length

  return (
    <div style={{ marginTop: 8 }}>
      {/* ① 归属匹配 —— 只给结果，不加进度条 */}
      {matchStage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ flexShrink: 0 }}>
            {matchNeedsAction ? (
              /* 待人工确认归属 —— 主色实心圆点（区别于「已完成」的绿勾，提示这里需要动作） */
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'var(--c-primary)',
                }}
              />
            ) : (
              <StageIcon status={matchStage.status} />
            )}
          </span>
          <span
            style={{
              fontSize: 13,
              flexShrink: 0,
              color: matchStage.status === 'waiting' ? 'var(--c-text-3)' : 'var(--c-text-2)',
            }}
          >
            {matchStage.label}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--c-text-3)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={matchStage.detail}
          >
            {matchStage.detail ?? (matchStage.status === 'running' ? '匹配中…' : '待匹配')}
          </span>
        </div>
      )}

      {/* ② AI 智能核验 —— 每个检测点独立进度 */}
      {verifyStages.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)' }}>
              {verifyTitle ?? 'AI 智能核验'}
            </span>
            <span
              className="num"
              style={{
                fontSize: 12,
                color: verifyDone === verifyStages.length ? 'var(--c-risk-low)' : 'var(--c-text-3)',
              }}
            >
              {verifyDone}/{verifyStages.length}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {verifyStages.map((s) => (
              <div
                key={s.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '14px 178px minmax(0, 1fr)',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <StageIcon status={s.status} />
                <span
                  style={{
                    fontSize: 13,
                    color:
                      s.status === 'waiting'
                        ? 'var(--c-text-3)'
                        : s.status === 'running'
                          ? 'var(--c-primary)'
                          : 'var(--c-text-2)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={s.label}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--c-text-3)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={s.detail}
                >
                  {s.detail ?? (s.status === 'running' ? '检测中…' : '待检测')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------- 任务卡片 ------------------------- */

function TaskCard({ task }: { task: RecognitionTask }) {
  const { dispatch } = useApp()
  const failedStage = task.stages.find((s) => s.status === 'failed')
  const matchStage = task.stages.find((s) => s.key === 'match')
  const percent = taskPercent(task)

  /** 本类型的业务规则（两阶段与否 / 检测项）—— 一律查表 */
  const rule = TYPE_RULE[task.type]
  /** 阶段一是否已完成（阶段一的全部检测点都 done）——银行函证 = 四要素识别完成，可开始「对应」 */
  const phase1Done = stagesOf(task.type, 1).every((k) => task.stages.find((s) => s.key === k)?.status === 'done')

  /** 银行函证的归属匹配看板 —— 归属匹配阶段出结果后展示 */
  const showMatchBoard = task.type === '银行函证' && !!task.bankMatch && matchStage?.status === 'done'
  /**
   * 归属看板是否**可操作**（v2.28 两阶段）：阶段一（四要素）完成即可确认 / 改派，
   * **不再等其余检测项跑完** —— 先把回函与系统函证对应起来，再细查。
   * 四要素识别进行中仍保持只读预览（避免四要素还没识别完就能确认）。
   */
  const canAssign = showMatchBoard && phase1Done && !task.assignSource
  /** 归属是否已确定（auto 自动归属 / 人工确认 / 人工指定） */
  const assigned = !!task.assignSource
  /**
   * 未确定归属时的标题词（v2.29 精简）：按档位区分「建议归属 / 待指定归属」，
   * **不再把回函落款单位名显示出来** —— 否则未确认归属就出现单位名，看着像"已经归好了"。
   */
  const unassignedTitle =
    task.type === '银行函证'
      ? MATCH_LEVEL_LABEL[task.bankMatch?.level ?? 'manual']
      : '待指定归属'

  return (
    <div
      style={{
        borderRadius: 8,
        padding: '9px 11px',
        background: failedStage ? 'var(--c-risk-high-bg)' : '#fff',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {assigned ? task.confirmationNo : unassignedTitle}
        </span>
        {/* 「未写入列表」标签已去掉（v2.29）—— 该信息由底栏「N 份待对应（确认后自动继续识别）」
            与完成提示各表达一次，卡片上再挂一次属重复（用户要求减少提醒） */}
        {/* 函证类型属于分类信息而非状态 —— 用中性标签，两类型靠文字区分 */}
        <Tag
          style={{
            marginInlineEnd: 0,
            fontSize: 12,
            lineHeight: '16px',
            padding: '0 4px',
            border: 'none',
            color: 'var(--c-text-2)',
            background: 'var(--c-tag-bg)',
          }}
        >
          {task.type}
        </Tag>
        {/* 被询证单位只在归属确定后显示 —— 未确认前它是回函落款识别值，提前显示会造成「已归属」的错觉 */}
        {assigned && task.matchedEntity && task.matchedEntity !== '—' && (
          <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>{task.matchedEntity}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{task.pageRange}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-3)' }} className="num">
          {percent}%
        </span>
        {failedStage && (
          <Button
            type="link"
            size="small"
            danger
            style={{ padding: 0, height: 'auto', fontSize: 12 }}
            onClick={() => dispatch({ type: 'RETRY_TASK', taskId: task.id })}
          >
            重试
          </Button>
        )}
      </div>

      {/* 阶段一（银行=四要素与归属；往来=全部检测项）—— 阶段二在归属确认后才追加进来 */}
      <StagePipeline
        stages={task.stages}
        verifyTitle={rule.twoPhase && task.phase === 1 ? '识别四要素' : undefined}
        matchNeedsAction={canAssign}
      />

      {showMatchBoard && (
        <div style={{ marginTop: 10 }}>
          <BankTextRecognition
            result={task.bankMatch!}
            /*
             * v2.28 两阶段：阶段一（四要素）完成即可确认 / 指定 —— **不再等其余检测项跑完**；
             * 四要素识别进行中保持只读预览（避免四要素还没识别完就能确认）。
             */
            mode={canAssign ? 'assign' : 'verify'}
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
          {/* 「确认对应后自动继续识别」的说明不再逐卡重复（用户反馈 v2.28）——
              底栏「N 份待对应（确认后自动继续识别）」与完成 Alert 已全局表达一次 */}
        </div>
      )}

      {failedStage && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message={<span style={{ fontSize: 13 }}>{task.failReason}</span>}
          description={
            <Space size={8} wrap style={{ marginTop: 4 }}>
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
              <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                可选动作：{(RECOVERY_ACTIONS[failedStage.key] ?? []).join(' / ')}
              </span>
            </Space>
          }
        />
      )}
    </div>
  )
}

/* ------------------------- 主抽屉 ------------------------- */

export default function RecognitionDrawer() {
  const { state, dispatch, pendingAssignCount } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  /**
   * 入口类型由打开工作台的上传入口指定（AppStore.recognitionType）——
   * 上传时类型即已确定，演示批次也只给本类型那一批，不再按文件名猜测类型。
   */
  const rule = TYPE_RULE[state.recognitionType]

  const hasBatch = state.batches.length > 0
  const allDone = hasBatch && state.batches.every((b) => b.status === 'done')
  const totalTasks = state.batches.reduce((a, b) => a + b.tasks.length, 0)
  const doneTasks = state.batches.reduce(
    (a, b) => a + b.tasks.filter((t) => t.status === 'success' || t.status === 'failed').length,
    0,
  )
  /** 已实际写入回函管理列表的任务数（归属未确定的不会落库） */
  const appliedCount = state.batches.flatMap((b) => b.tasks).filter((t) => t.applied).length

  function handleFiles(files: FileList | null) {
    if (!files || !files.length) return
    const file = files[0]
    // 快递数据 Excel 不涉及切分与识别，直接给出匹配代入结果
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      dispatch({
        type: 'IMPORT_EXPRESS',
        result: { ...EXPRESS_IMPORT_RESULT, fileName: file.name },
      })
      dispatch({ type: 'CLOSE_RECOGNITION' })
      return
    }
    /* 类型由入口决定 —— 不再按文件名猜测 */
    const batch = PRESET_BATCHES[rule.presetBatchId]()
    dispatch({
      type: 'START_BATCH',
      batch: { ...batch, fileName: file.name, fileSize: `${(file.size / 1024).toFixed(0)} KB` },
    })
  }

  const pending = state.batches.some((b) => b.status !== 'done')
  /** 对应通道：正在识别四要素与归属的份 */
  const currentTask = state.batches
    .flatMap((b) => b.tasks)
    .find(
      (t) => t.phase === 1 && t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
    )
  /** 细查通道：归属已确认、正在跑其余检测项的份（v2.28 两阶段） */
  const detailTask = state.batches
    .flatMap((b) => b.tasks)
    .find(
      (t) => t.phase === 2 && t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'),
    )
  /** 待人工对应的份数（含建议归属与待指定） */
  const awaitingAssignCount = state.batches
    .flatMap((b) => b.tasks)
    .filter((t) => t.phase === 1 && t.status === 'success' && !t.assignSource).length

  return (
    <Drawer
      title={`智能识别工作台 · ${state.recognitionType}`}
      width={920}
      open={state.recognitionOpen}
      onClose={() => dispatch({ type: 'CLOSE_RECOGNITION' })}
      /*
       * 遮罩「存在但完全不可见」—— 刻意不用 mask={false}：
       * 不渲染遮罩层时 antd 也不会绑定「点击外部 → onClose」，
       * 于是左侧列表点上去毫无反应。保留遮罩层、只把背景设为透明，
       * 左侧列表的视觉逐位不变，但点一下就能最小化工作台。
       */
      styles={{
        mask: { background: 'transparent' },
        body: { paddingTop: 12 },
      }}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
            {hasBatch ? (
              <>
                识别进度 <b className="num">{doneTasks}/{totalTasks}</b>
                {currentTask && (
                  <>
                    {' '}· 正在对应：
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
                  <span style={{ color: 'var(--c-risk-low)' }}> · 全部完成</span>
                )}
                {awaitingAssignCount > 0 && (
                  <span style={{ color: 'var(--c-text-2)' }}>
                    {' '}· {awaitingAssignCount} 份待对应（确认后自动继续识别）
                  </span>
                )}
              </>
            ) : (
              `等待上传${state.recognitionType}回函文件`
            )}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {/* 该动作的用户语义是「最小化」：只收起抽屉，识别继续进行，由右下角悬浮卡接管 */}
          <Tooltip title="最小化到右下角的识别进度卡 —— 识别继续进行，可随时展开">
            <Button
              icon={<DoubleRightOutlined />}
              onClick={() => dispatch({ type: 'CLOSE_RECOGNITION' })}
            >
              最小化
            </Button>
          </Tooltip>
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
      {/* 上传区 —— 常驻，可继续追加文件 */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`上传${state.recognitionType}回函文件：点击选择文件，或将文件拖到此处`}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        <CloudUploadOutlined style={{ fontSize: 26, color: 'var(--c-primary)' }} />
        <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600 }}>
          将{state.recognitionType}回函文件拖到此处，或点击上传
        </div>
        {/*
         * 上传提示整块已删除（v2.30，用户：「不需要这一堆内容」）——
         * 文件形态（银行只需回函件）、归属方式（四要素）、检测项，已在列表页两个上传入口的
         * 悬停说明里各讲过一次，工作台内再铺三行属重复且分散注意力。
         */}
      </div>

      <Space size={8} style={{ marginTop: 10 }} wrap>
        <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>没有文件？用演示数据体验：</span>
        {/* 演示批次按入口类型只给本类型那一批 —— 与「上传时类型已确定」的口径一致 */}
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() =>
            dispatch({ type: 'START_BATCH', batch: PRESET_BATCHES[rule.presetBatchId]() })
          }
        >
          {rule.presetBatchId === 'A' ? '往来函证拼接回函（9 页 / 5 封）' : '银行函证回函（11 页 / 3 封 · 三档归属）'}
        </Button>
      </Space>

      {/* 识别队列 */}
      {hasBatch && (
        <div style={{ marginTop: 18 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            识别队列
          </div>
          {state.batches.map((b) => {
            const done = b.tasks.filter((t) => t.status === 'success').length
            const failed = b.tasks.filter((t) => t.status === 'failed').length
            return (
              <div
                key={b.id}
                style={{
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                  background: 'var(--c-fill-light)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FilePdfOutlined style={{ color: 'var(--c-risk-high)' }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{b.fileName}</span>
                  <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                    {b.fileSize}
                    {b.pageCount ? ` · ${b.pageCount} 页` : ''}
                  </span>
                  <Tag style={{ marginInlineEnd: 0, fontSize: 12 }}>{b.type}</Tag>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-3)' }} className="num">
                    已完成 {done + failed}/{b.tasks.length}
                    {failed > 0 && <span style={{ color: 'var(--c-risk-high)' }}> · 失败 {failed}</span>}
                  </span>
                </div>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {b.tasks.map((t) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!hasBatch && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 14 }}
          message="上传后系统会先做「往来 / 银行」类型判定，再异步执行切分与识别，无需人工区分入口"
        />
      )}

      {allDone && (
        <Alert
          type={pendingAssignCount > 0 ? 'warning' : 'success'}
          showIcon
          style={{ marginTop: 14 }}
          message={pendingAssignCount > 0 ? '四要素识别完成，仍有回函待对应' : '识别完成'}
          description={
            <span style={{ fontSize: 13 }}>
              {pendingAssignCount > 0 ? (
                <>
                  还有 <b>{pendingAssignCount}</b> 份银行函证回函未与系统内函证对应，
                  <b>确认对应后才会写入回函管理列表并自动继续识别其余检测项</b>，请在上方逐份处理。
                </>
              ) : (
                <>
                  已归档 <b>{appliedCount}</b> 封函证。其中存在风险的函证已在列表中标记，
                  请前往「AI 智能核验」列查看详情并完成人工核验。
                </>
              )}
            </span>
          }
        />
      )}
    </Drawer>
  )
}
