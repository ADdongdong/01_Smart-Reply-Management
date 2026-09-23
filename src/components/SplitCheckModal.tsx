import { useEffect, useMemo, useState } from 'react'
import { Button, Modal, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import PdfPreview from '@/components/PdfPreview'
import { browserSampleUrlOf } from '@/config/preview'
import type { SplitFileInfo } from '@/components/SplitEntryModal'

/**
 * 「切分」界面 · ② 数据核对（往来函证专属，v2.35）。
 *
 * 承接 ①「文件识别录入」：把拼接件按右上角二维码切分成若干段，逐段给出
 * 「切分页数 / 函证编号 / 关联发函记录编号」，右侧同屏预览**函面原件**（竖版 A4）。
 * 点「确定」= **归属即定** —— 随即写入回函管理列表，并打开识别工作台开始异步识别。
 *
 * 两处口径（v2.35）：
 *   · **快递单号不在这一步手填** —— 列保留为一行灰字占位「待识别填入」，值由识别阶段的面单
 *     识别读出（见 5.4 回函快递信息），之后仍可修改；
 *   · 切分与识别是**两个界面**：本弹窗只负责核对归属，识别在确认之后才启动。
 *
 * 关联发函记录编号与发函时间来自发函登记，非 AI 产出，仅作核对参照。
 */
export interface SplitSegment {
  key: string
  /** 切分页数，如 `1-3` */
  span: string
  /** 该段页码起点（预览定位用） */
  startPage: number
  confirmationNo: string
  entity: string
  sendRecordNo: string
  sendDate: string
}

/**
 * 演示用的切分结果 —— 与旧系统「数据核对」弹窗的切分段一致：
 * 拼接件共 9 页，每段 = 该封回函页 + 该封自己的快递面单页（面单页没有二维码，
 * 按「最后页是否快递面单」的设定归入其前一段尾部）。
 */
export const SPLIT_SEGMENTS: SplitSegment[] = [
  {
    key: '1-3',
    span: '1-3',
    startPage: 1,
    confirmationNo: 'whzf0010006',
    entity: '广东证券股份有限公司',
    sendRecordNo: '20260903000001',
    sendDate: '2026-08-13',
  },
  {
    key: '4-6',
    span: '4-6',
    startPage: 4,
    confirmationNo: 'whzf0010005',
    entity: '海通证券股份有限公司',
    sendRecordNo: '20260903000002',
    sendDate: '2026-08-13',
  },
  {
    key: '7-9',
    span: '7-9',
    startPage: 7,
    confirmationNo: 'whzf0010003',
    entity: '华泰证券股份有限公司',
    sendRecordNo: '20260903000003',
    sendDate: '2026-08-13',
  },
]

export default function SplitCheckModal({
  open,
  file,
  onCancel,
  onConfirm,
}: {
  open: boolean
  /** ① 选好的文件（仅用于标题副文案；原型不做真实解析） */
  file?: SplitFileInfo | null
  onCancel: () => void
  /** 点「确定」= 归属即定 —— 写列表 + 进识别工作台 */
  onConfirm: (segments: SplitSegment[]) => void
}) {
  const [segs, setSegs] = useState<SplitSegment[]>(SPLIT_SEGMENTS)
  const [selectedKey, setSelectedKey] = useState<string>(SPLIT_SEGMENTS[0].key)

  /* 每次打开重置为完整的三段 */
  useEffect(() => {
    if (open) {
      setSegs(SPLIT_SEGMENTS)
      setSelectedKey(SPLIT_SEGMENTS[0].key)
    }
  }, [open])

  const selected = useMemo(
    () => segs.find((s) => s.key === selectedKey) ?? segs[0],
    [segs, selectedKey],
  )

  const columns: ColumnsType<SplitSegment> = [
    { title: '切分页数', dataIndex: 'span', width: 84, render: (v: string) => <span className="num">{v}</span> },
    {
      title: '函证编号',
      dataIndex: 'confirmationNo',
      width: 132,
      render: (v: string) => <span className="num">{v}</span>,
    },
    {
      title: '关联发函记录编号',
      dataIndex: 'sendRecordNo',
      width: 150,
      render: (v: string) => <span className="num">{v}</span>,
    },
    {
      title: '快递单号',
      dataIndex: 'expressNo',
      width: 118,
      render: () => (
        <span style={{ color: 'var(--c-text-3)', fontSize: 12 }} title="识别阶段由面单识别读出，之后仍可修改">
          待识别填入
        </span>
      ),
    },
    { title: '发函时间', dataIndex: 'sendDate', width: 106, render: (v: string) => <span className="num">{v}</span> },
    {
      title: '操作',
      key: 'op',
      width: 64,
      align: 'right',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={(e) => {
            e.stopPropagation()
            setSegs((prev) => {
              const next = prev.filter((s) => s.key !== row.key)
              if (selectedKey === row.key) setSelectedKey(next[0]?.key ?? '')
              return next
            })
          }}
        >
          删除
        </Button>
      ),
    },
  ]

  return (
    <Modal
      open={open}
      title={
        <span>
          数据核对
          {file && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--c-text-3)' }}>
              {file.name} · 已切分 {segs.length} 段
            </span>
          )}
        </span>
      }
      width={1040}
      onCancel={onCancel}
      maskClosable={false}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
            点「确定」即确定归属并写入回函管理列表，随后进入识别工作台
          </span>
          <span style={{ flex: 1 }} />
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" disabled={!segs.length} onClick={() => onConfirm(segs)}>
            确定
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：切分结果表 */}
        <div style={{ flex: '1.1 1 0', minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--c-text-2)', marginBottom: 8 }}>
            切分结果（{segs.length} 段）
          </div>
          <Table<SplitSegment>
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={segs}
            pagination={false}
            rowClassName={(row) => (row.key === selectedKey ? 'split-row-on' : '')}
            onRow={(row) => ({
              onClick: () => setSelectedKey(row.key),
              style: { cursor: 'pointer' },
            })}
            locale={{ emptyText: '已移除全部段 —— 取消后可重新上传' }}
          />
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.8 }}>
            逐页识别右上角二维码，相同函证编号的页归为一段；面单页没有二维码，归入其前一段的尾部。
          </p>
        </div>

        {/* 右：函面原件预览（竖版 A4；换段时按 key 重建以定位到该段首页） */}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>函面原件</span>
            {selected && (
              <Tag style={{ marginInlineEnd: 0 }} bordered={false}>
                <span className="num">{selected.span}</span>
              </Tag>
            )}
          </div>
          {selected ? (
            <PdfPreview
              key={selected.key}
              confirmationNo={selected.confirmationNo}
              fileUrl={browserSampleUrlOf(selected.confirmationNo)}
              page={selected.startPage}
              height={420}
              hideViewToggle
            />
          ) : (
            <div style={{ height: 420, display: 'grid', placeItems: 'center', background: 'var(--c-fill-light)', borderRadius: 'var(--radius-card)', color: 'var(--c-text-3)', fontSize: 13 }}>
              已移除全部段
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
