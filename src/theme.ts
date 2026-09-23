import type { ThemeConfig } from 'antd'

/**
 * 设计令牌
 * ------------------------------------------------------------------
 * 四条主线（第 2、3 条于 v2.49 修正口径）：
 * 1. **单色系 + 红绿状态标签** —— 全站只有靛蓝一个色相（主操作、AI 产出、
 *    人工核验留痕共用主色），红与绿只出现在「风险等级 / 相符性」两类状态标签上；
 * 2. **文字层级用实色阶** —— ~~靠透明度~~。原先用 `rgba(29,33,41,.72/.6)` 拉层次，
 *    但在浅色底上字会与背景**混色**，观感发虚发灰、且没有继续加深的余地；
 *    改实色（`#5B6270` / `#7A808C`）后同等对比度下**更锐利**。
 *    （「界面发灰、没有质感」的首要来源就是这一条。）
 * 3. **阴影多层叠加 + 带色相** —— 沿用多层叠加；但不再用纯黑低透明度
 *    （黑影蒙在蓝灰底上会发灰扑扑），统一改用深蓝灰 `rgb(20,28,45)` 并提高量级，
 *    让阴影成为环境的一部分而不是「盖了一层灰」。线条量级同步上调一档。
 * 4. **字重分工** —— 正文 400 / 强调 500 / 标题 600（`fontWeightStrong` 由 500 提到 600）。
 *    ~~「层次靠字号与颜色，不堆字重」~~ —— 该口径会让标题与正文「一样重」、界面缺骨架。
 */
