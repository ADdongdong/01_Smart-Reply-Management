import { Tooltip } from 'antd'
import { aiReviewItemsOf, aiReviewStageStatusOf, type AiReviewStageStatus } from '@/config/aiReview'
import { StatusTag } from '@/components/StatusTag'
import { PixelGridLoader } from '@/components/ai/PixelLoader'
import { TYPE_RULE } from '@/services/replyRule'
import type { ConfirmationType, RecognitionTask } from '@/types'

/**
 * 列表里**智能核查过程的两列**（2026-10-14 新增）。
 *
 * ## 它们替代了什么
 *
 * 原口径是「全部检测项跑完才入表」，识别过程中的那几封摆在列表页的**独立识别区**里
 * （`RecognitionProgressBoard`，现已不再挂载）。用户后来把这件事整个调过来了（原话）：
 *
 * > 「上传完函证回函、切分完点完确认以后，**函证回函数据直接落入表格**，
 * > 智能核查过程的显示的位置，**放在表单中**，因此表单要增加两个字段：
 * > ① 智能核查状态：未开始、正在核查（需要有动效）、已核查；
 * > ② 智能核查进度：类似 AI 核验事项字段展示的内容，**每识别完一个智能核查项，
 * > 该项前面加一个完成标识**。核查进度要和真实核查进度进行联动，动态展示。」
 *
 * 于是"哪一封核到哪一项"从**页面上的一块区域**变成了**这一行自己的两格** ——
 * 这才是它的正确归属：那是**这一行的状态**，不是页面的状态。
 *
 * ## 两列各答什么
 *
 * · **智能核查状态** —— 这一封**整体**核到哪一步：未开始 / 正在核查（主色标签 + **底色扫光**，
 *   动效即"系统正在工作"）/ 已核查 / **核查失败**（第四态，见下）；
 * · **智能核查进度** —— 逐项，**每项前面一枚状态标识**（`StageMark`）：未核查＝**一条浅灰短横**、
 *   正在核查＝**像素网格在跑**、已核查＝**主色对勾**（不是绿，见组件注释）、失败＝红叉。
 *   **顺序 = 机器核查顺序**（`aiReviewItemsOf` 按检测点管道排）。
 *
 * 两列的**动效分工**（2026-10-14 定，绕了一圈）：**逐项 = 像素网格（进度列）·
 * 整体 = 标签扫光（状态列）** —— 同一个动效出现在两处，用户会以为它们说的是同一件事。
 *
 * ## 数据从哪来
 *
 * 两列都读**识别任务**（`task.stages`）而不是记录 —— 记录上是"事实"（结论、留痕），
 * 过程在任务上。列表用 `recordId` 找回任务（`ReplyList` 的 `taskByRecordId`）。
 * 「没有任务」= 不是本次核查产生的行（演示种子 / 历史数据）⇒ **视为已核查**。
 *
 * ## 事项清单仍与「核查事项复核」格**共用一份**（`config/aiReview`）
 *
 * 用户原话是「类似 AI 核验事项字段展示的内容」—— 那就不是"再写一套标签"，而是**同一份事项**
 * 的两张脸：**本列答"机器核完没有"（逐项：短横 → 在跑的像素格 → 勾 / 叉）**，
 * 右边那一格答"**人复核完了没有**"（整条一个状态）。
 * 事项与检测项的对应关系收在 `AI_REVIEW_STAGE_MAP`，本文件不含任何清单；
 * 顺序取自 `aiReviewItemsOf`（按机器管道算）—— 与核验详情右侧的页签、以及
 * **点那一格进来时的默认落点**（`aiReviewEntryOf`）**同源**，三处看到的次序一致。
 *
 * ⚠️ v3.31 起右边那格**不再逐项列**（用户：「因为前面已经有 AI 核查进度展示具体进行了哪些
 * AI 核查项目，所以，这里就不展示具体的哪些核查项了」）—— 于是"两列逐项对得上"这条约束
 * 随之作废：**逐项只在本列**，那一格只报"还剩几项 / 已复核"。
 *
 * ## 为什么多出「核查失败」这一态
 *
 * 用户给的是三态（未开始 / 正在核查 / 已核查），但**跑完但某项失败**的封用「已核查」是句假话
 * （它没得出一份可用的核查结果）。故按站内既有口径补第四态，沿用 `--c-risk-high` 红档；
 * 红色在这里是"判定了坏结果"，与「没得出判定"走中性灰」的用色判据不冲突
 * （见 §7.1：红只给判定了坏结果）。
 */

