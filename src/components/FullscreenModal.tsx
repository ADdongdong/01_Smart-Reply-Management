import type { ReactNode } from 'react'
import { Modal } from 'antd'

/**
 * 全屏弹窗 —— 「查看 / AI 核验 / 资料录入 / 结果填写」四个业务入口统一复用。
 *
 * 形态：占满整个视口（100vw × 100vh）。因为全屏覆盖后遮罩不可见，
 * 关闭入口只剩右上角 ×、Esc 与底栏按钮三处 —— 三者都必须可用，不能把用户困住。
 *
 * 样式定义在 global.css 的 `.fs-modal` 作用域内，只作用于本组件，
 * 不影响新手引导、快递导入抽屉、智能识别工作台与 `modal.confirm`。
 */
export default function FullscreenModal({
  open,
  title,
  subtitle,
  extra,
  footer,
  onClose,
  children,
}: {
  open: boolean
  /** 标题（纯文本，样式由本组件统一控制） */
  title: ReactNode
  /** 标题旁的灰字补充说明，如「whzf0010001 · 广发证券股份有限公司」 */
  subtitle?: ReactNode
  /** 标题右侧内容，如风险标签 */
  extra?: ReactNode
  /** 底栏；不传则不渲染底栏区域 */
  footer?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={footer ?? null}
      rootClassName="fs-modal"
      width="100vw"
      keyboard
      maskClosable={false}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, flexShrink: 0 }}>{title}</span>
          {subtitle && (
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {subtitle}
            </span>
          )}
          {extra}
        </span>
      }
    >
      <div className="fs-body-inner">{children}</div>
    </Modal>
  )
}
