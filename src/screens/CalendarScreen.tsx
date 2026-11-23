import React, {
  memo, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Animated, Dimensions, Easing, Image, PanResponder, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, WEEK_DAYS } from '../theme';
import { Schedule, ScheduleType } from '../data';
import {
  buildMonthCells, Cell, completedStreak, dateKey, dateKeyOf, isFinished, sameDay,
  timeToMinutes, weekdayIndex,
} from '../utils/date';
import ScheduleCapsule, { TYPE_NAME } from '../components/ScheduleCapsule';
import StreakFlame, { streakSub } from '../components/StreakFlame';

type Props = {
  /** 全部日程（本页按选中日期过滤并排序） */
  schedules: Schedule[];
  /** 初始显示日期，默认今天（新增日程后跳到对应日期用） */
  initialDate?: { y: number; m: number; d: number };
  onOpenProfile: () => void;
  onOpenAdd: () => void;
  onOpenDetail: (item: Schedule) => void;
  /** 点卡片右侧的类型胶囊：切换完成状态 */
  onToggleComplete: (id: string) => void;
  /** 打开底部日期选择器：把当前选中日期和"确认后怎么处理"交给上层 */
  onOpenPicker: (
    init: { y: number; m: number; d: number },
    onPick: (y: number, m: number, d: number) => void,
  ) => void;
  /** 选中日期变化时上报（添加日程页用作默认日期） */
  onSelectDate?: (d: { y: number; m: number; d: number }) => void;
  /** 点右上角齿轮：打开设置页 */
  onOpenSettings: () => void;
  /**
   * 原「全部」入口（顶部标题行右上角）。
   * 已从首页移除：设置页和「我的」页都能进历史日程，这个链接只是快一步，
   * 却一直占着标题行最贵的位置。prop 保留，方便以后想加回来时不用改 App。
   */
  onOpenHistory: () => void;
  /** 头像 uri：改过资料后首页一起更新 */
  avatar?: string;
  /** 点卡片「去训练」入口：本轮只弹提示 */
  onGoTrain?: () => void;
  /** 点数据条右侧的本周进度：进数据报告页看完整统计 */
  onOpenReport?: () => void;
  /** 空状态「排一条」：快捷新建，表单时长预设成三分钟的一小段 */
  onAddQuick?: () => void;
  /** 长按月历某天：直接在这天新建训练 */
  onAddAt?: (d: { y: number; m: number; d: number }) => void;
};

// 月历日期数字统一颜色：比黑色淡一点的深灰
const DAY_TEXT_COLOR = '#2F3239';
// 周末（周六、周日）的活力淡橙
const WEEKEND_COLOR = '#FF9A45';
// 跨月补位日期（上月末尾）的淡化灰
const DIM_COLOR = '#C4C9D2';
/**
 * 「块」这一层的统一底色：日历灰条、日期凸台、数据条全用它。
 * 之前灰条是 #F2F3F6、数据条是 #F7F8FA，一屏两个近似白，看不出层级差别、只觉得脏。
 * 统一到深的那一档——灰条本来就靠这点深度才托得住上面那几个圆点。
 */
const BAND = '#F2F3F6';
/**
 * 是不是训练类。休息不算训练，统计口径要分开算：
 * 用户安排了休息日不代表「这周练了」，否则「本周训练 X/Y」会被休息撑虚。
 */
const isTraining = (s: Schedule) => s.type !== 'rest';
// 网格行高与行数（最多 6 行，固定高度避免切换月份时跳动）
// 行高 = 日期数字区(46) + 下方圆点区(DOT_ZONE)，给训练圆点留出空间
const ROW_H = 54;
const MAX_ROWS = 6;
/** 日期数字下方预留的圆点区高度（灰条有训练时才向下延伸到这一段） */
const DOT_ZONE = 12;

/** 选中圆（液体滑块）的直径，和原来 dayBox 一致 */
const BLOB = 34;
/** 选中圆在行内的垂直偏移（距行顶，保持和原 46 行高时一致，蓝圆位置不变） */
const BLOB_TOP = 6;
/** 跨周 / 换月 / 跳转时液滴的起始大小 */
const BLOOM_FROM = 0.45;
/** 旧点溶解的时长：新点在这段时间里同步绽放，两段动作重叠，看着才连贯 */
const GHOST_MS = 185;
/** 数字延后变白：等液滴盖住再亮，避免白字浮在白底上（和底部导航同一套做法） */
const PAINT_DELAY = 130;

/** 网格宽度的初始估算值：屏幕宽 - 左右各 20 的内边距 */
const EST_W = Dimensions.get('window').width - 40;

/**
 * 单个日期格。
 * 之前的写法是整格塞在 MonthGrid 的 map 里，父级一重渲染（哪怕只是某一天变白）
 * 42 个 Text 的 style 数组全部重建 → 42 次文字重排，安卓上一掉就是一帧。
 * 这里拆成 memo：props 全是原始值 + 稳定引用（cell 由 useMemo 产出不会变），
 * 所以一次选中只有"原来的那天"和"新的那天"两格真正重渲染。
 */
const DayCell = memo(function DayCell({
  cell, gy, gm, col, isSel, paint, dots, onPressDay, onLongPressDay,
}: {
  cell: Cell;
  gy: number;
  gm: number;
  /** 列下标 0-6（0=周一 … 6=周日），用来判断周末和跨月淡化 */
  col: number;
  isSel: boolean;
  paint: boolean;
  /** 该日期的训练类型数组（去重后），用来在数字下方画小圆点 */
  dots: ScheduleType[];
  onPressDay: (cell: Cell, gy: number, gm: number) => void;
  /** 长按：直接在这天新建训练 */
  onLongPressDay: (cell: Cell, gy: number, gm: number) => void;
}) {
  // 三种状态用三个静态样式对象，不再每次渲染新建 { color } 对象
  // 选中的数字仍走原来的"变白"逻辑（dayWait/dayOn 不动，液体滑块动画一行不碰）。
  // 只有"非选中"态按 周末橙 / 跨月淡化 / 普通深灰 三种静态样式区分。
  const textStyle = !isSel
    ? (cell.type === 'prev' ? styles.dayDim : (col >= 5 ? styles.dayWeekend : styles.dayOff))
    : paint ? styles.dayOn : styles.dayWait;
  return (
    <TouchableOpacity
      style={styles.cell}
      activeOpacity={0.6}
      onPress={() => onPressDay(cell, gy, gm)}
      onLongPress={() => onLongPressDay(cell, gy, gm)}
      delayLongPress={400}
    >
      <View style={styles.dayBox}>
        <Text style={textStyle}>{cell.day}</Text>
      </View>
      {dots.length > 0 ? (
        <View style={styles.dotRow}>
          {dots.map((t, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: C.typeDot[t] }]} />
          ))}
        </View>
      ) : (
        <View style={styles.dotRowEmpty} />
      )}
    </TouchableOpacity>
  );
});

/** 某一天在月历里的格位：行号、列号，以及滑块要平移到的 x / y */
function blobPosFor(gridW: number, y: number, m: number, d: number) {
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
  const idx = firstWeekday + d - 1;
  const col = idx % 7;
  const row = Math.floor(idx / 7);
  const cellW = (gridW || 300) / 7;
  return {
    row,
    col,
    x: col * cellW + (cellW - BLOB) / 2,
    y: row * ROW_H + BLOB_TOP,
  };
}

