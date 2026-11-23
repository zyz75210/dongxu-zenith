// 应用内的数据模型与初始值

// 日程分类：跳绳（核心）/ 体能（辅助）/ 跑步 / 休息
// 「休息」不是偷懒——它是计划内的一部分，勾完成同样算打卡，避免用户为不断签而硬练
export type ScheduleType =
  | 'rope' | 'fitness' | 'run' | 'rest';

/**
 * 重复频率。只在「保存那一刻」有意义：
 * 上层会按它把一条日程展开成多条具体日期的实例，实例本身不再带这个字段。
 * 这样日历、连续天数、本周进度、报告页全部零改动 —— 它们只认 date。
 */
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

/**
 * 重复覆盖的时长：接下来一整年。
 * 每天 = 365 条、每周 = 53 条、每月 = 13 条（都含起始那天）。
 * 一年的量对训练打卡刚好：够长到能形成习惯，又不至于把日历填到三年后。
 */
export const REPEAT_SPAN_DAYS = 365;

export const REPEAT_WORD: Record<Repeat, string> = {
  none: '',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

export type Schedule = {
  id: string;
  /** 所属日期：YYYY-MM-DD */
  date: string;
  title: string;
  start: string; // HH:mm
  end: string;   // HH:mm
  type: ScheduleType;
  tag?: string;
  note?: string;
  remind?: boolean;
  /** 是否已完成：详情页圆形按钮切换 */
  completed?: boolean;
  /**
   * 重复频率。落库后实例上也会保留这个字段：
   * 详情页要据此判断「这是一条每天/每周/每月的日程」，从而在删除时问"删整串还是删这一天"。
   */
  repeat?: Exclude<Repeat, 'none'>;
  /** 同一批重复日程共享的系列 id，单条日程没有 */
  seriesId?: string;
};

/** 个人资料：由 App.tsx 持有，"我的"页和编辑页共用一个来源；已随日程一起持久化 */
export type Profile = {
  name: string;
  /** 个人昵称：显示在"我的"页名字下方 */
  nickname: string;
  email: string;
  /** 生日：m 为 0-11 */
  birthday: { y: number; m: number; d: number };
  /** 相册选中的图片 uri；为空则用内置头像 */
  avatar?: string;
};

export const initialProfile: Profile = {
  name: '沈知遥',
  nickname: '产品设计师',
  email: 'zhiyao.shen@mail.com',
  birthday: { y: 1997, m: 10, d: 2 },
};

/**
 * 首次启动（磁盘上还没有存过数据）时的日程：空的，让用户自己录入。
 * 之后一律从 src/storage.ts 读回，这两个初始值只在「首次安装 / 数据损坏」时兜底。
 */
export const initialSchedules: Schedule[] = [];
