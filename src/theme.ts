// 全局主题：所有配色集中在这里，改一处即可全局生效
export const C = {
  bg: '#FFFFFF',          // 页面白底
  soft: '#F7F8FA',        // 浅灰辅助底
  cardSoft: '#F2F5FC',    // 功能页大卡片浅蓝底
  primary: '#5B8DEF',     // 主强调蓝
  primaryDark: '#4A7CE0',
  text: '#202431',        // 主文字
  gray: '#9299A6',        // 次要文字
  line: '#EEF0F4',        // 分割线
  white: '#FFFFFF',

  // 已过去日期的四色完成状态（只有数字变色，无底色）
  done: '#16864A',        // 全部完成 绿
  halfUp: '#A87800',      // 完成一半以上 黄
  halfDown: '#C65B20',    // 完成一半以下 橙
  none: '#C43D3D',        // 完全未完成 红

  // 训练计划三大类颜色（跳绳 / 体能 / 跑步）
  typeDot: {
    rope: '#5CB85C',      // 跳绳 绿
    fitness: '#A78BFA',   // 体能 紫
    run: '#4A7CFF',       // 跑步 蓝
  },

  // 危险红：超时未完成 / 删除等警示色（独立于类型色，避免和训练色混淆）
  danger: '#F04438',
} as const;

// 星期的中文显示（设计稿是周一开头）
export const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
