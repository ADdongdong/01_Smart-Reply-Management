import { useMemo, useState } from 'react'
import { App, Button, Input, Tag, Tooltip } from 'antd'
import {
  CheckCircleFilled,
  CloudUploadOutlined,
  FilePdfOutlined,
  InboxOutlined,
  InfoCircleFilled,
} from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { buildPrefillFields } from '@/mock/confirmations'
import { faceSheetUrlOf } from '@/config/preview'
import PdfPreview from '@/components/PdfPreview'
import FullscreenModal from '@/components/FullscreenModal'
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

  /** 上次人工确认过、本次回显的项数（编辑态提示用，与 AI 无关） */
  const confirmedCount = useMemo(() => fields.filter((f) => f.confirmed).length, [fields])

  /**
   * 仍需人工处理的必填项 —— 只提示、不阻断（原型里不把流程堵死）。
   *
   * **v2.36：本弹窗不再承载 AI 识别结果的采纳**（置信度胶囊、「采纳 / 已确认」与顶部
   * 批量采纳全部移除），因此判据只剩一条 —— 必填项是否为空（识别不到时留下的「—」也算空）。
   */
  const requiredPending = useMemo(
    () => fields.filter((f) => f.required && ['—', ''].includes(f.value)),
    [fields],
  )

  if (!open || !record) return null

  /**
   * 面单样例地址 —— 快递面单**不是单独上传的文件**，而是回函文件里的一页
   * （单号与所属函证都由识别阶段读出）。本弹窗只看面单，因此左侧直接渲染**一份独立的
   * 单页面单扫描件**并**只渲染这一页**，不把整份回函附件铺出来（看函证正文从列表「查看」进）。
   * 取不到（该回函确实没有面单，如银行函证）时给**空态**，不退回展示函证正文。
   */
  const faceSheetUrl = faceSheetUrlOf(record.confirmationNo)

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
                <CheckCircleFilled style={{ color: 'var(--c-primary)' }} /> 确认后记录核验人与核验时间，
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
              message.success('回函快递信息已确认，已记录核验人与时间')
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
        {/*
         * 左：**回函快递面单**预览（v2.31）
         * 本弹窗承载的是「回函快递信息」，左侧就该只给面单 —— 面单是回函文件里的一页，
         * 这里直接渲染**面单本身的单页文件**（`fileUrl` + `singlePage`），
         * 因此滚不出其它页、也看不到函证正文（要看正文从列表的「查看」入口进）。
         * 面单上没有印章 / 落章区域 / 手写区，故不传 `showRegions` / `sealBoxes`，并隐藏「AI 批注」切换。
         */}
        <div style={{ width: 460, flexShrink: 0 }}>
          <div className="panel" style={{ padding: 10 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              回函快递面单
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                {faceSheetUrl ? '仅展示面单页' : '未识别到面单'}
              </span>
            </div>
            {faceSheetUrl ? (
              <PdfPreview
                confirmationNo={record.confirmationNo}
                fileUrl={faceSheetUrl}
                singlePage
                hideViewToggle
                height={520}
              />
            ) : (
              /* 该回函确实没有面单（如银行函证）—— 只说明事实，不退回展示函证正文 */
              <div
                style={{
                  height: 520,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'var(--c-neutral-bg)',
                  borderRadius: 8,
                  padding: 24,
                  textAlign: 'center',
                }}
              >
                <InboxOutlined style={{ fontSize: 26, color: 'var(--c-text-3)' }} />
                <div style={{ fontSize: 13, color: 'var(--c-text-2)' }}>未识别到快递面单</div>
                <div style={{ fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.9 }}>
                  面单随回函一并寄回、由识别阶段读出
                  {record.type === '银行函证' && '；银行函证回函由银行自行出具，通常不含快递面单'}
                  <br />
                  可对照右侧「快递面单」字段核对单号；查看函证正文请回列表点「查看」
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右：快递信息表单 */}
        <div className="panel" style={{ flex: 1, minWidth: 0, padding: 16 }}>
          {/*
           * v2.36：本弹窗**不再承载 AI 识别结果的采纳** —— 原「已自动采纳 N 项 + 全部采纳 /
           * 全部清除」与低置信度提醒一并移除。字段值仍由识别阶段预填、直接可改，
           * 需要人处理的只剩「必填项是否为空」这一件事（底栏提示 + 缺项红档浅底）。
           */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="section-title">回函快递信息</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {isEdit
                ? `已回显 ${confirmedCount} 项上次确认值，可直接修改后保存`
                : '请核对下方信息；识别不到的项需手工填写'}
            </span>
          </div>

          {/* 附件区 */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {[
              { label: '回函文件', value: record.replyFile },
              { label: '快递面单', value: record.faceSheet },
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
                  <div style={{ fontSize: 13, color: 'var(--c-text-2)' }}>{f.label}</div>
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
              /**
               * 底色只标「需要你处理」的项 —— v2.36 起判据只有一条：
               * 必填项是否为空（识别不到时留下的「—」也算空）。其余一律不上色。
               */
              const needFill = f.required && ['—', ''].includes(f.value)
              return (
                <div
                  key={f.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 6px',
                    borderRadius: 4,
                    background: needFill ? 'var(--c-risk-high-bg)' : undefined,
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
                  {f.confirmed && (
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
                  )}
                  {!f.confirmed && needFill && (
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