/** 这一封**整体**核到哪一步了 */
type CheckState = 'waiting' | 'running' | 'done' | 'failed'

/**
 * 从任务推出整体状态。
 *
 * 之所以不直接读 `task.status`（`pending / success / failed`）：那个字段回答的是
 * 「这次识别成功了吗」，而这里要回答「**跑到哪一步了**」—— 前者在"队列里还没轮到"与
 * "正在跑"之间是**同一个值**（`pending`），拿它分不出「未开始」与「正在核查」。
 */
function checkStateOf(task: RecognitionTask | undefined): CheckState {
  /* 没有任务 = 不是本次核查产生的行（演示种子 / 历史数据）：它早就核完了 */
  if (!task) return 'done'
  const stages = task.stages
  const running = stages.some((s) => s.status === 'running')
  const failed = stages.some((s) => s.status === 'failed')
  /*
   * 「还有没轮到的」有两个来源：① 任务里真有 `waiting` 的检测项；
   * ② **两阶段类型此刻还在阶段一** —— 阶段二的检测项**还没被追加**到任务上，
   *    此时"没有 waiting"是假象（阶段一刚落定的那一 tick），不能据此判成"已核查"。
   */
  const pending = stages.some((s) => s.status === 'waiting') || (TYPE_RULE[task.type].twoPhase && task.phase === 1)
  const touched = stages.some((s) => s.status === 'done' || s.status === 'failed')

  if (running) return 'running'
  if (pending) return touched ? 'running' : 'waiting'
  return failed ? 'failed' : 'done'
}

const STATE_TEXT: Record<CheckState, string> = {
  waiting: '未开始',
  running: '正在核查',
  done: '已核查',
  failed: '核查失败',
}

/** 四态各走站内既有的语义档（`StatusTag` 的 tone）—— 与风险 / 相符性 / 人工核验同一套配色 */
const STATE_TONE = {
  waiting: 'neutral',
  running: 'primary',
  done: 'low',
  failed: 'high',
} as const

/**
 * 智能核查状态 —— **颜色标签**（用户：「做成颜色标签，**不要使用 to-do 样式**」）。
 *
 * ## 为什么从"方块 + 文字"改成标签
 *
 * 上一版是 `[旋转方块] 正在核查` —— 方块是 `insight.css` 的状态图标（空心/旋转/实心），
 * 它跟右侧「核查事项复核」列那些**待办记号**（当时是自绘的空心圆环；v3.30 起已换成勾选框）
 * 长得像，用户读成了"这是个待办勾选框"，
 * 于是要"颜色标签"。改完之后这一列的语言与站内**其它所有状态**一致
 * （`StatusTag`：相符绿 / 不相符红 / 未确认中性 / 人工留痕主色），不必再学第二套记号。
 *
 * ## 动效：**标签底色上一道扫过的亮光**（2026-10-14 二次改）
 *
 * 这一格换过两次动效，绕了一圈：
 *
 * ① 最早是**标签底色扫光**（`.status-tag--live`）—— 一道亮光沿底色扫过，我写它只是为了
 *    兑现"要有动效"；当时站内没有第二处在用，显得孤零零，于是被换掉；
 * ② 换成 beautifului `Loading State` 的**3×3 像素网格**（`PixelGridLoader`）—— 理由是
 *    "复用已经在用的加载语言"；
 * ③ **像素网格又撤了**（用户：「既然智能核查动效在智能核查进度这里有了，
 *    那智能核查状态就不要那 9 个点了。**换一种**」）。这句是对的、而且比我原来的理由更强：
 *    网格现在是**「智能核查进度」列逐项**的语言（跑过的那一项在动），是**逐项**的信号；
 *    而这一列说的是**整封的状态**。同一个动效在两列各出现一次，用户会以为它们说的是同一件事
 *    （"哪一项在跑" vs "这封在跑"），也让两列读起来像同一列的复制。
 *
 * 于是回到**底色扫光**，但这次它不再孤零零 —— 两列的动效分工清楚：
 * **逐项 = 像素网格（进度列）· 整体 = 标签扫光（本列）**。
 * 完成态、失败态**都不带任何动效**（定格）—— 动的是"还没干完"，干完了就该静
 * （失败那一态靠红标签说话，闪动反而像还在跑）。
 */
