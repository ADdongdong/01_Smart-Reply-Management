import { useMemo, useState } from 'react'
import { Alert, App, Button, Input, Tag, Tooltip } from 'antd'
import {
  CheckCircleFilled,
  ClearOutlined,
  CloudUploadOutlined,
  FilePdfOutlined,
  InfoCircleFilled,
  ThunderboltOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { buildPrefillFields } from '@/mock/confirmations'
import PdfPreview from '@/components/PdfPreview'
import FullscreenModal from '@/components/FullscreenModal'
import { AiChip, AiMark } from '@/components/Marks'
import type { ExpressInfo, PrefillField, ReplyRecord } from '@/types'

/**
 * 回函快递信息录入（全屏弹窗）。
 *
 * 由列表页以单一 state 驱动，切换记录时靠父组件的 `key` 重建组件，
 * 因此字段状态无需与 record 做 effect 同步。
 */
export default function ReplyDocEntryModal({
  open,
  recordId,
  onClose,
  onDone,
}: {
  open: boolean
  recordId?: string
  onClose: () => void
  /** 确认录入后衔接「回函结果填写」 */
  onDone?: (recordId: string) => void
}) {
  const { message } = App.useApp()
  const { state, dispatch } = useApp()
  const record = state.records.find((r) => r.id === recordId)

  const [fields, setFields] = useState<PrefillField[]>(() =>
    record ? (buildPrefillFields(record) as PrefillField[]) : [],
  )

  /** AI 识别字段数（含识别失败的收件人三项之外的全部 AI 字段） */
  const aiCount = useMemo(() => fields.filter((f) => f.ai).length, [fields])
  /** 已采纳 / 待人工确认 —— 默认采纳规则下，待确认的只剩低置信度与未识别项 */
  const adoptedCount = useMemo(() => fields.filter((f) => f.adopted).length, [fields])
  const pendingCount = fields.length - adoptedCount
  const lowConfidence = useMemo(
    () => fields.filter((f) => f.ai && f.confidence > 0 && f.confidence < 0.9),
    [fields],
  )
  /**
   * 仍需人工处理的必填项 —— 只提示、不阻断（原型里不把流程堵死）：
   * · AI 已识别但置信度不足的，需点一下「采纳」
   * · AI 识别不了的（收件人三项），需手工填写
   */
  const requiredPending = useMemo(
    () => fields.filter((f) => f.required && (f.ai ? !f.adopted : ['—', ''].includes(f.value))),
    [fields],
  )

  if (!open || !record) return null

  /**
   * 编辑态 —— 该函证的核验留痕已经打过（已完成人工核验）。
   * 此时弹窗不再是「首次确认」而是「修改」：只写回内容，不改回函进度、不重打核验留痕
   * （同一件事不设两处签字，见需求文档 5.4）。
   */
  const isEdit = record.verifyStatus === 'verified'

  const setField = (key: string, patch: Partial<PrefillField>) =>
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  /**
   * 把表单值收成写回记录用的 patch。
   * 未识别 / 未填写的项**直接省略** —— 否则「—」会被当成一个有效的人工确认值存下去，
   * 重开弹窗时又会把它标成「人工确认值」，把没收到的信息显示成已确认。
   */
  const buildPatch = (): Partial<ReplyRecord> => {
    const expressInfo: ExpressInfo = {}
    const KEYS: (keyof ExpressInfo)[] = [
      'replyFile',
      'faceSheet',
      'expressCompany',
      'expressNo',
      'senderName',
      'senderPhone',
      'senderAddress',
      'receiverName',
      'receiverPhone',
      'receiverAddress',
      'sendTime',
      'signTime',
    ]
    KEYS.forEach((k) => {
      const val = fields.find((f) => f.key === k)?.value ?? ''
      if (val && val !== '—') expressInfo[k] = val
    })
    /* 顶层字段同步一份：列表与展开行读的是顶层，两处不能打架 */
    return {
      expressInfo,
      replyFile: expressInfo.replyFile,
      faceSheet: expressInfo.faceSheet,
      expressCompany: expressInfo.expressCompany,
      expressNo: expressInfo.expressNo,
    }
  }

  return (
    <FullscreenModal
      open={open}
      title="回函快递信息"
      subtitle={`${record.confirmationNo} · ${record.type} · ${record.entity}`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {isEdit ? (
              <>
                <InfoCircleFilled style={{ color: 'var(--c-primary)' }} /> 本次修改只更新回函快递信息 ——
                不改变回函进度、不重复产生核验留痕；系统会记录修改人与修改时间
              </>
            ) : (
              <>
                <CheckCircleFilled style={{ color: 'var(--c-primary)' }} /> 确认后记录核验人「张审计」与核验时间（核验留痕的唯一入口），
                并把 AI 核验结论带入「填写回函结果」由你采纳或修改
              </>
            )}
          </span>
          {requiredPending.length > 0 && (
            <span style={{ color: 'var(--c-risk-high-text)', fontSize: 13 }}>
              还有 {requiredPending.length} 项必填待处理：{requiredPending.map((f) => f.label).join('、')}
            </span>
          )}
          <span style={{ marginLeft: 'auto' }} />
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={() => {
              const patch = buildPatch()
              if (isEdit) {
                dispatch({ type: 'UPDATE_DOC', recordId: record.id, patch })
                message.success('回函快递信息已更新，回函进度与核验留痕保持不变')
                onClose()
                return
              }
              dispatch({ type: 'CONFIRM_DOC', recordId: record.id, patch })
              message.success('回函快递信息已确认，并标记为「已人工核验」')
              if (onDone) onDone(record.id)
              else onClose()
            }}
          >
            {isEdit ? '保存修改' : '确认并进入结果填写'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：PDF 预览 */}
        <div style={{ width: 460, flexShrink: 0 }}>
          <div className="panel" style={{ padding: 10 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              回函函证
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                来自识别切分结果
              </span>
            </div>
            <PdfPreview
              confirmationNo={record.confirmationNo}
              entity={record.entity}
              showRegions
              activeRegion={record.verification?.seal.region}
              sealBoxes={record.verification?.seal.boxes}
              height={520}
            />
          </div>
        </div>

        {/* 右：AI 预填表单 */}
        <div className="panel" style={{ flex: 1, minWidth: 0, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="section-title">
              <ThunderboltOutlined style={{ color: 'var(--c-primary)' }} />
              {isEdit ? `已回显 ${adoptedCount} 项上次确认值` : `已自动采纳 ${adoptedCount} 项`}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {pendingCount > 0
                ? `${pendingCount} 项待你确认（共 ${fields.length} 项，其中 AI 识别 ${aiCount} 项）`
                : '全部已确认'}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Button
                size="small"
                icon={<CheckCircleFilled />}
                onClick={() => {
                  setFields((prev) => prev.map((f) => (f.ai ? { ...f, adopted: true } : f)))
                  message.success('已采纳全部 AI 识别结果')
                }}
              >
                全部采纳
              </Button>
              <Button
                size="small"
                icon={<ClearOutlined />}
                onClick={() => setFields((prev) => prev.map((f) => ({ ...f, adopted: false })))}
              >
                全部清除
              </Button>
            </span>
          </div>

          {lowConfidence.length > 0 && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningFilled />}
              style={{ marginBottom: 12 }}
              message={
                <span style={{ fontSize: 13 }}>
                  有 {lowConfidence.length} 项 AI 识别置信度低于 90%，已留待人工确认并高亮：
                  {lowConfidence.map((f) => f.label).join('、')}
                </span>
              }
            />
          )}

          {/* 附件区 */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {[
              { label: '回函文件', value: record.replyFile, conf: 0.98 },
              { label: '快递面单', value: record.faceSheet, conf: 0.95 },
            ].map((f) => (
              <div
                key={f.label}
                style={{
                  flex: 1,
                  borderRadius: 8,
                  padding: 12,
                  background: 'var(--c-neutral-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <FilePdfOutlined style={{ color: 'var(--c-risk-high)', fontSize: 18 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
                    {f.label}
                    <AiMark source="识别切分结果" confidence={f.conf} />
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {f.value ?? '未识别'}
                  </div>
                </div>
                <span style={{ marginLeft: 'auto' }}>
                  <Button size="small" icon={<CloudUploadOutlined />}>
                    替换
                  </Button>
                </span>
              </div>
            ))}
          </div>

          {/* 字段列表 —— 低置信度字段用红档浅底标注（原来是描边框，去线后改用底色） */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '4px 16px',
            }}
          >
            {fields.map((f) => {
              const low = f.ai && f.confidence > 0 && f.confidence < 0.9
              /**
               * 底色只标「需要你处理」的项：
               * 已采纳是默认常态，不再上色（避免整片浅底破坏单一色系）；低置信度走红档、
               * 未识别的待填写项走中性底。
               */
              const tone = f.adopted
                ? undefined
                : low
                  ? 'var(--c-risk-high-bg)'
                  : 'var(--c-neutral-bg)'
              return (
                <div
                  key={f.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 6px',
                    borderRadius: 4,
                    background: tone,
                  }}
                >
                  <span
                    style={{
                      width: 112,
                      flexShrink: 0,
                      fontSize: 13,
                      color: 'var(--c-text-2)',
                      textAlign: 'right',
                    }}
                  >
                    {f.required && <span style={{ color: 'var(--c-risk-high)' }}>* </span>}
                    {f.label}
                  </span>
                  <Input
                    size="small"
                    value={f.value}
                    onChange={(e) => setField(f.key, { value: e.target.value })}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  {f.confirmed ? (
                    <Tooltip title="你上次确认 / 修改后保存的值，可直接改后再次保存">
                      <span style={{ flexShrink: 0 }}>
                        <Tag
                          style={{
                            marginInlineEnd: 0,
                            flexShrink: 0,
                            fontSize: 11,
                            lineHeight: '16px',
                            padding: '0 4px',
                            border: 'none',
                            color: 'var(--c-primary)',
                            background: 'var(--c-primary-bg)',
                          }}
                        >
                          人工确认
                        </Tag>
                      </span>
                    </Tooltip>
                  ) : f.ai ? (
                    <>
                      <Tooltip title={`识别来源：${f.source}`}>
                        <span style={{ flexShrink: 0 }}>
                          <AiChip confidence={f.confidence} />
                        </span>
                      </Tooltip>
                      {f.adopted ? (
                        <Tag
                          style={{
                            marginInlineEnd: 0,
                            flexShrink: 0,
                            fontSize: 11,
                            lineHeight: '16px',
                            padding: '0 4px',
                            border: 'none',
                            color: 'var(--c-primary)',
                            background: 'var(--c-primary-bg)',
                          }}
                        >
                          ✓ 已确认
                        </Tag>
                      ) : (
                        <Button
                          size="small"
                          type="link"
                          style={{ padding: 0, flexShrink: 0, fontSize: 13 }}
                          onClick={() => setField(f.key, { adopted: true })}
                        >
                          采纳
                        </Button>
                      )}
                    </>
                  ) : (
                    <span style={{ flexShrink: 0, width: 74, fontSize: 12, color: 'var(--c-text-3)' }}>
                      需人工填写
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </FullscreenModal>
  )
}
