// 日期工具：真实日历计算（周一开头，ISO 周数）

export type Cell = {
  day: number;
  // prev = 上月补位日期，cur = 本月日期
  type: 'prev' | 'cur';
};

/** 生成某个月的日历格子：首行用上月末尾日期补齐，末尾不补下月 */
export function buildMonthCells(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=周日，换算成 0=周一
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: Cell[] = [];

  // 上月补位
  for (let i = firstWeekday; i > 0; i--) {
    cells.push({ day: daysInPrevMonth - i + 1, type: 'prev' });
  }

  // 本月日期
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, type: 'cur' });
  }

  return cells;
}

/** ISO 8601 周数 */
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** 是否同一天 */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** 星期下标：0=周一 ... 6=周日 */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** 日期键：YYYY-MM-DD，用于按天归档日程 */
export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** Date 对象转日期键 */
export function dateKeyOf(date: Date): string {
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 日期键转回 { y, m(0-11), d } */
export function parseDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: (m || 1) - 1, d: d || 1 };
}

/**
 * 解析搜索栏里手输的日期。
 *
 * 只认「年 月 日」三段：2025.11.25 / 2025-11-25 / 2025/11/25 / 20251125 都能吃。
 * 提示语里给的是点号写法（手机上打点最顺手），但短横、斜杠、纯 8 位也照样认，
 * 没必要为了统一格式让人重打一遍。
 *
 * 返回 null = 这不是一个真实存在的日期（2025.2.30、2025.13.1 都会被挡掉）。
 * 注意 m 是 0-11，和 App 里到处用的 month 下标一致。
 */
export function parseDateInput(raw: string): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  if (!s) return null;

  let parts: number[];
  if (/[./\-\s年月日]/.test(s)) {
    // 有分隔符：按分隔符切（中英文年月日也认）
    parts = s.split(/[./\-\s年月日]+/).filter(Boolean).map(Number);
  } else if (/^\d{8}$/.test(s)) {
    // 一串 8 位数字：按 YYYYMMDD 硬切
    parts = [Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))];
  } else {
    return null;
  }

  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const [y, m, d] = parts;
  if (y < 1900 || y > 2999) return null;
  if (m < 1 || m > 12) return null;
  // 当月 0 号 = 上个月最后一天，正好是「这个月有几天」
  if (d < 1 || d > new Date(y, m, 0).getDate()) return null;
  return { y, m: m - 1, d };
}

/**
 * 连续完成天数：从今天往前数，连续每天至少有一条已完成日程。
 * 今天还没完成不算断掉（一天才刚开始，不该罚），从昨天接着往前数。
 */
export function completedStreak(dates: string[]): number {
  const set = new Set(dates);
  if (set.size === 0) return 0;

  const cur = new Date();
  if (!set.has(dateKeyOf(cur))) cur.setDate(cur.getDate() - 1);

  let n = 0;
  while (set.has(dateKeyOf(cur))) {
    n += 1;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}

/** "HH:mm" 转当天分钟数，用于按时间排序 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 一条日程「算不算完成」的统一判定。
 *
 * 休息日不需要用户勾选：休息这个动作本身就是「不做事」，
 * 让用户去点一次「我完成了休息」，语义是拧的。所以休息日只要日期到了就算完成。
 * 未来的休息日还没发生，不算完成。
 *
 * 全 App 的统计（连续打卡、本周完成数、报告完成率）都必须走这里，
 * 否则会出现「卡片显示未完成，但连续天数算了一天」这种自相矛盾。
 */
export function isFinished(
  s: { type: string; date: string; completed?: boolean },
  todayKey: string,
): boolean {
  if (s.type === 'rest') return s.date <= todayKey;
  return s.completed === true;
}
