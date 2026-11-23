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
  buildMonthCells, Cell, completedStreak, dateKey, dateKeyOf, sameDay,
  timeToMinutes, weekdayIndex,
} from '../utils/date';
import ScheduleCapsule from '../components/ScheduleCapsule';

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
  /** 点当天列表右上角「全部」：进历史日程 */
  onOpenHistory: () => void;
  /** 头像 uri：改过资料后首页一起更新 */
  avatar?: string;
  /** 点卡片「去训练」入口：本轮只弹提示 */
  onGoTrain?: () => void;
  /** 长按月历某天：直接在这天新建训练 */
  onAddAt?: (d: { y: number; m: number; d: number }) => void;
};

// 月历日期数字统一颜色：比黑色淡一点的深灰
const DAY_TEXT_COLOR = '#2F3239';
// 周末（周六、周日）的活力淡橙
const WEEKEND_COLOR = '#FF9A45';
// 跨月补位日期（上月末尾）的淡化灰
const DIM_COLOR = '#C4C9D2';
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
  onOpenSettings, onOpenHistory, schedules, initialDate, onToggleComplete, avatar,
  onGoTrain, onAddAt,
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
    const order: ScheduleType[] = ['rope', 'fitness', 'run'];
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
    const done = schedules.filter((s) => s.completed);
    const streak = completedStreak(done.map((s) => s.date));
    const base = new Date(sel.y, sel.m, sel.d);
    const wd = (base.getDay() + 6) % 7; // 0=周一 … 6=周日
    const monday = new Date(sel.y, sel.m, sel.d - wd);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const mk = dateKeyOf(monday);
    const sk = dateKeyOf(sunday);
    const week = schedules.filter((s) => s.date >= mk && s.date <= sk);
    return {
      streak,
      weekDone: week.filter((s) => s.completed).length,
      weekTotal: week.length,
    };
  }, [schedules, sel]);

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
          <TouchableOpacity style={[styles.pill, styles.pillToday]} activeOpacity={0.7} onPress={goToday}>
            <Text style={styles.pillTodayText}>今天</Text>
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

        {/* 数据条：连续打卡 + 本周训练进度，放在月历和日程列表之间 */}
        <View style={styles.statsBar}>
          <View style={styles.statsLeft}>
            <View style={styles.statsFireRow}>
              {/* 用 App 同款 Ionicons 扁平火焰替代 emoji：emoji 是全彩写实风，和扁平界面不是一套 */}
              <Ionicons
                name="flame"
                size={17}
                color={statsBar.streak > 0 ? WEEKEND_COLOR : C.gray}
              />
              <View style={styles.statsStreakPair}>
                <Text style={styles.statsStreakNum}>{statsBar.streak}</Text>
                <Text style={styles.statsStreakLabel}>天</Text>
              </View>
            </View>
            <Text style={styles.statsStreakSub}>
              {statsBar.weekTotal === 0 ? '该运动啦' : '保持住，别断签'}
            </Text>
          </View>

          <View style={styles.statsRight}>
            {statsBar.weekTotal === 0 ? (
              // 本周还没排训练：不显示 0/0 和空进度条，改成引导文案
              <Text style={styles.statsEmpty}>该运动啦 ›</Text>
            ) : (
              <>
                <View style={styles.statsWeekRow}>
                  <Text style={styles.statsWeekText}>本周训练</Text>
                  <Text style={styles.statsWeekNum}>
                    {statsBar.weekDone}<Text style={styles.statsWeekTotal}>/{statsBar.weekTotal}</Text>
                  </Text>
                  <Text style={styles.statsWeekUnit}>次</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.min(100, (statsBar.weekDone / statsBar.weekTotal) * 100)}%` },
                    ]}
                  />
                </View>
              </>
            )}
          </View>
        </View>

        {/* 当天日程标题 */}
        <View style={styles.listHeader}>
          <View style={styles.listTitleRow}>
            <Text style={styles.listTitle}>
              {sel.m + 1}月{sel.d}日 星期{WEEK_DAYS[weekdayIndex(selDate)]}
            </Text>
            {isToday && (
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>今天</Text>
              </View>
            )}
          </View>
          <Text style={styles.listSub}>
            {dayCount > 0
              ? `${dayCount} 个日程 · 点开看详情`
              : '暂无日程'}
          </Text>
          <TouchableOpacity activeOpacity={0.7} onPress={onOpenHistory}>
            <Text style={styles.allLink}>全部</Text>
          </TouchableOpacity>
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
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={20} color={C.gray} />
            <Text style={styles.emptyText}>这天还没安排，点 + 加个训练</Text>
          </View>
        )}
      </ScrollView>

      {/* 右下角悬浮加号 */}
      <TouchableOpacity style={styles.fab} onPress={onOpenAdd} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color={C.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },

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
  pillText: { fontSize: 12, color: C.gray },
  pillToday: { backgroundColor: '#EAF1FE' },
  pillTodayText: { fontSize: 12, color: C.primary, fontWeight: '500' },

  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekText: { flex: 1, textAlign: 'center', fontSize: 12, color: C.gray },
  weekTextWeekend: { color: WEEKEND_COLOR, fontWeight: 'bold' },

  gridWrap: { height: ROW_H * MAX_ROWS, overflow: 'hidden', marginBottom: 8 },
  gridTrack: { flexDirection: 'row' },
  // 单个月份：长条层 + 滑块层都绝对定位在这一层上，日期格按流式排在最后（画在最上面）
  gridPage: { position: 'relative' },
  gridRow: { flexDirection: 'row', height: ROW_H },
  dayBand: {
    position: 'absolute', height: 34,
    backgroundColor: '#F2F3F6', borderRadius: 10,
  },
  // 有训练的日期，在底灰条下方延伸的凸台（放圆点用）：
  // 默认（中间段）顶部直角无缝贴主灰条、底部圆角收尾
  // height 比 DOT_ZONE 多 1，补偿 top 上移的 1px，保证底部位置不变
  dayBandTall: {
    position: 'absolute', height: DOT_ZONE + 1,
    backgroundColor: '#F2F3F6',
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
  },
  // 端部填充块：直角块，填平主灰条左右端圆角凹坑，让侧边变成竖直平边（类似 I）
  edgeFillL: {
    position: 'absolute', left: 0, top: -9,
    width: 10, height: 10,
    backgroundColor: '#F2F3F6',
  },
  edgeFillR: {
    position: 'absolute', right: 0, top: -9,
    width: 10, height: 10,
    backgroundColor: '#F2F3F6',
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
  // 训练圆点：日期数字正下方，横排，同类聚合（每种类型一个点，最多 3 个）
  // 圆点垂直居中在「蓝圆底(40)」与「凸出灰条底(52)」之间，中心落在 46
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, height: 4 },
  dotRowEmpty: { height: 8 },
  dot: { width: 4, height: 4, borderRadius: 2 },
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
    paddingVertical: 36, gap: 8,
    borderWidth: 1, borderColor: C.line, borderRadius: 18, borderStyle: 'dashed',
  },
  emptyText: { fontSize: 12, color: C.gray },

  // 数据条：连续打卡 + 本周训练进度
  statsBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F7F8FA', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 12, marginBottom: 18,
  },
  statsLeft: {},
  statsFireRow: { flexDirection: 'row', alignItems: 'center' },
  // 数字和「天」用 baseline 对齐，图标用外层 center 对齐数字块，不会一高一低
  statsStreakPair: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 5 },
  statsStreakNum: { fontSize: 22, fontWeight: 'bold', color: C.text },
  statsStreakLabel: { fontSize: 12, color: C.gray, marginLeft: 2 },
  statsStreakSub: { fontSize: 11, color: C.gray, marginTop: 3 },
  statsRight: { alignItems: 'flex-end' },
  // 本周没排训练时的引导文案
  statsEmpty: { fontSize: 13, color: C.primary, fontWeight: '500' },
  statsWeekRow: { flexDirection: 'row', alignItems: 'baseline' },
  statsWeekText: { fontSize: 12, color: C.gray },
  // 和右侧「该运动啦」同一个主色蓝：同一块区域两种状态用同一套色，视觉连贯
  statsWeekNum: { fontSize: 18, fontWeight: 'bold', color: C.primary, marginLeft: 6 },
  statsWeekTotal: { fontSize: 13, fontWeight: '600', color: C.gray },
  statsWeekUnit: { fontSize: 12, color: C.gray, marginLeft: 2 },
  progressTrack: {
    width: 90, height: 4, borderRadius: 2,
    backgroundColor: '#E5E8EE', marginTop: 6, overflow: 'hidden',
  },
  progressFill: {
    height: 4, borderRadius: 2,
    backgroundColor: C.primary,
  },

  listHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  listTitleRow: { flexDirection: 'row', alignItems: 'center' },
  listTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  todayBadge: {
    marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 999, backgroundColor: '#EAF1FE',
  },
  todayBadgeText: { fontSize: 11, color: C.primary, fontWeight: '500' },
  listSub: { fontSize: 11, color: C.gray, marginTop: 3 },
  allLink: { fontSize: 12, color: C.primary },

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
