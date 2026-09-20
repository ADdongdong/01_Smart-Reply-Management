import { App, Button, Drawer, Table, Tag, Tooltip } from 'antd'
import { FileExcelOutlined, InfoCircleOutlined, WarningFilled } from '@ant-design/icons'
import { useApp } from '@/store/AppStore'
import type { ExpressMatchRow } from '@/types'

/**
 * 快递数据导入结果 —— 不做步骤化处理，直接给出匹配代入结果。
 *
 * 快递 Excel 不涉及切分与二维码识别，导入后按运单号与回函面单识别出的单号匹配，
 * 命中即把快递详细信息写入对应函证。
 */
export default function ExpressImportDrawer() {
  const { message } = App.useApp()
  const { state, dispatch } = useApp()
  const r = state.expressResult

  return (
    <Drawer
      title="快递数据导入结果"
      width={900}
      open={state.expressOpen}
      onClose={() => dispatch({ type: 'CLOSE_EXPRESS' })}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
            {r && (
              <>
                已代入 <b className="num">{r.matchedCount}</b> 条快递信息
                {r.unmatchedCount > 0 && (
                  <span style={{ color: 'var(--c-risk-high)' }}>
                    　{r.unmatchedCount} 条未能匹配，需人工确认
                  </span>
                )}
              </>
            )}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <Button onClick={() => dispatch({ type: 'CLOSE_EXPRESS' })}>关闭</Button>
          <Button
            type="primary"
            disabled={!r || r.matchedCount === 0}
            onClick={() => {
              message.success(`已将 ${r?.matchedCount} 条快递信息代入对应函证`)
              dispatch({ type: 'CLOSE_EXPRESS' })
            }}
          >
            确认代入
          </Button>
        </div>
      }
    >
      {!r ? (
        <div className="muted" style={{ fontSize: 14 }}>暂无导入记录</div>
      ) : (
        <>
          {/* 摘要行 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: 8,
              background: 'var(--c-fill-light)',
              marginBottom: 12,
            }}
          >
            <FileExcelOutlined style={{ color: 'var(--c-risk-low)', fontSize: 18 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r.fileName}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {r.fileSize} · 导入时间 {r.importedAt}
              </div>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: 13 }}>
              <span>
                解析 <b className="num">{r.totalRows}</b> 行
              </span>
              <span style={{ color: 'var(--c-risk-low)' }}>
                成功代入 <b className="num">{r.matchedCount}</b> 条
              </span>
              <span style={{ color: r.unmatchedCount ? 'var(--c-risk-high)' : 'var(--c-text-3)' }}>
                未匹配 <b className="num">{r.unmatchedCount}</b> 条
              </span>
            </div>
          </div>

          {/* 匹配规则说明 */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
              fontSize: 13,
              color: 'var(--c-text-2)',
              lineHeight: 1.9,
              marginBottom: 12,
            }}
          >
            <InfoCircleOutlined style={{ color: 'var(--c-text-3)', marginTop: 4 }} />
            <span>
              匹配规则：以<b>运单号</b>为纽带 —— 回函面单识别出的单号已与函证编号建立对应，
              此处按同一运单号把快递详细信息（快递公司 / 发件人 / 电话 / 地址）写入对应函证。
            </span>
          </div>

          <Table<ExpressMatchRow>
            size="small"
            rowKey="id"
            dataSource={r.rows}
            pagination={false}
            scroll={{ x: 900 }}
            rowClassName={(row) => (row.status === 'unmatched' ? 'row-risk-high' : '')}
            columns={[
              {
                title: '运单号',
                dataIndex: 'expressNo',
                width: 150,
                render: (v: string) => <span className="num">{v}</span>,
              },
              { title: '快递公司', dataIndex: 'expressCompany', width: 96 },
              { title: '发件人', dataIndex: 'sender', width: 76 },
              {
                title: '联系电话',
                dataIndex: 'phone',
                width: 110,
                render: (v: string) => <span className="num">{v}</span>,
              },
              { title: '发件地址', dataIndex: 'address', ellipsis: true },
              {
                title: '归属函证',
                width: 190,
                render: (_, row) =>
                  row.status === 'matched' ? (
                    <span>
                      <span className="num">{row.matchedConfirmationNo}</span>
                      <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                        {row.matchedEntity}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  ),
              },
              {
                title: '匹配结果',
                dataIndex: 'status',
                width: 100,
                render: (s: ExpressMatchRow['status'], row) =>
                  s === 'matched' ? (
                    <Tag
                      style={{
                        marginInlineEnd: 0,
                        fontSize: 12,
                        border: 'none',
                        color: 'var(--c-risk-low-text)',
                        background: 'var(--c-risk-low-bg)',
                      }}
                    >
                      ✔ 已代入
                    </Tag>
                  ) : (
                    <Tooltip title={row.reason}>
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          fontSize: 12,
                          border: 'none',
                          color: 'var(--c-text-1)',
                          background: 'var(--c-risk-high-bg)',
                          cursor: 'help',
                        }}
                      >
                        <WarningFilled /> 未匹配
                      </Tag>
                    </Tooltip>
                  ),
              },
            ]}
          />

          {r.unmatchedCount > 0 && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.9 }}>
              <WarningFilled style={{ color: 'var(--c-risk-high)', marginRight: 6 }} />
              未匹配的记录通常有两种原因：该函证尚未上传回函（面单未识别），或运单号填写有误。
              可核对后重新导入，或对相应函证执行「资料录入」手工补填。
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