export function SmartCheckStatus({ task }: { task?: RecognitionTask }) {
  const state = checkStateOf(task)
  return (
    <StatusTag
      tone={STATE_TONE[state]}
      /* 扫光只在"正在核查"这一态出现（此刻至多一枚标签在动） */
      className={state === 'running' ? 'status-tag--live' : undefined}
    >
      {STATE_TEXT[state]}
    </StatusTag>
  )
}

/** 悬停补一句"这一项此刻什么情况" */
const ITEM_TIP: Record<AiReviewStageStatus, string> = {
  waiting: '尚未开始核查',
  running: '正在核查这一项…',
  done: '已核查完成',
  failed: '核查失败 —— 可在「操作」列点「重新识别」重跑',
}

/**
 * 逐项状态标识 —— **一条浅灰短横（未核查）· 一张在跑的像素网格（正在认）· 对勾 / 叉（结果）**
 * （Tabler Icons for 勾 / 叉，MIT，24×24 画布，path 逐字取自上游）。
 *
 * ## 形状怎么定下来的（五版，每一版都是用户否出来的）
 *
 * ① **旗子** —— 被否：「前面用个旗子的标识，还是太奇怪了」（旗在界面语言里是标记 / 书签，
 *    不是"这一项核完了没有"）；
 * ② **实心小圆点** —— 也被否：「**不要小圆点，我这是 ai 识别，要有 ai 识别的感觉**」；
 * ③ **圆圈 + 勾** —— 用户给了参照（「类似任务列表的这种感觉，只不过，是横向的」），
 *    但这个形状把"圈"也带来了；
 * ④ **不要圈，只留对勾**（用户：「**如果不要圆圈，只要对勾呢？**」）—— 圈不承载信息，
 *    去掉之后勾更干净、也更大；"没核到"那几项改由**压暗的像素网格**表达；
 * ⑤ **未核查也不用网格了**（用户：「**智能核查进度在还没有核查的时候，前面不要用灰色的
 *    9 个点。换个别的**」）—— 于是未核查只剩一条**浅灰短横**。
 *    这一条也把"像素网格式的 AI 感"收拢到了**唯一一处**：正在认的那一项（见下）。
 *
 * ## 四态四形（现状）
 *
 * | 项的状态 | 标识 | 读作 |
 * |---|---|---|
 * | 未核查 | **一条浅灰短横**（`.smart-check__dash`）| "这一格还没有结果" —— 与站内空值 `—` 同一个记号，<br>且**不抢戏**：没认到的项本来就不该有存在感 |
 * | **正在核查** | **像素网格在跑**（`PixelGridLoader`，扫描波前）| "模型正在读这一项" |
 * | 已核查 | **对勾**（`check`，无圈）| "机器认完了" |
 * | 核查失败 | **叉**（`x`，无圈）| "这一项机器没认成" |
 *
 * ## 「智能」怎么表达（用户提问：「如何展示出智能呢？」）
 *
 * 这一列的真问题不是"少一个图标"，而是**它长得像人列的任务清单**（勾 + 叉是通用符号，
 * 谁都能打）。站内表达"这是机器在干活"的既有语言是**像素网格 + 动效**（识别界面、识别区都用它），
 * 而它**只需要出现一次、出现在唯一需要动的地方**：**正在认的那一项**。
 * 于是这一列的读法是一条线：`— 还没认 → ⣿ 正在认（动）→ ✓ 认完了`，
 * 中间那一格是**唯一**的动效，也是"机器"这两个字在这一列的全部落点。
 *
 * 与右侧「核查事项复核」格的分工仍是清楚的：那一格是**人**的待办，v3.31 起只报**一条状态**
 * （待复核 · 剩 N 项 / 已复核：主色空方框 → 灰**方框加勾**），**逐项留在本列**；
 * 这一列是**机器**的过程（短横 → 动格 → 勾 / 叉）—— 于是并排的读法成了
 * 「**机器核完没有 → 我要不要复核**」。
 *
 * 尺寸 20px、描边 2（图标规范：≥16px 用 2）。对勾 `check` 是**裸勾**，在 20px 盒里画出来
 * 约 12.5×8.3px —— 比"圈里那枚小勾"（6×4 单位）大一倍多，这也是用户要的"明显"。
 */
