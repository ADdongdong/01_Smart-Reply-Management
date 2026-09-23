import { Empty, Table } from 'antd'
import type { RecognitionTask } from '@/types'
import { ASSIGN_SOURCE_LABEL } from '@/services/bankMatch'
import { splitIssuesOf } from '@/utils/pageRange'
import { pageRangeOf } from '@/utils/pageRange'

/**
 * 切分结果表（v2.56）—— 「归属匹配」页里展示**这份上传回函被切成了哪几段、各归到哪封函证**。
 *
 * ## 为什么它必须在这一步出现
 *
 * 识别工作台此前只给一行归属结论（`已归属：QS2024-031 · 齐商银行股份有限公司`），
 * 用户看不到**切分本身**。而银行回函是**一次寄来多封**的（一个 11 页的 PDF 里
 * 装着 3 封不同银行 / 支行的回函），「切得对不对」是归属这一步最需要核对的依据 ——
 * 只看一行结论，用户无从判断「那我这份文件里的第 5-8 页归到哪去了」。
 *
 * ## 与「识别队列」（左栏）的分工
 *
 * · **识别队列**按**任务**列出所有批次的待办（跨文件），回答「我有哪些要处理」；
 * · **本表**按**文件**列出该文件切成的那几段，回答「这份文件的每一页都去哪了」。
 *   两者角度不同，不是重复（同 v2.52 对"同一动作只给一个入口"的判据 —— 职责不同层）。
 *
 * ## 为什么同时给「连续性提示」
 *
 * 切分本应无缝无重叠（1-4 / 5-8 / 9-11），但**归属是人工可改的**（可改派、可指定），
 * 改完就可能出现断档或重复；这类错误不看原件根本发现不了，用户只会觉得
 * 「这封回函怎么少了一页」。故用 `splitIssuesOf` 算出问题并显式提示。
 */
export default function SplitResultTable({
  tasks,
  activeTaskId,
  onSelect,
}: {
  /** **同一上传文件**切出的全部任务（顺序不影响，内部按起始页排序） */
  tasks: RecognitionTask[]
  /** 当前正在查看的那一段 */
  activeTaskId: string
  onSelect: (taskId: string) => void
}) {
  const sorted = [...tasks].sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0))
  const issues = splitIssuesOf(tasks)

  return (
    <div>
      <Table<RecognitionTask>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={sorted}
        onRow={(r) => ({ onClick: () => onSelect(r.id), style: { cursor: 'pointer' } })}
        rowClassName={(r) => (r.id === activeTaskId ? 'row-active' : '')}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别出分段" /> }}
        columns={[
          {
            title: '切分页数',
            key: 'pages',
            width: 84,
            render: (_, r) => <span className="num">{pageRangeOf(r)}</span>,
          },
          {
            title: '函证编号',
            dataIndex: 'confirmationNo',
            width: 106,
            render: (no: string) =>
              no === '待指定' ? (
                <span className="muted">待指定</span>
              ) : (
                <span className="num">{no}</span>
              ),
          },
          {
            /*
             * 未归属时这里为空 —— 识别到的银行名称（人工判断「该归到谁」的依据）
             * 在归属页的「归属匹配」区与候选表里给，本表只回答「这几页归到哪封」。
             */
            title: '被询证单位',
            dataIndex: 'matchedEntity',
            /* 银行名称可能很长（「齐商银行股份有限公司张店支行」），超宽截断交给悬停 */
            ellipsis: true,
            render: (v: string | undefined) =>
              v && v !== '—' ? (
                <span style={{ color: 'var(--c-text-1)' }}>{v}</span>
              ) : (
                <span className="muted">—</span>
              ),
          },
          {
            title: '归属状态',
            key: 'assign',
            width: 96,
            render: (_, r) =>
              r.assignSource ? (
                <span style={{ color: 'var(--c-risk-low-text)' }}>{ASSIGN_SOURCE_LABEL[r.assignSource]}</span>
              ) : r.status === 'failed' ? (
                <span style={{ color: 'var(--c-risk-high-text)' }}>归属失败</span>
              ) : (
                <span style={{ color: 'var(--c-text-3)' }}>待人工确认</span>
              ),
          },
        ]}
      />

      {/*
       * 切分连续性提示 —— 只在有问题时出现（正常切分不该多一行字）。
       * 这是「不看原件发现不了的错误」，值得显式说。
       */}
      {issues.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--c-risk-high-text)' }}>
          {issues.map((t) => (
            <div key={t}>· {t}</div>
          ))}
        </div>
      )}
    </div>
  )
}
