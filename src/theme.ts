import type { ThemeConfig } from 'antd'

/**
 * 设计令牌
 * ------------------------------------------------------------------
 * 三条主线：
 * 1. **单色系 + 红绿状态标签** —— 全站只有靛蓝一个色相（主操作、AI 产出、
 *    人工核验留痕共用主色），红与绿只出现在「风险等级 / 相符性」两类状态标签上；
 * 2. **文字层级靠透明度** —— 同一「墨色」拉开层次，不用第二种色相，
 *    避免蓝灰混排的浑浊感；
 * 3. **阴影多层叠加** —— 而非单层硬投影，堆出接近真实光照的柔和过渡；
 *    线条压到最低，层次感主要由留白与阴影承担。
 */
export const token = {
  colorPrimary: '#3B5BDB',
  colorRiskHigh: '#E5484D',
  colorRiskLow: '#3FA34D',
  colorTextPrimary: '#1D2129',
  /** 次级文字 —— 同色相降透明度（等效 #5C6068，对比度 6.4:1） */
  colorTextSecondary: 'rgba(29, 33, 41, 0.72)',
  /** 三级文字 —— 同色相降透明度（等效 #777A80，对比度 4.6:1，达 WCAG AA） */
  colorTextTertiary: 'rgba(29, 33, 41, 0.6)',
  /** 控件边框（输入框 / 下拉 / 按钮） */
  colorBorder: '#E4E8F0',
  /** 极淡的结构线 */
  colorBorderLight: '#F0F2F7',
  /** 发丝线 —— 分隔线统一用它 */
  colorHairline: 'rgba(16, 24, 40, 0.06)',
  colorFillLight: '#F7F9FC',
  colorBgLayout: '#F5F7FB',
  /** 圆角三级：卡片 / 控件 / 标签 */
  radiusCard: 8,
  radiusControl: 6,
  radiusTag: 4,
  rowHeight: 38,
  /**
   * 阴影 —— 每层偏移与模糊成比例递减，多层叠加。
   * 单层大模糊会显得「脏」，分层叠加才有物理级的干净过渡。
   */
  shadowCard: [
    '0 0 0 1px rgba(25, 28, 33, 0.05)',
    '0 1px 1px -0.5px rgba(0, 0, 0, 0.05)',
    '0 2px 3px -1px rgba(0, 0, 0, 0.06)',
  ].join(', '),
  shadowHover: [
    '0 0 0 1px rgba(25, 28, 33, 0.06)',
    '0 1px 1px -0.5px rgba(0, 0, 0, 0.05)',
    '0 3px 3px -1.5px rgba(0, 0, 0, 0.05)',
    '0 6px 6px -3px rgba(0, 0, 0, 0.05)',
  ].join(', '),
  shadowPop: [
    '0 0 0 1px rgba(0, 0, 0, 0.04)',
    '0 1px 1px -0.5px rgba(0, 0, 0, 0.04)',
    '0 3px 3px -1.5px rgba(0, 0, 0, 0.04)',
    '0 6px 6px -3px rgba(0, 0, 0, 0.05)',
    '0 12px 12px -6px rgba(0, 0, 0, 0.06)',
    '0 24px 24px -12px rgba(0, 0, 0, 0.07)',
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
    /** 减轻「粗体」使用量：层次靠字号与颜色，而不是堆叠字重 */
    fontWeightStrong: 500,
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
