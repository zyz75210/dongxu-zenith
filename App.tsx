import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, AppState, BackHandler, Keyboard, Platform,
  SafeAreaView, StatusBar, StyleSheet, View,
} from 'react-native';
import { C } from './src/theme';
import { initialSchedules, initialProfile, Profile, Schedule } from './src/data';
import { loadPersistedData, savePersistedData } from './src/storage';
import {
  consumeFreshGrant, deviceBrand, needsBatteryHint, openAppSystemSettings,
  requestPermissionIfNeeded, syncReminders,
} from './src/notifications';
import { parseDateKey, completedStreak } from './src/utils/date';
import BottomNav, { TabKey } from './src/components/BottomNav';
import DatePickerSheet from './src/components/DatePickerSheet';
import TimePickerSheet from './src/components/TimePickerSheet';
import SlideScreen from './src/components/SlideScreen';
import BatteryHintSheet from './src/components/BatteryHintSheet';
import CalendarScreen from './src/screens/CalendarScreen';
import AddScheduleScreen from './src/screens/AddScheduleScreen';
import DetailScreen from './src/screens/DetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ProfileEditScreen from './src/screens/ProfileEditScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import FeatureScreen from './src/screens/FeatureScreen';

// 四个功能页的配置
const featureConfig: Record<string, {
  title: string; en: string; desc: string; icon: string;
  features: { icon: string; text: string }[];
}> = {
  train: {
    title: '训练', en: 'TRAINING',
    desc: '把每日计划变成可执行的习惯，记录每一次坚持。',
    icon: 'barbell-outline',
    features: [
      { icon: 'checkmark-circle-outline', text: '专注番茄钟与时间块记录' },
      { icon: 'sparkles-outline', text: '每周训练目标与完成度回顾' },
      { icon: 'calendar-outline', text: '连续坚持天数与成就徽章' },
    ],
  },
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
  | 'main' | 'add' | 'detail' | 'profile' | 'profileEdit' | 'settings' | 'history';

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
   * 刚拿到通知权限时弹一次省电策略引导。
   * 只在国产 ROM 上弹（那些系统会掐后台闹钟），其余机型不打扰。
   */
  const [batteryHint, setBatteryHint] = useState(false);

  const bumpReminders = useCallback(() => {
    setReminderTick((n) => n + 1);
    // 权限刚授下来的那一刻顺手引导：用户此刻正在意"提醒能不能到"
    if (needsBatteryHint() && consumeFreshGrant()) setBatteryHint(true);
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
    return {
      total: schedules.length,
      done: done.length,
      streak: completedStreak(done.map((s) => s.date)),
    };
  }, [schedules]);

  /**
   * 预热开关：首屏稳定后，把四个二级页面逐个在屏幕外建好。
   * 这样第一次点开时不用现建整页视图，滑入动画从第一帧就是顺的。
   * 逐个错开执行，避免连续几帧都在创建视图反而把首屏拖住。
   */
  const [warm, setWarm] = useState({
    detail: false, add: false, profile: false, profileEdit: false,
    settings: false, history: false,
  });
  /** 延迟预热历史页的定时器（打开设置页时排一次） */
  const preloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (preloadTimer.current) clearTimeout(preloadTimer.current);
  }, []);
  useEffect(() => {
    // 等水合完成再排预热：否则读盘慢的机器上，前几个定时器会在首帧之前就烧完，
    // 详情 / 添加两页全挤在首帧一起建，正好把水合省下来的时间又还回去。
    if (!ready) return;
    const order = ['detail', 'add', 'profile', 'profileEdit'] as const;
    const timers = [
      ...order.map((k, i) =>
        setTimeout(() => setWarm((w) => (w[k] ? w : { ...w, [k]: true })), 200 + i * 130)),
      // 齿轮是第一屏就有的入口，稍微晚一点预热，点开时不用现建整页
      setTimeout(() => setWarm((w) => ({ ...w, settings: true })), 740),
    ];
    return () => timers.forEach(clearTimeout);
    // 历史日程不预热：它要遍历全部日程建视图，留到真正点开时再建
  }, [ready]);

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
   * 遮罩浓度：有二级页面盖上来时淡淡压暗一层，形成前后层次。
   * 只动一个纯色视图的透明度，不缩放主界面 —— 整页 scale 每帧都要重绘，太贵。
   */
  const dim = useRef(new Animated.Value(0)).current;
  const onMain = page === 'main';
  useEffect(() => {
    Animated.timing(dim, {
      toValue: onMain ? 0 : 1,
      duration: onMain ? 220 : 260,
      useNativeDriver: true,
    }).start();
  }, [onMain, dim]);

  // 安卓返回键：二级页面退回上一层，不要直接退出 App
  const goBack = useCallback(() => {
    Keyboard.dismiss();
    setPage((p) => {
      if (p === 'profileEdit') return 'profile';
      if (p === 'history') return historyFrom.current;
      if (p === 'detail') return detailFrom.current;
      // 添加页：编辑态退回详情，新建态回主界面（和右上角关闭走同一条路）
      if (p === 'add') return editingId ? 'detail' : 'main';
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
    // 用户刚表达了「要提醒」，这一刻弹授权最容易被接受；拿到权限后 bump 一次重排
    if (draft.remind) {
      void requestPermissionIfNeeded().then((state) => {
        if (state === 'granted') bumpReminders();
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
  }, [editingId, bumpReminders]);

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
    setPage('settings');
    // 设置页滑入之后再在屏幕外把历史页建好：等用户点"历史日程"时就是瞬间打开。
    // 放到 420ms 后，避开设置页转场那几帧。
    if (preloadTimer.current) clearTimeout(preloadTimer.current);
    preloadTimer.current = setTimeout(() => {
      setWarm((w) => (w.history ? w : { ...w, history: true }));
    }, 420);
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
   * 已经打开过的 tab 一直留在视图树上，未选中的用 display:none 藏起来。
   * 之前切 tab 是"卸载一页 + 挂载另一页"：日历页光日期格就有 120 多个视图，
   * 重建整棵树的那几帧正好和底部导航的液体滑块动画抢同一个 UI 线程，
   * 看起来就是"点了之后先顿一下再滑"。常驻之后切 tab 几乎零成本。
   */
  const seenTab = useRef<Record<string, boolean>>({ calendar: true });
  seenTab.current[tab] = true;

  // 主界面：底部导航 + 当前 tab 页面
  const renderMain = () => (
    <>
      <View style={[styles.tabLayer, tab !== 'calendar' && styles.tabHidden]}>
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
      </View>

      {FEATURE_TABS.map((k) => (seenTab.current[k] ? (
        <View key={k} style={[styles.tabLayer, tab !== k && styles.tabHidden]}>
          <FeatureScreen
            title={featureConfig[k].title}
            en={featureConfig[k].en}
            desc={featureConfig[k].desc}
            icon={featureConfig[k].icon}
            features={featureConfig[k].features}
          />
        </View>
      ) : null))}

      <BottomNav active={tab} onChange={setTab} />
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
      <SafeAreaView style={[styles.safe, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        {/* 主界面常驻底层，不参与动画：位移/缩放整页在安卓上会拖慢帧率 */}
        <View style={styles.layer} pointerEvents={onMain ? 'auto' : 'none'}>
          {renderMain()}
        </View>

        {/* 层次遮罩：只淡入一个纯色层，开销极小 */}
        <Animated.View
          pointerEvents="none"
          style={[styles.scrim, { opacity: dim }]}
        />

        {/* 我的：进资料编辑时保持可见，编辑页从右侧盖在它上面 */}
        <SlideScreen
          visible={page === 'profile' || page === 'profileEdit'}
          preload={warm.profile}
          topInset={topInset}
          bottomInset={bottomInset}
        >
          <ProfileScreen profile={profile} onEditProfile={openProfileEdit} stats={profileStats} />
          <BottomNav active={tab} onChange={tabFromProfile} />
        </SlideScreen>

        <SlideScreen
          visible={page === 'profileEdit'}
          preload={warm.profileEdit}
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

        {/* 设置：齿轮入口 */}
        <SlideScreen
          visible={page === 'settings'}
          preload={warm.settings}
          topInset={topInset}
          bottomInset={bottomInset}
        >
          <SettingsScreen
            onBack={goBack}
            onOpenHistory={openHistory}
            scheduleCount={schedules.length}
            visible={page === 'settings'}
            onRemindersChanged={bumpReminders}
            onNeedBatteryHint={() => setBatteryHint(true)}
          />
        </SlideScreen>

        {/* 历史日程：按月 / 按天折叠，可批量删除 */}
        <SlideScreen
          visible={page === 'history'}
          preload={warm.history}
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

        {/* 日程详情：从右侧推入。放在设置/历史之上，从历史里点开时详情才能顺滑盖上去 */}
        <SlideScreen
          visible={page === 'detail'}
          preload={warm.detail}
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

        {/* 添加日程：和详情、我的统一从右侧推入，方向一致更符合直觉 */}
        <SlideScreen
          visible={page === 'add'}
          preload={warm.add}
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
      </SafeAreaView>

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

      {/* 省电策略引导：刚授完通知权限、且是国产 ROM 机型时弹一次 */}
      <BatteryHintSheet
        visible={batteryHint}
        brand={deviceBrand()}
        onClose={() => setBatteryHint(false)}
        onOpenSettings={() => {
          setBatteryHint(false);
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
  // 每个 tab 一层容器：未选中的整层藏掉（display:none 只是不参与布局/绘制，视图树还在）
  tabLayer: { flex: 1, backgroundColor: C.bg },
  tabHidden: { display: 'none' },
  scrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,20,34,0.20)',
  },
});
