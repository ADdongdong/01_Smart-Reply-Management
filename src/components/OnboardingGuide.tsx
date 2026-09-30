import { Button, Modal, Steps } from 'antd'
import { useState } from 'react'
import { useApp } from '@/store/AppStore'

/**
 * 首次使用引导 / 操作指引弹窗。
 * 显隐完全由全局状态派生，不使用 effect 同步 state。
 *
 * ## 文案必须跟着界面走（v2.72 整体改写）
 *
 * 本组件是**全站唯一承载"这套系统怎么用"的地方**，但它此前停在 v2.57 / v2.60 / v2.62 之前：
 * 还在讲「最小化识别工作台」「快速确认对应关系」「手动指定函证 / 重新识别 / 跳过」
 * 「从核验页采纳或修正」—— 这四件事在当前实现里**都不存在了**。
 * 引导讲错比没有引导更糟（用户会照着找不到的东西找）。故本次按现行界面逐条重写，
 * **凡是提到界面元素的地方都写它此刻的真名**（「回函归属」「智能识别」「AI 核验」「回函结果填写」、
 * 右下角进度卡、列表的「回函进度」步骤条）。
 *
 * 改这个文件前先跑一遍真实流程（列表 → 上传 → 回函归属 → 右下角进度卡 → 智能识别 → AI 核验 / 结果填写）。
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
        items={[{ title: '上传回函' }, { title: '智能识别' }, { title: 'AI 核验' }, { title: '结果确认' }]}
        style={{ marginBottom: 20 }}
      />

      {step === 0 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>
            过去回函录入需要你在「回函登记 / 文件识别录入 / 按文件编号上传 / 快递数据导入」之间
            <b>自行判断该走哪个按钮</b>。现在只需记住一件事：
          </p>
          <p style={{ padding: '8px 12px', background: 'var(--c-primary-bg)', borderRadius: 6 }}>
            <b>按函证类型选对上传入口，其余由「回函归属」界面接着走。</b>
            「上传往来函证回函」与「上传银行函证回函」是两个独立入口 —— 两类函证的智能检测事项
            差别很大，上传时类型即已确定，系统不再事后判类型。
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            · 往来函证：回函是<b>多封拼在一个文件里</b>的拼接件（每封的回函页 + 它自己的快递面单页）
            → 系统按右上角二维码<b>预切分</b>
            <br />· 银行函证：只需上传<b>回函件</b>（格式一 / 格式二数据已存于函证系统），文件里没有二维码
            <br />· 两类的下一步一样：<b>「回函归属」界面</b> —— 左边一页一张缩略图、页与页之间立着一把剪刀，
            点一下就在那里切一刀；右边给每一段挂归属。归好点「确定」才算写进回函管理列表
            <br />· 快递详细信息（快递公司 / 地址 / 电话）另外用主操作行的「<b>导入快递数据</b>」按单号补
          </p>
        </div>
      )}

      {step === 1 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>识别是<b>异步</b>的，你不需要盯着它等：</p>
          <p style={{ padding: '8px 12px', background: 'var(--c-primary-bg)', borderRadius: 6 }}>
            上传后即返回，识别在后台推进 —— <b>你在「回函归属」界面切分的同时，识别已经在跑</b>。
            切分与归属决定的是「<b>什么时候写入回函管理列表</b>」，不是「识别什么时候开始」。
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            · 银行函证分两阶段：先<b>识别四要素</b>（银行名称 / 被审计单位 / 函证起止日期）；
            归属确定后，其余检测项（询证事项逐项核对 / 是否有印章 / 印章名称与被询证单位一致）
            <b>自动开跑</b>，不必再点按钮
            <br />· 进度看<b>右下角的「正在识别回函」卡片</b>：写着「正在对应 N 份 / 正在细查 M 份」，
            点「看识别过程」进「智能识别」界面 —— 那里能看到每个检测点读了哪几页、命中了什么
            <br />· 结果自动写入列表：先显示「识别中」，阶段二跑完自动刷新为正式结论
            <br />· 识别中途可以照常浏览列表、确认快递信息，不必等它跑完
          </p>
        </div>
      )}

      {step === 2 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>归档完成后系统自动执行智能核验 —— <b>两套检测项</b>：</p>
          <p style={{ fontWeight: 500, marginBottom: 4 }}>往来函证：</p>
          <ul style={{ paddingLeft: 18, margin: '0 0 8px' }}>
            <li>
              发函回函一致性检测 —— 发函件与回函件里<b>每一张数据表格</b>并排对照（列名列序照抄原件，
              不做归一化），不一致的金额单元格<b>打红框</b>
            </li>
            <li>
              印章识别 —— 是否盖章、骑缝章、公章/财务章、名称一致性，并
              <b>依据印章落章区域判定回函结果是否相符</b>
            </li>
            <li>手写体识别 —— 「信息不符」处的手写说明转录</li>
          </ul>
          <p style={{ fontWeight: 500, marginBottom: 4 }}>银行函证：</p>
          <ul style={{ paddingLeft: 18, margin: '0 0 8px' }}>
            <li>
              询证事项逐项核对 —— 识别回函件后，与<b>系统内已存的格式一 / 格式二数据</b>逐项比对；
              <b>有差异即判不相符</b>（印章位置不参与相符性判定，仅作风险提示）
            </li>
            <li>
              印章识别 —— <b>是否有印章</b>、印章名称与被询证单位是否一致
              （只作风险提示，不影响相符性；<b>不检测骑缝章</b>）
            </li>
            <li>识别四要素 —— 银行名称、被审计单位、函证起止日期（阶段一）</li>
            <li>不检测手写体</li>
          </ul>
          <p className="muted" style={{ marginBottom: 0 }}>
            AI 只给出<b>建议与风险标签</b>，不会自动写入数据；有风险的函证会在列表中高亮提示。
          </p>
        </div>
      )}

      {step === 3 && (
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          <p style={{ marginTop: 0 }}>最后一步由你来把关 —— <b>「看」与「定」分在两个地方</b>：</p>
          <p style={{ padding: '8px 12px', background: 'var(--c-primary-bg)', borderRadius: 6 }}>
            <b>看</b>：操作列「<b>更多 → AI 核验</b>」—— 逐项核对 AI 的判断依据
            （原件上的批注框、逐表并排比对、置信度）。
            <b>这一页是只读的</b>，看的时候不会误改任何东西。
            <br />
            <b>定</b>：采纳与修改都在「<b>回函结果填写</b>」页的「AI 核验结论」区块 ——
            点「<b>采纳</b>」才写进表单，写进去之后仍可改。
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            · <b>「回函进度」那一列就是你的下一步</b>：「快递信息 › 回函结果」，当前该做的那一步是加粗的，
            点步骤名直接进去办
            <br />· 流程：确认「回函快递信息」→ 填写「回函结果」并归档；首次确认时记一次
            <b>核验人 + 核验时间</b>，形成可追溯的函证证据链
            <br />· 带 ✦ 的字段表示由 AI 识别填充，鼠标悬停可查看来源与置信度
          </p>
        </div>
      )}
    </Modal>
  )
}
