/**
 * 动作提示（现场纠错）。
 *
 * 目标：跳的过程中，只提醒「一眼就能改、改了马上有效」的问题。
 *
 * ## 坐标：优先用 worldLandmarks（真实 3D，单位米）
 *
 * MediaPipe 会同时回传两套关键点：
 *   · landmarks        —— 画面归一化坐标（x÷宽、y÷高），是"投影"
 *   · worldLandmarks   —— 以髋中点为原点、按米计算的 3D 坐标
 *
 * 为什么必须用后者：正对镜头做动作时，很多问题发生在**深度方向**——
 * 屈膝是把膝盖往前送（z 变），脚尖内八是把脚往内侧转（x/z 同时变）。
 * 只看投影的 x/y，"膝盖太弯"永远是个 180 度的假直角，
 * 脚尖朝向也会被透视压缩到看不出变化 —— 这正是上一版"根本不灵敏"的根因。
 *
 * 只有世界坐标缺失时才退回到投影坐标（此时 aspect 把 x 换算到和 y 同一个
 * 尺度：App 锁竖屏，aspect = min(w,h)/max(w,h) 一定 ≤ 1；
 * 库回传的尺寸是旋转前的传感器尺寸，直接相除会算反）。
 *
 * ## 读数要「尽量都读出来」
 *
 * 每一项单独判可用性：读不出来的给 null，别的项照常判。
 * 上一版是"任何一个点不可信就整帧作废"，手一贴髋（手腕被腿挡住）
 * 整段分析直接静默，表现就是"什么提示都没有"。
 */

/** 一条提示 = 一个问题码，文案统一从这张表取，别在界面里散着写 */
export type PostureKey =
  | 'sideway'
  | 'feetIn'
  | 'kneesBent'
  | 'armsWide'
  | 'handsUneven'
  | 'handsHigh'
  | 'handsLow'
  | 'headDown'
  | 'jumpHigh'
  | 'legRaiseHigh'
  | 'legRaiseLow';

/** 动作没问题时显示这句 */
export const POSTURE_OK = '动作 OK · 保持这个节奏';

/**
 * 文案。要求：先说"哪里不对"，再说"怎么改"，中间用「·」分开。
 * 字数控制在 12 个字以内 —— 跳着的时候没人读长句。
 */
export const POSTURE_TEXT: Record<PostureKey, string> = {
  sideway: '身体侧对镜头 · 转正',
  feetIn: '脚有点内八 · 脚尖朝前',
  kneesBent: '膝盖太弯 · 站直一点',
  armsWide: '手臂张太开 · 夹一点',
  handsUneven: '两手一高一低 · 抬平',
  handsHigh: '手抬太高 · 收到髋部',
  handsLow: '手放太低 · 抬到髋部',
  headDown: '头低下来了 · 目视前方',
  jumpHigh: '跳太高 · 落地轻一点',
  legRaiseHigh: '抬腿太高 · 放低一点',
  legRaiseLow: '抬腿太低 · 抬高一点',
};

/** 结算页用的短名：那里是标签，不是句子，越短越好 */
export const POSTURE_SHORT: Record<PostureKey, string> = {
  sideway: '身体侧对',
  feetIn: '脚内八',
  kneesBent: '膝盖太弯',
  armsWide: '手臂太开',
  handsUneven: '两手不齐',
  handsHigh: '手抬太高',
  handsLow: '手放太低',
  headDown: '低头',
  jumpHigh: '跳太高',
  legRaiseHigh: '抬腿太高',
  legRaiseLow: '抬腿太低',
};

/** 一帧读出来的动作指标。读不出来的那项是 null，交给 pickPosture 跳过 */
export type PostureSample = {
  /** 双手平均高度：0 = 与髋同高，1 = 与肩同高，负数 = 比髋低 */
  handUp: number | null;
  /** 两手高度差：0 = 齐平 */
  handDiff: number | null;
  /** 手腕离同侧髋的横向距离（越大越"张太开"） */
  armSpread: number | null;
  /** 身体朝向：0 度 = 正对镜头，90 度 = 完全侧对 */
  facing: number | null;
  /** 双肩横向宽度（占画面宽），朝向判据的第二道闸 */
  spanX: number;
  /** 膝盖角度：180 = 伸直，越小越弯 */
  kneeAngle: number | null;
  /** 鼻尖到肩线的竖直距离（越小越"低头"） */
  headDrop: number | null;
  /** 内八强度：脚尖/膝盖朝内的程度，0 = 正常 */
  inward: number | null;
  /**
   * 抬腿幅度（换脚跳专用）：单侧大腿抬起时，髋-膝连线与竖直方向的夹角，
   * 取两侧较大值。单位度。并脚跳不读这项（返回 null）。
   */
  legRaise: number | null;
};