export const token = {
  colorPrimary: '#3B5BDB',
  colorRiskHigh: '#E5484D',
  colorRiskLow: '#3FA34D',
  colorTextPrimary: '#1D2129',
  /** 次级文字 —— 实色阶（等效原 rgba(29,33,41,.72)，对比度 6.3:1） */
  colorTextSecondary: '#5B6270',
  /** 三级文字 —— 实色阶（等效原 rgba(29,33,41,.60)，对比度 4.7:1，达 WCAG AA） */
  colorTextTertiary: '#7A808C',
  /** 控件边框（输入框 / 下拉 / 按钮） */
  colorBorder: '#DFE3EC',
  /** 极淡的结构线 */
  colorBorderLight: '#EAEDF4',
  /** 发丝线 —— 分隔线统一用它（量级由 .06 提到 .09） */
  colorHairline: 'rgba(16, 24, 40, 0.09)',
  colorFillLight: '#F7F9FC',
  /**
   * 页面底 —— **纯白**（v2.54，用户反馈「这个灰/蓝色太丑了」）。
   *
   * ⚠️ **必须与 `global.css` 的 `--c-bg-layout` 保持一致** —— 这个 token 供
   * antd 组件内部使用，CSS 变量供项目自绘样式使用，**两处都要改，只改一处会漏**
   * （本次就先漏了这个，是靠全库搜同类色值才捞出来的）。
   * 卡片边界改由阴影的第 1 层描边承担（见 `shadowCard`）。
   */
  colorBgLayout: '#FFFFFF',
  /** 圆角三级：卡片 / 控件 / 标签 */
  radiusCard: 8,
  radiusControl: 6,
  radiusTag: 4,
  rowHeight: 38,
  /**
   * 阴影 —— 每层偏移与模糊成比例递减，多层叠加。
   * 单层大模糊会显得「脏」，分层叠加才有物理级的干净过渡。
   * **色相**（v2.49）：统一用深蓝灰 `rgb(20,28,45)` 而非纯黑 —— 黑影蒙在蓝灰底上会发灰；
   * **量级**同步提高到 .06~.12，让卡片真正有边界。
   */
  shadowCard: [
    '0 0 0 1px rgba(20, 28, 45, 0.06)',
    '0 1px 2px -1px rgba(20, 28, 45, 0.1)',
    '0 2px 4px -1px rgba(20, 28, 45, 0.06)',
  ].join(', '),
  shadowHover: [
    '0 0 0 1px rgba(20, 28, 45, 0.08)',
    '0 1px 2px -1px rgba(20, 28, 45, 0.1)',
    '0 4px 8px -2px rgba(20, 28, 45, 0.1)',
    '0 8px 16px -4px rgba(20, 28, 45, 0.07)',
  ].join(', '),
  shadowPop: [
    '0 0 0 1px rgba(20, 28, 45, 0.06)',
    '0 1px 2px -1px rgba(20, 28, 45, 0.08)',
    '0 4px 8px -2px rgba(20, 28, 45, 0.08)',
    '0 8px 16px -4px rgba(20, 28, 45, 0.08)',
    '0 16px 24px -8px rgba(20, 28, 45, 0.1)',
    '0 32px 48px -16px rgba(20, 28, 45, 0.12)',
  ].join(', '),
  /** 自定义缓动 —— 起步果断、收尾极慢，比内置 ease-out 更有质量感 */
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
}

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: token.colorPrimary,
    colorSuccess: token.colorRiskLow,
    /** 「需关注」并入风险红档 —— 全站只用红/绿两种状态色（antd 内置 Alert/Tag 一并收敛） */
    colorWarning: token.colorRiskHigh,
    colorError: token.colorRiskHigh,
    colorInfo: token.colorPrimary,
    colorText: token.colorTextPrimary,
    colorTextSecondary: token.colorTextSecondary,
    colorTextTertiary: token.colorTextTertiary,
    colorBorder: token.colorBorder,
    colorBorderSecondary: token.colorBorderLight,
    /** antd 的分隔线（Tabs 下划线、Descriptions 等）统一走发丝线 */
    colorSplit: token.colorHairline,
    colorBgLayout: token.colorBgLayout,
    colorFillQuaternary: token.colorFillLight,
    borderRadius: token.radiusCard,
    borderRadiusSM: token.radiusTag,
    borderRadiusLG: token.radiusCard,
    fontSize: 14,
    fontFamily: token.fontFamily,
    controlHeight: 30,
    lineWidth: 1,
    motionEaseOut: token.easeOut,
    motionEaseInOut: token.easeOut,
    motionDurationMid: '0.18s',
    boxShadow: token.shadowHover,
    boxShadowSecondary: token.shadowPop,
    /**
     * 标题/强调字重 —— v2.49 由 500 提到 **600**。
     * 原口径「层次靠字号与颜色，不堆叠字重」会让标题与正文**一样重**、界面缺骨架；
     * 现在恢复三级分工：正文 400 / 强调 500 / 标题 600。
     */
    fontWeightStrong: 600,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      headerHeight: 52,
      headerPadding: '0 24px',
      bodyBg: token.colorBgLayout,
    },
    Table: {
      /** 表头铺极淡中性底（参照 Ant Design Pro 详情页） */
      headerBg: token.colorFillLight,
      headerColor: token.colorTextTertiary,
      headerSplitColor: 'transparent',
      cellPaddingBlock: 8,
      cellPaddingInline: 12,
      fontSize: 14,
      rowHoverBg: '#F7F9FC',
      /** 行分隔线压到极淡，真正的分隔靠留白与 hover */
      borderColor: token.colorBorderLight,
      headerBorderRadius: 8,
    },
    Card: {
      /** 卡片内边距略放宽，向 Ant Design Pro 详情页的呼吸感靠 */
      paddingLG: 20,
      headerFontSize: 15,
    },
    Tabs: {
      horizontalItemPadding: '6px 0',
      horizontalItemGutter: 16,
      titleFontSize: 13,
      inkBarColor: token.colorPrimary,
    },
    Button: {
      controlHeight: 30,
      paddingInline: 12,
      fontSize: 14,
      primaryShadow: 'none',
      defaultShadow: 'none',
      /** 默认按钮边框压淡，减少线条感 */
      defaultBorderColor: '#DFE3EC',
    },
    Input: { controlHeight: 30, activeShadow: 'none' },
    Select: { controlHeight: 30, optionSelectedBg: 'var(--c-primary-bg)' },
    DatePicker: { controlHeight: 30 },
    Menu: {
      itemHeight: 38,
      itemMarginInline: 6,
      itemBorderRadius: token.radiusControl,
    },
    Descriptions: {
      itemPaddingBottom: 8,
      /** 标签不再铺底色块，避免「方框套方框」 */
      labelBg: 'transparent',
    },
    Tag: { fontSizeSM: 11, lineHeightSM: 1.6, defaultBg: 'transparent' },
    Drawer: { paddingLG: 16, footerPaddingBlock: 12, footerPaddingInline: 16 },
    Progress: { defaultColor: token.colorPrimary },
    Segmented: { fontSize: 13, itemSelectedBg: '#FFFFFF' },
    Alert: { fontSize: 13, paddingContentHorizontal: 12, withDescriptionPadding: '10px 12px' },
    Form: { itemMarginBottom: 16, labelFontSize: 13 },
    Empty: { fontSize: 14 },
    Badge: { fontSize: 13 },
    Modal: { titleFontSize: 15, paddingContentHorizontal: 16 },
    Tooltip: { fontSize: 13 },
    List: { itemPadding: '12px 0' },
  },
}
