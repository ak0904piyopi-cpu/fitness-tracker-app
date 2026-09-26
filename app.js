'use strict';

/* ---------- Storage ---------- */
const STORAGE_KEYS = {
  workouts: 'ftrack_workouts',
  meals: 'ftrack_meals',
  weights: 'ftrack_weights',
  goal: 'ftrack_goal',
  settings: 'ftrack_settings',
  exerciseLibrary: 'ftrack_exercise_library',
  routines: 'ftrack_routines',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('load failed', key, e);
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let state = {
  workouts: load(STORAGE_KEYS.workouts, []),
  meals: load(STORAGE_KEYS.meals, []),
  weights: load(STORAGE_KEYS.weights, []),
  goal: load(STORAGE_KEYS.goal, {
    phase: 'cut',
    startWeight: null,
    targetWeight: null,
    targetDate: null,
    targetCalories: null,
    targetProtein: null,
    targetFat: null,
    targetCarbs: null,
  }),
  settings: load(STORAGE_KEYS.settings, {
    geminiApiKey: '',
    geminiModel: '',
  }),
  exerciseLibrary: load(STORAGE_KEYS.exerciseLibrary, null) || defaultExerciseLibrary(),
  routines: load(STORAGE_KEYS.routines, null) || defaultRoutines(),
};

function persist(part) {
  save(STORAGE_KEYS[part], state[part]);
}

/* ---------- Utils ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function formatLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})`;
}

function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  const rounded = Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits);
  return rounded.toString();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg, opts = {}) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('celebrate', !!opts.celebrate);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), opts.celebrate ? 2600 : 1600);
}

/* ---------- Navigation ---------- */
const TAB_TITLES = { home: 'ホーム', workout: '筋トレ記録', meal: '食事記録', weight: '体重記録', goal: '目標設定' };
let currentTab = 'home';

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.dataset.panel !== name);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.target === name);
  });
  document.getElementById('topbar-title').textContent = TAB_TITLES[name];
  document.getElementById('fab-photo').classList.toggle('hidden', !(name === 'home' || name === 'meal'));
  renderTab(name);
}

function renderTab(name) {
  if (name === 'home') renderHome();
  else if (name === 'workout') renderWorkout();
  else if (name === 'meal') renderMeal();
  else if (name === 'weight') renderWeight();
  else if (name === 'goal') renderGoal();
}

