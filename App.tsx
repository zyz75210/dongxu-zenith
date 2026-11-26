import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState, BackHandler, Keyboard, Platform,
  SafeAreaView, StatusBar, StyleSheet, View,
} from 'react-native';
import { C } from './src/theme';
import { MOTION } from './src/motion';
import { initialSchedules, initialProfile, Profile, Schedule, REPEAT_WORD } from './src/data';
import { loadPersistedData, savePersistedData } from './src/storage';
import {
  checkNotifyHealth, consumeFreshGrant, deviceBrand, isWithinLeadWindow, needsBatteryHint,
  openAppSystemSettings, REMIND_MINUTES, syncReminders,
} from './src/notifications';
import { parseDateKey, dateKeyOf, completedStreak, isFinished, timeToMinutes, repeatDates } from './src/utils/date';
import { completeTick } from './src/utils/haptics';
import BottomNav, { TabKey } from './src/components/BottomNav';
import DatePickerSheet from './src/components/DatePickerSheet';
import DurationPickerSheet from './src/components/DurationPickerSheet';
import TimePickerSheet from './src/components/TimePickerSheet';
import SlideScreen from './src/components/SlideScreen';
import TabPane from './src/components/TabPane';
import FrostOverlay from './src/components/FrostOverlay';
import { BlurTargetView } from 'expo-blur';
import NotifyGuideSheet, { type GuideKind } from './src/components/NotifyGuideSheet';
import Toast from './src/components/Toast';
import CalendarScreen from './src/screens/CalendarScreen';
import AddScheduleScreen from './src/screens/AddScheduleScreen';
import DetailScreen from './src/screens/DetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ProfileEditScreen from './src/screens/ProfileEditScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ReportScreen from './src/screens/ReportScreen';
import FeatureScreen from './src/screens/FeatureScreen';
import TrainingScreen from './src/screens/TrainingScreen';
import ContentScreen from './src/screens/ContentScreen';
import GrowthScreen from './src/screens/GrowthScreen';
import GradeMapScreen from './src/screens/GradeMapScreen';
import CountScreen from './src/screens/CountScreen';
import {
  loadGradeProgress, saveGradeProgress, stageStats,
} from './src/content/gradeProgress';

// 尚未开发的功能页配置（训练 / 内容 / 积累都已经是真实页面，只剩「星球」还走这个占位模板）
const featureConfig: Record<string, {
  title: string; en: string; desc: string; icon: string;
  features: { icon: string; text: string }[];
}> = {
  planet: {
    title: '星球', en: 'PLANET',
    desc: '探索他人的时间规划方式，找到适合自己的节奏。',
    icon: 'planet-outline',
    features: [
      { icon: 'checkmark-circle-outline', text: '时间规划社区与话题广场' },
      { icon: 'sparkles-outline', text: '精选日程模板一键套用' },
      { icon: 'person-outline', text: '关注感兴趣的时间管理创作者' },
    ],
  },
};

// 页面类型：主界面 / 添加 / 详情 / 我的 / 资料编辑 / 设置 / 历史日程 / 段位地图
type Page =
  | 'main' | 'add' | 'detail' | 'profile' | 'profileEdit' | 'report' | 'settings'
  | 'history' | 'grades' | 'jump';

// 四个功能页的顺序（切 tab 时按需挂载、挂载后常驻）
const FEATURE_TABS: TabKey[] = ['train', 'planet', 'content', 'growth'];

/**
 * 空状态「排一条」带进添加页的预设时长。
 * 和空状态那句「先动三分钟？」必须一致，改一处就要改另一处。
 */
const QUICK_PRESET_MINUTES = 3;

/**
 * 详情页的兜底数据：只在「已经进了详情页但条目刚好没了」时用（删除 / 退场动画那一瞬），
 * 用户看不到。页面本身不再预热 —— 现在首次打开才建视图树（见 SlideScreen 的 `seen`）。
 */
const WARM_ITEM: Schedule = {
  id: '__warm__', date: '2026-01-01', title: '',
  start: '09:00', end: '10:00', type: 'rope', remind: false,
};