/**
 * 单个月份的网格，分三层（从下往上）：
 * 1. 浅灰长条层（绝对定位，一次算好每段的 left/width/top）
 * 2. 液体滑块层（整页唯一一个，靠 translateX/translateY 定位）
 * 3. 日期格层（普通流式排布，所以数字永远画在滑块上面）
 *
 * 滑块必须放在"页"这一层、而不是塞进某一行：放进行里的话，跨行选中时
 * React 得先在旧行卸载、再到新行创建，中间会有一帧停在错误坐标上 ——
 * 表现就是斜着点日期时邻格闪一下色块。
 */
const MonthGrid = memo(function MonthGrid({
  y, m, selDay, paint, withBlob,
  blobX, blobY, grow, blobOpacity,
  ghostX, ghostY, ghostScale, ghostOpacity,
  dotsByDay, onPressDay, onLongPressDay,
}: {
  y: number;
  m: number;
  /** 选中日：-1 表示这个网格里没有选中项 */
  selDay: number;
  /** 数字是否已经变白（液滴到位后才变） */
  paint: boolean;
  /** 这个网格要不要显示滑块（只有中间那页要，恒定不变） */
  withBlob: boolean;
  blobX: Animated.Value;
  blobY: Animated.Value;
  grow: Animated.Value;
  blobOpacity: Animated.Value;
  ghostX: Animated.Value;
  ghostY: Animated.Value;
  ghostScale: Animated.Value;
  ghostOpacity: Animated.Value;
  /** 日期键 → 该日训练类型数组（去重），供日期格画圆点 */
  dotsByDay: Map<string, ScheduleType[]>;
  onPressDay: (cell: Cell, gy: number, gm: number) => void;
  onLongPressDay: (cell: Cell, gy: number, gm: number) => void;
}) {
  const cells = useMemo(() => buildMonthCells(y, m), [y, m]);

  const rows = useMemo(() => {
    const out: (Cell | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const row = cells.slice(i, i + 7) as (Cell | null)[];
      while (row.length < 7) row.push(null);
      out.push(row);
    }
    return out;
  }, [cells]);

  // 浅灰长条：按行拆成"本月连续日期"的区段，位置一次算好，渲染时不再新建对象
  const bands = useMemo(() => {
    const out: { key: string; top: number; left: number; width: number }[] = [];
    rows.forEach((row, r) => {
      let s = -1;
      const push = (start: number, end: number) => {
        out.push({
          key: `${r}-${start}`,
          top: r * ROW_H + 6,
          left: (start / 7) * 100,
          width: ((end - start + 1) / 7) * 100,
        });
      };
      row.forEach((cell, i) => {
        const isCur = cell !== null && cell.type === 'cur';
        if (isCur && s === -1) s = i;
        if (!isCur && s !== -1) {
          push(s, i - 1);
          s = -1;
        }
      });
      if (s !== -1) push(s, 6);
    });
    return out;
  }, [rows]);

  // 有训练的日期：在底灰条(34)下方多延伸一段(DOT_ZONE)，露出放圆点的空间。
  // 按"连续有训练的日期"合并成段，中间无缝连成一条（顶部直角贴主灰条）。
  // 段端若已经是主灰条的边界（左/右相邻格不是本月日期），需要填充圆角把凹坑填平。
  const tallBands = useMemo(() => {
    const out: {
      key: string; top: number; left: number; width: number;
      roundLeft: boolean; roundRight: boolean;
    }[] = [];
    rows.forEach((row, r) => {
      let s = -1;
      const push = (start: number, end: number) => {
        // 左/右相邻格是否为本月日期：不是 → 这一端就是主灰条边界，需要填平圆角
        const leftCell = start > 0 ? row[start - 1] : null;
        const rightCell = end < 6 ? row[end + 1] : null;
        const leftIsCur = leftCell !== null && leftCell.type === 'cur';
        const rightIsCur = rightCell !== null && rightCell.type === 'cur';
        out.push({
          key: `t-${r}-${start}`,
          top: r * ROW_H + 6 + 34 - 1,
          left: (start / 7) * 100,
          width: ((end - start + 1) / 7) * 100,
          roundLeft: !leftIsCur,
          roundRight: !rightIsCur,
        });
      };
      row.forEach((cell, i) => {
        const has = cell !== null && cell.type === 'cur'
          && (dotsByDay.get(dateKey(y, m, cell.day))?.length ?? 0) > 0;
        if (has && s === -1) s = i;
        if (!has && s !== -1) {
          push(s, i - 1);
          s = -1;
        }
      });
      if (s !== -1) push(s, 6);
    });
    return out;
  }, [rows, dotsByDay, y, m]);

  return (
    <View style={styles.gridPage}>
      {bands.map((b) => (
        <View
          key={b.key}
          style={[
            styles.dayBand,
            { top: b.top, left: `${b.left}%`, width: `${b.width}%` },
          ]}
        />
      ))}

      {tallBands.map((b) => (
        // 主灰条左右端是"向内凹"的圆角(10)，凸出块直角顶在凹弧下会形成 ( 形凹坑。
        // 段端已是主灰条边界时，用直角填充块把凹坑填平，让侧边变成竖直平边（类似 I）。
        // roundLeft / roundRight 已在计算时按"相邻格是否本月日期"判定，
        // 所以月初从中间开始、月末在中间结束都能正确填平。
        <View
          key={b.key}
          style={[
            styles.dayBandTall,
            { top: b.top, left: `${b.left}%`, width: `${b.width}%` },
          ]}
        >
          {b.roundLeft && <View style={styles.edgeFillL} />}
          {b.roundRight && <View style={styles.edgeFillR} />}
        </View>
      ))}

      {withBlob && (
        <>
          {/*
            残影：跨行选中时，旧位置那颗圆在原地缩小 + 淡出（像被吸走），
            新位置那颗同时淡入 + 绽放。两个动作重叠，所以看不到"圆突然消失"的断点。
            只在跨行时出现，平时 opacity 为 0、不参与绘制。
          */}
          <Animated.View
            key="ghost"
            pointerEvents="none"
            style={[
              styles.blob,
              {
                opacity: ghostOpacity,
                transform: [
                  { translateX: ghostX },
                  { translateY: ghostY },
                  { scale: ghostScale },
                ],
              },
            ]}
          />
          {/*
            主滑块：只有位移 + 缩放，始终是正圆 —— 不做任何横向/纵向拉伸，
            液体感靠弹簧的过冲回弹和「旧点溶解 + 新点绽放」的重叠来给。
          */}
          <Animated.View
            key="blob"
            pointerEvents="none"
            style={[
              styles.blob,
              {
                opacity: blobOpacity,
                transform: [
                  { translateX: blobX },
                  { translateY: blobY },
                  { scale: grow },
                ],
              },
            ]}
          />
        </>
      )}

      {rows.map((row, r) => (
        <View key={r} style={styles.gridRow}>
          {row.map((cell, i) => (
            cell === null ? (
              <View key={i} style={styles.cell} />
            ) : (
              <DayCell
                key={i}
                cell={cell}
                gy={y}
                gm={m}
                col={i}
                isSel={cell.type === 'cur' && cell.day === selDay}
                paint={paint}
                dots={cell.type === 'cur' ? (dotsByDay.get(dateKey(y, m, cell.day)) ?? []) : []}
                onPressDay={onPressDay}
                onLongPressDay={onLongPressDay}
              />
            )
          ))}
        </View>
      ))}
    </View>
  );
});