/* ---------- Canvas line chart ---------- */
function drawLineChart(canvas, points, opts = {}) {
  const ctx = canvas.getContext('2d');
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  // Read the intended display height from data-h (fixed at markup time), never from
  // canvas.height itself — that property is reflected/mutated below for bitmap scaling,
  // so reusing it as the source would compound on every re-render (dpr× per call).
  const cssHeight = Number(canvas.dataset.h) || 160;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? '#2c2836' : '#efe4d8';
  const textColor = isDark ? '#9c93ac' : '#8b8496';
  const lineColor = opts.color || (isDark ? '#ff7a50' : '#ff5a36');

  if (!points || points.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('データがありません', cssWidth / 2, cssHeight / 2);
    return;
  }

  if (points.length === 1) {
    ctx.fillStyle = textColor;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${points[0].label}: ${fmtNum(points[0].value, 1)}`, cssWidth / 2, cssHeight / 2 - 8);
    ctx.fillText('記録が増えると推移グラフが表示されます', cssWidth / 2, cssHeight / 2 + 12);
    return;
  }

  const padL = 38, padR = 12, padT = 14, padB = 22;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  let values = points.map(p => p.value);
  if (opts.targetValue !== undefined && opts.targetValue !== null && !isNaN(opts.targetValue)) {
    values = values.concat([opts.targetValue]);
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.15;
  min -= pad; max += pad;

  const xFor = i => padL + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const yFor = v => padT + plotH - ((v - min) / (max - min)) * plotH;

  // grid lines (4)
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3;
    const y = yFor(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssWidth - padR, y);
    ctx.stroke();
    ctx.fillText(fmtNum(v, 1), padL - 6, y + 3);
  }

  // target line
  if (opts.targetValue !== undefined && opts.targetValue !== null && !isNaN(opts.targetValue)) {
    const ty = yFor(opts.targetValue);
    ctx.save();
    ctx.strokeStyle = '#f5b93b';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, ty);
    ctx.lineTo(cssWidth - padR, ty);
    ctx.stroke();
    ctx.restore();
  }

  // line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // dots
  ctx.fillStyle = lineColor;
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.value);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // x labels: first, middle, last
  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const idxs = points.length <= 2 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  [...new Set(idxs)].forEach(i => {
    ctx.fillText(points[i].label, xFor(i), cssHeight - 6);
  });
}

/* ================= HOME ================= */
function computeWorkoutStreak() {
  const dates = new Set(state.workouts.map(w => w.date));
  const startOffset = dates.has(todayStr()) ? 0 : (dates.has(daysAgoStr(1)) ? 1 : null);
  if (startOffset === null) return 0;
  let streak = 0;
  let n = startOffset;
  while (dates.has(daysAgoStr(n))) { streak++; n++; }
  return streak;
}

function renderHome() {
  const streak = computeWorkoutStreak();
  const streakEl = document.getElementById('home-streak-banner');
  if (streak >= 2) {
    streakEl.textContent = `🔥 ${streak}日連続記録中！`;
    streakEl.classList.remove('hidden');
  } else {
    streakEl.classList.add('hidden');
  }

  const g = state.goal;
  const phaseCard = document.getElementById('home-phase-card');
  const latestWeight = getLatestWeight();

  if (!g.targetWeight) {
    phaseCard.innerHTML = `<div class="card-title">目標が未設定です</div>
      <div class="muted small">「目標」タブから目標体重や摂取カロリーを設定しましょう。</div>`;
  } else {
    const phaseLabel = g.phase === 'bulk' ? '増量中' : '減量中';
    let progressPct = null;
    if (latestWeight != null && g.startWeight != null && g.targetWeight != null && g.startWeight !== g.targetWeight) {
      progressPct = ((g.startWeight - latestWeight) / (g.startWeight - g.targetWeight)) * 100;
      progressPct = Math.max(0, Math.min(100, progressPct));
    }
    let daysLeftHtml = '';
    if (g.targetDate) {
      const diff = Math.ceil((new Date(g.targetDate) - new Date(todayStr())) / 86400000);
      daysLeftHtml = `<div class="muted small">目標日まで ${diff >= 0 ? diff + '日' : '期限超過'}</div>`;
    }
    phaseCard.innerHTML = `
      <span class="phase-badge">${phaseLabel}</span>
      <div class="summary-grid" style="margin-top:12px">
        <div><div class="num">${latestWeight != null ? fmtNum(latestWeight, 1) : '-'}</div><div class="lbl">現在(kg)</div></div>
        <div><div class="num">${g.targetWeight != null ? fmtNum(g.targetWeight, 1) : '-'}</div><div class="lbl">目標(kg)</div></div>
        <div><div class="num">${progressPct != null ? fmtNum(progressPct, 0) + '%' : '-'}</div><div class="lbl">進捗</div></div>
      </div>
      ${daysLeftHtml}
    `;
  }

  // meal summary
  const today = todayStr();
  const todayMeals = state.meals.filter(m => m.date === today);
  const totals = todayMeals.reduce((acc, m) => {
    acc.calories += Number(m.calories) || 0;
    acc.protein += Number(m.protein) || 0;
    acc.fat += Number(m.fat) || 0;
    acc.carbs += Number(m.carbs) || 0;
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });

  document.getElementById('home-meal-summary').innerHTML = buildPfcBars(totals, g);

  // weight chart (last 30 entries)
  const sortedWeights = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sortedWeights.slice(-30);
  drawLineChart(document.getElementById('home-weight-chart'),
    recent.map(w => ({ label: formatLabel(w.date), value: Number(w.weight) })),
    { targetValue: g.targetWeight != null ? Number(g.targetWeight) : null });

  const weightSummaryEl = document.getElementById('home-weight-summary');
  if (recent.length === 0) {
    weightSummaryEl.textContent = '体重の記録がまだありません';
  } else {
    const last = recent[recent.length - 1];
    const weekAgoTarget = daysAgoStr(7);
    const weekAgoEntry = [...sortedWeights].reverse().find(w => w.date <= weekAgoTarget);
    let diffText = '';
    if (weekAgoEntry) {
      const diff = Number(last.weight) - Number(weekAgoEntry.weight);
      diffText = ` / 7日前比 ${diff >= 0 ? '+' : ''}${fmtNum(diff, 1)}kg`;
    }
    weightSummaryEl.textContent = `最新: ${fmtNum(last.weight, 1)}kg (${formatLabel(last.date)})${diffText}`;
  }

  // workout summary
  const todayWorkouts = state.workouts.filter(w => w.date === today);
  const wEl = document.getElementById('home-workout-summary');
  if (todayWorkouts.length === 0) {
    wEl.innerHTML = `<div class="empty-state">今日の記録はまだありません</div>`;
  } else {
    wEl.innerHTML = todayWorkouts.map(w => `
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title">${escapeHtml(w.exercise)}</div>
          <div class="list-row-sub">${fmtNum(w.weight, 1)}kg × ${w.reps}回 × ${w.sets}セット</div>
        </div>
      </div>`).join('');
  }
}

function buildPfcBars(totals, g) {
  const rows = [
    { label: 'カロリー', unit: 'kcal', value: totals.calories, target: g.targetCalories },
    { label: 'タンパク質', unit: 'g', value: totals.protein, target: g.targetProtein },
    { label: '脂質', unit: 'g', value: totals.fat, target: g.targetFat },
    { label: '炭水化物', unit: 'g', value: totals.carbs, target: g.targetCarbs },
  ];
  return rows.map(r => {
    const hasTarget = r.target !== null && r.target !== undefined && r.target !== '' && Number(r.target) > 0;
    const pct = hasTarget ? Math.min(100, (r.value / Number(r.target)) * 100) : Math.min(100, r.value > 0 ? 100 : 0);
    const over = hasTarget && r.value > Number(r.target);
    return `
      <div class="pfc-bar-wrap">
        <div class="pfc-bar-label">
          <span>${r.label}</span>
          <span>${fmtNum(r.value, 0)}${hasTarget ? ' / ' + fmtNum(r.target, 0) : ''} ${r.unit}</span>
        </div>
        <div class="pfc-bar-track">
          <div class="pfc-bar-fill ${over ? 'over' : ''}" style="width:${hasTarget ? pct : 0}%"></div>
        </div>
      </div>`;
  }).join('');
}

function getLatestWeight() {
  if (state.weights.length === 0) return null;
  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  return Number(sorted[sorted.length - 1].weight);
}

/* ================= WORKOUT ================= */
function defaultExerciseLibrary() {
  return {
    '胸': ['ベンチプレス', 'インクラインベンチプレス', 'ダンベルプレス', 'チェストプレス(マシン)', 'ペックフライ(マシン)', 'ダンベルフライ', 'ケーブルクロスオーバー', 'ディップス'],
    '背中': ['ラットプルダウン(マシン)', 'シーテッドロウ(マシン)', 'ベントオーバーロウ', 'ワンハンドダンベルロウ', 'デッドリフト', '懸垂(チンニング)', 'Tバーロウ'],
    '脚': ['スクワット', 'レッグプレス(マシン)', 'レッグエクステンション(マシン)', 'レッグカール(マシン)', 'ランジ', 'カーフレイズ', 'ヒップスラスト', 'ブルガリアンスクワット'],
    '肩': ['ショルダープレス', 'サイドレイズ', 'リアレイズ', 'アップライトロウ', 'シュラッグ'],
    '腕': ['アームカール', 'ハンマーカール', 'トライセプスプレスダウン(ケーブル)', 'ライイングトライセプスエクステンション', 'プリーチャーカール(マシン)'],
    '腹': ['クランチ(マシン)', 'レッグレイズ', 'アブローラー', 'プランク', 'ロシアンツイスト'],
  };
}

const EXERCISE_INFO = {
  'ベンチプレス': '仰向けに寝てバーベルを胸の上まで下ろし、まっすぐ押し上げる',
  'インクラインベンチプレス': '上体を斜めに傾けたベンチで行うベンチプレス。胸の上部に効く',
  'ダンベルプレス': '仰向けでダンベルを両手に持ち、胸の横から真上に押し上げる',
  'チェストプレス(マシン)': '座ったままレバーを前方に押し出すマシン種目',
  'ペックフライ(マシン)': '両腕を胸の前で閉じるように動かすマシン種目',
  'ダンベルフライ': '仰向けでダンベルを持ち、弧を描くように腕を開閉する',
  'ケーブルクロスオーバー': '左右のケーブルを胸の前で交差させるように引き寄せる',
  'ディップス': '平行棒に腕を伸ばして体を支え、肘を曲げて体を沈める',
  'ラットプルダウン(マシン)': '座ってバーを頭上から胸の前まで引き下ろす',
  'シーテッドロウ(マシン)': '座って前方のハンドルを体に引き寄せる',
  'ベントオーバーロウ': '上体を前傾させてバーベルを腹に向かって引き上げる',
  'ワンハンドダンベルロウ': '片手・片膝をベンチにつき、ダンベルを脇腹に引き上げる',
  'デッドリフト': '床のバーベルを、背中をまっすぐ保ったまま立ち上がって持ち上げる',
  '懸垂(チンニング)': 'バーにぶら下がり、顎がバーを超えるまで体を引き上げる',
  'Tバーロウ': '体を前傾させ、Tバーのハンドルを胸に向かって引く',
  'スクワット': 'バーベルを担ぎ、股関節と膝を曲げてしゃがみ込んでから立ち上がる',
  'レッグプレス(マシン)': '座った姿勢でフットプレートを脚で押し出す',
  'レッグエクステンション(マシン)': '座って膝を伸ばし、足を前方に蹴り上げる',
  'レッグカール(マシン)': 'うつ伏せや座位で膝を曲げ、かかとをお尻に近づける',
  'ランジ': '片足を大きく前に踏み出し、膝を曲げて体を沈める',
  'カーフレイズ': 'かかとを上げ下げしてふくらはぎを鍛える',
  'ヒップスラスト': '肩をベンチにつけ、バーベルを腰にのせて腰を突き上げる',
  'ブルガリアンスクワット': '後ろ足を台に乗せ、片足でしゃがみ込む',
  'ショルダープレス': 'ダンベルやバーベルを肩の高さから頭上に押し上げる',
  'サイドレイズ': '両腕にダンベルを持ち、体の横に肩の高さまで上げる',
  'リアレイズ': '前傾姿勢で両腕を体の後ろ側に持ち上げる',
  'アップライトロウ': 'バーベルやダンベルを体の前面で顎の下まで引き上げる',
  'シュラッグ': 'ダンベルやバーベルを持ち、肩をすくめるように上げ下げする',
  'アームカール': 'ダンベルやバーベルを持ち、肘を曲げて持ち上げる（力こぶ）',
  'ハンマーカール': '手のひらを内側に向けたままダンベルを持ち上げる',
  'トライセプスプレスダウン(ケーブル)': 'ケーブルバーを胸の高さから下に押し下げる',
  'ライイングトライセプスエクステンション': '仰向けでバーベルを額の上まで下ろし、肘を伸ばして戻す',
  'プリーチャーカール(マシン)': '台に腕を固定した状態でカールを行う',
  'クランチ(マシン)': '座ってパッドを押し込むように上体を丸める',
  'レッグレイズ': '仰向けで脚をまっすぐ伸ばしたまま持ち上げる',
  'アブローラー': '膝立ちでローラーを前方に転がし、腹筋で引き戻す',
  'プランク': '肘とつま先で体を一直線に支え、姿勢をキープする',
  'ロシアンツイスト': '座った姿勢で上体をひねり、左右に体重を移動させる',
};

function imageSearchUrl(name) {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' 筋トレ フォーム')}`;
}

function defaultRoutines() {
  const lib = defaultExerciseLibrary();
  return Object.keys(lib).map(cat => ({ id: uid(), name: `${cat}の日`, exercises: [...lib[cat]] }));
}

function estimate1RM(weight, reps) {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

function getPB(exerciseName) {
  const records = state.workouts.filter(w => w.exercise === exerciseName);
  if (records.length === 0) return null;
  let maxWeight = -Infinity, maxWeightReps = 0, maxWeightDate = null;
  let maxEst1RM = -Infinity, maxEst1RMDate = null;
  records.forEach(r => {
    const w = Number(r.weight), reps = Number(r.reps);
    if (w > maxWeight) { maxWeight = w; maxWeightReps = reps; maxWeightDate = r.date; }
    const e1 = estimate1RM(w, reps);
    if (e1 > maxEst1RM) { maxEst1RM = e1; maxEst1RMDate = r.date; }
  });
  return { maxWeight, maxWeightReps, maxWeightDate, maxEst1RM, maxEst1RMDate };
}

function getLatestRecord(exerciseName) {
  const records = state.workouts.filter(w => w.exercise === exerciseName);
  if (records.length === 0) return null;
  return [...records].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).pop();
}

let selectedExerciseCategory = null;
let selectedExerciseName = null;
let exerciseEditMode = false;
let selectedRoutineId = null;
let routineEditMode = false;
let editingRoutineId = null;
let routineDraftExercises = new Set();

function renderExerciseCategoryChips() {
  if (!selectedExerciseCategory || !(selectedExerciseCategory in state.exerciseLibrary)) {
    selectedExerciseCategory = Object.keys(state.exerciseLibrary)[0];
  }
  const el = document.getElementById('exercise-category-chips');
  el.innerHTML = Object.keys(state.exerciseLibrary).map(cat =>
    `<button type="button" class="chip ${cat === selectedExerciseCategory ? 'active' : ''}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
  ).join('');
}

function renderExerciseItemChips() {
  const el = document.getElementById('exercise-item-chips');
  let items;
  if (selectedRoutineId) {
    const r = state.routines.find(x => x.id === selectedRoutineId);
    items = r ? r.exercises : [];
  } else {
    items = state.exerciseLibrary[selectedExerciseCategory] || [];
  }
  let html = items.map(name => {
    if (exerciseEditMode && !selectedRoutineId) {
      return `<button type="button" class="chip chip-removable" data-remove-exercise="${escapeHtml(name)}">${escapeHtml(name)} ✕</button>`;
    }
    return `<button type="button" class="chip ${name === selectedExerciseName ? 'selected' : ''}" data-exercise-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  }).join('');
  if (exerciseEditMode && !selectedRoutineId) {
    html += `<button type="button" class="chip chip-add" id="exercise-add-chip">＋ 追加</button>`;
  }
  el.innerHTML = html || '<div class="muted small">種目がありません</div>';
}

