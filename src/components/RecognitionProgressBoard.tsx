import { useEffect, useMemo, useState } from 'react'
import { Button } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import { stageLabelOf } from '@/mock/recognition'
import type { RecognitionTask, StageKey, StageStatus } from '@/types'

/**
 * 列表页的**智能识别区**（v3.28 立题；v3.29 改版：位置、形态、去进度条）。
 *
 * ## 它替代了什么
 *
 * 原先「识别进行中」有两条表达：右下角常驻的**悬浮进度卡**（`FloatingProgress`）与点进去的
 * **全屏识别界面**（`InsightView`）。用户判定识别过程必须**落在主页面**上：
 * 「上传函证以后，智能识别的过程，要放在主页面……并且要达到，用户知道哪个函证正在智能识别」。
 * 于是本组件接管那两条表达，两者**只保留代码、不再挂载**（`WorkbenchLayout` 已摘除挂载）。
 *
 * ## 逐封一行，跑完即走
 *
 * 每封函证一行：函证编号（面单页写「快递面单 · 第 N 页」）+ 被询证单位 + **当前检测项**。
 * **跑完的那一封从本区消失、同时出现在下方表格里** —— 两者是同一件事的两半
 * （入表闸在 store 里，见 `finalizeTask` / `isFullyRecognized`）。
 *
 * 只列**已提交**批次的未完成任务：未点「确定」的批次一个字都不会写入列表（v3.27），
 * 此刻把它们的进度摆在这里会让人以为"这些马上就会出现在下面"。
 *
 * ## 快递面单识别**不在本区**（v3.29）
 *
 * 用户：「**切分时候的快递面单的快递单号识别，保留。切分后的智能识别里的快递面单识别，去掉**」。
 * 于是：面单段（`faceSheetPage`）不占本区一行，「当前检测项」也跳过 `expressSheet` ——
 * 它属于**切分（归属）阶段**的前置识别，进度由归属界面顶部那行状态交代
 * （"正在识别快递面单…／已识别 N 张"，见 `AssignView` 的 `faceSheetScan`）。
 * 识别本身照跑（结果到达后归属界面据此预切面单段、带出单号），只是不再在这里冒充一项检测内容。
 *
 * ## 形态：一列左对齐的文本，**不做进度条**（v3.29）
 *
 * 三轮形态收敛，用户每次都在减：
 * ① v3.28 自绘 2px 细进度条 → ② 上一轮换成**分段扫过轨**（一格一个检测项、格内局部进度
 * 加一道扫过的白光）→ ③ 本轮**连轨道与百分比一起去掉**，整行左对齐纯文本：
 * 「不需要右侧的进度条，**整体左对齐就行了，看起来简单高级一些**」。
 *
 * 留下的三件东西各回答一个问题，且都靠**文字**回答，不靠量条：
 * · **状态方块**（`.in-status`）—— 这一封现在有没有在跑（运行中 = 旋转方框）；
 * · **当前检测项**（主色 = 正在跑这一项 / 灰色「待×××」= 还没轮到）；
 * · **函证编号 + 被询证单位** —— 哪一封。
 *
 * 「还剩几封」由**头部那行字**给（`跑完一封即写入下方列表，无需等待 · 剩余 N 封`）——
 * 逐行再画一根条是同一件事的第二处表达，也是这轮被去掉的东西。
 * 保持的科技感只在**头部**：像素方格（`.px-grid`）+ 微光标题（`.shimmer-text`），
 * 都是 v2.57 从 beautifului.dev 那套移植进来的原语，不是本轮新造。
 *
 * ## 逐项留痕：认完一项，后面就多一枚对勾（v3.29）
 *
 * 用户看过实机后的要求：「这个地方，**每成功识别一项，后面要出现一个圆形对勾**，绿色或者蓝色」。
 *
 * 原先一行只写**当前那一项** —— 认完的项当场被下一项顶掉，**过程一点痕迹不留**，
 * 用户只能看到"现在在干什么"，看不到"已经干完了哪些"。现在改为把该封**已经认完的检测项
 * 逐条摆出来**（灰字 + 一枚绿色圆形对勾），再接上正在认的那一项（主色）。
 *
 * 后续又收了几条（用户）：
 * · 「不要这种对勾，要**空心圆形的对勾**，简单一点，有点像 workbuddy 任务完成的那种」——
 *   由实心圆 `CheckCircleFilled` 换成**空心圆 `CheckCircleOutlined`**（勾在圈里、圈是描边）；
 * · 摆法试了三轮：① 横着往后追加 → 「不要一直往后追加」；② 横向滚动窗口 →
 *   「上下滚动就行了，**不用左右滚动，看着很难受**」；③ 竖直摊开 →
 *   「**始终只展示一行识别项，然后一行内容上下滚动**」⇒ 现在是**一行高的窗口 + 整体上移**；
 * · 「这里**不需要「待归属匹配」**，只展示智能识别的事项」⇒ 还没轮到的项**不占位**，
 *   窗口里只有真实发生过的：已认完（灰字 + 空心绿勾）/ 失败（红字 + 红叉）/ 正在认（主色）。
 *
 * 颜色的选择：**绿**（`--c-risk-low`）。站内"完成"的语义色就是相符绿（右侧「回函进度」列的
 * 绿勾同色），用蓝色会与本行"正在进行"的主色撞车，分不出"正在做"与"已做完"。
 * 失败项**不能打勾**（那是在说谎）：红字 + 红叉，原因放在悬停里。
 *
 * ## 出现与收起
 *
 * 「识别区只在有任务时出现，跑完自动收起」（用户勾选）。收起用**淡出 + 收高度**，
 * 再等过渡走完才卸载 —— 直接卸载会让下方表格**跳一下**。
 *
 * ## 性能
 *
 * 本组件随 `TICK`（600ms）重渲染，故：数据在这里算完再渲染（不外传函数）；
 * 动效只剩像素方格的 `transform` / `opacity`（合成层）。去掉逐行量条后，
 * 一屏十几行同跑的成本比上一版更低。
 */