/*
 * ============================================================================
 * 阈值体系：两套跳法 × 8 档速度（50 个/分一档，0~400）
 * ============================================================================
 *
 * 依据《动作评判标准表》（docs/动作评判标准表.md），来源为国家体育总局、
 * 央视/人民日报、高校速度跳绳讲义、吉尼斯世界纪录、中考体测标准。
 *
 * 分两类：
 *   A. 共同姿态判据 —— 与速度无关，两套跳法共用固定阈值；
 *   B. 速度相关判据 —— 跳高 / 膝盖 / 抬腿幅度，按当下绝对速度（rate）查表插值。
 */

/* ---- A. 共同姿态判据（不分速度、不分跳法） ---- */
/** 手抬到 0.42（小腹偏上）以上 */
const HAND_HIGH = 0.42;
/** 垂到 −0.60（膝盖附近）以下 */
const HAND_LOW = -0.60;
/** 两手差到 0.38（一个手掌高）以上 */
const HAND_DIFF = 0.38;
/** 手腕离髋横向 0.46（约 18cm）以上 = 张太开 */
const ARM_WIDE = 0.46;
/** 鼻到肩不到 0.30 个躯干 = 低头 */
const HEAD_DOWN = 0.30;
/** 内八 0.10（约 4cm）以上 */
const FEET_IN = 0.10;
/** 朝向 55 度以上 */
const FACING_SIDE = 55;
/** 双肩横向宽度小于画面宽 10% —— 真侧身时肩宽会掉到 2%~6% */
const SPAN_SIDE = 0.10;

/* ---- B. 速度相关判据 ---- */
/**
 * 速度档位边界：0, 50, 100, ... 400，共 8 档。
 * rate 落在哪两个边界之间，就在这两个边界对应的阈值之间线性插值。
 */
const RATE_STEPS = [0, 50, 100, 150, 200, 250, 300, 350, 400];

/**
 * 「细节姿态判据」的速度衰减。
 *
 * 为什么要有这一层：
 *   低头、脚尖朝向、手的高低这些是"慢速才讲究的细节"。速度一上去，
 *   人为了看清绳子落点会自然轻微低头、脚踝高速点地脚尖会有自然偏差、
 *   手也会下意识往上带一点发力——这些在高速下是**正常代偿**，不该被当成错误。
 *   硬拿慢速的"标准姿势"去卡高速，就是在高速档疯狂误报。
 *
 * 做法：这几条细节判据的阈值乘一个随速度单调增大的"门槛系数"，
 *   速度越快，越难触发。到 300+ 的冲刺档，系数大到几乎等于关闭。
 * 而"影响安全和速度"的核心判据（侧身、手臂张开、膝盖、跳高、抬腿）
 *   不受这层衰减影响，全程按各自标准卡。
 *
 * detailGate(rate) 返回一个 ≥1 的系数：
 *   慢速（≤100）→ 1.0（标准阈值，不衰减）
 *   200 → ~1.4，300 → ~2.2，400 → ~3.0（阈值放大，极难触发）
 * 用二次曲线，让中高速的衰减更平滑，不出现"一过某速度就突然不提示"的跳变。
 */
function detailGate(rate: number): number {
  const r = Math.max(0, Math.min(400, rate));
  // r≤100 不衰减；100 之后按 (r-100)/300 的平方放大，400 时放大到 1 + 2 = 3 倍
  const t = r <= 100 ? 0 : (r - 100) / 300;
  return 1 + 2 * t * t;
}