function updateExerciseFilterVisibility() {
  const catRow = document.getElementById('exercise-category-chips');
  const editToggle = document.getElementById('exercise-edit-toggle');
  const active = !!selectedRoutineId;
  catRow.classList.toggle('hidden', active);
  editToggle.classList.toggle('hidden', active);
}

function renderRoutineChips() {
  const el = document.getElementById('routine-chips');
  let html = `<button type="button" class="chip ${selectedRoutineId === null ? 'active' : ''}" data-routine="">全種目</button>`;
  html += state.routines.map(r => {
    if (routineEditMode) {
      return `<span class="chip chip-removable" data-edit-routine="${r.id}">${escapeHtml(r.name)}<button type="button" class="chip-x" data-remove-routine="${r.id}">✕</button></span>`;
    }
    return `<button type="button" class="chip ${r.id === selectedRoutineId ? 'active' : ''}" data-routine="${r.id}">${escapeHtml(r.name)}</button>`;
  }).join('');
  if (routineEditMode) {
    html += `<button type="button" class="chip chip-add" id="routine-add-chip">＋ 新規</button>`;
  }
  el.innerHTML = html;
}

function renderRoutineProgress() {
  const el = document.getElementById('routine-progress');
  if (!selectedRoutineId) { el.classList.add('hidden'); return; }
  const r = state.routines.find(x => x.id === selectedRoutineId);
  if (!r) { el.classList.add('hidden'); return; }
  const today = todayStr();
  const todayNames = new Set(state.workouts.filter(w => w.date === today).map(w => w.exercise));
  const done = r.exercises.filter(n => todayNames.has(n)).length;
  el.textContent = `今日 ${done}/${r.exercises.length} 種目完了`;
  el.classList.remove('hidden');
}

