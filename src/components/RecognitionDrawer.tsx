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
import { PRESET_BATCHES } from '@/mock/recognition'
import { EXPRESS_IMPORT_RESULT } from '@/mock/expressImport'
import { RECOVERY_ACTIONS, UPLOAD_TIPS, taskPercent } from '@/services/mockRecognition'
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
 *   ② AI 智能核验 —— 每个检测点独立进度条 + 结论
 */
function StagePipeline({ stages }: { stages: RecognitionStage[] }) {
  const matchStage = stages.find((s) => s.key === 'match')
  const verifyStages = stages.filter((s) => s.key !== 'match')
  const verifyDone = verifyStages.filter((s) => s.status === 'done').length

  return (
    <div style={{ marginTop: 8 }}>
      {/* ① 归属匹配 —— 只给结果，不加进度条 */}
      {matchStage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ flexShrink: 0 }}>
            <StageIcon status={matchStage.status} />
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
              AI 智能核验
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

  /** 银行函证的归属匹配看板 —— 归属匹配阶段出结果后展示 */
  const showMatchBoard = task.type === '银行函证' && !!task.bankMatch && matchStage?.status === 'done'
  /** 识别已完成，但归属尚未确定 —— 此时不会写入回函列表 */
  const awaitingAssign = task.status === 'success' && !task.assignSource

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
          {task.confirmationNo === '待指定' ? '待指定归属' : task.confirmationNo}
        </span>
        {awaitingAssign && (
          <Tag
            style={{
              marginInlineEnd: 0,
              fontSize: 12,
              lineHeight: '16px',
              padding: '0 4px',
              border: 'none',
              color: 'var(--c-primary)',
              background: 'var(--c-primary-bg)',
            }}
          >
            未写入列表
          </Tag>
        )}
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
        {task.matchedEntity && task.matchedEntity !== '—' && (
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

      <StagePipeline stages={task.stages} />

      {showMatchBoard && (
        <div style={{ marginTop: 10 }}>
          <BankTextRecognition
            result={task.bankMatch!}
            /* 识别进行中先只读预览归属结论；等整体核验跑完再开放确认 / 指定，避免核验结果未齐就落库 */
            mode={task.status === 'success' ? 'assign' : 'verify'}
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

function resolveBatch(fileName: string) {
  if (/银行|齐商|工商|建设|农业|中国银行/i.test(fileName)) return PRESET_BATCHES.B()
  return PRESET_BATCHES.A()
}

export default function RecognitionDrawer() {
  const { state, dispatch, pendingAssignCount } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

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
    const batch = resolveBatch(file.name)
    dispatch({
      type: 'START_BATCH',
      batch: { ...batch, fileName: file.name, fileSize: `${(file.size / 1024).toFixed(0)} KB` },
    })
  }

  const pending = state.batches.some((b) => b.status !== 'done')
  const currentTask = state.batches
    .flatMap((b) => b.tasks)
    .find((t) => t.status === 'pending' && t.stages.some((s) => s.status === 'running' || s.status === 'waiting'))

  return (
    <Drawer
      title="智能识别工作台"
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
                {pending && (
                  <>
                    {' '}· 正在处理：
                    <b style={{ color: 'var(--c-primary)', fontWeight: 600 }}>
                      {currentTask?.confirmationNo ?? '—'}
                    </b>
                  </>
                )}
                {allDone && pendingAssignCount === 0 && (
                  <span style={{ color: 'var(--c-risk-low)' }}> · 全部完成</span>
                )}
                {pendingAssignCount > 0 && (
                  <span style={{ color: 'var(--c-text-2)' }}> · 待确定归属 {pendingAssignCount}</span>
                )}
              </>
            ) : (
              '等待上传回函文件'
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
            {pendingAssignCount > 0 ? `还有 ${pendingAssignCount} 份待确定归属` : '完成并查看结果'}
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
        aria-label="上传回函文件：点击选择文件，或将文件拖到此处"
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
          将回函文件拖到此处，或点击上传
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.9 }}>
          {UPLOAD_TIPS.map((t) => (
            <div key={t}>· {t}</div>
          ))}
        </div>
      </div>

      <Space size={8} style={{ marginTop: 10 }} wrap>
        <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>没有文件？用演示数据体验：</span>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => dispatch({ type: 'START_BATCH', batch: PRESET_BATCHES.A() })}
        >
          往来函证拼接回函（9 页 / 5 封）
        </Button>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => dispatch({ type: 'START_BATCH', batch: PRESET_BATCHES.B() })}
        >
          银行函证回函（11 页 / 3 封 · 三档归属）
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
          message={pendingAssignCount > 0 ? '识别完成，仍有回函待确定归属' : '识别完成'}
          description={
            <span style={{ fontSize: 13 }}>
              {pendingAssignCount > 0 ? (
                <>
                  还有 <b>{pendingAssignCount}</b> 份银行函证回函未确定归属，
                  <b>确认归属后才会写入回函管理列表</b>，请在上方逐份处理。
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