/**
 * 并脚跳（together）的速度相关阈值。
 *   jumpHigh —— 允许的最大跳高（躯干倍数，越大越宽松），随速度收紧；
 *   kneeMin  —— 允许的最小膝角（度，越弯越触发），随速度变直（阈值变大）。
 * 8 个值对应 8 档：0~50, 50~100, ... 350~400。
 */
const TOGETHER = {
  jumpHigh: [0.20, 0.15, 0.12, 0.07, 0.05, 0.04, 0.03, 0.025],
  kneeMin: [135, 145, 155, 162, 168, 172, 175, 178],
};

/**
 * 换脚跳（alternate）的速度相关阈值。
 *   jumpHigh   —— 允许最大跳高（比并脚跳宽松，单脚落地天然低）；
 *   legRaiseHi —— 抬腿角上限（度，超过算"抬太高"）。
 *                 慢速是"向前提膝"（高抬膝），高速转成"半高抬腿跑"——
 *                 抬腿幅度会变小，但**不会贴地**，而是稳定在一个中等区间。
 *                 依据：岑小林等世界冠军的"半蹲点地"、教学标准"离地3~5cm"、
 *                 "速度更高时提膝幅度变小，近似半高抬腿跑"。
 *                 所以高速档上限收敛到 ~32°，而不是一路压到很小；
 *   legRaiseLo —— 抬腿角下限（度，低于算"拖脚"），高速稳定在 ~12°；
 *   kneeMin    —— 始终微屈放松，固定 140（换脚跳要抬腿，膝盖天然更弯）。
 */
const ALTERNATE = {
  jumpHigh: [0.10, 0.10, 0.08, 0.06, 0.05, 0.04, 0.04, 0.04],
  // 上限：慢速 55°（高抬膝），随速度降到 ~32°（半高抬腿跑），不再往下压
  legRaiseHi: [55, 52, 48, 42, 36, 34, 32, 32],
  // 下限：慢速 15°（向前提膝），随速度降到 ~12°（半高抬腿跑的下沿），不贴地
  legRaiseLo: [15, 15, 14, 13, 12, 12, 12, 12],
  kneeMin: [140, 140, 140, 140, 140, 140, 140, 140],
};

/** 跳法类型（和 jumpStyle 的 key 对应） */
export type PostureStyle = 'together' | 'alternate';

/**
 * 取当前速度（rate，个/分）对应档位的阈值，两档之间线性插值。
 *
 * @param values 8 个值，对应 8 档
 * @param rate   当前实时节奏（个/分），会 clamp 到 0~400
 */
function interpolate(values: number[], rate: number): number {
  const r = Math.max(0, Math.min(400, rate));
  // 找到 r 落在哪个区间 [RATE_STEPS[i], RATE_STEPS[i+1]]
  // 注意：RATE_STEPS 有 9 个边界点（0~400），values 只有 8 个（对应 8 档）。
  // 最后一个区间是 [350,400]，对应 values[7]（第 8 档），i 最大到 7。
  let i = 0;
  while (i < RATE_STEPS.length - 2 && r > RATE_STEPS[i + 1]) i += 1;
  const lo = RATE_STEPS[i];
  const hi = RATE_STEPS[i + 1];
  const t = hi === lo ? 0 : (r - lo) / (hi - lo);
  const v0 = values[i];
  const v1 = values[Math.min(i + 1, values.length - 1)];
  return v0 + (v1 - v0) * t;
}

/** 当前速度 + 跳法下，某一项判据的阈值（进入提示用的严格阈值） */
type SpeedKey = 'jumpHigh' | 'kneeMin' | 'legRaiseHi' | 'legRaiseLo';

function thresholdAt(style: PostureStyle, key: SpeedKey, rate: number): number {
  const table = style === 'together' ? TOGETHER : ALTERNATE;
  // 两张表结构不同：TOGETHER 只有 jumpHigh/kneeMin，ALTERNATE 四者都有。
  // 调用方保证不会用 together 去查 legRaiseHi/Lo（抬腿只在换脚跳分支里查）。
  return interpolate((table as Record<string, number[]>)[key], rate);
}

