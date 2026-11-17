// 应用内的数据模型与初始值

// 日程六大分类：工作 / 运动 / 学习 / 活动 / 重要 / 其他
export type ScheduleType =
  | 'work' | 'sport' | 'study' | 'activity' | 'important' | 'other';

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
};

/** 个人资料：目前存在内存里，"我的"页和编辑页共用一个来源 */
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

/** 首次启动的日程：空的，让用户自己录入（本地还没有持久化，关掉 App 会回到这里） */
export const initialSchedules: Schedule[] = [];
