import { useState } from 'react'
import { Button, Modal, Upload } from 'antd'
import { CloudUploadOutlined, DeleteOutlined, FilePdfOutlined, ThunderboltOutlined } from '@ant-design/icons'

/**
 * 「上传银行函证回函」—— **上传小弹窗**（v2.47）。
 *
 * ## 为什么由全屏工作台改为弹窗
 *
 * 此前点「上传银行函证回函」会**直接打开全屏识别工作台**，而工作台在无批次时是
 * 一个几乎空白的上传区 —— 拿一整屏做一个 520 宽弹窗就能做完的事。
 * 更关键的是**两类函证的入口形态不一致**：往来是「先在弹窗里选文件 → 再进工作台」，
 * 银行却是「一进去就是个空工作台」。本轮让银行侧对齐往来的节奏：
 * **弹窗负责选文件，工作台只负责看进度与结果。**
 *
 * ## 为什么这么简
 *
 * 往来那份弹窗（`SplitEntryModal`）里的「最后页是否快递面单」是**切分边界判定的输入**，
 * 银行不切分、也没有拼在回函件里的面单页（面单是随批次上传的独立扫描件），
 * 所以银行这份**没有任何字段**，只有拖拽区。
 *
 * ## 「用演示数据体验」入口从工作台搬到这里
 *
 * 它是**上传**的一种替代（没文件时用内置批次跑通流程），跟着上传动作走才合逻辑；
 * 工作台空态改为「暂无识别任务」后，那里也不该再出现上传类入口。
 */
export interface BankUploadFile {
  name: string
  size: string
}

export default function BankUploadModal({
  open,
  onCancel,
  onConfirm,
  /** 演示数据按钮文案（按入口类型给，如「银行函证回函（11 页 / 3 封 · 三档归属）」） */
  demoLabel,
  onDemo,
}: {
  open: boolean
  onCancel: () => void
  /** 点「确定」—— 直接开始识别并进入工作台 */
  onConfirm: (files: BankUploadFile[]) => void
  demoLabel?: string
  /** 点演示数据 —— 同上，只是用内置批次 */
  onDemo?: () => void
}) {
  const [files, setFiles] = useState<BankUploadFile[]>([])
  const [msg, setMsg] = useState('')

  /** 每次打开都回到干净状态 —— 组件不卸载，所以手动重置 */
  const reset = () => {
    setFiles([])
    setMsg('')
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  const handleOk = () => {
    /* 校验不通过时**按钮保持可点、给出文字提示**（本项目既有口径：不用 disabled 把用户堵死） */
    if (!files.length) {
      setMsg('请先选择要上传的回函文件（pdf）')
      return
    }
    setMsg('')
    const picked = files
    reset()
    onConfirm(picked)
  }

  return (
    <Modal
      open={open}
      title="上传银行函证回函"
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
      {files.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: 'var(--c-fill-light)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <FilePdfOutlined style={{ color: 'var(--c-text-3)', fontSize: 16, flexShrink: 0 }} />
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
                {f.name}
              </span>
              <span className="num" style={{ fontSize: 12, color: 'var(--c-text-3)', flexShrink: 0 }}>
                {f.size}
              </span>
              <Button
                type="text"
                size="small"
                aria-label={`移除 ${f.name}`}
                icon={<DeleteOutlined />}
                style={{ marginLeft: 'auto', flexShrink: 0 }}
                onClick={() => {
                  setFiles((prev) => prev.filter((_, x) => x !== i))
                  setMsg('')
                }}
              />
            </div>
          ))}
          <Upload
            accept=".pdf"
            multiple
            showUploadList={false}
            beforeUpload={(f) => {
              /* 原型不做真实上传：只记录文件名与大小，随后由 mock 识别给出结果 */
              setFiles((prev) => [...prev, { name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB` }])
              return Upload.LIST_IGNORE
            }}
          >
            <Button size="small">继续添加文件</Button>
          </Upload>
        </div>
      ) : (
        <Upload.Dragger
          accept=".pdf"
          multiple
          showUploadList={false}
          beforeUpload={(f) => {
            setFiles((prev) => [...prev, { name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB` }])
            setMsg('')
            return Upload.LIST_IGNORE
          }}
          style={{ padding: '8px 0' }}
        >
          <p style={{ margin: 0, color: 'var(--c-text-3)', fontSize: 22 }}>
            <CloudUploadOutlined style={{ color: 'var(--c-primary)' }} />
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--c-text-1)' }}>
            点击或拖拽文件到此区域上传
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-3)' }}>
            支持单个或批量上传，仅支持 pdf 格式
          </p>
        </Upload.Dragger>
      )}

      {onDemo && demoLabel && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>没有文件？用演示数据体验：</span>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => {
              reset()
              onDemo()
            }}
          >
            {demoLabel}
          </Button>
        </div>
      )}
    </Modal>
  )
}