export default function App() {
  const [tab, setTab] = useState<TabKey>('calendar');
  const [page, setPage] = useState<Page>('main');
  // 详情页只记 id，条目内容从 schedules 派生 —— 完成状态改变时详情页能立刻刷新
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * 正在编辑哪一条：null = 新建。添加页被新建和编辑共用，
   * 靠这一个 id 决定「表单从哪儿回填」和「保存时是追加还是覆盖」。
   * 放在页面状态旁边：goBack 要用它决定返回目标（编辑态回详情，新建态回主界面）。
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  // 全部日程：新增 / 删除 / 完成状态都直接改这里，日历页按日期过滤展示
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);

  // 个人资料：头像 / 名字 / 生日，"我的"页与编辑页共用
  const [profile, setProfile] = useState<Profile>(initialProfile);

  /**
   * 段位进度：只存「已掌握动作」的 key（`段位-动作`）。
   * 单独一份 AsyncStorage，不走 storage.ts 的日程 schema ——
   * 那份一改 schemaVersion 就要写迁移，迁移写错会把用户的日程一起丢掉。
   */
  const [gradeDone, setGradeDone] = useState<string[]>([]);
  const gradeLoaded = useRef(false);
  const gradeTouched = useRef(false);

  /**
   * 本地持久化：启动时从 AsyncStorage 读回，之后 schedules/profile 一变就防抖写回。
   * 读写的序列化 / 校验在 src/storage.ts，这里只负责「什么时候读、什么时候写」。
   *
   * 四条时序保护（少一条就会丢数据）：
   * 1) hydrated 门控——读取完成前绝不写盘，否则首帧会用初始值覆盖已存数据；
   * 2) ready 门控——读取完成前不渲染业务页，否则首帧会闪一下「今天还没有日程」，
   *    而且这几十毫秒里用户新增的日程会被读回的数据覆盖；
   * 3) skipNextSave——刚读回来的那份不立刻原样写回去，省一次无意义的写盘；
   * 4) latest ref——切后台 / 卸载时拿的是最新值，不会因闭包陈旧漏掉防抖窗口里的改动。
   * 写入都 fire-and-forget（void），不阻塞 UI，失败在 storage.ts 内部已吞掉。
   */
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
  const latest = useRef({ schedules, profile });
  latest.current = { schedules, profile };

  const flushSave = useCallback(() => {
    if (!hydrated.current) return;
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void savePersistedData(latest.current.schedules, latest.current.profile);
  }, []);

  /** 数据是否已从磁盘读回。为 false 时只渲染底色，不建业务页。 */
  const [ready, setReady] = useState(false);

  /** +1 就触发一次提醒重排（授权成功后用，见下面的 effect） */
  const [reminderTick, setReminderTick] = useState(0);
  /**
   * 通知引导面板：null = 不显示。
   * - permission / channel：用户点「提醒与通知」时体检出来的真实卡点
   * - battery：国产 ROM 刚授予权限时弹一次（系统会掐后台闹钟）
   */
  const [guide, setGuide] = useState<GuideKind | null>(null);

  /**
   * 全局轻提示：目前用于「日程距开始不足 15 分钟，提醒改到开始时」这一条，
   * 后续其它需要"说一句"的操作可以直接复用。
   */
  const [toast, setToast] = useState<string | null>(null);
  /**
   * 可撤销提示里那个按钮。有值 = 这次提示带一个能点的动作（比如「撤销」）。
   * 和文案分开存：普通提示不该因为上一次是撤销提示就多出一个按钮。
   */
  const [toastAction, setToastAction] = useState<{ label: string; onPress: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    setToastAction(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  /**
   * 带动作的提示（删除后的「撤销」）。
   * 停留时间按 5.2 秒：比普通提示长一倍多 —— 撤销这种操作，人要先反应过来发生了什么，
   * 2.4 秒根本来不及。
   */
  const showUndoToast = useCallback((text: string, onPress: () => void) => {
    setToast(text);
    setToastAction({ label: '撤销', onPress });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      setToastAction(null);
    }, 5200);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const bumpReminders = useCallback(() => {
    setReminderTick((n) => n + 1);
    // 权限刚授下来的那一刻顺手引导：用户此刻正在意"提醒能不能到"。
    // 只对国产 ROM 弹（那些系统会掐后台闹钟），其余机型不打扰。
    if (needsBatteryHint() && consumeFreshGrant()) setGuide('battery');
  }, []);

  // 启动读一次：读到才 setState；没读到（首次安装 / 数据损坏）保留初始值即可
  useEffect(() => {
    let alive = true;
    // 兜底：万一存储层卡住（极少见），1.2s 后也放行，不能让用户对着白屏等
    const bail = setTimeout(() => { if (alive) setReady(true); }, 1200);
    loadPersistedData().then((data) => {
      if (!alive) return;
      clearTimeout(bail);
      if (data) {
        skipNextSave.current = true;
        setSchedules(data.schedules);
        setProfile(data.profile);
      }
      hydrated.current = true;
      setReady(true);          // 和上面的 setState 同批提交，不会闪空态
    });
    return () => { alive = false; clearTimeout(bail); };
  }, []);

  // 数据变更：防抖 300ms 写回；hydrated 之前跳过（用初始值覆盖已存数据的风险）
  useEffect(() => {
    if (!hydrated.current) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void savePersistedData(latest.current.schedules, latest.current.profile);
    }, 300);
    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
  }, [schedules, profile]);

  /**
   * 段位进度：独立读写，和上面日程的 hydration 完全解耦。
   * 读取期间用户若已经点过动作（首屏几乎不可能），以内存为准，别被落盘数据盖回去。
   */
  useEffect(() => {
    let alive = true;
    void loadGradeProgress().then((keys) => {
      if (!alive) return;
      if (!gradeTouched.current) setGradeDone(keys);
      gradeLoaded.current = true;
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!gradeLoaded.current) return;
    void saveGradeProgress(gradeDone);
  }, [gradeDone]);

  /**
   * 提醒排程：日程一变就把待发提醒全量重排一遍。
   * 防抖 800ms 比落盘稍长，连续操作时只排最后一次；
   * 没给权限时 syncReminders 内部直接返回 0，不会弹窗——授权只发生在用户主动操作之后。
   *
   * reminderTick 是「刚拿到权限，重排一次」的开关：授权回调里只把计数 +1，
   * 真正读 schedules 的是这个 effect（拿到的永远是最新值，不会用陈旧的闭包把新日程漏掉）。
   */
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { void syncReminders(latest.current.schedules); }, 800);
    return () => clearTimeout(t);
  }, [schedules, ready, reminderTick]);

  /**
   * 回到前台时复查一次通知链路。
   *
   * 为什么需要：用户按引导去系统设置里把权限打开，回来时权限变了，
   * 但日程一条都没改 —— 不补排的话，要等到下次新增/编辑日程才会开始提醒，
   * 用户看到的现象就是「明明开了权限，还是不响」。
   *
   * 只在「上一轮卡着、这一轮通了」时补排一次，不是每次前台都重排。
   */
  const lastBlocker = useRef<'permission' | 'channel' | null | undefined>(undefined);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void checkNotifyHealth().then((health) => {
        const prev = lastBlocker.current;
        lastBlocker.current = health.blocker;
        if (prev && !health.blocker) bumpReminders();
      });
    });
    return () => sub.remove();
  }, [bumpReminders]);

  // 切后台 / 卸载时立即落盘，保住防抖窗口里最后那次改动（杀 App 不发 onSnapshot）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') flushSave();
    });
    return () => {
      sub.remove();
      flushSave();
    };
  }, [flushSave]);

  const selected = selectedId
    ? schedules.find((s) => s.id === selectedId) ?? null
    : null;

  /**
   * 「我的」页三个统计：全部按真实日程算，随增删和完成状态即时更新。
   * 用 useMemo 保证引用稳定 —— ProfileScreen 是 memo 的，每次渲染新建对象会让它白重渲染。
   */
  const profileStats = useMemo(() => {
    // 休息日不需要用户勾，日期到了就算完成 —— 统一走 isFinished，避免和首页口径不一致
    const nowKey = dateKeyOf(new Date());
    const done = schedules.filter((s) => isFinished(s, nowKey));
    /**
     * 本月摘要：卡片上先给一句结论（本月完成率），点进报告页才看细节。
     * 用 dateKeyOf 截前 7 位做月份前缀，和日程存的 "YYYY-MM-DD" 口径一致。
     */
    const monthPrefix = nowKey.slice(0, 7);
    const month = schedules.filter((s) => s.date.startsWith(monthPrefix));
    return {
      total: schedules.length,
      done: done.length,
      streak: completedStreak(done.map((s) => s.date)),
      monthTotal: month.length,
      monthDone: month.filter((s) => isFinished(s, nowKey)).length,
    };
  }, [schedules]);

  /** 段位派生：Set 给地图做 O(1) 掌握判断，统计给首页卡显示「已获 X 段」 */
  const gradeDoneSet = useMemo(() => new Set(gradeDone), [gradeDone]);
  const gradeStat = useMemo(() => stageStats(gradeDoneSet), [gradeDoneSet]);

  /**
   * 详情页退场时条目可能已经被删掉（selected 变成 null），
   * 这里留一份最后一次的引用，让退场动画里还能看到原来的内容，不会白屏。
   */
  const lastDetail = useRef<Schedule | null>(null);
  if (selected) lastDetail.current = selected;
  const detailItem = selected ?? lastDetail.current;

  /**
   * 详情页是从哪儿打开的：主页日程列表，还是历史日程。
   * 返回 / 删除后要回到来的地方，不能一律跳回主界面（否则在历史里点开一条，
   * 返回就直接被踢出历史页了）。用 ref 存，不额外触发渲染。
   */
  const detailFrom = useRef<Page>('main');
  /** 历史日程是从哪进来的：设置页，还是主页「全部」 */
  const historyFrom = useRef<Page>('settings');
  /**
   * 设置页是从哪进来的：日历首页的齿轮，还是「我的」右上角的齿轮。
   * 两个入口都要能返回原处，否则从「我的」进设置、返回却被送到主界面。
   */
  const settingsFrom = useRef<Page>('main');
  /**
   * 数据报告是从哪进来的：「我的」右上角，还是日历首页数据条上的本周进度。
   * 两个入口都要能返回原处，否则从首页点进来、返回却被送到「我的」。
   */
  const reportFrom = useRef<Page>('profile');
  /**
   * 报告页要打开哪个月。
   * 首页数据条写「本月 3/7」并带着月份进来 → 这里存那个月，报告页直接定位过去；
   * 从「我的」等其它入口进来 → 留 null，报告页落到今天所在的月。
   */
  const reportYm = useRef<{ y: number; m: number } | null>(null);

  /**
   * 二级页面是否盖在主界面上：只用来决定主界面吃不吃触摸，不做视觉。
   * 原来这里还有一层"开页面时把主界面压暗"的遮罩动画 —— 它和页面的淡入是两条
   * 独立曲线，叠在一起就成了背景亮度忽明忽暗的第二个来源，已经去掉。
   */
  const onMain = page === 'main';

  /**
   * 整屏起雾：全 App 唯一的转场动画，由「页面 + tab」这个组合值驱动。
   * 进了 / 出了二级页面 = 一次完整转场；只切 tab = 短一档，而且要让开底部菜单栏。
   */
  const frostTarget = useRef<React.ComponentRef<typeof View> | null>(null);
  /**
   * 页面内部的"局部转场"计数器。
   * 首页搜索栏的进出不是换页，但也该和换页一样起一次雾，
   * 所以让它往这个数字上加一 —— 拼进 navSig 后就会驱动 FrostOverlay 播一次同款转场，
   * 动画参数、时长、曲线全部复用，不另写一套。
   */
  const [frostTick, setFrostTick] = useState(0);
  /**
   * 每个 tick 属于哪种转场：只有搜索这一档要「不压暗 + 时长再长一点」。
   * 记的是完整的 navSig 字符串，所以只要换页 / 切 tab，它自然就对不上了，
   * 下一次换页拿到的就是默认参数，不用额外清理。
   */
  const frostSig = useRef<string | null>(null);
  const tickRef = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const bumpSearchFrost = useCallback(() => {
    const next = tickRef.current + 1;
    tickRef.current = next;
    frostSig.current = `${pageRef.current}|${tabRef.current}|${next}`;
    setFrostTick(next);
  }, []);
  const navSig = `${page}|${tab}|${frostTick}`;
  /** 这一次转场是不是搜索栏的进出 */
  const isSearchFrost = frostSig.current === navSig;
  const prevPage = useRef(page);
  const pageChanged = prevPage.current !== page;
  prevPage.current = page;

  /** 底部菜单栏的高度：切 tab 时模糊层要停在它上面，菜单栏不参与转场 */
  const [navH, setNavH] = useState(0);

  // 安卓返回键：二级页面退回上一层，不要直接退出 App
  const goBack = useCallback(() => {
    Keyboard.dismiss();
    setPage((p) => {
      if (p === 'profileEdit') return 'profile';
      // 报告页两个入口，各回各家
      if (p === 'report') return reportFrom.current;
      if (p === 'history') return historyFrom.current;
      if (p === 'detail') return detailFrom.current;
      // 添加页：编辑态退回详情，新建态回主界面（和右上角关闭走同一条路）
      if (p === 'add') return editingId ? 'detail' : 'main';
      // 设置页可能从日历首页的齿轮进，也可能从"我的"进，各回各家
      if (p === 'settings') return settingsFrom.current;
      // 段位地图只从「内容」页进，返回就是主界面（内容 tab 还在原位）
      if (p === 'grades') return 'main';
      return 'main';
    });
    setEditingId(null);
  }, [editingId]);

  useEffect(() => {
    if (page === 'main') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [page, goBack]);

  /**
   * 日历当前选中的日期：添加日程时作为默认日期、保存后用来跳转。
   * 这里刻意只存 ref —— 之前每次点日期都 setState，会把 App 整棵树和日历页
   * 全部重渲染一遍，正好压在液体滑块的动画首帧上，就是"点了先顿一下"的根源。
   * 真正需要的时候（打开添加页 / 保存后跳转）再升级成 state，和 setPage 同批提交，
   * 不会多出一次渲染。
   */
  const selDateRef = useRef((() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  })());
  const handleSelectDate = useCallback((d: { y: number; m: number; d: number }) => {
    selDateRef.current = d;
  }, []);

  // 添加页的默认日期（点加号那一刻取一次）
  const [addDate, setAddDate] = useState(selDateRef.current);
  /** 快捷新建的预设时长：只有空状态 CTA 会带值，其余新建 / 编辑都是 undefined */
  const [addPresetMinutes, setAddPresetMinutes] = useState<number | undefined>(undefined);
  // 保存后让日历跳到那一天
  const [jumpDate, setJumpDate] = useState(selDateRef.current);

  const editItem = editingId
    ? schedules.find((s) => s.id === editingId) ?? null
    : null;

  const addSchedule = useCallback((draft: Omit<Schedule, 'id'>) => {
    Keyboard.dismiss();
    /**
     * 保存前先看一眼有没有时间重叠（同一天、排除自己）。
     * 只提示、不拦截：训练加练、时间微调都是正常需求，强行禁止会更烦。
     */
    const sMin = timeToMinutes(draft.start);
    const eMin = timeToMinutes(draft.end);
    /**
     * 冲突要按「实际会落地的每一天」去查，不能只看 draft.date。
     * 重复会把一条草稿展开成一年的实例（最多 365 条），只查首日的话，
     * 后面那些撞上已有安排的日子会被静默放过 —— 排完才发现每天都撞。
     */
    const landingDates = draft.repeat
      ? [draft.date, ...repeatDates(draft.date, draft.repeat)]
      : [draft.date];
    /**
     * 已有日程先按日期建索引：重复要连着查 365 天，
     * 逐日再对全表扫一遍等于白算 365 遍（日历里条数越多越明显）。
     */
    const busyByDate = new Map<string, { s: number; e: number }[]>();
    for (const o of latest.current.schedules) {
      if (editingId && o.id === editingId) continue;
      const span = { s: timeToMinutes(o.start), e: timeToMinutes(o.end) };
      const arr = busyByDate.get(o.date);
      if (arr) arr.push(span);
      else busyByDate.set(o.date, [span]);
    }
    const clashDates = landingDates.filter((d) =>
      (busyByDate.get(d) ?? []).some((r) => sMin < r.e && r.s < eMin));
    // 保存时就告诉用户：这条已经进了 15 分钟窗口，提醒会改成「开始时」发一条，
    // 否则用户会以为「开了提醒却没响」。编辑已完成的那条不提示（本来就不会提醒）。
    const completed = editingId ? Boolean(editItem?.completed) : false;
    /**
     * 休息和训练排在同一天：不拦，但给一句关怀提醒。
     * 有人确实会「上午练、下午躺」，硬禁止反而烦；但多半是忘了那天已经排了别的。
     */
    const sameDay = latest.current.schedules.filter(
      (o) => o.date === draft.date && (!editingId || o.id !== editingId),
    );
    const hasRest = sameDay.some((o) => o.type === 'rest');
    const hasTrain = sameDay.some((o) => o.type !== 'rest');
    const restClash = !draft.repeat && (draft.type === 'rest' ? hasTrain : hasRest);
    /**
     * 三条提示只留一条：休息冲突最要紧（它关系到别练过头），其次时间重叠，最后提醒窗口。
     *
     * 这里只攒成一句话、不直接弹 —— 重复保存最后还有一句「已排好 N 次」，
     * 如果两处都调 showToast，后一句会把前一句整个盖掉，
     * 那正是「重复日程撞了时间却不提醒」的根因。
     */
    let notice: string | null = null;
    if (restClash) {
      notice = draft.type === 'rest'
        ? '这天已经有训练啦，休息日建议先把训练挪到别的日期'
        : '这天你安排了休息，想练的话注意别过量哦';
    } else if (clashDates.length > 0) {
      notice = draft.repeat
        ? `其中 ${clashDates.length} 天和已有日程时间重叠`
        : '这段时间和已有日程重叠了，记得确认下安排';
    } else if (isWithinLeadWindow({ ...draft, completed })) {
      notice = `距开始不足 ${REMIND_MINUTES} 分钟，提醒改为开始时发送`;
    }
    /**
     * 用户刚表达了「要提醒」，这一刻弹授权最容易被接受。
     * 但授权拿不到时不能一声不吭 —— 先体检：权限被关就弹 permission 引导，
     * 渠道被关就弹 channel 引导，只有链路通畅才去排程。
     */
    if (draft.remind && !completed) {
      void checkNotifyHealth({ request: true }).then((health) => {
        if (health.blocker) setGuide(health.blocker);
        else bumpReminders();
      });
    }
    // 编辑分支：只覆盖草稿里的字段，id 和 completed 原样保留（改个标题不该把打卡记录清掉）
    if (editingId) {
      setSchedules((list) => list.map((s) => (s.id === editingId ? { ...s, ...draft } : s)));
      setJumpDate(parseDateKey(draft.date));
      setEditingId(null);
      setPage('detail');        // 改完回详情页，能立刻看到新内容
      if (notice) showToast(notice);
      return;
    }
    /**
     * 重复：在这里把一条草稿展开成多条具体日期的实例，覆盖接下来一年。
     * 这样日历、连续天数、本周完成率、报告页全都不需要知道"重复"这回事 ——
     * 它们看到的就是若干条各自独立的日程。
     * 每条都带同一个 seriesId，详情页删除时靠它判断"要不要连整串一起删"。
     */
    const { repeat: repeatKind, ...base } = draft;
    const freq = repeatKind ?? null;
    const extraDates = freq ? repeatDates(base.date, freq) : [];
    const seriesId = extraDates.length > 0
      ? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      : undefined;
    const mkId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const items: Schedule[] = [base.date, ...extraDates].map((d) => ({
      ...base,
      date: d,
      repeat: freq ?? undefined,
      seriesId,
      id: mkId(),
    }));
    setSchedules((list) => [...list, ...items]);
    // 保存后跳到该日程所在日期，能立刻看到它
    setJumpDate(parseDateKey(base.date));
    setPage('main');
    /**
     * 只弹一次：有冲突时把条数和警告合成一句，
     * 而不是先报冲突、再被「已排好 N 次」冲掉。
     */
    if (freq) {
      showToast(
        notice
          ? `已排好 ${items.length} 次 · ${notice}`
          : `${REPEAT_WORD[freq]}一次，已排好 ${items.length} 次`,
      );
    } else if (notice) {
      showToast(notice);
    }
  }, [editingId, editItem, bumpReminders, showToast]);

  /**
   * 删除 + 撤销。
   * 删之前先把「被删的是哪几条、原来排在第几位」记下来，撤销时按原索引插回去 ——
   * 这样撤销后的列表顺序和删之前一模一样，而不是把恢复的日程甩到末尾。
   * 只认这一次的 5 秒窗口，过期就真的没了（不占内存、也不给"其实删掉了"的错觉）。
   */
  /** 把删掉的那几条按原索引插回列表，并立刻收起提示 */
  const restoreRemoved = useCallback((removed: { item: Schedule; index: number }[]) => {
    setSchedules((list) => {
      const next = [...list];
      removed
        .slice()
        .sort((a, b) => a.index - b.index)
        .forEach(({ item, index }) => next.splice(Math.min(index, next.length), 0, item));
      return next;
    });
    // 撤销完立刻收起提示，不用等它自己消失
    setToast(null);
    setToastAction(null);
  }, []);

  const deleteWithUndo = useCallback((
    match: (s: Schedule) => boolean,
    label: (n: number) => string,
  ) => {
    const removed = latest.current.schedules
      .map((s, index) => ({ item: s, index }))
      .filter(({ item }) => match(item));
    if (removed.length === 0) return;

    setSchedules((list) => list.filter((s) => !match(s)));
    setSelectedId(null);
    setPage(detailFrom.current);
    showUndoToast(label(removed.length), () => restoreRemoved(removed));
  }, [restoreRemoved, showUndoToast]);

  const deleteSchedule = useCallback((id: string) => {
    deleteWithUndo((s) => s.id === id, () => '已删除这条日程');
  }, [deleteWithUndo]);

  /** 删除整串重复日程：seriesId 相同的每一条都走 */
  const deleteSeries = useCallback((seriesId: string) => {
    deleteWithUndo(
      (s) => s.seriesId === seriesId,
      (n) => `已删除 ${n} 条重复日程`,
    );
  }, [deleteWithUndo]);

  /** 历史日程里批量删除：一次把选中的月份 / 日期下的日程全部移除（同样可撤销） */
  const deleteSchedules = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const kill = new Set(ids);
    const removed = latest.current.schedules
      .map((s, index) => ({ item: s, index }))
      .filter(({ item }) => kill.has(item.id));
    setSchedules((list) => list.filter((s) => !kill.has(s.id)));
    setSelectedId((cur) => (cur && kill.has(cur) ? null : cur));
    if (removed.length > 0) {
      showUndoToast(`已删除 ${removed.length} 条`, () => restoreRemoved(removed));
    }
  }, [restoreRemoved, showUndoToast]);

  // 完成 / 取消完成：只翻转这一条，其他不动
  const toggleComplete = useCallback((id: string) => {
    const cur = latest.current.schedules.find((s) => s.id === id);
    // 休息日没有「完成 / 取消完成」这回事：日期到了自动算完成，不再给用户翻来翻去
    if (!cur || cur.type === 'rest') return;
    // 只在"未完成 → 完成"这一下给触感，取消完成不震（避免噪音）
    if (!cur.completed) completeTick();
    setSchedules((list) =>
      list.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)),
    );
  }, []);

  // 日期选择器放在最外层渲染，这样浮层能盖住底部导航和状态栏
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInit, setPickerInit] = useState(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  });
  const pickerCallback = useRef<((y: number, m: number, d: number) => void) | null>(null);

  // 稳定引用：日历页、添加页都拿它当 prop，变了会让那些页面白白重渲染
  const openPicker = useCallback((
    init: { y: number; m: number; d: number },
    onPick: (y: number, m: number, d: number) => void,
  ) => {
    pickerCallback.current = onPick;
    setPickerInit(init);
    setPickerOpen(true);
  }, []);

  const closePicker = () => setPickerOpen(false);

  // 时间选择器（时/分两列），与日期选择器同一套外壳和手感
  const [timePicker, setTimePicker] = useState({ open: false, title: '选择时间', h: 9, m: 0 });
  const timeCallback = useRef<((h: number, m: number) => void) | null>(null);

  // 同样要稳定引用：它被当成 prop 传给常驻的添加日程页
  const openTimePicker = useCallback((
    title: string,
    init: { h: number; m: number },
    onPick: (h: number, m: number) => void,
  ) => {
    timeCallback.current = onPick;
    setTimePicker({ open: true, title, h: init.h, m: init.m });
  }, []);

  const closeTimePicker = () => setTimePicker((s) => ({ ...s, open: false }));

  /**
   * 训练时长选择器（时/分两列）。
   *
   * 和上面两个选择器同一套做法：面板在最外层渲染，训练页只负责把「当前值」
   * 和「确定后怎么应用」交出去。放在这里而不是训练页里用 Modal 包的，
   * 是因为安卓每次开 Modal 都要新建 Dialog 窗口，点开滚轮会顿一下。
   */
  const [durPicker, setDurPicker] = useState({ open: false, minutes: 30 });
  const durCallback = useRef<((total: number) => void) | null>(null);

  // 稳定引用：它被当成 prop 传给常驻的训练页
  /**
   * 训练页点 GO：进全屏计数页。
   * 引用要稳定（TrainingScreen 是 memo 的），否则每输一个字训练页都跟着重渲染。
   */
  const startJump = useCallback(() => setPage('jump'), []);

  const openDurationPicker = useCallback((
    current: number,
    onPick: (total: number) => void,
  ) => {
    durCallback.current = onPick;
    setDurPicker({ open: true, minutes: current });
  }, []);

  const closeDurationPicker = () => setDurPicker((s) => ({ ...s, open: false }));

  // Android 上 SafeAreaView 不处理状态栏，这里手动补状态栏高度 + 额外留白
  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 10 : 0;
  const bottomInset = Platform.OS === 'android' ? 8 : 0;

  /**
   * 所有往日历页传的回调都用 useCallback 固定引用。
   * 否则父级每次重渲染都会让日历页跟着重渲染 —— 三张月历网格（上百个日期格）
   * 正好在点下去的那一帧重算，就是卡顿的另一个来源。
   */
  const openDetail = useCallback((item: Schedule) => {
    detailFrom.current = 'main';
    setSelectedId(item.id);
    setPage('detail');
  }, []);
  // 历史日程里点开某条：返回时回到历史页而不是主界面
  const openHistoryDetail = useCallback((item: Schedule) => {
    detailFrom.current = 'history';
    setSelectedId(item.id);
    setPage('detail');
  }, []);
  const backFromDetail = useCallback(() => {
    Keyboard.dismiss();
    setPage(detailFrom.current);
  }, []);
  const openSettings = useCallback(() => {
    settingsFrom.current = 'main';
    setPage('settings');
  }, []);
  const openSettingsFromProfile = useCallback(() => {
    settingsFrom.current = 'profile';
    setPage('settings');
  }, []);
  // 设置页里进历史：返回时回到设置
  const openHistory = useCallback(() => {
    historyFrom.current = 'settings';
    setPage('history');
  }, []);
  // 主页「全部」进历史：返回时直接回主界面
  const openHistoryFromMain = useCallback(() => {
    historyFrom.current = 'main';
    setPage('history');
  }, []);
  const openProfile = useCallback(() => setPage('profile'), []);
  // 打开添加页：顺手把日历当前选中的日期带上（同批提交，不额外渲染）
  const openAdd = useCallback(() => {
    setEditingId(null);       // 从加号进来一律是"新建"，别继承上一次的编辑目标
    setAddPresetMinutes(undefined);  // 普通新建走默认时长
    setAddDate(selDateRef.current);
    setPage('add');
  }, []);

  /**
   * 空状态「排一条」：同样走新建，但时长预设成三分钟。
   * 文案说「先动三分钟」，表单若是默认的 90 分钟，用户一打开就会放弃。
   */
  const openAddQuick = useCallback(() => {
    setEditingId(null);
    setAddPresetMinutes(QUICK_PRESET_MINUTES);
    setAddDate(selDateRef.current);
    setPage('add');
  }, []);

  /** 长按月历某天：直接以那天为默认日期新建（不依赖 selDateRef 的渲染时序） */
  const openAddAt = useCallback((d: { y: number; m: number; d: number }) => {
    setEditingId(null);
    setAddPresetMinutes(undefined);
    setAddDate(d);
    setPage('add');
  }, []);

  /** 详情页点「编辑日程」：同一条日程，进添加页的「修改」分支 */
  const openEdit = useCallback((item: Schedule) => {
    setEditingId(item.id);
    setAddPresetMinutes(undefined);  // 编辑走回填，不吃快捷新建的预设时长
    setPage('add');
  }, []);

  /** 关掉添加页：编辑态退回详情（还要接着看），新建态回主界面 */
  const closeAdd = useCallback(() => {
    Keyboard.dismiss();
    setEditingId(null);
    setPage(editingId ? 'detail' : 'main');
  }, [editingId]);

  const openProfileEdit = useCallback(() => setPage('profileEdit'), []);
  /** 报告页两个入口：从「我的」进，返回回「我的」；从首页数据条进，返回回首页 */
  const openReport = useCallback(() => {
    reportYm.current = null;
    reportFrom.current = 'profile';
    setPage('report');
  }, []);
  const openReportFromMain = useCallback((ym?: { y: number; m: number }) => {
    // 首页把「它刚才在看的那个月」交过来，报告页照这个月打开，两边数字必然一致
    reportYm.current = ym ?? null;
    reportFrom.current = 'main';
    setPage('report');
  }, []);
  /** 内容库 → 段位地图（内容 tab 上的大卡点进来） */
  const openGrades = useCallback(() => setPage('grades'), []);
  /** 段位地图里标记 / 取消「已掌握」。通关要整段掌握，但只要上一段过半，下一段就能挑战 */
  const toggleGradeAction = useCallback((key: string) => {
    gradeTouched.current = true;
    setGradeDone((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  }, []);
  /** 云同步还没接后端：如实说明当前数据在哪，别让用户以为已经在同步 */
  const openCloud = useCallback(() => {
    showToast('云同步还在开发中，数据已保存在本机');
  }, [showToast]);
  /** 还没做的入口：统一点一下给句话，避免"点了没反应" */
  const pressSoon = useCallback((label: string) => {
    showToast(`${label}还在开发中`);
  }, [showToast]);
  const backToProfile = useCallback(() => {
    Keyboard.dismiss();
    setPage('profile');
  }, []);

  const saveProfile = useCallback((p: Profile) => {
    Keyboard.dismiss();
    setProfile(p);
    setPage('profile');
  }, []);

  // "我的"页里点底部导航：切 tab 同时回主界面
  const tabFromProfile = useCallback((k: TabKey) => {
    setTab(k);
    setPage('main');
  }, []);

  /**
   * 已经打开过的 tab 一直留在视图树上，未选中的藏起来（TabPane 内部 display:none）。
   * 之前切 tab 是"卸载一页 + 挂载另一页"：日历页光日期格就有 120 多个视图，
   * 重建整棵树的那几帧正好和底部导航的液体滑块动画抢同一个 UI 线程，
   * 看起来就是"点了之后先顿一下再滑"。常驻之后切 tab 几乎零成本。
   */
  const seenTab = useRef<Record<string, boolean>>({ calendar: true });
  seenTab.current[tab] = true;

  // 主界面：底部导航 + 当前 tab 页面
  const renderMain = () => (
    <>
      {/* tab 舞台：所有页面叠在同一个格子里，显示 / 隐藏 / 转场都交给 TabPane */}
      <View style={styles.tabStage}>
        <TabPane active={tab === 'calendar'}>
          <CalendarScreen
            schedules={schedules}
            initialDate={jumpDate}
            onOpenProfile={openProfile}
            onOpenAdd={openAdd}
            onOpenDetail={openDetail}
            onOpenPicker={openPicker}
            onSelectDate={handleSelectDate}
            onToggleComplete={toggleComplete}
            onOpenSettings={openSettings}
            onOpenHistory={openHistoryFromMain}
            avatar={profile.avatar}
            onGoTrain={() => showToast('训练板块还在装修，先记着这条')}
            onAddAt={openAddAt}
            onOpenReport={openReportFromMain}
            onAddQuick={openAddQuick}
            onFrost={bumpSearchFrost}
          />
        </TabPane>

        {FEATURE_TABS.map((k) => (seenTab.current[k] ? (
          <TabPane key={k} active={tab === k}>
            {k === 'train' ? (
              // 训练页整屏固定，不滚动：一进来就是训练面板本身
              <TrainingScreen
                onEditDuration={openDurationPicker}
                onStartJump={startJump}
              />
            ) : k === 'content' ? (
              // 内容库：段位大卡 → 段位地图，底部留白给后续板块
              <ContentScreen
                stats={gradeStat}
                onOpenMap={openGrades}
                onSoon={pressSoon}
              />
            ) : k === 'growth' ? (
              // 积累页：置顶运动卡 + 等高组件网格。这一版入口全部未接，只给提示
              <GrowthScreen onSoon={pressSoon} />
            ) : (
              <FeatureScreen
                title={featureConfig[k].title}
                en={featureConfig[k].en}
                desc={featureConfig[k].desc}
                icon={featureConfig[k].icon}
                features={featureConfig[k].features}
                onMore={pressSoon}
              />
            )}
          </TabPane>
        ) : null))}
      </View>

      {/* 包一层只为量高度：切 tab 时模糊层要让开菜单栏，不让它跟着糊 */}
      <View onLayout={(e) => {
        const h = Math.round(e.nativeEvent.layout.height);
        setNavH((prev) => (prev === h ? prev : h));
      }}
      >
        <BottomNav active={tab} onChange={setTab} />
      </View>
    </>
  );

  /**
   * 数据还没从磁盘读回来：只铺一层底色。
   * 这几十毫秒里如果照常渲染，用户会先看到空列表再被数据顶一下（闪），
   * 更糟的是这期间新增的日程会被随后读回的快照覆盖掉。
   */
  if (!ready) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />

      {/*
        整屏内容层 = 模糊的取样目标。主界面、二级页面、两条栏都在这里面，
        所以起雾时屏幕上不会有任何一块"没跟上"。
      */}
      <BlurTargetView ref={frostTarget} collapsable={false} style={styles.frost}>
        <SafeAreaView style={[styles.safe, { paddingTop: topInset, paddingBottom: bottomInset }]}>
          {/* 主界面常驻底层，不参与动画：位移/缩放整页在安卓上会拖慢帧率 */}
          <View style={styles.layer} pointerEvents={onMain ? 'auto' : 'none'}>
            {renderMain()}
          </View>
        </SafeAreaView>

        {/*
          转场层必须放在 SafeAreaView 外面。
          放在里面会被它的内边距框住：状态栏那一条（topInset 高）拿不到过渡，
          转场时顶部会留一条"没跟上"的硬边。放在整屏层就一定是盖满的。
        */}
          {/*
            我的：进资料编辑 / 数据报告时保持可见，子页面盖在它上面。
            不保持的话，从"我的"进报告页会让底层先退回主界面，
            返回时还要重新挂一次"我的"，转场里能看出背景换过一茬。
          */}
          <SlideScreen
            visible={
              page === 'profile' || page === 'profileEdit'
              // 从「我的」进报告时保持可见；从首页数据条进则不挂这一页，否则背景会错成「我的」
              || (page === 'report' && reportFrom.current === 'profile')
              // 从"我的"进设置时也留着：返回时这一页还在原位，不用重新挂载、淡入
              || (page === 'settings' && settingsFrom.current === 'profile')
            }
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <ProfileScreen
              profile={profile}
              onEditProfile={openProfileEdit}
              stats={profileStats}
              onOpenReport={openReport}
              onOpenCloud={openCloud}
              onPressSoon={pressSoon}
              onOpenSettings={openSettingsFromProfile}
            />
            <BottomNav active={tab} onChange={tabFromProfile} />
          </SlideScreen>

          <SlideScreen
            visible={page === 'profileEdit'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <ProfileEditScreen
              profile={profile}
              visible={page === 'profileEdit'}
              onClose={backToProfile}
              onSave={saveProfile}
              onOpenDate={openPicker}
            />
          </SlideScreen>

          {/* 数据报告：从"我的"进，整屏看当月完成率与类型分布 */}
          <SlideScreen
            visible={page === 'report'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <ReportScreen
              schedules={schedules}
              visible={page === 'report'}
              initialYm={reportYm.current ?? undefined}
              onBack={goBack}
            />
          </SlideScreen>

          {/* 段位地图：从「内容」页的大卡进，九段动作清单与掌握状态都在这 */}
          <SlideScreen
            visible={page === 'grades'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <GradeMapScreen
              done={gradeDoneSet}
              onToggle={toggleGradeAction}
              onBack={goBack}
            />
          </SlideScreen>

          {/* 设置：齿轮入口 */}
          <SlideScreen
            visible={page === 'settings'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <SettingsScreen
              onBack={goBack}
              onOpenHistory={openHistory}
              scheduleCount={schedules.length}
              visible={page === 'settings'}
              onRemindersChanged={bumpReminders}
              onShowNotifyGuide={setGuide}
            />
          </SlideScreen>

          {/* 历史日程：按月 / 按天折叠，可批量删除 */}
          <SlideScreen
            visible={page === 'history'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <HistoryScreen
              schedules={schedules}
              visible={page === 'history'}
              onBack={goBack}
              onOpenDetail={openHistoryDetail}
              onToggleComplete={toggleComplete}
              onDeleteMany={deleteSchedules}
            />
          </SlideScreen>

          {/* 日程详情：放在设置/历史之上，从历史里点开时详情盖上去才不打架 */}
          <SlideScreen
            visible={page === 'detail'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <DetailScreen
              item={detailItem ?? WARM_ITEM}
              onBack={backFromDetail}
              onEdit={openEdit}
              onDelete={deleteSchedule}
              onDeleteSeries={deleteSeries}
              onToggleComplete={toggleComplete}
            />
          </SlideScreen>

          {/* 添加日程：层级与详情、我的一致，同样只做对焦出场 */}
          <SlideScreen
            visible={page === 'add'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <AddScheduleScreen
              visible={page === 'add'}
              onClose={closeAdd}
              initialDate={addDate}
              editItem={editItem}
              presetMinutes={editItem ? undefined : addPresetMinutes}
              onOpenDate={openPicker}
              onOpenTime={openTimePicker}
              onSave={addSchedule}
            />
          </SlideScreen>

          {/*
            跳绳计数页：从训练页的 GO 进来，全屏相机 + 实时计数。
            放在最后 = 层级最高，盖住底部导航（计数时不该还能点别的 tab）。
          */}
          <SlideScreen
            visible={page === 'jump'}
            topInset={topInset}
            bottomInset={bottomInset}
          >
            <CountScreen
              active={page === 'jump'}
              onExit={goBack}
            />
          </SlideScreen>
      </BlurTargetView>

      {/*
        全 App 唯一的转场动画：起雾 → 对焦。
        盖在内容之上、所有浮层之下，所以状态栏那条和底部菜单栏也会一起起雾。
      */}
      <FrostOverlay
        targetRef={frostTarget}
        trigger={navSig}
        fog={isSearchFrost ? MOTION.searchFog : (pageChanged ? MOTION.fog : MOTION.tabFog)}
        focus={isSearchFrost ? MOTION.searchFocus : (pageChanged ? MOTION.enter : MOTION.tab)}
        // 压暗永远盖整屏（菜单栏也一起暗），但模糊只到菜单栏上沿；
        // 进出二级页面时菜单栏本来就被页面盖住，整屏一起糊也没关系
        clipBottom={pageChanged ? 0 : navH + bottomInset}
        // 搜索栏进出：整屏亮度不变，只糊不暗，模糊强度也弱一点
        dim={!isSearchFrost}
        blur={isSearchFrost ? true : MOTION.useBlur}
        intensity={isSearchFrost ? MOTION.searchBlur : undefined}
      />

      {/* 日期选择浮层：整屏覆盖，层级高于底部导航 */}
      <DatePickerSheet
        visible={pickerOpen}
        year={pickerInit.y}
        month={pickerInit.m}
        day={pickerInit.d}
        onClose={closePicker}
        onConfirm={(y, m, d) => {
          pickerCallback.current?.(y, m, d);
          pickerCallback.current = null;
          closePicker();
        }}
      />

      {/* 时间选择浮层：与日期选择器同一套外壳，只换滚轮列 */}
      <TimePickerSheet
        visible={timePicker.open}
        title={timePicker.title}
        hour={timePicker.h}
        minute={timePicker.m}
        onClose={closeTimePicker}
        onConfirm={(h, m) => {
          timeCallback.current?.(h, m);
          timeCallback.current = null;
          closeTimePicker();
        }}
      />

      {/* 训练时长浮层：与上面两套同一套外壳，训练页只交来当前值和「确定后怎么应用」 */}
      <DurationPickerSheet
        visible={durPicker.open}
        minutes={durPicker.minutes}
        onClose={closeDurationPicker}
        onConfirm={(total) => {
          const apply = durCallback.current;
          durCallback.current = null;
          closeDurationPicker();
          apply?.(total);
        }}
      />

      {/* 引导面板在前时先不弹轻提示：面板本身就带着更完整的说明，两个一起冒会互相盖住 */}
      <Toast message={guide ? null : toast} action={guide ? null : toastAction} />

      {/* 通知引导：权限 / 渠道 / 省电策略共用同一个面板，内容按 kind 切换 */}
      <NotifyGuideSheet
        visible={guide !== null}
        kind={guide ?? 'permission'}
        brand={deviceBrand()}
        onClose={() => setGuide(null)}
        onOpenSettings={() => {
          setGuide(null);
          openAppSystemSettings();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1, backgroundColor: C.bg },
  layer: { flex: 1, backgroundColor: C.bg },
  // 整屏内容层：模糊取样的目标，必须自带底色，否则糊出来是透明而不是"糊了的页面"
  frost: { flex: 1, backgroundColor: C.bg },
  // tab 舞台：所有 tab 页绝对定位叠在这里，BottomNav 单独占底部
  tabStage: { flex: 1, backgroundColor: C.bg },
});
