import { useState } from 'react'
import { Button, Modal, Radio, Upload } from 'antd'
import { FilePdfOutlined, InboxOutlined, ThunderboltOutlined } from '@ant-design/icons'

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
 *
 * ## v3.06：补上「没有文件？用演示数据体验」入口
 *
 * 银行弹窗自 v2.47 就有这个入口，往来这边一直缺 —— 于是"想试一下但手头没有文件"的人
 * **只有银行那条路走得通**，往来这条得先自己去准备一个 PDF。本轮补上，与银行弹窗
 * **同款同措辞**（同样的「没有文件？用演示数据体验：」+ 闪电图标按钮），
 * 文案取自 `DEMO_LABEL.A`，两处共用一份、避免各写一份而漂移。
 *
 * 走法与「下一步」**同一条路**（`START_BATCH` 会一并置 `assignOpen`，直接进归属界面），
 * 差别只有两点：用内置批次代替选文件；面单口径按该演示批次的**实际形态**给定
 * （A 批每段尾部都有一页面单）—— 演示的意图是"没文件也能一步看到结果"，
 * 不该反过来先让人回答一个他无从判断的问题。
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
  /** 演示数据按钮文案（按入口类型给，如「往来函证拼接回函（9 页 / 3 段）」） */
  demoLabel,
  onDemo,
}: {
  open: boolean
  onCancel: () => void
  /** 校验通过 → 进入 ②「回函归属」（`AssignView`，本链路的最后一步） */
  onNext: (value: SplitEntryValue) => void
  demoLabel?: string
  /** 点演示数据（v3.06）—— 与「下一步」同路，只是用内置批次 */
  onDemo?: () => void
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
          {/* 按钮只说「推进」不说「推到哪」（v2.71 改文案后留下的缺口）—— 一句话补上落点 */}
          <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>下一步：核对切分与归属</span>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" onClick={handleOk}>
            下一步
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
          {/*
           * 拖放区图标 —— 站内**两处**拖拽区（本弹窗与银行上传弹窗）统一为
           * `InboxOutlined`（收件箱 = 往里放）+ **主色 + 24px**：
           * 此前一处是灰色 Inbox、一处是主色 CloudUpload，「同一个东西两种长相」。
           * 分工也一并定下：**投放区 = Inbox（收进来）、上传按钮 = CloudUpload（往上传）**。
           */}
          <p style={{ margin: 0, fontSize: 24 }}>
            <InboxOutlined style={{ color: 'var(--c-primary)' }} />
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--c-text-1)' }}>
            点击或拖拽文件到此区域上传
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-3)' }}>
            支持单个或批量上传，仅支持 pdf 格式
          </p>
        </Upload.Dragger>
      )}

      {/* v3.06：与银行弹窗同款入口 —— 没文件时用内置批次一键跑通（含切分与归属） */}
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
