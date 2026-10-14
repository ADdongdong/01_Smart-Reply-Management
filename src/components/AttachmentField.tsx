import { Button, Upload } from 'antd'
import {
  CloseOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileUnknownOutlined,
  PaperClipOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { CURRENT_USER } from '@/store/AppStore'
import { attachmentFromFile, attachmentKindOf, formatFileSize } from '@/utils/attachment'
import type { ReplyAttachment } from '@/types'

/**
 * 一个**上传类字段**的通用行（v3.33）。
 *
 * ## 为什么抽成组件
 *
 * 两个上传字段（替代性测试文件 / 差异调节表）要出现在**两个地方**
 * （「回函结果填写」页、核验页「回函结果补充」项），且读写**同一份数据**
 * （`ReplyResultInfo` 的两个附件数组）。若两处各写一套，
 * 迟早出现"这边能删除、那边只能看"这类不一致 —— 收成一个组件，一处改两处同变。
 *
 * ⚠️ **第三个字段曾经也在这里**：「拟执行的进一步核查程序及底稿指引」v3.33 时是"上传 Excel"，
 * v3.34 按用户口径（「**是文本框输入，不是上传附件**」）改成了普通多行文本，
 * 数据字段也从 `procedureFiles` 换成了 `procedureNote` —— 它不再走本组件。
 * 两处（结果页 / 核验页第 4 项）都用 `Input.TextArea` 渲染它。
 *
 * ## 交互口径
 *
 * · 选文件立刻入列（`beforeUpload` 返回 `false` 拦下真实上传，只把元信息收进来），
 *   和本页另两个字段原先的行为一致：**不跳转、不转圈、不打断填表**；
 * · 已上传件**逐条列出**文件名 / 大小 / 上传人 / 时间，右侧一枚删除 ——
 *   用户口径是"落库并回显"，那么"回显"就要回显到能认出是哪一个文件、谁什么时候传的；
 * · 图标按扩展名给（PDF / 表格 / 图片 / 其它），一眼分辨，不必眯着眼读文件名。
 *
 * 不显示 antd 自带的 `fileList`（`showUploadList={false}`）：它会把"上传中/失败"这类
 * 真实上传才有的状态带进来，而这个原型里文件根本没离开浏览器，显示那些状态是假的。
 */
export default function AttachmentField({
  label,
  actionText,
  accept,
  multiple = true,
  files,
  onChange,
  emptyHint,
  labelWidth,
}: {
  /** 字段名（与结果页表单上逐字一致） */
  label: string
  /** 上传按钮文案，如「上传附件（支持 PDF / Excel）」 */
  actionText: string
  /** 允许的扩展名，如 `.pdf,.xls,.xlsx` —— 同时过滤系统文件选择器 */
  accept?: string
  multiple?: boolean
  files: ReplyAttachment[]
  onChange: (next: ReplyAttachment[]) => void
  /** 一件都没有时的一句说明（可选） */
  emptyHint?: string
  /**
   * 标签列宽（px）—— 传了就按**结果页表单口径**排（定宽标签、右对齐、色用二级墨色），
   * 与同页其它字段（差异说明、底稿指引等）对齐；不传则是核验页的紧凑口径（标签随内容、左对齐）。
   * 两种口径只差这几个值，故不另做一套组件。
   */
  labelWidth?: number
}) {
  const kindIcon = (name: string) => {
    const kind = attachmentKindOf(name)
    if (kind === 'pdf') return <FilePdfOutlined />
    if (kind === 'excel') return <FileExcelOutlined />
    if (kind === 'image') return <FileImageOutlined />
    return <FileUnknownOutlined />
  }

  return (
    <div className="attach-field">
      <span
        className="attach-field__label"
        style={
          labelWidth
            ? { width: labelWidth, flex: 'none', textAlign: 'right', color: 'var(--c-text-2)' }
            : undefined
        }
      >
        {label}
      </span>
      <div className="attach-field__body">
        <Upload
          accept={accept}
          multiple={multiple}
          showUploadList={false}
          beforeUpload={(file) => {
            /*
             * 不真上传，只收元信息 —— `false` 是 antd 的"阻止默认上传"约定。
             * 时间口径与全站留痕一致（`YYYY-MM-DD HH:mm:ss`）；同一批多选时逐个记，
             * 时间会差几百毫秒，但显示到秒后看不出来，不值得为它写一次时间快照。
             */
            onChange([
              ...files,
              attachmentFromFile(
                file as unknown as File,
                CURRENT_USER,
                dayjs().format('YYYY-MM-DD HH:mm:ss'),
              ),
            ])
            return false
          }}
        >
          <Button size="small" icon={<PaperClipOutlined />}>
            {actionText}
          </Button>
        </Upload>

        {files.length > 0 ? (
          <ul className="attach-field__list">
            {files.map((f, i) => (
              <li className="attach-field__item" key={`${f.name}-${f.at}-${i}`}>
                <span className="attach-field__icon" aria-hidden="true">
                  {kindIcon(f.name)}
                </span>
                <span className="attach-field__name" title={f.name}>
                  {f.name}
                </span>
                <span className="attach-field__meta">
                  {formatFileSize(f.size)} · {f.by} · {f.at}
                </span>
                <button
                  type="button"
                  className="attach-field__del"
                  aria-label={`移除附件 ${f.name}`}
                  title="移除"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                >
                  <CloseOutlined />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          emptyHint && <span className="attach-field__empty">{emptyHint}</span>
        )}
      </div>
    </div>
  )
}