const MARK_PATH: Record<'done' | 'failed', string> = {
  /* 勾 —— 核完了 */
  done: 'm5 12l5 5L20 7',
  /* 叉 —— 这一项没成 */
  failed: 'M18 6L6 18M6 6l12 12',
}

function StageMark({ state }: { state: AiReviewStageStatus }) {
  return (
    <span className="smart-check__mark" aria-hidden="true">
      {state === 'waiting' && <span className="smart-check__dash" />}
      {state === 'running' && <PixelGridLoader />}
      {state !== 'waiting' && state !== 'running' && (
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d={MARK_PATH[state]}
          />
        </svg>
      )}
    </span>
  )
}

/**
 * 智能核查进度 —— 逐项，**每项前面一枚状态标识**，横向排成一条任务清单。
 *
 * 与「核查事项复核」列是**同一份清单的两张脸**：这一列看**机器**（像素格 → 勾 / 叉），
 * 那一列看**人**（v3.30 起：主色空方框 → 方框加勾 + 状态词，项名后缀 `✦`）。两列相邻摆放，
 * 扫一眼就知道"机器核到哪了、人处理了没有"。**两列顺序共用**（见 `aiReviewItemsOf`），
 * 所以左右逐项对得上，不会"左边第三项对右边第一项"。
 *
 * ## 形态与配色的取舍（2026-10-14 定，形状改过四版 —— 最新一版见 `StageMark` 的头注释）
 *
 * | 项的状态 | 标识 | 颜色 |
 * |---|---|---|
 * | 未核查（`waiting`） | **一条浅灰短横**（`.smart-check__dash`）| 浅灰（`--c-text-3` 档）|
 * | 正在核查（`running`） | **同一张网格在跑** | **主色**（文字也转主色）|
 * | 已核查（`done`） | **裸勾**（无圈）| **主色蓝** |
 * | 核查失败（`failed`） | **裸叉**（无圈）| 红档 |
 *
 * **几处取舍的理由**：
 *
 * ① **标识位从"有 / 无"改成"四态四形"** —— 首版是"核完才插标识"，未核查的项**前面空着**。
 *    但这一列回答的是"**共几项、核完了几项**"，空位与置灰是两种不同的读法：置灰的占位让人
 *    **先看到总量**（三条短横比"什么都没有"多告诉一件事），再逐个被勾替换就是进度本身；
 * ② **蓝色替掉相符绿** —— 首版走绿（我当时按"站内完成＝绿勾"套的）。用户否掉，有依据：
 *    绿在站内被"**相符 / 低风险**"占着（「回函是否相符」的相符、
 *    「回函进度」的绿勾都是业务的"这单没问题"），而这一列说的是"**机器核完了**"——
 *    是**系统自己的动作**，与"这笔业务相符"不是一回事。主色才是站内"系统 / AI 一侧的动作"色档
 *    （同列「正在核查」标签、识别中的项名都是它）。绿留给业务结论，蓝留给"机器干完了"；
 * ③ **形状：旗 → 点 → 圈勾 → 像素格 + 圈勾 → 短横 + 裸勾/叉** —— 前四版都被否，理由见 `StageMark`；
 * ④ **失败给叉而非空着** —— 这一项确实跑过、且没成，空着会被读成"还没轮到"。
 */
export function SmartCheckProgress({
  task,
  type,
}: {
  task?: RecognitionTask
  type: ConfirmationType
}) {
  return (
    <span className="smart-check ai-surface">
      {aiReviewItemsOf(type).map((item) => {
        const state = aiReviewStageStatusOf(task, type, item.key)
        return (
          <Tooltip
            key={item.key}
            title={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{item.label}</div>
                <div style={{ marginTop: 2 }}>{ITEM_TIP[state]}</div>
              </div>
            }
          >
            <span className={`smart-check__item is-${state}`}>
              {/*
               * 状态标识**挂在项名前面**（用户：「该项前面加一个完成标识」）——
               * **每项都占一格标识位**，形状与颜色都按状态给，见 `StageMark` 的说明。
               */}
              <StageMark state={state} />
              {item.label}
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}
