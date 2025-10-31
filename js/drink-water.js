/********************
 * 配置（仅在代码中修改）
 ********************/
const DAILY_GOAL_ML = 2000; // 今日目标毫升数。示例：2000 ml
const SMALL_CUPS = [250, 250, 250, 250, 250, 250, 250, 250]; // 小杯容量列表，代表数量与各自毫升数

/********************
 * 工具函数
 ********************/
const fmt = (n) => new Intl.NumberFormat('zh-CN').format(Math.round(n));
// 替换原有 todayKey 与 ymd
const toLocalYMD = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const todayKey = () => toLocalYMD(); // 本地今天
const ymd = (d) => toLocalYMD(d); // 日历与查询同样用本地

/********************
 * IndexedDB 简易封装
 ********************/
const DB_NAME = 'hydratrack';
const DB_VER = 1;
const STORE = 'intake';

const idb = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'date' });
          os.createIndex('by_date', 'date');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  tx(db, mode = 'readonly') {
    return db.transaction(STORE, mode);
  },
  async get(date) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = this.tx(db).objectStore(STORE).get(date);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = this.tx(db, 'readwrite').objectStore(STORE).put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },
  async range(start, end) {
    // inclusive range by date
    const db = await this.open();
    const res = [];
    return new Promise((resolve, reject) => {
      const store = this.tx(db).objectStore(STORE);
      const idx = store.index('by_date');
      const keyRange = IDBKeyRange.bound(start, end);
      const req = idx.openCursor(keyRange);
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          res.push(cur.value);
          cur.continue();
        } else {
          resolve(res);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
};

/********************
 * 状态
 ********************/
const state = {
  date: todayKey(),
  goal: DAILY_GOAL_ML,
  smalls: SMALL_CUPS.map((v) => ({ vol: v, filled: false })),
  total: 0
};

/********************
 * 元素引用
 ********************/
const el = {
  progressText: document.getElementById('progressText'),
  progressBar: document.getElementById('progressBar'),
  goalBadge: document.getElementById('goalBadge'),
  todayBadge: document.getElementById('todayBadge'),
  statusBadge: document.getElementById('statusBadge'),
  badges: document.getElementById('badges'),
  smallCups: document.getElementById('smallCups'),
  cupFill: document.getElementById('cupFill'),
  calTitle: document.getElementById('calTitle'),
  calGrid: document.getElementById('calGrid'),
  prevMonth: document.getElementById('prevMonth'),
  nextMonth: document.getElementById('nextMonth'),
  thisMonth: document.getElementById('thisMonth')
};

/********************
 * 渲染函数
 ********************/
function renderSmallCups() {
  el.smallCups.innerHTML = '';
  state.smalls.forEach((cup, idx) => {
    const btn = document.createElement('button');
    btn.className = 'sCup';
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-idx', String(idx));
    btn.setAttribute('data-filled', String(cup.filled));
    btn.innerHTML = `
      <span class="sCup-visual">
        <span class="sCup-fill" style="height:${cup.filled ? '100' : '0'}%"></span>
      </span>
      <span class="sCup-vol">${cup.vol} ml</span>
    `;
    btn.addEventListener('click', onToggleCup);
    el.smallCups.appendChild(btn);
  });
}

function updateProgress() {
  const pct = Math.min(100, Math.round((state.total / state.goal) * 100) || 0);
  el.progressText.innerHTML = `${fmt(state.total)} / ${fmt(state.goal)} ml <small>(${pct}%)</small>`;
  el.progressBar.style.width = `${pct}%`;
  el.cupFill.style.height = `${pct}%`;
  el.cupFill.style.boxShadow = pct > 0 ? 'inset 0 8px 20px rgba(255,255,255,0.25)' : 'none';
  el.goalBadge.textContent = `目标 ${fmt(state.goal)} ml`;
  el.todayBadge.textContent = `今天 ${fmt(state.total)} ml`;
  el.statusBadge.textContent = pct >= 100 ? '目标达成 ✅' : pct >= 50 ? '继续加油 💧' : '未达成';

  // 顶部动态徽章
  el.badges.innerHTML = '';
  const b1 = document.createElement('span');
  b1.className = 'badge';
  b1.textContent = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const b2 = document.createElement('span');
  b2.className = 'badge';
  b2.textContent = pct >= 100 ? '目标完成' : `剩余 ${fmt(Math.max(0, state.goal - state.total))} ml`;
  el.badges.append(b1, b2);
}

async function onToggleCup(e) {
  const idx = Number(e.currentTarget.getAttribute('data-idx'));
  const cup = state.smalls[idx];
  cup.filled = !cup.filled;
  state.total = state.smalls.filter((c) => c.filled).reduce((s, c) => s + c.vol, 0);

  await idb.put({
    date: state.date,
    goal: state.goal,
    total: state.total,
    entries: state.smalls.map((c) => ({ vol: c.vol, filled: c.filled }))
  });

  // ✅ 重绘全部 UI，而不是仅当前按钮
  renderSmallCups();
  updateProgress();
  renderCalendar(currentMonth);
}

/********************
 * 加载与同步当日数据
 ********************/
async function loadToday() {
  const rec = await idb.get(state.date);
  if (rec) {
    state.goal = rec.goal ?? DAILY_GOAL_ML;
    state.total = rec.total ?? 0;
    // 与配置 SMALL_CUPS 对齐：以配置为基准展示，但如果历史中杯子数量不同，尽量映射
    const fromDb = rec.entries || [];
    state.smalls = SMALL_CUPS.map((vol, i) => ({ vol, filled: Boolean(fromDb[i]?.filled) }));
  } else {
    // 初始化
    await idb.put({
      date: state.date,
      goal: state.goal,
      total: 0,
      entries: state.smalls
    });
  }
  renderSmallCups();
  updateProgress();
}

/********************
 * 日历
 ********************/
let currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function renderCalendar(baseDate) {
  const y = baseDate.getFullYear();
  const m = baseDate.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);

  el.calTitle.textContent = `${y}年${String(m + 1).padStart(2, '0')}月`;
  el.calGrid.innerHTML = '';

  // 计算需要的前置空白（以周一为一周开始）
  const weekday = (first.getDay() + 6) % 7; // 0=Mon
  for (let i = 0; i < weekday; i++) {
    const pad = document.createElement('div');
    pad.className = 'day';
    pad.style.visibility = 'hidden';
    el.calGrid.appendChild(pad);
  }

  const startKey = ymd(first);
  const endKey = ymd(last);
  const rows = await idb.range(startKey, endKey);
  const map = Object.fromEntries(rows.map((r) => [r.date, r]));

  for (let d = 1; d <= last.getDate(); d++) {
    const cur = new Date(y, m, d);
    const key = ymd(cur);
    const rec = map[key] || null;
    const total = rec?.total || 0;
    const goal = rec?.goal || DAILY_GOAL_ML;
    const pct = Math.min(100, Math.round((total / goal) * 100) || 0);

    const cell = document.createElement('div');
    cell.className = 'day' + (key === state.date ? ' today' : '');
    cell.innerHTML = `
      <div class="date">${d}</div>
      <div class="amt">${fmt(total)} ml</div>
      <div class="pctBar" style="height:${pct}%"></div>
    `;
    el.calGrid.appendChild(cell);
  }
}

el.prevMonth.addEventListener('click', () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  renderCalendar(currentMonth);
});

el.nextMonth.addEventListener('click', () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  renderCalendar(currentMonth);
});

el.thisMonth.addEventListener('click', () => {
  currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  renderCalendar(currentMonth);
});

/********************
 * 启动
 ********************/
(async function start() {
  await loadToday();
  await renderCalendar(currentMonth);
})();