export default function RecognitionProgressBoard() {
  const { state, dispatch } = useApp()

  const rows = useMemo(() => {
    const out: {
      task: RecognitionTask
      title: string
      entity: string
      /**
       * **本封的检测项（已排除面单识别），按阶段顺序** —— 界面据此把"已经认完的"
       * 一条条摆出来（每项后面跟一枚圆形对勾），再接上"正在认的那一项"。
       * 见组件头注释的「逐项留痕」。
       */
      steps: { key: StageKey; label: string; status: StageStatus }[]
      /** 窗口里实际渲染的那些（= `steps` 去掉还没轮到的） */
      shown: { key: StageKey; label: string; status: StageStatus }[]
      /** 本行是否有检测项正在跑（决定状态方块与文字色） */
      running: boolean
    }[] = []

    for (const b of state.batches) {
      /* 未提交的批次不在此列（它们还不会写入列表，见组件头注释） */
      if (!b.committed) continue
      for (const t of b.tasks) {
        /*
         * ① **已经入表的段不在此列**（v3.29）—— 它的位置在下方表格里。
         *    这条同时照顾了"重新识别"：重跑时它的落库标记被清掉、记录被撤下，
         *    会**重新出现在这里**逐项再走一遍（见 `RETRY_TASK`）。
         * ② 只列**还在跑**（`pending`）与**跑失败但还没入表**（`failed`）的两类 ——
         *    失败的封一旦入表（`applied`）就从本区消失，识别区因此能正常收起。
         * ③ **快递面单不属本区**（v3.29，见下）—— 面单段（`faceSheetPage`）不占行。
         */
        if (t.applied) continue
        if (t.status !== 'pending' && t.status !== 'failed') continue
        if (t.faceSheetPage) continue
        const steps = t.stages
          .filter((s) => s.key !== 'expressSheet')
          .map((s) => ({ key: s.key, label: stageLabelOf(t.type, s.key), status: s.status }))
        /*
         * **快递面单识别不进「智能识别」**（v3.29，用户：「切分时候的快递面单的快递单号识别，
         * 保留。**切分后的智能识别里的快递面单识别，去掉**」）。
         *
         * 它仍然是一个真实的识别阶段（在 `task.stages` 里照跑，结果到达后归属界面据此预切
         * 面单段、带出单号）—— 但它属于**切分（归属）阶段**的前置识别，不是这封函证的"体检项"。
         * 它的进度由**归属界面顶部那行状态**交代（"正在识别快递面单…／已识别 N 张"，
         * 见 `AssignView` 的 `faceSheetScan`），不该再在这里冒充一项检测内容。
         * 故挑"当前检测项"时跳过 `expressSheet`。
         */
        const running = t.stages.some((s) => s.status === 'running' && s.key !== 'expressSheet')
        out.push({
          task: t,
          /*
           * 走到这里的一定是**函证段**（面单段已在上面被跳过），故直接用函证编号 ——
           * 原先还要判一次"是不是面单页、要用「快递面单 · 第 N 页」"（v3.22 的角标口径），
           * 面单不再进本区后那条分支已不可达。
           */
          title: t.confirmationNo,
          entity: t.matchedEntity ?? '',
          /*
           * 检测点名**按函证类型取**（v3.29 修正）：银行函证的 `consistency` 是
           * 「询证事项逐项核对」，直接查 `STAGE_LABELS` 会错写成往来那套
           * 「发/回函一致性检测」—— 该函数（`stageLabelOf`）本来就是为分流存在的。
           */
          steps,
          /* 窗口里真正展示的那些 —— **滤掉还没轮到的**（用户：「不需要「待归属匹配」」） */
          shown: steps.filter((s) => s.status !== 'waiting'),
          running,
        })
      }
    }
    return out
  }, [state.batches])

  const hasWork = rows.length > 0
  /*
   * 「跑完自动收起」—— 先淡出收高度（CSS 过渡），过渡走完再卸载。
   * 首次进入页面且本来就没有任务时不渲染，避免空占版面。
   */
  const [mounted, setMounted] = useState(hasWork)
  useEffect(() => {
    if (hasWork) {
      setMounted(true)
      return
    }
    const t = window.setTimeout(() => setMounted(false), 1800)
    return () => window.clearTimeout(t)
  }, [hasWork])

  /*
   * 检测项**竖直往下堆**（v3.29）—— 用户：「在这个位置，**上下滚动就行了，不用左右滚动**，
   * 看着很难受」。故这里**没有任何自动横向滚动**：整块的高度随项数向下长，
   * 由 `.recog-board__list`（识别区自身的竖向滚动）负责上下看 —— 这正是他要的那一种滚动。
   */

  if (!mounted) return null

  const failed = rows.filter((r) => r.task.status === 'failed').length

  return (
    /* `ai-surface` = insight.css 里那套 AI 原生原语的语义别名（微光文字要读 `--in-*`） */
    <div className={`recog-board ai-surface${hasWork ? '' : ' is-done'}`}>
      <div className="recog-board__head">
        {/*
         * 头部「系统正在工作」的信号 —— 像素方格（跑完后定格成静态图案，表示"干完了"）。
         * 替代原先的 antd `LoadingOutlined`：spinner 是通用控件语言，与这套像素语言不同族。
         */}
        <span className={`px-grid${hasWork ? '' : ' is-done'}`} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="px-grid__cell" style={{ ['--i' as string]: i }} />
          ))}
        </span>
        <span className={`recog-board__title${hasWork ? ' shimmer-text' : ''}`}>
          {hasWork ? '正在智能识别' : '识别已完成'}
        </span>
        <span className="recog-board__note">
          {hasWork
            ? `跑完一封即写入下方列表，无需等待 · 剩余 ${rows.length} 封`
            : '结果已全部写入下方列表'}
        </span>
        {/* 失败数**跟着左对齐**，不再甩到卡片最右端（用户要求整块左对齐） */}
        {failed > 0 && hasWork && (
          <span className="recog-board__failed">· {failed} 封识别失败</span>
        )}
      </div>

      {/*
       * 行列表**独立滚动**（v3.29 补）：整块的 `max-height` 是收起动效需要的，
       * 但它同时会把行**裁掉** —— 银行演示批次最多同时有 20 个任务，
       * 摆满会超过这个高度，最下面几行既看不到也点不到（失败行的「重试」就在其中）。
       * 故头部固定、行区自己滚：高度可控，且一行都不会丢。
       */}
      <div className="recog-board__list">
        {rows.map((r) => (
          <div className="recog-board__row" key={r.task.id}>
            {/*
             * 状态方块（`.in-status`）—— 运行中是旋转方框、等待是虚线方框、失败是红方块，
             * 与像素方格同族；不用 spinner / 对勾图标。
             */}
            <span
              className={
                r.task.status === 'failed'
                  ? 'in-status in-status--failed'
                  : r.running
                    ? 'in-status in-status--running'
                    : 'in-status in-status--waiting'
              }
              aria-hidden="true"
            />
            <span className="recog-board__no num">{r.title}</span>
            <span className="recog-board__entity">{r.entity}</span>

            {/*
             * **逐项留痕，一行窗口自上而下滚**（v3.29）。
             *
             * 三条用户口径叠起来就是这个形态：
             * ① 「每成功识别一项，后面要出现一个圆形对勾」⇒ 认完的项**逐条留在串里**（不再被下一项顶掉）；
             * ② 「**始终只展示一行识别项，然后一行内容上下滚动**」⇒ 窗口固定 **一行高**（20px），
             *    串整体上移 `(项数 - 1) × 20px`，让**最新那一项**停在窗口里 ——
             *    每多认完一项，整串往上滚一格（CSS transition 出那个滚动感）。
             *    行高因此恒定，识别区里能同时看到更多封；
             * ③ 「这里**不需要「待归属匹配」**，只展示智能识别的事项」⇒ 还没轮到的项**不占位**、
             *    也不写「待×××」；窗口里只有**真实发生过的**：已认完 / 失败 / 正在认。
             *
             * 失败项**不能打勾**（那是在说谎）：红字 + 红叉，原因挂在整项悬停里。
             */}
            <span className="recog-board__steps">
              <span
                className="recog-board__stepsInner"
                style={{ transform: `translateY(-${Math.max(0, r.shown.length - 1) * 20}px)` }}
              >
                {r.shown.map((s) => (
                  <span
                    key={s.key}
                    className={
                      s.status === 'failed'
                        ? 'recog-board__step is-failed'
                        : s.status === 'running'
                          ? 'recog-board__step is-current'
                          : 'recog-board__step'
                    }
                    /* 失败原因挂整项悬停（不塞进行内 —— 那会把行撑得很长） */
                    title={
                      s.status === 'failed'
                        ? (r.task.failReason ?? '识别失败，可在下方列表「重新识别」')
                        : undefined
                    }
                  >
                    {s.label}
                    {s.status === 'failed' ? (
                      <CloseCircleOutlined className="recog-board__mark is-failed" />
                    ) : s.status === 'done' ? (
                      <CheckCircleOutlined className="recog-board__mark" />
                    ) : null}
                  </span>
                ))}
              </span>
            </span>

            {r.task.status === 'failed' && (
              <Button
                type="link"
                size="small"
                className="recog-board__retry"
                style={{ padding: 0, height: 'auto', fontSize: 13, marginLeft: 4 }}
                icon={<ReloadOutlined />}
                onClick={() => dispatch({ type: 'RETRY_TASK', taskId: r.task.id })}
              >
                重试
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
