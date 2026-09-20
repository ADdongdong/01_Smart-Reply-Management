import { useEffect, useMemo, useState } from 'react'
import { Button, Spin, Tooltip } from 'antd'
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import { buildKkPreviewUrl } from '@/config/preview'

/**
 * KKFileView 预览（**当前未启用，保留备用**）。
 *
 * 只负责把文件地址交给 KKFileView，由它完成格式转换与渲染
 * （Office 转 PDF、图片、PDF 内嵌等）。原型中的文件由 Vite dev server
 * 从 `public/samples/` 提供，容器经 `host.docker.internal` 回访拉取。
 *
 * **为何不再用于回函预览**：它是第三方 iframe（内部自渲染、跨域），
 * 无法在其内容上叠加坐标批注层，且与 pdf.js 渲染的观感不一致
 * （带自己的工具栏 / 缩放条，两个视图对比时会跳）。
 * 现由 `AnnotatedPdfPreview`（pdf.js 自渲染 + 批注叠加层）统一承载
 * 「原始文件 / AI 批注」两个视图，共用同一画布。
 *
 * 保留用途：后续若需预览 pdf.js 不支持的格式（Word / Excel 等），可再启用本组件。
 */
export default function KkFilePreview({
  fileUrl,
  height = 430,
}: {
  /** 文件的 HTTP 地址（须为 KKFileView 容器可访问的地址） */
  fileUrl: string
  height?: number
}) {
  const src = useMemo(() => buildKkPreviewUrl(fileUrl), [fileUrl])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // 切换文件或手动重载时复位加载态
  useEffect(() => {
    setLoading(true)
    // iframe 加载失败不会触发 onLoad，超时兜底收起遮罩，避免一直转圈
    const timer = window.setTimeout(() => setLoading(false), 10000)
    return () => window.clearTimeout(timer)
  }, [src, nonce])

  return (
    <div
      style={{
        position: 'relative',
        height,
        background: '#fff',
        borderRadius: 8,
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
      }}
    >
      <iframe
        key={nonce}
        title="KKFileView 文件预览"
        src={src}
        onLoad={() => setLoading(false)}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />

      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: 'rgba(255,255,255,0.92)',
          }}
        >
          <Spin size="small" />
          <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
            KKFileView 正在转换并加载文件…
          </span>
        </div>
      )}

      {/* 预览工具条 —— 避开 KKFileView 自带的顶部工具栏 */}
      <div
        style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          display: 'flex',
          gap: 2,
          padding: '2px 4px',
          borderRadius: 4,
          background: 'rgba(255,255,255,0.92)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <Tooltip title="重新加载">
          <Button
            type="text"
            size="small"
            aria-label="重新加载预览"
            style={{ width: 24, height: 24, minWidth: 24, padding: 0 }}
            icon={<ReloadOutlined style={{ fontSize: 13 }} />}
            onClick={() => setNonce((n) => n + 1)}
          />
        </Tooltip>
        <Tooltip title="在新窗口打开">
          <Button
            type="text"
            size="small"
            aria-label="在新窗口打开预览"
            style={{ width: 24, height: 24, minWidth: 24, padding: 0 }}
            icon={<ExportOutlined style={{ fontSize: 13 }} />}
            onClick={() => window.open(src, '_blank', 'noopener')}
          />
        </Tooltip>
      </div>
    </div>
  )
}