function renderWorkoutPB() {
  const select = document.getElementById('workout-exercise-select');
  const exercise = select.value;
  const el = document.getElementById('workout-pb-info');
  const pb = exercise ? getPB(exercise) : null;
  if (!pb) { el.classList.add('hidden'); return; }
  el.textContent = `🏆 自己ベスト ${fmtNum(pb.maxWeight, 1)}kg × ${pb.maxWeightReps}回（推定1RM ${fmtNum(pb.maxEst1RM, 1)}kg）・${formatLabel(pb.maxWeightDate)}`;
  el.classList.remove('hidden');
}

function fillPrevValues(name) {
  const hintEl = document.getElementById('workout-prev-hint');
  if (!name) { hintEl.classList.add('hidden'); hintEl.textContent = ''; return; }
  const latest = getLatestRecord(name);
  const form = document.getElementById('workout-form');
  if (latest) {
    form.weight.value = latest.weight;
    form.reps.value = latest.reps;
    form.sets.value = latest.sets;
    hintEl.textContent = `前回: ${fmtNum(latest.weight, 1)}kg × ${latest.reps}回 × ${latest.sets}セット（${formatLabel(latest.date)}）`;
    hintEl.classList.remove('hidden');
  } else {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
  }
}

function renderExerciseInfo() {
  const el = document.getElementById('exercise-info');
  if (!selectedExerciseName) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const desc = EXERCISE_INFO[selectedExerciseName];
  el.innerHTML = `
    <div class="exercise-info-name">${escapeHtml(selectedExerciseName)}</div>
    ${desc ? `<div class="exercise-info-desc">${escapeHtml(desc)}</div>` : ''}
    <a class="exercise-info-link" href="${imageSearchUrl(selectedExerciseName)}" target="_blank" rel="noopener">🔍 画像で見る</a>
  `;
  el.classList.remove('hidden');
}

function renderWorkout() {
  document.querySelector('#workout-form [name="date"]').value =
    document.querySelector('#workout-form [name="date"]').value || todayStr();

  const exerciseNames = [...new Set(state.workouts.map(w => w.exercise))].sort();
  document.getElementById('exercise-list').innerHTML = exerciseNames.map(n => `<option value="${escapeHtml(n)}">`).join('');

  const select = document.getElementById('workout-exercise-select');
  const prevSelected = select.value;
  select.innerHTML = exerciseNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if (exerciseNames.length === 0) {
    select.innerHTML = '<option value="">記録なし</option>';
  } else if (exerciseNames.includes(prevSelected)) {
    select.value = prevSelected;
  }

  exerciseEditMode = false;
  document.getElementById('exercise-edit-toggle').textContent = '編集';
  routineEditMode = false;
  document.getElementById('routine-edit-toggle').textContent = '編集';

  renderRoutineChips();
  renderRoutineProgress();
  updateExerciseFilterVisibility();
  renderExerciseCategoryChips();
  renderExerciseItemChips();
  renderExerciseInfo();
  renderWorkoutProgressChart();
  renderWorkoutPB();
  renderWorkoutHistory();
}

