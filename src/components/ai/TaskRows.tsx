import { useState } from 'react'
import { DownOutlined } from '@ant-design/icons'

/**
 * 任务行与展开轨迹（v2.57）—— 智能识别界面的主体。
 *
 * 形态取自 beautifului.dev 的 **Task Rows**（running / failed / completed + 进度）与
 * **Thinking**（可展开的推理轨迹）。
 *
 * ## 折叠优先
 *
 * **默认只渲染一行**（状态 + 名称 + 结论摘要 + 耗时），点开才渲染依据明细。
 * 两个理由：
 * · 一份回函有 4–6 个检测点、多封又是多段，全部铺开会一屏塞不下；
 * · 需求文档的口径是「**AI 的核查内容必须全暴露**」——"全暴露"指**可查全**、
 *   不是"一次性全铺"；折叠态的结论 + 展开态的依据，两者的并集才是全暴露。
 *
 * ## 按函证分组（v2.61 修正）
 *
 * 用户看到一屏 18 项（3 封 × 6 项）后问：「**很多重复的识别项，那具体是在识别哪个函证**」。
 * 平铺是对的（同一套检测逐封跑），**错的是没分段** —— 用户无从判断"这一行属于哪一封"，
 * 于是看起来像列表出了错。
 * 故改为 **`TaskGroups`：每个功能分组一张卡，卡头是该函证的编号 + 被询证单位 + 它自己的结论**，
 * 组内才是 6 个检测点。这样"在识别哪个函证"由**卡头**回答，不再需要用户推断。
 */
export interface TaskRowItem {
  id: string
  /** 名称，如「询证事项逐项核对」 */
  label: string
  status: 'running' | 'failed' | 'completed' | 'waiting'
  /** 运行中的进度（0–100）；有条光带自左扫到此处 */
  percent?: number
  /** 右侧一行结论摘要，如「2 项差异」 */
  verdict?: string
  /** 耗时（毫秒）—— 慢环节的安抚信息（MinerU 那一环最慢） */
  elapsedMs?: number
  /** 展开后才渲染的依据明细（每行一条） */
  details?: string[]
}

/** 一个「功能分组」= 一封函证的整套检测 */
export interface TaskGroup {
  id: string
  /** 组标题主文案：函证编号 · 被询证单位（回答"在识别哪个函证"） */
  title: string
  /** 组副文案：页区间 / 回函次序等定位信息 */
  subtitle?: string
  /**
   * 该函证自己的结论（相符 / 不相符 / 待人工判定 / 识别中）。
   * **给在组头**而不是只给一张全局结论卡 —— 多封时全局卡无法回答"这个不相符是谁的"。
   */
  verdict?: { text: string; tone: 'high' | 'low' | 'neutral' | 'running' }
  rows: TaskRowItem[]
}

/** 耗时展示：>1s 用秒并保留一位小数，否则用毫秒 */
function fmtElapsed(ms?: number): string {
  if (ms == null) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function StatusMark({ status }: { status: TaskRowItem['status'] }) {
  const cls =
    status === 'running'
      ? 'in-status in-status--running'
      : status === 'failed'
        ? 'in-status in-status--failed'
        : status === 'completed'
          ? 'in-status in-status--done'
          : 'in-status in-status--waiting'
  return <span className={cls} aria-hidden="true" />
}

function TaskRow({ item }: { item: TaskRowItem }) {
  const [open, setOpen] = useState(false)
  const expandable = !!item.details?.length
  const running = item.status === 'running'

  return (
    <div className="task-row">
      <button
        type="button"
        className="task-row__head"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <StatusMark status={item.status} />
        <span className="task-row__label">{item.label}</span>

        {item.verdict && <span className="task-row__verdict">{item.verdict}</span>}

        {item.elapsedMs != null && (
          <span className="task-row__time in-num">{fmtElapsed(item.elapsedMs)}</span>
        )}

        {expandable && (
          <DownOutlined
            style={{
              fontSize: 10,
              color: 'var(--in-text-3)',
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 180ms var(--ease-out)',
            }}
          />
        )}
      </button>

      {/*
       * 运行中的进度光带 —— 只在"还没干完"时出现。
       * 完成后不再保留（光带停在 100% 只会让人以为还在跑），
       * 那时耗时数字已经接替它说明"花了多久"。
       */}
      {running && (
        <div className="sweep-track" style={{ marginBottom: 10 }}>
          <span
            className="sweep-bar is-running"
            style={{ ['--p' as string]: item.percent ?? 0 }}
          />
        </div>
      )}

      {open && expandable && (
        <div className="task-row__detail">
          {item.details!.map((line) => (
            <span key={line} className="task-row__detail-line">
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 一行小统计：几项检测 / 几项要关注 / 合计耗时 —— 挂在组头上，让人不必展开就知道这封的体量 */
function groupSummary(rows: TaskRowItem[]): string {
  const warn = rows.filter((r) => r.status === 'failed').length
  const total = rows.reduce((n, r) => n + (r.elapsedMs ?? 0), 0)
  const parts = [`${rows.length} 项检测`]
  if (warn) parts.push(`${warn} 项需关注`)
  if (total) parts.push(fmtElapsed(total))
  return parts.join(' · ')
}

function TaskGroupCard({ group }: { group: TaskGroup }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="insight-card">
      {/* 组头 = 「在识别哪一封」的答案：函证编号 + 被询证单位 + 该封自己的结论 */}
      <button
        type="button"
        className="group-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="group-head__main">
          <span className="group-head__title">{group.title}</span>
          {group.subtitle && <span className="group-head__sub in-num">{group.subtitle}</span>}
        </span>

        {group.verdict && (
          <span
            className={
              group.verdict.tone === 'high'
                ? 'group-verdict is-high'
                : group.verdict.tone === 'low'
                  ? 'group-verdict is-low'
                  : group.verdict.tone === 'running'
                    ? 'group-verdict is-running'
                    : 'group-verdict'
            }
          >
            {group.verdict.text}
          </span>
        )}

        <span className="group-head__meta in-num">{groupSummary(group.rows)}</span>
        <DownOutlined
          style={{
            fontSize: 10,
            color: 'var(--in-text-3)',
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 180ms var(--ease-out)',
          }}
        />
      </button>

      {open && (
        <div className="group-body">
          {group.rows.map((it) => (
            <TaskRow key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskGroups({ groups }: { groups: TaskGroup[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map((g) => (
        <TaskGroupCard key={g.id} group={g} />
      ))}
    </div>
  )
}

/** 兼容旧调用（单组、无分头的场合）—— 直接把 items 当一组渲染 */
export function TaskRows({ items }: { items: TaskRowItem[] }) {
  return (
    <div className="insight-card">
      {items.map((it) => (
        <TaskRow key={it.id} item={it} />
      ))}
    </div>
  )
}
