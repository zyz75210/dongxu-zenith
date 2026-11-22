import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState, BackHandler, Keyboard, Platform,
  SafeAreaView, StatusBar, StyleSheet, View,
} from 'react-native';
import { C } from './src/theme';
import { MOTION } from './src/motion';
import { initialSchedules, initialProfile, Profile, Schedule } from './src/data';
import { loadPersistedData, savePersistedData } from './src/storage';
import {
  checkNotifyHealth, consumeFreshGrant, deviceBrand, isWithinLeadWindow, needsBatteryHint,
  openAppSystemSettings, REMIND_MINUTES, syncReminders,
} from './src/notifications';
import { parseDateKey, dateKeyOf, completedStreak } from './src/utils/date';
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

// 三个尚未开发的功能页配置（训练页已经是真实页面，不再走这个占位模板）
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
  content: {
    title: '内容', en: 'CONTENT',
    desc: '沉淀你的笔记与资料，与日程自然关联。',
    icon: 'document-text-outline',
    features: [
      { icon: 'checkmark-circle-outline', text: '日程备注一键转为笔记' },
      { icon: 'sparkles-outline', text: '会议纪要与待办清单整理' },
      { icon: 'folder-outline', text: '按主题检索历史记录' },
    ],
  },
  growth: {
    title: '积累', en: 'GROWTH',
    desc: '长期记录的时间资产，会慢慢长成你的能力。',
    icon: 'layers-outline',
    features: [
      { icon: 'checkmark-circle-outline', text: '时间投入分布与趋势图' },
      { icon: 'sparkles-outline', text: '月度成长报告自动生成' },
      { icon: 'calendar-outline', text: '关键里程碑时间线回顾' },
    ],
  },
};

// 页面类型：主界面 / 添加 / 详情 / 我的 / 资料编辑 / 设置 / 历史日程
type Page =
  | 'main' | 'add' | 'detail' | 'profile' | 'profileEdit' | 'report' | 'settings' | 'history';

// 四个功能页的顺序（切 tab 时按需挂载、挂载后常驻）
const FEATURE_TABS: TabKey[] = ['train', 'planet', 'content', 'growth'];

/**
 * 详情页预热用的占位数据：只在屏幕外建视图树时用到，用户看不到。
 * 有了它，第一次点开日程时详情页不需要再新建整棵视图树。
 */
const WARM_ITEM: Schedule = {
  id: '__warm__', date: '2026-01-01', title: '',
  start: '09:00', end: '10:00', type: 'work', remind: false,
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
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
    const done = schedules.filter((s) => s.completed);
    /**
     * 本月摘要：卡片上先给一句结论（本月完成率），点进报告页才看细节。
     * 用 dateKeyOf 截前 7 位做月份前缀，和日程存的 "YYYY-MM-DD" 口径一致。
     */
    const monthPrefix = dateKeyOf(new Date()).slice(0, 7);
    const month = schedules.filter((s) => s.date.startsWith(monthPrefix));
    return {
      total: schedules.length,
      done: done.length,
      streak: completedStreak(done.map((s) => s.date)),
      monthTotal: month.length,
      monthDone: month.filter((s) => s.completed).length,
    };
  }, [schedules]);

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
  const navSig = `${page}|${tab}`;
  const prevPage = useRef(page);
  const pageChanged = prevPage.current !== page;
  prevPage.current = page;

  /** 底部菜单栏的高度：切 tab 时模糊层要停在它上面，菜单栏不参与转场 */
  const [navH, setNavH] = useState(0);

  // 安卓返回键：二级页面退回上一层，不要直接退出 App
  const goBack = useCallback(() => {
    Keyboard.dismiss();
    setPage((p) => {
      if (p === 'profileEdit' || p === 'report') return 'profile';
      if (p === 'history') return historyFrom.current;
      if (p === 'detail') return detailFrom.current;
      // 添加页：编辑态退回详情，新建态回主界面（和右上角关闭走同一条路）
      if (p === 'add') return editingId ? 'detail' : 'main';
      // 设置页可能从日历首页的齿轮进，也可能从"我的"进，各回各家
      if (p === 'settings') return settingsFrom.current;
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
  // 保存后让日历跳到那一天
  const [jumpDate, setJumpDate] = useState(selDateRef.current);

  const editItem = editingId
    ? schedules.find((s) => s.id === editingId) ?? null
    : null;

  const addSchedule = useCallback((draft: Omit<Schedule, 'id'>) => {
    Keyboard.dismiss();
    // 保存时就告诉用户：这条已经进了 15 分钟窗口，提醒会改成「开始时」发一条，
    // 否则用户会以为「开了提醒却没响」。编辑已完成的那条不提示（本来就不会提醒）。
    const completed = editingId ? Boolean(editItem?.completed) : false;
    if (isWithinLeadWindow({ ...draft, completed })) {
      showToast(`距开始不足 ${REMIND_MINUTES} 分钟，提醒改为开始时发送`);
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
      return;
    }
    const item: Schedule = {
      ...draft,
      id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    };
    setSchedules((list) => [...list, item]);
    // 保存后跳到该日程所在日期，能立刻看到它
    setJumpDate(parseDateKey(item.date));
    setPage('main');
  }, [editingId, editItem, bumpReminders, showToast]);

  const deleteSchedule = useCallback((id: string) => {
    setSchedules((list) => list.filter((s) => s.id !== id));
    setSelectedId(null);
    setPage(detailFrom.current);
  }, []);

  /** 历史日程里批量删除：一次把选中的月份 / 日期下的日程全部移除 */
  const deleteSchedules = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const kill = new Set(ids);
    setSchedules((list) => list.filter((s) => !kill.has(s.id)));
    setSelectedId((cur) => (cur && kill.has(cur) ? null : cur));
  }, []);

  // 完成 / 取消完成：只翻转这一条，其他不动
  const toggleComplete = useCallback((id: string) => {
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
    setAddDate(selDateRef.current);
    setPage('add');
  }, []);

  /** 详情页点「编辑日程」：同一条日程，进添加页的「修改」分支 */
  const openEdit = useCallback((item: Schedule) => {
    setEditingId(item.id);
    setPage('add');
  }, []);

  /** 关掉添加页：编辑态退回详情（还要接着看），新建态回主界面 */
  const closeAdd = useCallback(() => {
    Keyboard.dismiss();
    setEditingId(null);
    setPage(editingId ? 'detail' : 'main');
  }, [editingId]);

  const openProfileEdit = useCallback(() => setPage('profileEdit'), []);
  const openReport = useCallback(() => setPage('report'), []);
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
          />
        </TabPane>

        {FEATURE_TABS.map((k) => (seenTab.current[k] ? (
          <TabPane key={k} active={tab === k}>
            {k === 'train' ? (
              // 训练页整屏固定，不滚动：一进来就是训练面板本身
              <TrainingScreen onEditDuration={openDurationPicker} />
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
              page === 'profile' || page === 'profileEdit' || page === 'report'
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
              onOpenDate={openPicker}
              onOpenTime={openTimePicker}
              onSave={addSchedule}
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
        fog={pageChanged ? MOTION.fog : MOTION.tabFog}
        focus={pageChanged ? MOTION.enter : MOTION.tab}
        // 压暗永远盖整屏（菜单栏也一起暗），但模糊只到菜单栏上沿；
        // 进出二级页面时菜单栏本来就被页面盖住，整屏一起糊也没关系
        clipBottom={pageChanged ? 0 : navH + bottomInset}
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
      <Toast message={guide ? null : toast} />

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
