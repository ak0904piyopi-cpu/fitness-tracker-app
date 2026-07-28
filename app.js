'use strict';

/* ---------- Storage ---------- */
const STORAGE_KEYS = {
  workouts: 'ftrack_workouts',
  meals: 'ftrack_meals',
  weights: 'ftrack_weights',
  goal: 'ftrack_goal',
  settings: 'ftrack_settings',
  exerciseLibrary: 'ftrack_exercise_library',
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
    geminiModel: 'gemini-2.5-flash',
  }),
  exerciseLibrary: load(STORAGE_KEYS.exerciseLibrary, null) || defaultExerciseLibrary(),
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

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1600);
}

/* ---------- Navigation ---------- */
const TAB_TITLES = { home: 'ホーム', workout: '筋トレ記録', meal: '食事記録', weight: '体重記録', goal: '目標設定' };

function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.dataset.panel !== name);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.target === name);
  });
  document.getElementById('topbar-title').textContent = TAB_TITLES[name];
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
  const cssHeight = canvas.height || 160;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? '#2a2e37' : '#e5e7eb';
  const textColor = isDark ? '#9aa0aa' : '#6b7280';
  const lineColor = opts.color || (isDark ? '#3b82f6' : '#2563eb');

  if (!points || points.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('データがありません', cssWidth / 2, cssHeight / 2);
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
    ctx.strokeStyle = '#f59e0b';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, ty);
    ctx.lineTo(cssWidth - padR, ty);
    ctx.stroke();
    ctx.restore();
  }

  // line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
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
    ctx.arc(x, y, 3, 0, Math.PI * 2);
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
function renderHome() {
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

let selectedExerciseCategory = null;
let selectedExerciseName = null;
let exerciseEditMode = false;

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
  const items = state.exerciseLibrary[selectedExerciseCategory] || [];
  let html = items.map(name => {
    if (exerciseEditMode) {
      return `<button type="button" class="chip chip-removable" data-remove-exercise="${escapeHtml(name)}">${escapeHtml(name)} ✕</button>`;
    }
    return `<button type="button" class="chip ${name === selectedExerciseName ? 'selected' : ''}" data-exercise-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  }).join('');
  if (exerciseEditMode) {
    html += `<button type="button" class="chip chip-add" id="exercise-add-chip">＋ 追加</button>`;
  }
  el.innerHTML = html;
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
  renderExerciseCategoryChips();
  renderExerciseItemChips();
  renderWorkoutProgressChart();
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

async function analyzeFoodPhoto(base64Data) {
  const { geminiApiKey, geminiModel } = state.settings;
  if (!geminiApiKey) throw new Error('NO_API_KEY');
  const model = geminiModel || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
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
    if (res.status === 400 || res.status === 403) throw new Error('INVALID_KEY');
    throw new Error('API_ERROR: ' + res.status + ' ' + errBody.slice(0, 200));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE');
  return JSON.parse(text);
}

async function handlePhotoSelected(file) {
  const statusEl = document.getElementById('photo-analyze-status');
  const btn = document.getElementById('photo-analyze-btn');

  if (!state.settings.geminiApiKey) {
    toast('先に設定画面でGemini APIキーを入力してください');
    openSettingsModal();
    return;
  }

  btn.disabled = true;
  statusEl.textContent = '解析中…';
  statusEl.classList.remove('hidden');
  statusEl.classList.add('loading');

  try {
    const base64 = await resizeImageToBase64(file);
    const result = await analyzeFoodPhoto(base64);

    const form = document.getElementById('meal-form');
    form.date.value = form.date.value || todayStr();
    form.foodName.value = result.name ?? '';
    form.calories.value = result.calories ?? '';
    form.protein.value = result.protein_g ?? 0;
    form.fat.value = result.fat_g ?? 0;
    form.carbs.value = result.carbs_g ?? 0;

    statusEl.textContent = '解析完了。内容を確認して「記録する」を押してください';
    toast('AIが推定しました');
  } catch (err) {
    console.error(err);
    if (err.message === 'INVALID_KEY') {
      statusEl.textContent = 'APIキーが正しくないか無効です。設定を確認してください。';
    } else if (err.message === 'EMPTY_RESPONSE') {
      statusEl.textContent = '解析結果を取得できませんでした。もう一度お試しください。';
    } else {
      statusEl.textContent = '解析に失敗しました（通信エラーの可能性があります）';
    }
  } finally {
    statusEl.classList.remove('loading');
    btn.disabled = false;
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

function initForms() {
  document.getElementById('workout-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    state.workouts.push({
      id: uid(),
      date: f.date.value,
      exercise: f.exercise.value.trim(),
      weight: Number(f.weight.value),
      reps: Number(f.reps.value),
      sets: Number(f.sets.value),
    });
    persist('workouts');
    f.exercise.value = '';
    f.weight.value = '';
    f.reps.value = '';
    f.sets.value = '1';
    selectedExerciseName = null;
    toast('記録しました');
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
    document.querySelector('#workout-form [name="weight"]').focus();
  });

  document.getElementById('workout-exercise-select').addEventListener('change', renderWorkoutProgressChart);

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
