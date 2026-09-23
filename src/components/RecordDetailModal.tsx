import { Button, Descriptions, Tabs } from 'antd'
import type { ReactNode } from 'react'
import type { ReplyRecord } from '@/types'
import { TYPE_RULE } from '@/services/replyRule'
import PdfPreview from '@/components/PdfPreview'
import FullscreenModal from '@/components/FullscreenModal'
import { AiMark } from '@/components/Marks'

/** 页面缩略图（纯展示，当前原型不支持翻页，因此不给出可点击的视觉暗示） */
function PageThumbs({ active, page }: { active?: boolean; page: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: 54,
        height: 74,
        border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-border)'}`,
        borderRadius: 3,
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color: 'var(--c-text-3)',
      }}
    >
      {page} / 2
    </div>
  )
}

export default function RecordDetailModal({
  open,
  record,
  onClose,
  note,
}: {
  open: boolean
  record?: ReplyRecord
  onClose: () => void
  /**
   * 语境提示（可选）—— 从展开行的历次回函进来时，用来说明「这是第几次、是否已被覆盖」。
   * 不传时本页行为与之前完全一致（纯增量、向后兼容）。
   */
  note?: ReactNode
}) {
  if (!record) return null

  const infoTab = (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, maxWidth: 560 }}>
        <PdfPreview
          confirmationNo={record.confirmationNo}
          entity={record.entity}
          showRegions
          activeRegion={record.verification?.seal.region}
          sealBoxes={record.verification?.seal.boxes ?? []}
          /* 银行函证不检测手写体 —— 按类型查表关闭，即使存在残留数据也不绘制标注 */
          handwriting={
            TYPE_RULE[record.type].detectHandwriting
              ? record.verification?.handwriting?.text
              : undefined
          }
          height={600}
        />
      </div>
      <div style={{ width: 70, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PageThumbs active page={1} />
        <PageThumbs page={2} />
      </div>
    </div>
  )

  return (
    <FullscreenModal
      open={open}
      title="查看函证"
      subtitle={`${record.confirmationNo} · ${record.entity}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {note && (
        <div className="tone-block tone-neutral" style={{ marginBottom: 12 }}>
          {note}
        </div>
      )}
      <Descriptions
        size="small"
        column={4}
        style={{ marginBottom: 12 }}
        items={[
          { key: 'a', label: '函证编号', children: record.confirmationNo },
          { key: 'b', label: '函证类型', children: record.type },
          { key: 'c', label: '被询证单位', children: record.entity },
          /* 「发函方式」与「快递公司」于 v2.38 从列表展开行并入本页 —— 列表侧不再出现这两项 */
          { key: 'g', label: '发函方式', children: record.sendMethod },
          { key: 'd', label: '发函登记日期', children: record.sendDate },
          { key: 'e', label: '回函登记日期', children: record.replyDate ?? '—' },
          { key: 'h', label: '快递公司', children: record.expressCompany ?? '—' },
          {
            key: 'f',
            label: '回函快递单号',
            children: (
              <span>
                {record.expressNo ?? '—'}
                {record.expressNo && <AiMark source="快递面单条码识别" confidence={0.99} />}
              </span>
            ),
          },
        ]}
      />
      <Tabs
        items={[
          { key: 'send', label: '发函函证', children: infoTab },
          { key: 'sendInfo', label: '发函信息', children: infoTab },
          { key: 'reply', label: '回函函证', children: infoTab },
          { key: 'replyInfo', label: '回函信息', children: infoTab },
          { key: 'files', label: '函证过程文件', children: infoTab },
        ]}
      />
    </FullscreenModal>
  )
}
