import type { ReplyAttachment } from '@/types'

/**
 * 上传件的小工具（v3.33）。
 *
 * 三个上传类字段（替代性测试文件 / 差异调节表 / 拟执行的进一步核查程序及底稿指引）
 * 在「回函结果填写」页与核验页「回函结果补充」项**两处填报同一份数据**，
 * 所以"怎么把浏览器选的 File 变成落库的元信息""怎么把字节读成人话"这两件事收在这里，
 * 不许两处各写一遍（否则一处显示 1.2 MB、另一处显示 1234567 字节）。
 */

/**
 * 字节 → 人话（B / KB / MB）。
 *
 * 保留一位小数是刻意的：附件大小在这个场景里只需回答"是不是那种几十兆的大件"，
 * 不需要精确到字节；`.toFixed(1)` 也让 1234 B 与 1.2 KB 看起来是同一档量级。
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 浏览器 `File` → 落库用的附件元信息。
 *
 * **只取元信息、不读内容**：原型没有上传服务，我们要的是"传了哪个文件、多大、谁传的、
 * 什么时候"—— 足以回显与判定完成度；把二进制塞进 state 既没必要，也会让
 * localStorage / 控制台快照变得不可读。
 *
 * `by` / `at` 由调用方传入（与全站的留痕口径一致：`CURRENT_USER` + `YYYY-MM-DD HH:mm:ss`），
 * 不在这里偷偷取当前时间 —— 那样将来想改成"以服务端时间为准"时找不到入口。
 */
export function attachmentFromFile(file: File, by: string, at: string): ReplyAttachment {
  return { name: file.name, size: file.size, by, at }
}

/** 按扩展名给一枚图标语义（回显时一眼认出是 PDF 还是表格） */
export function attachmentKindOf(name: string): 'pdf' | 'excel' | 'image' | 'other' {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'excel'
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'image'
  return 'other'
}
