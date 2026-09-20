import { Button, Modal, Steps } from 'antd'
import { useState } from 'react'
import { useApp } from '@/store/AppStore'

/**
 * 首次使用引导 / 操作指引弹窗。
 * 显隐完全由全局状态派生，不使用 effect 同步 state。
 */
export default function OnboardingGuide() {
  const { state, dispatch } = useApp()
  const [step, setStep] = useState(0)

  const close = () => {
    setStep(0)
    dispatch({ type: 'CLOSE_ONBOARDING' })
  }

  const open = state.onboardingVisible

  return (
    <Modal
      open={open}
      title="回函管理操作指引"
      width={720}
      onCancel={close}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            第 {step + 1} / 4 步
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
          {step < 3 ? (
            <Button type="primary" onClick={() => setStep(step + 1)}>
              下一步
            </Button>
          ) : (
            <Button type="primary" onClick={close}>
              开始使用
            </Button>
          )}
        </div>
      }
    >
      <Steps
        size="small"
        current={step}
        items={[{ title: '上传回函' }, { title: '智能识别' }, { title: 'AI 核验' }, { title: '人工确认' }]}
        style={{ marginBottom: 20 }}
      />

      {step === 0 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>
            过去回函录入需要你在「回函登记 / 文件识别录入 / 按文件编号上传 / 快递数据导入」之间
            <b>自行判断该走哪个按钮</b>。现在只需记住一件事：
          </p>
          <p style={{ padding: '8px 12px', background: 'var(--c-primary-bg)', borderRadius: 6 }}>
            <b>把回函文件直接拖进来就好。</b> 往来函证、银行函证、快递数据 Excel
            可以一起拖入，系统会自己判断类型并分派处理方式。
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            · 往来函证：我方发出的函证右上角带系统二维码 → 按二维码自动切分并归属
            <br />· 银行函证：银行自行制作、无系统标记 → 按「银行名称 + 被审计单位 + 函证起止日期」四要素归属
          </p>
        </div>
      )}

      {step === 1 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>识别过程是<b>异步</b>的，你不需要盯着进度条等待：</p>
          <p style={{ padding: '8px 12px', background: 'var(--c-primary-bg)', borderRadius: 6 }}>
            每一封函证都会按「页面切分 → 二维码/文本定位 → 快递面单识别 → 归属匹配」逐阶段推进，
            右侧抽屉可以实时看到<b>正在处理哪一封</b>。
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            · 处理期间可最小化识别工作台，继续浏览列表
            <br />· 识别失败的函证会给出明确原因，并支持「手动指定函证 / 重新识别 / 跳过」
          </p>
        </div>
      )}

      {step === 2 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>归档完成后系统自动执行四类智能核验：</p>
          <ul style={{ paddingLeft: 18, margin: '0 0 8px' }}>
            <li>回函一致性检测 —— 回函表格科目金额与发函底稿逐行比对</li>
            <li>
              印章识别 —— 是否盖章、骑缝章、公章/财务章、名称一致性，并
              <b>依据印章落章区域判定回函结果是否相符</b>
            </li>
            <li>银行函证文本识别 —— 银行名称、被审计单位、函证起止日期</li>
            <li>手写体识别 —— 「信息不符」处的手写说明转录</li>
          </ul>
          <p className="muted" style={{ marginBottom: 0 }}>
            AI 只给出<b>建议与风险标签</b>，不会自动写入数据；有风险的函证会在列表中高亮提示。
          </p>
        </div>
      )}

      {step === 3 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>
            最后一步由你来把关：在「AI 智能核验」列查看结论，逐项<b>采纳或修正</b>，
            确认后系统会打上「已人工核验」标识并记录核验人与时间。
          </p>
          <p style={{ padding: '8px 12px', background: 'var(--c-primary-bg)', borderRadius: 6 }}>
            确认「回函快递信息录入」→ 填写「回函结果」→ 归档完成，形成可追溯的函证证据链。
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            提示：列表中带 ✦ 的字段表示由 AI 识别填充，鼠标悬停可查看来源与置信度。
          </p>
        </div>
      )}
    </Modal>
  )
}
