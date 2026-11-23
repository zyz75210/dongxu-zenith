// 应用内的数据模型与初始值

// 日程分类：跳绳（核心）/ 体能（辅助）/ 跑步 / 休息
// 「休息」不是偷懒——它是计划内的一部分，勾完成同样算打卡，避免用户为不断签而硬练
export type ScheduleType =
  | 'rope' | 'fitness' | 'run' | 'rest';

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
