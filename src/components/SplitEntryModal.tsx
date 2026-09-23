import { useState } from 'react'
import { Button, Modal, Radio, Upload } from 'antd'
import { FilePdfOutlined, InboxOutlined } from '@ant-design/icons'

/**
 * 「切分」界面 · ① 文件识别录入（往来函证专属，v2.35）。
 *
 * 往来回函上传的是**拼接件**（多封回函 + 各自面单页拼在一个 PDF 里），需要先按右上角二维码
 * 切分成若干段、由业务人员核对归属，**确认之后才进入识别工作台**。本弹窗是这条链路的第一步，
 * 沿用旧系统「文件识别录入」的形态。
 *
 * 两处与旧系统的差别（都在 v2.35 定稿）：
 *   · 「最后页是否快递面单」**恢复为人工指定** —— 它是切分边界判定的直接输入
 *     （告知切分逻辑「每段尾部是否还有一页没有二维码的面单页」）；
 *   · 与切分无关的字段（快递单号等）**不在这一步出现** —— 快递单号改由识别阶段的面单识别读出。
 */
export interface SplitFileInfo {
  name: string
  size: string
}

export interface SplitEntryValue {
  /** 最后页是否快递面单 —— 必选 */
  faceSheetLast: 'yes' | 'no'
  file: SplitFileInfo
}

export default function SplitEntryModal({
  open,
  onCancel,
  onNext,
}: {
  open: boolean
  onCancel: () => void
  /** 校验通过 → 进入 ②「数据核对」 */
  onNext: (value: SplitEntryValue) => void
}) {
  const [faceSheetLast, setFaceSheetLast] = useState<'yes' | 'no' | null>(null)
  const [file, setFile] = useState<SplitFileInfo | null>(null)
  const [msg, setMsg] = useState('')

  /** 每次打开都回到干净状态 —— 组件不卸载，所以手动重置 */
  const reset = () => {
    setFaceSheetLast(null)
    setFile(null)
    setMsg('')
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  const handleOk = () => {
    /* 校验不通过时**按钮保持可点、给出文字提示**（本项目既有口径：不用 disabled 把用户堵死） */
    if (!faceSheetLast) {
      setMsg('请先选择「最后页是否快递面单」')
      return
    }
    if (!file) {
      setMsg('请先选择要上传的回函文件（pdf）')
      return
    }
    setMsg('')
    const value: SplitEntryValue = { faceSheetLast, file }
    reset()
    onNext(value)
  }

  return (
    <Modal
      open={open}
      title="文件识别录入"
      width={520}
      onCancel={handleCancel}
      maskClosable={false}
      destroyOnHidden={false}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {msg && <span style={{ fontSize: 12, color: 'var(--c-risk-high-text)' }}>{msg}</span>}
          <span style={{ flex: 1 }} />
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" onClick={handleOk}>
            确定
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>最后页是否快递面单</span>
        <Radio.Group
          value={faceSheetLast ?? undefined}
          onChange={(e) => {
            setFaceSheetLast(e.target.value)
            setMsg('')
          }}
        >
          <Radio value="yes">是</Radio>
          <Radio value="no">否</Radio>
        </Radio.Group>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.8 }}>
        每段尾部是否还有一页没有二维码的面单页 —— 这决定切分边界怎么定。
      </p>

      {file ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--c-fill-light)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          <FilePdfOutlined style={{ color: 'var(--c-text-3)', fontSize: 18 }} />
          <span
            style={{
              fontSize: 13,
              color: 'var(--c-text-1)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </span>
          <span className="num" style={{ fontSize: 12, color: 'var(--c-text-3)', flexShrink: 0 }}>
            {file.size}
          </span>
          <Button type="link" size="small" style={{ marginLeft: 'auto' }} onClick={() => setFile(null)}>
            移除
          </Button>
        </div>
      ) : (
        <Upload.Dragger
          accept=".pdf"
          multiple
          showUploadList={false}
          beforeUpload={(f) => {
            /* 原型不做真实上传：只记录文件名与大小，随后由 mock 切分给出分段结果 */
            setFile({ name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB` })
            setMsg('')
            return Upload.LIST_IGNORE
          }}
          style={{ padding: '8px 0' }}
        >
          <p style={{ margin: 0, color: 'var(--c-text-3)', fontSize: 22 }}>
            <InboxOutlined />
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--c-text-1)' }}>
            点击或拖拽文件到此区域上传
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-3)' }}>
            支持单个或批量上传，仅支持 pdf 格式
          </p>
        </Upload.Dragger>
      )}
    </Modal>
  )
}