function CalendarScreen({
  onOpenProfile, onOpenAdd, onOpenDetail, onOpenPicker, onSelectDate,
  onOpenSettings, schedules, initialDate, onToggleComplete, avatar,
  onGoTrain, onAddAt, onOpenReport, onAddQuick,
}: Props) {
  const today = useMemo(() => new Date(), []);
  // 长按新建：用 ref 中转，保持 pressDayLong 的 useCallback 引用稳定
  const addAtRef = useRef(onAddAt);
  addAtRef.current = onAddAt;
  // 首次进入用 initialDate（新日程保存后跳到那天），没传就用今天
  const initDate = useMemo(
    () => initialDate ?? { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() },
    [],
  );

  const [view, setView] = useState({ y: initDate.y, m: initDate.m });
  const [sel, setSel] = useState(initDate);

  // 把选中的日期同步给上层（只在日期真正变化时触发，回调保持稳定不会循环）
  useEffect(() => {
    onSelectDate?.(sel);
  }, [sel, onSelectDate]);

  // 网格宽度：先用屏幕宽度估算，onLayout 后取精确值
  const [gridW, setGridW] = useState(EST_W);
  const gridWRef = useRef(gridW);
  gridWRef.current = gridW;

  /** 当前选中日期 / 正在显示的月份，供稳定回调里读取最新值 */
  const selRef = useRef(sel);
  selRef.current = sel;
  const viewRef = useRef(view);
  viewRef.current = view;

  /**
   * 位移值 tx + 一个 epoch 计数：
   * 切月时把月份、tx（换成全新的 0 值）和 epoch 一起提交，让三个网格整棵重挂，
   * 新挂载的视图直接用 0 位移。这样既不会残留旧的 native 位移，
   * 也不会出现"内容先回弹一帧"的闪动。
   */
  const [epoch, setEpoch] = useState(0);
  const [tx, setTx] = useState(() => new Animated.Value(0));
  const txRef = useRef(tx);
  txRef.current = tx;

  // 非滑动方式切月（按钮/选日期）时，顺手把位移归零
  const resetTx = () => txRef.current.setValue(0);

  /* ---------------- 选中态的液体滑块 ---------------- */

  const initPos = useMemo(() => blobPosFor(EST_W, initDate.y, initDate.m, initDate.d), []);
  const [blobX] = useState(() => new Animated.Value(initPos.x));
  const [blobY] = useState(() => new Animated.Value(initPos.y));
  const [grow] = useState(() => new Animated.Value(1));
  /** 主滑块的透明度（跨行绽放时淡入） */
  const [blobOpacity] = useState(() => new Animated.Value(1));
  /** 残影：旧位置那颗圆，跨行时原地溶解 */
  const [ghostX] = useState(() => new Animated.Value(initPos.x));
  const [ghostY] = useState(() => new Animated.Value(initPos.y));
  const [ghostScale] = useState(() => new Animated.Value(1));
  const [ghostOpacity] = useState(() => new Animated.Value(0));

  /** 上一次滑块停在哪：用来判断"同一周可以横move"还是"跨周要溶解 + 绽放" */
  const lastRef = useRef({ month: `${initDate.y}-${initDate.m}`, row: initPos.row });
  /** 滑块当前的目标坐标（残影就从这个点起溶） */
  const posRef = useRef({ x: initPos.x, y: initPos.y });
  /** 本次要播哪种动画 */
  const playQueue = useRef<'slide' | 'cross' | 'bloom' | null>(null);
  /** 横向滑动时滑块要去的 x */
  const pendingX = useRef(initPos.x);
  const animating = useRef(false);

  /** 数字变白的状态：先灰，液滴盖上去之后再变白 */
  const [paint, setPaint] = useState(true);
  const paintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPaintTimer = () => {
    if (paintTimer.current) {
      clearTimeout(paintTimer.current);
      paintTimer.current = null;
    }
  };
  useEffect(() => clearPaintTimer, []);

  /**
   * 选中某一天，并决定用哪种液体动画（三种都保持正圆，不做任何拉伸）：
   * 1. 同一周（同一行）→ 滑块横向滑过去，弹簧轻微过冲再停住
   * 2. 同月跨行 → 旧点原地溶解（缩 + 淡出），新点同时淡入 + 绽放，两段重叠没有断点
   * 3. 换月 / 跳转 → 网格整棵重挂，残影没有意义，只在新日期上绽放
   */
  const selectDate = (y: number, m: number, d: number, forceGrow = false) => {
    const cur = selRef.current;
    const v = viewRef.current;
    const monthChanged = y !== v.y || m !== v.m;
    // 日期和月份都没变：什么都没发生，不要白播一次动画
    if (!monthChanged && cur.y === y && cur.m === m && cur.d === d) return;

    // 上一次的动画可能还没停稳（连点），先掐断，新的动画从当前位置接着走
    blobX.stopAnimation();
    blobY.stopAnimation();
    grow.stopAnimation();
    blobOpacity.stopAnimation();
    ghostScale.stopAnimation();
    ghostOpacity.stopAnimation();

    const w = gridWRef.current || 300;
    const p = blobPosFor(w, y, m, d);
    const sameRow = !monthChanged && lastRef.current.row === p.row;
    const slide = sameRow && !forceGrow;

    if (slide) {
      // 横向平移：起点就是当前值，只改目标位置（y 本来就没变，设一次防止漂移）
      blobY.setValue(p.y);
      grow.setValue(1);
      blobOpacity.setValue(1);
      ghostOpacity.setValue(0);
      pendingX.current = p.x;
      playQueue.current = 'slide';
    } else {
      // 先把残影钉在"上一次停留的位置"，让它从那儿溶掉
      const prev = posRef.current;
      ghostX.setValue(prev.x);
      ghostY.setValue(prev.y);
      ghostScale.setValue(1);
      // 同月跨行才需要残影；换月时网格整棵重挂，残影只会错位
      ghostOpacity.setValue(monthChanged ? 0 : 1);

      // 新点：x/y 一次性摆到目标日期的正中心，然后在原地由小变大（不位移、不拉伸）。
      // 起始透明，所以"出现"那一下是无痕的，眼睛只看到它从中心长出来。
      blobX.setValue(p.x);
      blobY.setValue(p.y);
      grow.setValue(BLOOM_FROM);
      blobOpacity.setValue(0);
      playQueue.current = monthChanged ? 'bloom' : 'cross';
    }
    posRef.current = { x: p.x, y: p.y };
    lastRef.current = { month: `${y}-${m}`, row: p.row };

    // 数字先变回深灰，等液滴到位再变白
    setPaint(false);
    clearPaintTimer();
    paintTimer.current = setTimeout(() => setPaint(true), PAINT_DELAY);

    if (monthChanged) setView({ y, m });
    setSel({ y, m, d });
  };
  const selectRef = useRef(selectDate);
  selectRef.current = selectDate;

  // 选中状态提交后播动画：放在 effect 里，保证视图已经按新的位置/大小渲染过一帧
  useEffect(() => {
    const mode = playQueue.current;
    if (!mode) return;
    playQueue.current = null;
    animating.current = true;

    const done = () => { animating.current = false; };

    if (mode === 'slide') {
      // 横向滑行：不加任何形变（始终正圆）。液体感靠弹簧本身 ——
      // damping 比"刚好不甩"低一档，圆的边缘会轻轻冲过目标一两像素再收回来，
      // 像一滴水在台面上滑到位后晃一下停住。
      Animated.spring(blobX, {
        toValue: pendingX.current,
        useNativeDriver: true,
        stiffness: 300,
        damping: 21,
        mass: 0.9,
      }).start(done);
      return;
    }

    /**
     * 新点绽放：纯正圆，在选中日期的**正中心**由小变大，不位移、不拉伸。
     * 液体感全靠弹簧本身：220/15/0.9（约 15% 回弹），
     * 长到满尺寸会轻轻鼓过一点再收回来，像一滴水在格子里摊开又收圆。
     */
    const bloomIn = [
      Animated.timing(blobOpacity, {
        toValue: 1,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(grow, {
        toValue: 1,
        useNativeDriver: true,
        stiffness: 220,
        damping: 15,
        mass: 0.9,
      }),
    ];

    if (mode === 'cross') {
      // 旧点溶解 + 新点绽放重叠播放：一颗缩没了，另一颗刚好长出来，中间没有黑场。
      // 旧点的"缩"用 outQuad（一上来就明显变小，像被吸走），
      // 透明度用 inQuad（先保持看得见、最后才消失），两下一配合就不是"闪一下"，而是"化掉"。
      Animated.parallel([
        ...bloomIn,
        Animated.timing(ghostScale, {
          toValue: 0.14,
          duration: GHOST_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(ghostOpacity, {
          toValue: 0,
          duration: GHOST_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(done);
    } else {
      Animated.parallel(bloomIn).start(done);
    }
  }, [sel, view, blobX, blobY, grow, blobOpacity, ghostScale, ghostOpacity]);

  // 网格真实宽度到手后，把滑块重新摆正（比如横竖屏、字体缩放造成的差别）
  useEffect(() => {
    if (animating.current) return;
    const p = blobPosFor(gridW, viewRef.current.y, viewRef.current.m, selRef.current.d);
    lastRef.current = { month: `${viewRef.current.y}-${viewRef.current.m}`, row: p.row };
    posRef.current = { x: p.x, y: p.y };
    blobX.setValue(p.x);
    blobY.setValue(p.y);
    grow.setValue(1);
    blobOpacity.setValue(1);
    ghostOpacity.setValue(0);
    pendingX.current = p.x;
  }, [gridW, blobX, blobY, grow, blobOpacity, ghostOpacity]);

  const busy = useRef(false);
  // 动画卡住时的兜底：超过 800ms 还处于 busy，强制解锁，避免整块日历"点不动"
  const busyAt = useRef(0);
  const lock = () => {
    busy.current = true;
    busyAt.current = Date.now();
  };
  const unlock = () => {
    busy.current = false;
    busyAt.current = 0;
  };
  const isBusy = () => {
    if (!busy.current) return false;
    if (Date.now() - busyAt.current > 800) {
      unlock();
      return false;
    }
    return true;
  };

  /**
   * 主界面现在常驻不卸载（为了转场动画），所以新增日程保存后
   * 上层改 initialDate 不会再靠"重挂"生效，这里补一次同步：
   * 只有日期真的变了才跳，用户自己点日期造成的变化会被 key 比对挡掉。
   */
  const initKeyRef = useRef(
    `${initDate.y}-${initDate.m}-${initDate.d}`,
  );
  useEffect(() => {
    if (!initialDate) return;
    const k = `${initialDate.y}-${initialDate.m}-${initialDate.d}`;
    if (k === initKeyRef.current) return;
    initKeyRef.current = k;
    resetTx();
    setEpoch((e) => e + 1);
    selectRef.current(initialDate.y, initialDate.m, initialDate.d, true);
  }, [initialDate]);

  const selDate = new Date(sel.y, sel.m, sel.d);
  const isToday = sameDay(selDate, today);
  const dayKey = dateKey(sel.y, sel.m, sel.d);
  // 今天：用来判断某条日程是否已经"隔天超时"
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  // 选中那天的日程，按开始时间排序
  const daySchedules = useMemo(
    () =>
      schedules
        .filter((s) => s.date === dayKey)
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)),
    [schedules, dayKey],
  );
  const dayCount = daySchedules.length;

  // 日期键 → 该日训练类型（去重、按固定顺序），供月历格画圆点
  const dotsByDay = useMemo(() => {
    const map = new Map<string, ScheduleType[]>();
    // 圆点顺序固定为 跳绳 → 体能 → 跑步 → 休息，休息排最后（它是低饱和灰蓝，放边上不抢眼）
    const order: ScheduleType[] = ['rope', 'fitness', 'run', 'rest'];
    for (const s of schedules) {
      const arr = map.get(s.date);
      if (!arr) {
        map.set(s.date, [s.type]);
      } else if (!arr.includes(s.type)) {
        arr.push(s.type);
        arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      }
    }
    return map;
  }, [schedules]);

  // 连续打卡天数 + 本周训练统计（数据条用），全部由真实日程即时算
  // 「本周」跟随当前选中日期所在的周（周一~周日），翻到哪一周就统计哪一周
  const statsBar = useMemo(() => {
    const done = schedules.filter((s) => isFinished(s, todayKey));
    const streak = completedStreak(done.map((s) => s.date));
    const base = new Date(sel.y, sel.m, sel.d);
    const wd = (base.getDay() + 6) % 7; // 0=周一 … 6=周日
    const monday = new Date(sel.y, sel.m, sel.d - wd);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const mk = dateKeyOf(monday);
    const sk = dateKeyOf(sunday);
    const week = schedules.filter((s) => s.date >= mk && s.date <= sk);
    // 训练和休息分开算：休息日不算「练了一次」，否则进度条会被休息撑虚
    const weekTrain = week.filter(isTraining);
    /**
     * 距离「最近一次动」过了几天：用来区分「第一次来」和「断了很久又回来」。
     * 只看今天之前的记录（今天的安排还没完成，不算动过）。
     * 没有任何历史 → -1，代表这是个全新的用户。
     */
    const pastDates = schedules
      .filter((s) => s.date < todayKey)
      .map((s) => s.date)
      .sort();
    const lastActive = pastDates.length > 0 ? pastDates[pastDates.length - 1] : null;
    const daysSinceActive = lastActive
      ? Math.round((new Date(todayKey).getTime() - new Date(lastActive).getTime()) / 86400000)
      : -1;
    return {
      streak,
      weekDone: weekTrain.filter((s) => isFinished(s, todayKey)).length,
      weekTotal: weekTrain.length,
      weekRest: week.length - weekTrain.length,
      daysSinceActive,
      /** 选中的周是不是「今天所在的那一周」：决定右边说「本周」还是「当周」 */
      isThisWeek: todayKey >= mk && todayKey <= sk,
      /** 选中日期相对今天的位置：左边那句短话的语义完全由它决定 */
      isPastDay: dayKey < todayKey,
      isFutureDay: dayKey > todayKey,
    };
  }, [schedules, sel, todayKey, dayKey]);

  /**
   * 有没有过训练记录。休息日不算训练（它不需要人动手），
   * 所以只排过休息日、或者把历史里的训练全删了，这里都会是 false。
   */
  const hasTraining = useMemo(
    () => schedules.some((s) => s.type !== 'rest'),
    [schedules],
  );

  /**
   * 数据条左侧那句短话。
   * 今天 → 说「当下的连续战绩」；历史 → 说「那天的结果」；未来 → 只说「安排」。
   * 三种时间态必须分开，否则会出现「三个月前的那天，你已坚持 12 天」这种驴唇不对马嘴。
   */
  const leftView = useMemo((): {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    color: string;
    prefix?: string;
    num?: string;
    unit?: string;
    text?: string;
    /** 副文案：空态时不给（这一天什么都没排，就别再补一句评价了，劝的话交给下方空态卡） */
    sub?: string;
    /** 有值就表示「这一档用自绘火焰」，值即轮廓形态；其余状态仍用 Ionicons */
    flame?: 'solid' | 'linear';
  } => {
    const total = daySchedules.length;
    const doneCount = daySchedules.filter((s) => isFinished(s, todayKey)).length;
    // 训练与休息分开：文案要对得上「练了」还是「歇了」，不能混着说
    const trainList = daySchedules.filter(isTraining);
    const trainTotal = trainList.length;
    const trainDone = trainList.filter((s) => isFinished(s, todayKey)).length;

    // 未来：还没发生，只陈述排了几条，不做任何评价
    if (statsBar.isFutureDay) {
      return total > 0
        ? { icon: 'calendar-outline', color: C.primary, text: `已安排 ${total} 条`, sub: '到时候见' }
        : { icon: 'calendar-outline', color: C.gray, text: '还没安排' };
    }

    // 历史：说那天的结果
    if (statsBar.isPastDay) {
      // 那天压根没排——别说「忙忘啦」，那是在冤枉人
      if (total === 0) {
        return { icon: 'remove-outline', color: C.gray, text: '没安排' };
      }
      // 那天只排了休息：这是计划内的恢复日，不能按「训练完成率」去算
      if (trainTotal === 0) {
        return doneCount === total
          ? { icon: 'moon', color: C.typeDot.rest, text: '休息到位', sub: '歇够了才练得动' }
          // 「下次记得勾一下」是在指责用户，而休息日本来就不需要他操作，责任在产品
          : { icon: 'moon-outline', color: C.gray, text: '休息没打卡', sub: '忘勾了，不影响休息' };
      }
      if (trainDone === trainTotal) {
        return { icon: 'checkmark-circle', color: C.done, text: '全部完成', sub: '这天没偷懒' };
      }
      if (trainDone > 0) {
        return {
          icon: 'checkmark-circle-outline', color: C.halfUp,
          text: `完成 ${trainDone}/${trainTotal}`, sub: '差一点就满分',
        };
      }
      return { icon: 'ellipse-outline', color: C.gray, text: '没完成', sub: '大概是忙忘了' };
    }

    // 今天：火焰三态，严格对应「今天做到了没有」
    // ① 今天已经算完成（训练勾了，或今天本来就是休息日）→ 实心，真的点亮了
    if (doneCount > 0) {
      const restOnlyToday = trainTotal === 0 && total > 0;
      return {
        icon: 'flame', color: C.fire, flame: 'solid',
        prefix: '已坚持', num: String(statsBar.streak), unit: '天',
        // 副文案跟着阶位走：每满 10 天换一句，和火焰的华丽度同步升级
        sub: restOnlyToday ? '该歇就歇，才练得久' : streakSub(statsBar.streak),
      };
    }
    // ② 今天还没完成，但有连续记录 → 档位色线性，亮着但没实心：提醒今天还差一次
    if (statsBar.streak > 0) {
      return {
        icon: 'flame-outline', color: C.fire, flame: 'linear',
        prefix: '已坚持', num: String(statsBar.streak), unit: '天',
        sub: total === 0 ? undefined : '今天补上，别断了',
      };
    }
    // ③ 没有连续记录 → 线性灰
    // 今天排了训练只是没勾：他知道自己要练什么，「还没动」就够了
    if (total > 0) {
      return {
        icon: 'flame-outline', color: C.gray, flame: 'linear',
        text: '今天还没动',
        sub: '练完来打个勾',
      };
    }
    // 今天一条都没排：这就是空态。数据条只说事实，不劝 ——
    // 一屏只劝一次，劝的活归下方那张空态卡（它有三个训练色块和按钮）
    // 但如果连一条训练记录都没有（新用户，或把历史都删光了），
    // 「今天还没排」是在陈述一件他不知道怎么改的事，换成「第一次来？」才对得上他现在的处境。
    return {
      icon: 'flame-outline', color: C.gray, flame: 'linear',
      text: hasTraining ? '今天还没排' : '第一次来？',
    };
  }, [daySchedules, statsBar, hasTraining]);

  const prevDate = new Date(view.y, view.m - 1, 1);
  const nextDate = new Date(view.y, view.m + 1, 1);

  // 切换月份：目标月就是"今天"所在的月，就选中今天；否则回到 1 号
  const shiftMonth = (delta: number) => {
    const base = viewRef.current;
    const target = new Date(base.y, base.m + delta, 1);
    const y = target.getFullYear();
    const m = target.getMonth();
    const isTodayMonth = y === today.getFullYear() && m === today.getMonth();
    const d = isTodayMonth ? today.getDate() : 1;
    selectDate(y, m, d, true);
  };

  // 点按钮切月时顺手把位移归零，防止任何残留偏移
  const goShift = (delta: number) => {
    resetTx();
    shiftMonth(delta);
  };

  // PanResponder 里要用最新闭包，用 ref 中转
  const shiftRef = useRef(shiftMonth);
  shiftRef.current = shiftMonth;

  const goToday = () => {
    resetTx();
    const y = today.getFullYear();
    const m = today.getMonth();
    selectDate(y, m, today.getDate(), true);
  };

  // 稳定的点击回调，配合 memo 避免三个网格无意义重渲染
  const pressDay = useCallback((cell: Cell, gy: number, gm: number) => {
    if (cell.type === 'cur') {
      selectRef.current(gy, gm, cell.day);
      return;
    }
    // 上月补位日期：跳到上月并选中那天
    const p = new Date(gy, gm - 1, 1);
    selectRef.current(p.getFullYear(), p.getMonth(), cell.day, true);
  }, []);

  /**
   * 长按日期：直接在这天新建训练。
   * 用 addAtRef 中转 onAddAt，保持 useCallback 引用稳定（否则三张网格会跟着重渲染）。
   * 跨月补位日期归到相邻月；同时选中那天，返回时日历停在这天。
   */
  const pressDayLong = useCallback((cell: Cell, gy: number, gm: number) => {
    let y = gy;
    let m = gm;
    if (cell.type !== 'cur') {
      const p = new Date(gy, gm - 1, 1);
      y = p.getFullYear();
      m = p.getMonth();
    }
    selectRef.current(y, m, cell.day, cell.type !== 'cur');
    addAtRef.current?.({ y, m, d: cell.day });
  }, []);

  /** 松手确认切月：先平滑滑到相邻页，再整棵重挂（月份 + 归零位移 + epoch 同批提交） */
  const commitPage = (dir: 1 | -1, from: number) => {
    const w = gridWRef.current || 300;
    lock();
    // 剩下的距离越远，动画稍长一点，速度手感保持一致
    const remaining = Math.min(Math.abs(-dir * w - from), w);
    const duration = 130 + Math.round((remaining / w) * 150);

    Animated.timing(txRef.current, {
      toValue: -dir * w,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // 不管动画是否被判为中断，都完成切月，避免卡在半路（选不中、点不动）
      shiftRef.current(dir);
      setTx(new Animated.Value(0));
      setEpoch((e) => e + 1);
      unlock();
    });
  };
  const commitRef = useRef(commitPage);
  commitRef.current = commitPage;

  // 回弹：轻微阻尼，不是硬弹回去
  const springBack = () => {
    Animated.spring(txRef.current, {
      toValue: 0,
      useNativeDriver: true,
      stiffness: 210,
      damping: 24,
      mass: 1,
    }).start();
  };
  const springRef = useRef(springBack);
  springRef.current = springBack;

  // 左右滑动切月：拖动时内容跟手，超出边界后带阻尼，松手按距离/速度判断
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !isBusy() && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,

      onPanResponderMove: (_, g) => {
        if (isBusy()) return;
        const w = gridWRef.current || 300;
        const abs = Math.abs(g.dx);
        // 一屏之内 1:1 跟手；超出一屏后进入橡皮筋，越拖越沉
        const v = abs <= w
          ? g.dx
          : Math.sign(g.dx) * (w + (abs - w) * 0.25);
        txRef.current.setValue(v);
      },

      onPanResponderRelease: (_, g) => {
        if (isBusy()) return;
        const w = gridWRef.current || 300;
        const goNext = g.dx < -w * 0.18 || g.vx < -0.4;
        const goPrev = g.dx > w * 0.18 || g.vx > 0.4;

        if (goNext || goPrev) {
          commitRef.current(goNext ? 1 : -1, g.dx);
        } else {
          springRef.current();
        }
      },

      onPanResponderTerminate: () => {
        if (isBusy()) return;
        springRef.current();
      },
    }),
  ).current;

  return (
    <View style={styles.root}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 顶部：头像 + 月份（可点，弹出日期选择）+ 功能图标 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onOpenProfile} activeOpacity={0.8}>
            <Image
              source={avatar ? { uri: avatar } : require('../../assets/avatar.png')}
              style={styles.avatar}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.titleBox}
            activeOpacity={0.7}
            onPress={() => onOpenPicker({ ...sel }, (y, m, d) => {
              resetTx();
              selectRef.current(y, m, d, true);
            })}
          >
            <View style={styles.monthRow}>
              <Text style={styles.month}>{view.y}年{view.m + 1}月</Text>
              <Ionicons name="chevron-down" size={14} color={C.text} style={styles.monthCaret} />
            </View>
          </TouchableOpacity>

          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.iconCircle} activeOpacity={0.7}>
              <Ionicons name="search-outline" size={18} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconCircle}
              activeOpacity={0.7}
              onPress={onOpenSettings}
            >
              <Ionicons name="settings-outline" size={18} color={C.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 月份切换 */}
        <View style={styles.monthSwitch}>
          <TouchableOpacity style={styles.pill} activeOpacity={0.7} onPress={() => goShift(-1)}>
            <Ionicons name="chevron-back-outline" size={14} color={C.gray} />
            <Text style={styles.pillText}>上月</Text>
          </TouchableOpacity>
          {/*
            「今天」按钮兼两个身份：
            - 已经选中今天 → 只是状态标签，写「今天」，禁用（点了也没有可做的事）
            - 选中别的日期 → 变成可点的动作，写「回到今天」，实心主色更显眼
            这样文案自己就说清了「能不能点」，不需要再靠置灰去猜。
          */}
          <TouchableOpacity
            style={[styles.pill, isToday ? styles.pillToday : styles.pillBack]}
            activeOpacity={0.7}
            onPress={goToday}
            disabled={isToday}
          >
            <Text style={isToday ? styles.pillTodayText : styles.pillBackText}>
              {isToday ? '今天' : '回到今天'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pill} activeOpacity={0.7} onPress={() => goShift(1)}>
            <Text style={styles.pillText}>下月</Text>
            <Ionicons name="chevron-forward-outline" size={14} color={C.gray} />
          </TouchableOpacity>
        </View>

        {/* 星期标题 */}
        <View style={styles.weekRow}>
          {WEEK_DAYS.map((w, i) => (
            <Text key={i} style={[styles.weekText, i >= 5 && styles.weekTextWeekend]}>{w}</Text>
          ))}
        </View>

        {/* 月历网格：横向排三个月，拖动时整条平移，实现跟手滑动 */}
        <View
          style={styles.gridWrap}
          onLayout={(e) => setGridW(Math.round(e.nativeEvent.layout.width))}
          {...pan.panHandlers}
        >
          <Animated.View
            key={`track-${epoch}`}
            style={[
              styles.gridTrack,
              {
                width: gridW * 3,
                marginLeft: -gridW,
                transform: [{ translateX: tx }],
              },
            ]}
          >
            <View style={{ width: gridW }}>
              <MonthGrid
                y={prevDate.getFullYear()}
                m={prevDate.getMonth()}
                selDay={-1}
                paint={false}
                withBlob={false}
                blobX={blobX}
                blobY={blobY}
                grow={grow}
                blobOpacity={blobOpacity}
                ghostX={ghostX}
                ghostY={ghostY}
                ghostScale={ghostScale}
                ghostOpacity={ghostOpacity}
                dotsByDay={dotsByDay}
                onPressDay={pressDay}
                onLongPressDay={pressDayLong}
              />
            </View>
            <View style={{ width: gridW }}>
              <MonthGrid
                y={view.y}
                m={view.m}
                selDay={sel.d}
                paint={paint}
                withBlob
                blobX={blobX}
                blobY={blobY}
                grow={grow}
                blobOpacity={blobOpacity}
                ghostX={ghostX}
                ghostY={ghostY}
                ghostScale={ghostScale}
                ghostOpacity={ghostOpacity}
                dotsByDay={dotsByDay}
                onPressDay={pressDay}
                onLongPressDay={pressDayLong}
              />
            </View>
            <View style={{ width: gridW }}>
              <MonthGrid
                y={nextDate.getFullYear()}
                m={nextDate.getMonth()}
                selDay={-1}
                paint={false}
                withBlob={false}
                blobX={blobX}
                blobY={blobY}
                grow={grow}
                blobOpacity={blobOpacity}
                ghostX={ghostX}
                ghostY={ghostY}
                ghostScale={ghostScale}
                ghostOpacity={ghostOpacity}
                dotsByDay={dotsByDay}
                onPressDay={pressDay}
                onLongPressDay={pressDayLong}
              />
            </View>
          </Animated.View>
        </View>

        {/* 数据条：左侧说「今天/那天怎么样了」，右侧说「这一周练了几次」 */}
        <View style={styles.statsBar}>
          <View style={styles.statsLeft}>
            <View style={styles.statsFireRow}>
              {/*
                用 App 同款 Ionicons 扁平图标替代 emoji（emoji 是全彩写实风，和扁平界面不是一套）。
                图标形状本身就区分状态：火焰=当下战绩、勾=完成、空圈=没完成、横线=没安排。
              */}
              {leftView.flame ? (
                <StreakFlame
                  streak={statsBar.streak}
                  doneToday={leftView.flame === 'solid'}
                  size={17}
                />
              ) : (
                <Ionicons name={leftView.icon} size={17} color={leftView.color} />
              )}
              <View style={styles.statsStreakPair}>
                {leftView.num !== undefined ? (
                  <>
                    {leftView.prefix ? (
                      <Text style={styles.statsStreakPrefix}>{leftView.prefix}</Text>
                    ) : null}
                    <Text style={styles.statsStreakNum}>{leftView.num}</Text>
                    {leftView.unit ? (
                      <Text style={styles.statsStreakLabel}>{leftView.unit}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.statsStreakStart}>{leftView.text}</Text>
                )}
              </View>
            </View>
            {/* 空态没有副文案：数据条在这一屏只负责报事实，整条会更矮、更轻 */}
            {leftView.sub ? (
              <Text style={styles.statsStreakSub}>{leftView.sub}</Text>
            ) : null}
          </View>

          <View style={styles.statsRight}>
            {statsBar.weekTotal === 0 ? (
              // 这一周没有训练安排：先看有没有排休息（排了就不是「没安排」）
              <Text style={styles.statsEmpty}>
                {statsBar.weekRest > 0
                  ? `${statsBar.isThisWeek ? '本周' : '当周'}休息 ${statsBar.weekRest} 天`
                  : statsBar.isThisWeek
                    // 整周一条训练都没有：给一个"接下来做什么"，比一句「这周还空着」有用。
                    // 不带 › ：它不可点（点了没反应的东西标成链接是骗人），只是一句提示。
                    ? '下滑开始安排运动吧'
                    : (statsBar.isPastDay ? '那周是空的' : '还空着')}
              </Text>
            ) : (
              /*
                只留一行「本周 3/7 次 ›」，去掉那条 4px 进度条 ——
                进度条比例要靠它自己算，读起来是第二道算术题；
                而「3/7」本身既是数据，又是进分析页的入口。
              */
              <TouchableOpacity
                style={styles.statsWeekRow}
                activeOpacity={0.6}
                onPress={onOpenReport}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                {/* 选中历史周还说「本周训练」就是错的，按是否本周切换措辞 */}
                <Text style={styles.statsWeekText}>
                  {statsBar.isThisWeek ? '本周' : '当周'}
                </Text>
                <Text style={styles.statsWeekNum}>
                  {statsBar.weekDone}<Text style={styles.statsWeekTotal}>/{statsBar.weekTotal}</Text>
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={12}
                  color={C.gray}
                  style={styles.statsWeekCaret}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/*
          标题行：左边日期，右边一句操作提示（同一行，读起来是一句话）。
          原来右侧挂的「全部」已经去掉：设置页和「我的」页都有历史日程入口，
          首页这个链接只是更快一步，却一直占着最贵的一行右侧。
          「1 个日程」单独占下一行，不跟日期抢宽度。
        */}
        <View style={styles.listHeader}>
          <View style={styles.listTitleRow}>
            <Text style={styles.listTitle}>
              {sel.m + 1}月{sel.d}日 星期{WEEK_DAYS[weekdayIndex(selDate)]}
            </Text>
            {/* 提示只要列表里有条目就常驻：它是这行的操作说明，不是新手引导 */}
            {dayCount > 0 && (
              <Text style={styles.listHint} numberOfLines={1}>
                先点开看详情 · 点标签标完成
              </Text>
            )}
          </View>
          <Text style={styles.listSub}>
            {dayCount > 0 ? `${dayCount} 个日程` : '暂无训练'}
          </Text>
        </View>

        {/* 当天日程：按开始时间排序，没有就显示空状态 */}
        {dayCount > 0 ? (
          daySchedules.map((s) => (
            <ScheduleCapsule
              key={s.id}
              item={s}
              todayKey={todayKey}
              onPress={() => onOpenDetail(s)}
              onToggle={() => onToggleComplete(s.id)}
              onGoTrain={onGoTrain}
            />
          ))
        ) : (
          /*
            空状态不只是「这天没东西」，它还是新用户第一次打开时唯一的落点。
            空月历本身零信息量（可以是日历 / 待办 / 记账），所以这里用三个训练色块
            直接把「这是个练什么的 App」摆出来 —— 视觉，而不是一句说明文字。
            老用户只要有任意一条日程，就永远看不到这块。
          */
          <View style={styles.empty}>
            <View style={styles.emptyTypes}>
              {(['rope', 'fitness', 'run'] as ScheduleType[]).map((t) => (
                <View key={t} style={styles.emptyType}>
                  <View style={[styles.emptyTypeDot, { backgroundColor: C.typeDot[t] }]} />
                  <Text style={styles.emptyTypeText}>{TYPE_NAME[t]}</Text>
                </View>
              ))}
            </View>

            <View style={styles.emptyCopy}>
              <Text style={styles.emptyLead}>
                {isToday
                  ? '慢走三分钟，也算练过'
                  : (statsBar.isPastDay ? '这天没留下记录' : '这天还是空的')}
              </Text>
              {/* 专门拆掉「今天算了」的借口：要装备、要热身、要练很久 */}
              {isToday && (
                <Text style={styles.emptySub}>不用装备，不用热身，想停就停</Text>
              )}
            </View>

            <TouchableOpacity
              style={styles.emptyCta}
              activeOpacity={0.85}
              onPress={onAddQuick ?? onOpenAdd}
            >
              <Ionicons name="add" size={15} color={C.white} />
              <Text style={styles.emptyCtaText}>{isToday ? '先动三分钟' : '排一条'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/*
        右下角加号只在「这天已经有日程」时出现。
        空态卡片里本来就有自己的主按钮，再放一个蓝色圆钮，两个蓝色抢同一件事，只会让人犹豫。
      */}
      {dayCount > 0 && (
        <TouchableOpacity style={styles.fab} onPress={onOpenAdd} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color={C.white} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  // 底部留白必须大于「FAB 底距 22 + 自身 52」= 74，否则滚到底时最后一条的状态胶囊会被加号盖住
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 88 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  titleBox: { marginLeft: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center' },
  month: { fontSize: 17, fontWeight: '600', color: C.text },
  monthCaret: { marginLeft: 4, marginTop: 1 },
  headerIcons: { flexDirection: 'row', gap: 10, marginLeft: 'auto' },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
  },

  monthSwitch: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 16, backgroundColor: C.soft,
  },
  pillText: { fontSize: 12, color: C.sub },
  pillToday: { backgroundColor: '#EAF1FE' },
  pillTodayText: { fontSize: 12, color: C.primary, fontWeight: '500' },
  // 选中别的日期时：变成实心主色的动作按钮，「回到今天」四个字也放得下
  pillBack: { backgroundColor: C.primary },
  pillBackText: { fontSize: 12, color: C.white, fontWeight: '600' },

  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekText: { flex: 1, textAlign: 'center', fontSize: 12, color: C.sub },
  weekTextWeekend: { color: WEEKEND_COLOR, fontWeight: 'bold' },

  gridWrap: { height: ROW_H * MAX_ROWS, overflow: 'hidden', marginBottom: 8 },
  gridTrack: { flexDirection: 'row' },
  // 单个月份：长条层 + 滑块层都绝对定位在这一层上，日期格按流式排在最后（画在最上面）
  gridPage: { position: 'relative' },
  gridRow: { flexDirection: 'row', height: ROW_H },
  dayBand: {
    position: 'absolute', height: 34,
    backgroundColor: BAND, borderRadius: 10,
  },
  // 有训练的日期，在底灰条下方延伸的凸台（放圆点用）：
  // 默认（中间段）顶部直角无缝贴主灰条、底部圆角收尾
  // height 比 DOT_ZONE 多 1，补偿 top 上移的 1px，保证底部位置不变
  dayBandTall: {
    position: 'absolute', height: DOT_ZONE + 1,
    backgroundColor: BAND,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
  },
  // 端部填充块：直角块，填平主灰条左右端圆角凹坑，让侧边变成竖直平边（类似 I）
  edgeFillL: {
    position: 'absolute', left: 0, top: -9,
    width: 10, height: 10,
    backgroundColor: BAND,
  },
  edgeFillR: {
    position: 'absolute', right: 0, top: -9,
    width: 10, height: 10,
    backgroundColor: BAND,
  },
  // 选中态的液体滑块：尺寸/圆角显式写死，避免安卓上圆角丢失变成方块
  // 位置完全由 translateX / translateY 决定（left/top 固定 0），方便用 native driver
  blob: {
    position: 'absolute', left: 0, top: 0,
    width: BLOB, height: BLOB, borderRadius: BLOB / 2,
    backgroundColor: C.primary,
  },
  cell: {
    width: '14.2857%',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  dayBox: {
    width: BLOB, height: BLOB, borderRadius: BLOB / 2,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
    marginTop: BLOB_TOP,
  },
  // 训练圆点：日期数字正下方，横排，同类聚合（每种类型一个点，最多 4 个）
  // 4px → 5px：马卡龙色本身浅，靠尺寸把存在感补回来，同时不会像深色那样在灰条上"砸"出黑点
  // marginTop 3 + 高 5 = 总占位 8，和空行占位(8)一致，有没有点的行不会错位
  // 中心落在凸台(39~52)正中 45.5，不偏下；gap 3 让三点之间透气，不连成一坨
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, height: 5 },
  dotRowEmpty: { height: 8 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  // 三个静态文字样式：日期数字统一深灰；选中后加粗；液滴到位后再变白
  // （Android 中文对数字字重响应差，用 'bold' 更稳；字号微增让加粗更明显）
  // 非选中态再按 周末橙 / 跨月淡化 区分，选中逻辑（dayWait/dayOn）保持原样
  dayOff: { fontSize: 14, color: DAY_TEXT_COLOR },
  dayWeekend: { fontSize: 14, fontWeight: 'bold', color: WEEKEND_COLOR },
  dayDim: { fontSize: 14, color: DIM_COLOR },
  dayWait: { fontSize: 15, fontWeight: 'bold', color: DAY_TEXT_COLOR },
  dayOn: { fontSize: 15, fontWeight: 'bold', color: C.white },

  empty: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 26, paddingHorizontal: 18, gap: 14,
    borderWidth: 1, borderColor: C.line, borderRadius: 18,
    backgroundColor: C.white,
  },
  // 三个训练色块：新用户第一眼「这是什么 App」的答案，靠视觉不靠文字
  emptyTypes: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  emptyType: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emptyTypeDot: { width: 8, height: 8, borderRadius: 4 },
  emptyTypeText: { fontSize: 12, color: C.text },
  emptyLead: { fontSize: 13, fontWeight: '500', color: C.text },
  emptyCopy: { alignItems: 'center', gap: 5 },
  emptySub: { fontSize: 12, color: C.sub },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primary, borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 9,
  },
  emptyCtaText: { fontSize: 13, color: C.white, fontWeight: '500' },

  // 数据条：连续打卡 + 本周训练进度
  statsBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: BAND, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 12, marginBottom: 18,
  },
  statsLeft: {},
  statsFireRow: { flexDirection: 'row', alignItems: 'center' },
  // 数字和「天」用 baseline 对齐，图标用外层 center 对齐数字块，不会一高一低
  statsStreakPair: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 5 },
  // 「已坚持」作为前缀小字，和「天」同一层级；数字才是视觉重点
  statsStreakPrefix: { fontSize: 12, color: C.sub },
  statsStreakNum: { fontSize: 22, fontWeight: 'bold', color: C.text, marginLeft: 3 },
  statsStreakLabel: { fontSize: 12, color: C.sub, marginLeft: 2 },
  // 0 天时显示的邀请文案，替代「已坚持 0 天」
  statsStreakStart: { fontSize: 15, fontWeight: '600', color: C.text },
  statsStreakSub: { fontSize: 11, color: C.sub, marginTop: 3 },
  statsRight: { alignItems: 'flex-end' },
  // 本周没排训练时的引导文案
  statsEmpty: { fontSize: 13, color: C.primary, fontWeight: '500' },
  statsWeekRow: { flexDirection: 'row', alignItems: 'baseline' },
  statsWeekText: { fontSize: 12, color: C.sub },
  // 和右侧「这周还空着」同一个主色蓝：同一块区域两种状态用同一套色，视觉连贯
  statsWeekNum: { fontSize: 18, fontWeight: 'bold', color: C.primary, marginLeft: 6 },
  statsWeekTotal: { fontSize: 13, fontWeight: '600', color: C.sub },
  // 箭头告诉用户「这行字能点」，也是唯一说明它是入口的地方
  statsWeekCaret: { marginLeft: 1, alignSelf: 'center' },

  // 标题和提示同一行：提示跟在「星期二」右边，读到它时正好在日期上
  listHeader: { marginBottom: 12 },
  listTitleRow: { flexDirection: 'row', alignItems: 'baseline' },
  listTitle: { fontSize: 15, fontWeight: '600', color: C.text, flexShrink: 0 },
  // 「今天」徽章已移除：上方按钮已经能表达「你在今天」，两处重复只增加视觉噪音
  listSub: { fontSize: 11, color: C.sub, marginTop: 3 },
  // 操作提示跟在标题右侧：窄屏时允许压缩截断，也不许把标题挤歪
  listHint: { fontSize: 11, color: C.sub, marginLeft: 8, flexShrink: 1 },

  fab: {
    position: 'absolute', right: 20, bottom: 22,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
});

/**
 * 日历页是常驻底层的，App 每次重渲染（切页面、开关选择器等）都会重建它的元素。
 * memo + 稳定的 props 引用可以让它整页跳过重算 —— 否则三张月历网格会在点下去的
 * 那一帧跟着重渲染，那正是"点开会卡一下"的主因之一。
 */
export default memo(CalendarScreen);