function renderWorkoutProgressChart() {
  const select = document.getElementById('workout-exercise-select');
  const exercise = select.value;
  const canvas = document.getElementById('workout-progress-chart');
  const emptyEl = document.getElementById('workout-progress-empty');

  if (!exercise) {
    canvas.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  const records = state.workouts.filter(w => w.exercise === exercise);
  const byDate = {};
  records.forEach(r => {
    const w = Number(r.weight);
    if (!(r.date in byDate) || w > byDate[r.date]) byDate[r.date] = w;
  });
  const points = Object.keys(byDate).sort().map(d => ({ label: formatLabel(d), value: byDate[d] }));
  drawLineChart(canvas, points);
}

function renderWorkoutHistory() {
  const el = document.getElementById('workout-history');
  if (state.workouts.length === 0) {
    el.innerHTML = '<div class="empty-state">記録がありません</div>';
    return;
  }
  const sorted = [...state.workouts].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  let html = '';
  let lastDate = null;
  sorted.forEach(w => {
    if (w.date !== lastDate) {
      html += `<div class="date-group-label">${formatLabel(w.date)}</div>`;
      lastDate = w.date;
    }
    html += `
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title">${escapeHtml(w.exercise)}</div>
          <div class="list-row-sub">${fmtNum(w.weight, 1)}kg × ${w.reps}回 × ${w.sets}セット</div>
        </div>
        <button class="list-row-del" data-del-workout="${w.id}">×</button>
      </div>`;
  });
  el.innerHTML = html;
}

/* ================= ROUTINE MODAL ================= */
function openRoutineModal(routine) {
  editingRoutineId = routine ? routine.id : null;
  routineDraftExercises = new Set(routine ? routine.exercises : []);
  document.getElementById('routine-modal-title').textContent = routine ? 'ルーティンを編集' : 'ルーティンを作成';
  document.getElementById('routine-name-input').value = routine ? routine.name : '';
  renderRoutinePicker();
  document.getElementById('routine-modal').classList.remove('hidden');
}

function closeRoutineModal() {
  document.getElementById('routine-modal').classList.add('hidden');
}

function renderRoutinePicker() {
  const el = document.getElementById('routine-exercise-picker');
  el.innerHTML = Object.entries(state.exerciseLibrary).map(([cat, names]) => `
    <div class="field-label" style="margin-top:10px">${escapeHtml(cat)}</div>
    <div class="chip-grid">
      ${names.map(n => `<button type="button" class="chip ${routineDraftExercises.has(n) ? 'selected' : ''}" data-pick-exercise="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
    </div>
  `).join('');
}

/* ================= MEAL ================= */
function renderMeal() {
  document.querySelector('#meal-form [name="date"]').value =
    document.querySelector('#meal-form [name="date"]').value || todayStr();

  const today = todayStr();
  const todayMeals = state.meals.filter(m => m.date === today);
  const totals = todayMeals.reduce((acc, m) => {
    acc.calories += Number(m.calories) || 0;
    acc.protein += Number(m.protein) || 0;
    acc.fat += Number(m.fat) || 0;
    acc.carbs += Number(m.carbs) || 0;
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
  document.getElementById('meal-today-summary').innerHTML = buildPfcBars(totals, state.goal);

  renderMealHistory();
}

function renderMealHistory() {
  const dateFilter = document.getElementById('meal-history-date').value;
  const el = document.getElementById('meal-history');
  let list = [...state.meals];
  if (dateFilter) list = list.filter(m => m.date === dateFilter);
  if (list.length === 0) {
    el.innerHTML = '<div class="empty-state">記録がありません</div>';
    return;
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  let html = '';
  let lastDate = null;
  list.forEach(m => {
    if (m.date !== lastDate) {
      html += `<div class="date-group-label">${formatLabel(m.date)}</div>`;
      lastDate = m.date;
    }
    html += `
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title">${escapeHtml(m.name)}</div>
          <div class="list-row-sub">${fmtNum(m.calories, 0)}kcal ／ P${fmtNum(m.protein, 1)} F${fmtNum(m.fat, 1)} C${fmtNum(m.carbs, 1)}</div>
        </div>
        <button class="list-row-del" data-del-meal="${m.id}">×</button>
      </div>`;
  });
  el.innerHTML = html;
}

/* ================= PHOTO ANALYSIS (Gemini) ================= */
function resizeImageToBase64(file, maxDim = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('IMAGE_LOAD_FAILED'));
    };
    img.src = url;
  });
}

// Google periodically retires specific Gemini model versions for new API keys/projects
// (e.g. gemini-2.5-flash was cut off for new users). Rather than hardcode a model name
// that will eventually break, discover a currently-usable one from the account's own
// model list, cache it, and re-discover automatically if it later stops working.
async function discoverGeminiModel(apiKey, excludeName) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    let reason = '';
    try { reason = JSON.parse(errBody)?.error?.status || ''; } catch (e) { /* not JSON */ }
    if (reason === 'API_KEY_INVALID' || reason === 'PERMISSION_DENIED') throw new Error('INVALID_KEY');
    throw new Error('MODEL_LIST_FAILED: HTTP ' + res.status + ' ' + errBody.slice(0, 150));
  }
  const data = await res.json();
  const candidates = (data.models || []).filter(m =>
    Array.isArray(m.supportedGenerationMethods) &&
    m.supportedGenerationMethods.includes('generateContent') &&
    /flash/i.test(m.name) &&
    !/vision|embedding|aqa|tts|image-generation|thinking/i.test(m.name) &&
    m.name.replace(/^models\//, '') !== excludeName
  );
  candidates.sort((a, b) => {
    const aLatest = /latest/i.test(a.name) ? 1 : 0;
    const bLatest = /latest/i.test(b.name) ? 1 : 0;
    if (aLatest !== bLatest) return bLatest - aLatest;
    return b.name.localeCompare(a.name);
  });
  if (!candidates[0]) throw new Error('NO_USABLE_MODEL');
  return candidates[0].name.replace(/^models\//, '');
}

async function callGemini(model, apiKey, base64Data) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = 'あなたは栄養士です。添付された食事の写真を見て、料理名（日本語、短く）と、写っている分量から推定した栄養価を返してください。次のJSON形式のみで出力し、説明文は付けないでください。数値は数字のみ（単位なし）。{"name": string, "calories": number, "protein_g": number, "fat_g": number, "carbs_g": number}';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    let reason = '';
    try { reason = JSON.parse(errBody)?.error?.status || ''; } catch (e) { /* not JSON */ }
    if (reason === 'API_KEY_INVALID' || reason === 'PERMISSION_DENIED') throw new Error('INVALID_KEY');
    if (res.status === 429 || reason === 'RESOURCE_EXHAUSTED') throw new Error('RATE_LIMIT');
    if (res.status === 404 || reason === 'NOT_FOUND') throw new Error('MODEL_UNAVAILABLE: ' + errBody.slice(0, 200));
    throw new Error('API_ERROR: HTTP ' + res.status + (reason ? ' ' + reason : '') + ' ' + errBody.slice(0, 200));
  }

  const data = await res.json();
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) throw new Error('BLOCKED: ' + blockReason);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE: ' + JSON.stringify(data).slice(0, 200));

  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error('PARSE_ERROR: ' + text.slice(0, 200));
  }
}

async function analyzeFoodPhoto(base64Data) {
  const { geminiApiKey } = state.settings;
  if (!geminiApiKey) throw new Error('NO_API_KEY');

  if (!state.settings.geminiModel) {
    state.settings.geminiModel = await discoverGeminiModel(geminiApiKey);
    persist('settings');
  }

  try {
    return await callGemini(state.settings.geminiModel, geminiApiKey, base64Data);
  } catch (err) {
    if (!err.message.startsWith('MODEL_UNAVAILABLE')) throw err;
    // The cached model was retired since we last resolved it — rediscover once and retry.
    const nextModel = await discoverGeminiModel(geminiApiKey, state.settings.geminiModel);
    state.settings.geminiModel = nextModel;
    persist('settings');
    return await callGemini(nextModel, geminiApiKey, base64Data);
  }
}

let pendingMealResult = null;

function openPhotoResultModal(result) {
  pendingMealResult = result;
  document.getElementById('photo-result-name').textContent = result.name || '(名称不明)';
  document.getElementById('photo-result-cal').textContent = fmtNum(result.calories, 0);
  document.getElementById('photo-result-p').textContent = fmtNum(result.protein_g, 1);
  document.getElementById('photo-result-f').textContent = fmtNum(result.fat_g, 1);
  document.getElementById('photo-result-c').textContent = fmtNum(result.carbs_g, 1);
  document.getElementById('photo-result-modal').classList.remove('hidden');
}

function closePhotoResultModal() {
  document.getElementById('photo-result-modal').classList.add('hidden');
}

async function handlePhotoSelected(file) {
  const statusEl = document.getElementById('photo-analyze-status');

  if (!state.settings.geminiApiKey) {
    toast('先に設定画面でGemini APIキーを入力してください');
    openSettingsModal();
    return;
  }

  statusEl.textContent = '解析中…';
  statusEl.classList.remove('hidden');
  statusEl.classList.add('loading');

  try {
    const base64 = await resizeImageToBase64(file);
    const result = await analyzeFoodPhoto(base64);
    statusEl.classList.add('hidden');
    statusEl.classList.remove('loading');
    openPhotoResultModal(result);
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : String(err);
    let friendly;
    if (msg === 'INVALID_KEY') {
      friendly = 'APIキーが正しくないか無効です。設定を確認してください。';
    } else if (msg === 'RATE_LIMIT') {
      friendly = '無料枠の利用上限に達した可能性があります。しばらく待って再度お試しください。';
    } else if (msg.startsWith('BLOCKED:')) {
      friendly = 'この写真はAIの安全フィルターによりブロックされました。別の写真でお試しください。';
    } else if (msg.startsWith('PARSE_ERROR') || msg.startsWith('EMPTY_RESPONSE')) {
      friendly = 'AIの応答を解析できませんでした。もう一度お試しください。';
    } else if (msg === 'NO_USABLE_MODEL' || msg.startsWith('MODEL_LIST_FAILED')) {
      friendly = '利用できるAIモデルが見つかりませんでした。しばらくしてから再度お試しください。';
    } else if (err instanceof TypeError) {
      friendly = 'ネットワークに接続できませんでした。通信状況を確認してください。';
    } else {
      friendly = '解析に失敗しました（詳細: ' + msg.slice(0, 120) + '）';
    }
    statusEl.textContent = friendly;
    statusEl.classList.remove('loading');
    toast(friendly);
  }
}

/* ================= SETTINGS ================= */
function openSettingsModal() {
  document.getElementById('gemini-api-key-input').value = state.settings.geminiApiKey || '';
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

/* ================= WEIGHT ================= */
function renderWeight() {
  document.querySelector('#weight-form [name="date"]').value =
    document.querySelector('#weight-form [name="date"]').value || todayStr();

  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-60);
  drawLineChart(document.getElementById('weight-chart'),
    recent.map(w => ({ label: formatLabel(w.date), value: Number(w.weight) })),
    { targetValue: state.goal.targetWeight != null ? Number(state.goal.targetWeight) : null });

  const summaryEl = document.getElementById('weight-summary');
  if (sorted.length === 0) {
    summaryEl.textContent = '記録がありません';
  } else {
    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    const totalDiff = Number(last.weight) - Number(first.weight);
    summaryEl.textContent = `最新: ${fmtNum(last.weight, 1)}kg / 記録開始比 ${totalDiff >= 0 ? '+' : ''}${fmtNum(totalDiff, 1)}kg`;
  }

  const el = document.getElementById('weight-history');
  if (state.weights.length === 0) {
    el.innerHTML = '<div class="empty-state">記録がありません</div>';
    return;
  }
  const descSorted = [...state.weights].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  el.innerHTML = descSorted.map(w => `
    <div class="list-row">
      <div class="list-row-main">
        <div class="list-row-title">${fmtNum(w.weight, 1)}kg${w.bodyFat ? ' / 体脂肪 ' + fmtNum(w.bodyFat, 1) + '%' : ''}</div>
        <div class="list-row-sub">${formatLabel(w.date)}</div>
      </div>
      <button class="list-row-del" data-del-weight="${w.id}">×</button>
    </div>`).join('');
}

/* ================= GOAL ================= */
function renderGoal() {
  const g = state.goal;
  const form = document.getElementById('goal-form');
  form.phase.value = g.phase || 'cut';
  form.startWeight.value = g.startWeight ?? '';
  form.targetWeight.value = g.targetWeight ?? '';
  form.targetDate.value = g.targetDate ?? '';
  form.targetCalories.value = g.targetCalories ?? '';
  form.targetProtein.value = g.targetProtein ?? '';
  form.targetFat.value = g.targetFat ?? '';
  form.targetCarbs.value = g.targetCarbs ?? '';

  const progressEl = document.getElementById('goal-progress');
  const latestWeight = getLatestWeight();
  if (!g.targetWeight || g.startWeight == null) {
    progressEl.innerHTML = '<div class="empty-state">目標体重・開始体重を設定すると進捗が表示されます</div>';
    return;
  }
  const current = latestWeight != null ? latestWeight : Number(g.startWeight);
  let pct = 0;
  if (Number(g.startWeight) !== Number(g.targetWeight)) {
    pct = ((Number(g.startWeight) - current) / (Number(g.startWeight) - Number(g.targetWeight))) * 100;
  }
  pct = Math.max(0, Math.min(100, pct));
  const remainingKg = current - Number(g.targetWeight);
  progressEl.innerHTML = `
    <div class="summary-grid">
      <div><div class="num">${fmtNum(g.startWeight, 1)}</div><div class="lbl">開始(kg)</div></div>
      <div><div class="num">${fmtNum(current, 1)}</div><div class="lbl">現在(kg)</div></div>
      <div><div class="num">${fmtNum(g.targetWeight, 1)}</div><div class="lbl">目標(kg)</div></div>
    </div>
    <div class="pfc-bar-wrap">
      <div class="pfc-bar-label"><span>進捗</span><span>${fmtNum(pct, 0)}%</span></div>
      <div class="pfc-bar-track"><div class="pfc-bar-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="muted small" style="margin-top:8px">目標まであと ${fmtNum(Math.abs(remainingKg), 1)}kg</div>
  `;
}

function autofillGoalTargets() {
  const form = document.getElementById('goal-form');
  const phase = form.phase.value;
  const weight = Number(form.startWeight.value) || getLatestWeight();
  if (!weight) {
    toast('先に体重を入力してください');
    return;
  }
  let kcalPerKg = phase === 'bulk' ? 38 : 30;
  const targetCalories = Math.round(weight * kcalPerKg);
  const protein = Math.round(weight * 2);
  const fat = Math.round(weight * (phase === 'bulk' ? 1 : 0.8));
  const remainingKcal = Math.max(0, targetCalories - protein * 4 - fat * 9);
  const carbs = Math.round(remainingKcal / 4);

  form.targetCalories.value = targetCalories;
  form.targetProtein.value = protein;
  form.targetFat.value = fat;
  form.targetCarbs.value = carbs;
  toast('自動計算しました（保存を押してください）');
}

/* ================= Event wiring ================= */
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.target));
  });
}

function initSettings() {
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target.id === 'settings-modal') closeSettingsModal();
  });
  document.getElementById('toggle-key-visibility').addEventListener('click', () => {
    const input = document.getElementById('gemini-api-key-input');
    const btn = document.getElementById('toggle-key-visibility');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '隠す' : '表示';
  });
  document.getElementById('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    state.settings.geminiApiKey = document.getElementById('gemini-api-key-input').value.trim();
    persist('settings');
    toast('設定を保存しました');
    closeSettingsModal();
  });
}

function initRoutineModal() {
  document.getElementById('routine-modal-close').addEventListener('click', closeRoutineModal);
  document.getElementById('routine-modal').addEventListener('click', e => {
    if (e.target.id === 'routine-modal') closeRoutineModal();
  });
  document.getElementById('routine-exercise-picker').addEventListener('click', e => {
    const name = e.target.getAttribute('data-pick-exercise');
    if (!name) return;
    if (routineDraftExercises.has(name)) routineDraftExercises.delete(name);
    else routineDraftExercises.add(name);
    renderRoutinePicker();
  });
  document.getElementById('routine-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('routine-name-input').value.trim();
    if (!name) { toast('ルーティン名を入力してください'); return; }
    if (routineDraftExercises.size === 0) { toast('種目を1つ以上選んでください'); return; }
    const exercises = [...routineDraftExercises];
    if (editingRoutineId) {
      const r = state.routines.find(x => x.id === editingRoutineId);
      if (r) { r.name = name; r.exercises = exercises; }
    } else {
      state.routines.push({ id: uid(), name, exercises });
    }
    persist('routines');
    closeRoutineModal();
    renderWorkout();
    toast('ルーティンを保存しました');
  });
}

function initPhotoResultModal() {
  document.getElementById('photo-result-save').addEventListener('click', () => {
    if (!pendingMealResult) return;
    state.meals.push({
      id: uid(),
      date: todayStr(),
      name: (pendingMealResult.name || '').trim() || '(名称不明)',
      calories: Number(pendingMealResult.calories) || 0,
      protein: Number(pendingMealResult.protein_g) || 0,
      fat: Number(pendingMealResult.fat_g) || 0,
      carbs: Number(pendingMealResult.carbs_g) || 0,
    });
    persist('meals');
    closePhotoResultModal();
    toast('🍚 記録しました');
    renderTab(currentTab);
  });
  document.getElementById('photo-result-edit').addEventListener('click', () => {
    const result = pendingMealResult;
    closePhotoResultModal();
    showTab('meal');
    const form = document.getElementById('meal-form');
    if (!result) return;
    form.date.value = form.date.value || todayStr();
    form.foodName.value = result.name ?? '';
    form.calories.value = result.calories ?? '';
    form.protein.value = result.protein_g ?? 0;
    form.fat.value = result.fat_g ?? 0;
    form.carbs.value = result.carbs_g ?? 0;
    form.foodName.focus();
  });
  document.getElementById('photo-result-cancel').addEventListener('click', closePhotoResultModal);
  document.getElementById('photo-result-modal').addEventListener('click', e => {
    if (e.target.id === 'photo-result-modal') closePhotoResultModal();
  });
}

function initForms() {
  document.getElementById('workout-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const exercise = f.exercise.value.trim();
    const weight = Number(f.weight.value);
    const reps = Number(f.reps.value);
    const sets = Number(f.sets.value);
    const prevPB = getPB(exercise);

    state.workouts.push({ id: uid(), date: f.date.value, exercise, weight, reps, sets });
    persist('workouts');

    const newPB = getPB(exercise);
    const isNewPB = newPB && (!prevPB || newPB.maxEst1RM > prevPB.maxEst1RM + 1e-9);

    f.exercise.value = '';
    f.weight.value = '';
    f.reps.value = '';
    f.sets.value = '1';
    selectedExerciseName = null;
    fillPrevValues(null);
    renderExerciseInfo();

    if (isNewPB) {
      toast(`🎉 自己ベスト更新！ ${escapeHtml(exercise)} ${fmtNum(weight, 1)}kg×${reps}回`, { celebrate: true });
    } else {
      toast('記録しました');
    }
    renderWorkout();
  });

  document.getElementById('exercise-category-chips').addEventListener('click', e => {
    const cat = e.target.getAttribute('data-category');
    if (!cat) return;
    selectedExerciseCategory = cat;
    renderExerciseCategoryChips();
    renderExerciseItemChips();
  });

  document.getElementById('exercise-edit-toggle').addEventListener('click', () => {
    exerciseEditMode = !exerciseEditMode;
    document.getElementById('exercise-edit-toggle').textContent = exerciseEditMode ? '完了' : '編集';
    renderExerciseItemChips();
  });

  document.getElementById('exercise-item-chips').addEventListener('click', e => {
    const removeName = e.target.getAttribute('data-remove-exercise');
    if (removeName) {
      state.exerciseLibrary[selectedExerciseCategory] = state.exerciseLibrary[selectedExerciseCategory].filter(n => n !== removeName);
      persist('exerciseLibrary');
      renderExerciseItemChips();
      return;
    }
    if (e.target.id === 'exercise-add-chip') {
      const input = prompt('追加する種目名を入力してください');
      const name = input ? input.trim() : '';
      if (name && !state.exerciseLibrary[selectedExerciseCategory].includes(name)) {
        state.exerciseLibrary[selectedExerciseCategory].push(name);
        persist('exerciseLibrary');
        renderExerciseItemChips();
      }
      return;
    }
    const name = e.target.getAttribute('data-exercise-name');
    if (!name) return;
    selectedExerciseName = name;
    document.querySelector('#workout-form [name="exercise"]').value = name;
    renderExerciseItemChips();
    renderExerciseInfo();
    fillPrevValues(name);
    document.querySelector('#workout-form [name="weight"]').focus();
  });

  document.querySelector('#workout-form [name="exercise"]').addEventListener('change', e => {
    const name = e.target.value.trim();
    selectedExerciseName = name || null;
    fillPrevValues(name);
    renderExerciseInfo();
  });

  document.getElementById('routine-chips').addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-remove-routine]');
    if (removeBtn) {
      const id = removeBtn.getAttribute('data-remove-routine');
      state.routines = state.routines.filter(r => r.id !== id);
      persist('routines');
      if (selectedRoutineId === id) selectedRoutineId = null;
      renderRoutineChips();
      updateExerciseFilterVisibility();
      renderExerciseCategoryChips();
      renderExerciseItemChips();
      renderRoutineProgress();
      return;
    }
    if (e.target.id === 'routine-add-chip') { openRoutineModal(null); return; }
    const editEl = e.target.closest('[data-edit-routine]');
    if (editEl && routineEditMode) {
      const id = editEl.getAttribute('data-edit-routine');
      const r = state.routines.find(x => x.id === id);
      if (r) openRoutineModal(r);
      return;
    }
    const selectEl = e.target.closest('[data-routine]');
    if (selectEl && !routineEditMode) {
      const id = selectEl.getAttribute('data-routine');
      selectedRoutineId = id || null;
      renderRoutineChips();
      updateExerciseFilterVisibility();
      renderExerciseCategoryChips();
      renderExerciseItemChips();
      renderRoutineProgress();
    }
  });

  document.getElementById('routine-edit-toggle').addEventListener('click', () => {
    routineEditMode = !routineEditMode;
    document.getElementById('routine-edit-toggle').textContent = routineEditMode ? '完了' : '編集';
    renderRoutineChips();
  });

  document.getElementById('workout-exercise-select').addEventListener('change', () => {
    renderWorkoutProgressChart();
    renderWorkoutPB();
  });

  document.getElementById('workout-history').addEventListener('click', e => {
    const id = e.target.getAttribute('data-del-workout');
    if (!id) return;
    state.workouts = state.workouts.filter(w => w.id !== id);
    persist('workouts');
    renderWorkout();
  });

  document.getElementById('meal-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    state.meals.push({
      id: uid(),
      date: f.date.value,
      name: f.foodName.value.trim(),
      calories: Number(f.calories.value) || 0,
      protein: Number(f.protein.value) || 0,
      fat: Number(f.fat.value) || 0,
      carbs: Number(f.carbs.value) || 0,
    });
    persist('meals');
    f.foodName.value = '';
    f.calories.value = '';
    f.protein.value = '0';
    f.fat.value = '0';
    f.carbs.value = '0';
    toast('記録しました');
    renderMeal();
  });

  document.getElementById('meal-history-date').addEventListener('change', renderMealHistory);

  document.getElementById('photo-analyze-btn').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });

  document.getElementById('fab-photo').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });

  document.getElementById('photo-input').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handlePhotoSelected(file);
  });

  document.getElementById('meal-history').addEventListener('click', e => {
    const id = e.target.getAttribute('data-del-meal');
    if (!id) return;
    state.meals = state.meals.filter(m => m.id !== id);
    persist('meals');
    renderMeal();
  });

  document.getElementById('weight-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    state.weights.push({
      id: uid(),
      date: f.date.value,
      weight: Number(f.weight.value),
      bodyFat: f.bodyFat.value ? Number(f.bodyFat.value) : null,
    });
    persist('weights');
    f.bodyFat.value = '';
    toast('記録しました');
    renderWeight();
  });

  document.getElementById('weight-history').addEventListener('click', e => {
    const id = e.target.getAttribute('data-del-weight');
    if (!id) return;
    state.weights = state.weights.filter(w => w.id !== id);
    persist('weights');
    renderWeight();
  });

  document.getElementById('goal-autofill').addEventListener('click', autofillGoalTargets);

  document.getElementById('goal-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    state.goal = {
      phase: f.phase.value,
      startWeight: f.startWeight.value ? Number(f.startWeight.value) : null,
      targetWeight: f.targetWeight.value ? Number(f.targetWeight.value) : null,
      targetDate: f.targetDate.value || null,
      targetCalories: f.targetCalories.value ? Number(f.targetCalories.value) : null,
      targetProtein: f.targetProtein.value ? Number(f.targetProtein.value) : null,
      targetFat: f.targetFat.value ? Number(f.targetFat.value) : null,
      targetCarbs: f.targetCarbs.value ? Number(f.targetCarbs.value) : null,
    };
    persist('goal');
    toast('目標を保存しました');
    renderGoal();
  });
}

function updateTopbarDate() {
  const d = new Date();
  document.getElementById('topbar-date').textContent =
    `${d.getMonth() + 1}/${d.getDate()} (${['日','月','火','水','木','金','土'][d.getDay()]})`;
}

function init() {
  updateTopbarDate();
  initNav();
  initForms();
  initSettings();
  initRoutineModal();
  initPhotoResultModal();
  showTab('home');

  if ('serviceWorker' in navigator) {
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update().catch(() => {});
    }).catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