/** B 是顶点（膝盖/肘），返回两段向量 BA 与 BC 的夹角；带 z 就是真 3D 角 */
function angleAt(
  a: number[], b: number[], c: number[],
) {
  const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const n1 = Math.hypot(v1[0], v1[1], v1[2]);
  const n2 = Math.hypot(v2[0], v2[1], v2[2]);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  const cos = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const avg = (a: number | null, b: number | null) => {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
};

const maxOf = (a: number | null, b: number | null) => {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
};

export type PostureReadOpts = {
  /** 躯干长度（肩中点→髋中点），和 lm 同一套单位 */
  torso: number;
  /** 投影坐标下把 x 换算到 y 尺度的系数；世界坐标传 1 */
  aspect: number;
  /** 双肩在画面里的横向宽度（0~1），朝向判据第二道闸用 */
  spanX: number;
  /** 是否使用世界坐标（含可信的 z） */
  use3d: boolean;
};

/**
 * 从一帧关键点里读出动作指标。
 *
 * @returns 连躯干都读不出来时返回 null；否则返回结构，单项可能为 null
 */
export function readPosture(lm: any[], opts: PostureReadOpts): PostureSample | null {
  const { torso, aspect, spanX, use3d } = opts;
  // 躯干太短 = 人离得太远或关键点糊了，这时所有比值都会被放大，整帧作废
  if (!(torso > 0.02) || lm.length < 33) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;

  const vis = (i: number) => lm[i]?.visibility ?? 1;
  const ok = (i: number, th = 0.35) => vis(i) > th;
  // 肩和髋必须先可信，否则"手相对髋的高度"没有意义
  if (vis(11) < 0.4 || vis(12) < 0.4 || vis(23) < 0.4 || vis(24) < 0.4) return null;

  /** 取点：x 乘 aspect 拉齐到 y 的尺度；z 只在世界坐标下参与 */
  const P = (i: number) => [
    lm[i].x * aspect,
    lm[i].y,
    use3d ? (lm[i].z ?? 0) : 0,
  ];
  const X = (i: number) => lm[i].x * aspect;
  const Y = (i: number) => lm[i].y;

  const hipY = (Y(23) + Y(24)) / 2;
  const shY = (Y(11) + Y(12)) / 2;

  /* ---- 手：高度 / 齐不齐 / 张不张开 ---- */
  const okL = ok(15, 0.2);
  const okR = ok(16, 0.2);
  const upL = okL ? (hipY - Y(15)) / torso : null;
  const upR = okR ? (hipY - Y(16)) / torso : null;
  const handUp = avg(upL, upR);
  // 只有两只手都看得见，才谈得上"齐不齐"
  const handDiff = okL && okR ? Math.abs(Y(15) - Y(16)) / torso : null;
  // 张太开：手腕离同侧髋的横向距离，取两边里大的那个
  const spreadL = okL ? Math.abs(X(15) - X(23)) / torso : null;
  const spreadR = okR ? Math.abs(X(16) - X(24)) / torso : null;
  const armSpread = maxOf(spreadL, spreadR);

  /* ---- 朝向 = atan2(双肩深度差, 双肩横向距离)，世界坐标下就是真角度 ---- */
  const dz = Math.abs((P(11)[2] ?? 0) - (P(12)[2] ?? 0));
  const dx = Math.abs(X(11) - X(12));
  const facingValid = Number.isFinite(dz) && dz < 1.2 && (dx > 1e-4 || dz > 1e-4);
  const facing = facingValid ? (Math.atan2(dz, dx) * 180) / Math.PI : null;

  /* ---- 膝盖角度：取两条腿里较直的那条，避免一条腿被挡住就误报 ---- */
  const kneeOne = (hip: number, knee: number, ankle: number) => {
    if (!ok(hip, 0.4) || !ok(knee, 0.4) || !ok(ankle, 0.3)) return null;
    return angleAt(P(hip), P(knee), P(ankle));
  };
  const kneeAngle = maxOf(kneeOne(23, 25, 27), kneeOne(24, 26, 28));

  /* ---- 低头：鼻尖到肩线的竖直距离（越小说明头越往下埋） ---- */
  const headDrop = ok(0, 0.5) ? (shY - Y(0)) / torso : null;

  /* ---- 内八：脚尖朝内 和 膝盖内扣 两路取大 ---- */
  /*
   * 关键：用「离身体中线的距离」来比，而不是用带正负的 x 相减。
   * 因为 MediaPipe 的 23/24 哪个是左、图像里落在哪一侧，
   * 一旦符号约定写反，"内八"就会变成永远不触发，或者把外八报成内八。
   * 比"离中线远近"这件事跟左右、跟镜像都没有关系：
   *   脚尖比脚踝更靠中线  → 内八
   *   膝盖比髋踝连线更靠中线 → 膝内扣
   */
  const cx = (X(23) + X(24)) / 2;
  const dist = (i: number) => Math.abs(X(i) - cx);
  const toeInL = ok(27, 0.3) && ok(31, 0.25) ? (dist(27) - dist(31)) / torso : null;
  const toeInR = ok(28, 0.3) && ok(32, 0.25) ? (dist(28) - dist(32)) / torso : null;
  const valgusL = ok(23, 0.4) && ok(25, 0.4) && ok(27, 0.3)
    ? ((dist(23) + dist(27)) / 2 - dist(25)) / torso
    : null;
  const valgusR = ok(24, 0.4) && ok(26, 0.4) && ok(28, 0.3)
    ? ((dist(24) + dist(28)) / 2 - dist(26)) / torso
    : null;
  const inward = maxOf(avg(toeInL, toeInR), avg(valgusL, valgusR));

  /* ---- 抬腿幅度（换脚跳专用）：髋-膝连线与竖直方向的夹角 ---- */
  /*
   * 竖直方向在 MediaPipe 的世界坐标里就是 y 轴（y 向下）。
   * 大腿抬得越高，髋→膝这条线越接近水平，与竖直（y 轴）夹角越大。
   * 取两侧较大值（抬得更高的那条腿决定幅度），0 = 完全下垂，90 = 抬到水平。
   */
  const legRaiseOne = (hip: number, knee: number) => {
    if (!ok(hip, 0.4) || !ok(knee, 0.4)) return null;
    const vy = Math.abs(Y(knee) - Y(hip));          // 竖直分量
    const vx = Math.abs(X(knee) - X(hip));          // 横向分量（已乘 aspect）
    const vz = use3d ? Math.abs((lm[knee].z ?? 0) - (lm[hip].z ?? 0)) : 0;
    const hor = Math.hypot(vx, vz);                 // 水平面内的分量
    if (vy < 1e-6 && hor < 1e-6) return null;
    // 与竖直（y）轴的夹角；膝盖前顶（z 向）也算抬腿，所以用水平分量合成
    return (Math.atan2(hor, vy) * 180) / Math.PI;
  };
  const legRaise = maxOf(legRaiseOne(23, 25), legRaiseOne(24, 26));

  return {
    handUp, handDiff, armSpread, facing, spanX, kneeAngle, headDrop, inward, legRaise,
  };
}

/**
 * 从指标里挑出**最该提醒的那一条**，没有就返回 null。
 *
 * 顺序 = 严重程度 + 好不好改：
 *   站姿方向错了，其它判据全会跟着飘，所以先纠朝向、再纠脚和腿（站姿），
 *   然后是手（最好改、改了立刻有效），最后才是"跳多高 / 抬多高"这种发力问题。
 *
 * @param s         一帧动作指标（已平滑）
 * @param rate      当前实时节奏（个/分），速度相关阈值按它查表
 * @param jumpStyle 跳法：together 并脚跳 / alternate 换脚跳，用两套标准
 * @param jumpPeak  最近 1.2 秒峰值离地量（不在 PostureSample 里，单独传）
 */
export function pickPosture(
  s: PostureSample, rate: number, jumpStyle: PostureStyle, jumpPeak: number,
): PostureKey | null {
  /*
   * 判据分两层：
   *   核心判据（sideway / armsWide / kneesBent / jumpHigh / legRaise）——
   *     影响安全和速度，任何档位都严格按标准卡，不随速度放宽。
   *   细节姿态（feetIn / headDown / handsUneven / handsHigh / handsLow）——
   *     慢速才讲究，高速时是"正常代偿"，用 detailGate 放大阈值、近乎关闭。
   */
  const gate = detailGate(rate);

  // 核心：身体侧对镜头（方向错了其它判据全飘，最高优先级，不衰减）
  if (s.facing !== null && s.facing > FACING_SIDE && s.spanX < SPAN_SIDE) return 'sideway';
  // 核心：手臂张开（影响摇绳效率，不衰减）
  if (s.armSpread !== null && s.armSpread > ARM_WIDE) return 'armsWide';
  // 核心：膝盖太弯（影响缓冲和回弹，速度相关，不衰减）
  if (s.kneeAngle !== null && s.kneeAngle < thresholdAt(jumpStyle, 'kneeMin', rate)) {
    return 'kneesBent';
  }
  // 核心：跳太高（速度相关，不衰减）
  if (jumpPeak > thresholdAt(jumpStyle, 'jumpHigh', rate)) return 'jumpHigh';
  // 核心：换脚跳抬腿幅度（速度相关，不衰减）
  if (jumpStyle === 'alternate' && s.legRaise !== null) {
    if (s.legRaise > thresholdAt('alternate', 'legRaiseHi', rate)) return 'legRaiseHigh';
    if (s.legRaise < thresholdAt('alternate', 'legRaiseLo', rate)) return 'legRaiseLow';
  }

  // 细节姿态（速度衰减，高速近乎关闭）：
  if (s.inward !== null && s.inward > FEET_IN * gate) return 'feetIn';
  if (s.headDrop !== null && s.headDrop < HEAD_DOWN / gate) return 'headDown';
  if (s.handDiff !== null && s.handDiff > HAND_DIFF * gate) return 'handsUneven';
  if (s.handUp !== null && s.handUp > HAND_HIGH * gate) return 'handsHigh';
  if (s.handUp !== null && s.handUp < HAND_LOW / gate) return 'handsLow';

  return null;
}

/**
 * 滞回：已经在提示的那个问题，指标要回落一截才算消失。
 *
 * 为什么需要：指标的平滑值会正好停在阈值上下，一旦在边上抖，
 * 文案就在「有问题 / 动作 OK」之间来回切 —— 看着像设备坏了。
 * 所以进入用严格阈值（pickPosture），退出用放宽 12% 的阈值。
 * 相当于把"进入"和"退出"分成两条线，中间这段是死区。
 */
const EXIT = 0.88;
const EXIT_ANGLE = 12;

export function keepIssue(
  k: PostureKey, s: PostureSample, rate: number, jumpStyle: PostureStyle, jumpPeak: number,
): boolean {
  const gate = detailGate(rate);
  switch (k) {
    case 'sideway':
      return s.facing !== null && s.facing > FACING_SIDE * EXIT && s.spanX < SPAN_SIDE;
    case 'feetIn':
      return s.inward !== null && s.inward > FEET_IN * EXIT * gate;
    case 'kneesBent':
      // 膝盖角是"越小越错"，退出阈值放宽 = 阈值减小 12 度
      return s.kneeAngle !== null && s.kneeAngle < thresholdAt(jumpStyle, 'kneeMin', rate) - EXIT_ANGLE;
    case 'handsUneven':
      return s.handDiff !== null && s.handDiff > HAND_DIFF * EXIT * gate;
    case 'handsHigh':
      return s.handUp !== null && s.handUp > HAND_HIGH * EXIT * gate;
    case 'armsWide':
      return s.armSpread !== null && s.armSpread > ARM_WIDE * EXIT;
    case 'headDown':
      return s.headDrop !== null && s.headDrop < HEAD_DOWN / EXIT / gate;
    case 'handsLow':
      return s.handUp !== null && s.handUp < HAND_LOW / EXIT / gate;
    case 'jumpHigh':
      return jumpPeak > thresholdAt(jumpStyle, 'jumpHigh', rate) * EXIT;
    case 'legRaiseHigh':
      // 抬腿太高是"越大越错"，退出阈值放宽 = 上限抬高
      return jumpStyle === 'alternate' && s.legRaise !== null
        && s.legRaise > thresholdAt('alternate', 'legRaiseHi', rate) / EXIT;
    case 'legRaiseLow':
      // 抬腿太低是"越小越错"，退出阈值放宽 = 下限压低
      return jumpStyle === 'alternate' && s.legRaise !== null
        && s.legRaise < thresholdAt('alternate', 'legRaiseLo', rate) * EXIT;
    default:
      return false;
  }
}
