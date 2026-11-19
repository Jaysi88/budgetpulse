'use strict';
/* BudgetPulse+ — offline-first budget calendar. No libraries, no backend. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const DAY = 86400000;

/* ---------- dates (day numbers = days since epoch, UTC based, timezone safe) ---------- */
const pd = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const ymd = n => { const d = new Date(n * DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() }; };
const fd = n => { const o = ymd(n); return `${o.y}-${pad(o.m + 1)}-${pad(o.d)}`; };
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const dayNum = (y, m, d) => Date.UTC(y, m, d) / DAY;
const todayN = () => { const d = new Date(); return dayNum(d.getFullYear(), d.getMonth(), d.getDate()); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDate = n => new Date(n * DAY).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const rel = n => { const t = todayN(), k = n - t; return k === 0 ? 'today' : k === 1 ? 'tomorrow' : k === -1 ? 'yesterday' : k > 0 ? `in ${k} days` : `${-k} days ago`; };

/* ---------- categories ---------- */
const CATS = {
  housing: { l: 'Housing', e: '🏠', c: '#8b5cff', t: 'expense' }, food: { l: 'Food', e: '🍜', c: '#ff9f43', t: 'expense' },
  transport: { l: 'Transport', e: '🚌', c: '#54a0ff', t: 'expense' }, remit: { l: 'Family', e: '👨‍👩‍👦', c: '#ff6b9d', t: 'expense' },
  savings: { l: 'Savings', e: '🚗', c: '#3ddc97', t: 'expense' }, bills: { l: 'Bills', e: '💡', c: '#feca57', t: 'expense' },
  phone: { l: 'Phone', e: '📱', c: '#48dbfb', t: 'expense' }, shop: { l: 'Shopping', e: '🛍️', c: '#c56cf0', t: 'expense' },
  health: { l: 'Health', e: '💊', c: '#ff7675', t: 'expense' }, fun: { l: 'Fun', e: '🎬', c: '#fd79a8', t: 'expense' },
  debt: { l: 'Debt', e: '💳', c: '#e17055', t: 'expense' }, other: { l: 'Other', e: '📦', c: '#a29bfe', t: 'expense' }, invest: { l: 'Investing', e: '📈', c: '#7bed9f', t: 'expense' },
  salary: { l: 'Salary', e: '💼', c: '#3ddc97', t: 'income' }, bonus: { l: 'Bonus', e: '🎁', c: '#55efc4', t: 'income' },
  repaid: { l: 'Repaid', e: '🤝', c: '#81ecec', t: 'income' }, inother: { l: 'Other', e: '💵', c: '#74b9ff', t: 'income' }
};
const catsOf = t => Object.keys(CATS).filter(k => CATS[k].t === t);
const FREQ = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' };
const CURS = ['USD', 'SGD', 'MYR', 'AED', 'MMK'];

/* ---------- storage ---------- */
const KEY = 'budgetpulse.v1', AIKEY = 'budgetpulse.ai', CHATKEY = 'budgetpulse.chat';
let state, ai, chat;
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Storage full or blocked'); } } };
const save = () => ls.set(KEY, state);
const saveAI = () => ls.set(AIKEY, ai);
const saveChat = () => ls.set(CHATKEY, chat.slice(-30));

const DEFAULT_RATES = { USD: 1, MMK: 4500, SGD: 1.3, MYR: 4.13, AED: 3.6725 };
const RATE_CURS = ['MMK', 'SGD', 'MYR', 'AED'];
const METHODS = ['Bank', 'KBZPay', 'WavePay', 'AYA Pay', 'Agent / hundi', 'Other'];
const PCOL = ['#ff6b9d', '#54a0ff', '#feca57', '#3ddc97', '#c56cf0', '#ff9f43', '#48dbfb', '#fd79a8'];

function seedDemo() {
  const t = ymd(todayN());
  const first = fd(dayNum(t.y, t.m, 1));
  const nm = (mo, d) => { const y = t.y + Math.floor((t.m + mo) / 12), m = (((t.m + mo) % 12) + 12) % 12; return fd(dayNum(y, m, Math.min(d, dim(y, m)))); };
  const A = { main: 'acc_main', sav: 'acc_sav', mm: 'acc_mm' };
  const T = (type, amount, cat, acc, date, note, rec, extra) => ({ id: uid(), type, amount, cat, acc, date, note: note || '', rec: rec || null, skip: [], demo: true, ...(extra || {}) });
  const nextSat = () => { let n = dayNum(t.y, t.m, 1) - 120; while (ymd(n).w !== 6) n++; return fd(n); };
  const nextMon = () => { let n = dayNum(t.y, t.m, 2) - 126; while (ymd(n).w !== 1) n++; return fd(n); };
  const M = { freq: 'monthly', end: '' };
  const cd = cryptoDemo(A.main), demoTx = cd._txDemo; delete cd._txDemo;
  const st = {
    meta: { demo: true, created: Date.now() },
    settings: { currency: 'USD', threshold: 1200, thrCur: 'USD', rates: { ...DEFAULT_RATES }, ratesCustom: {}, ratesUpdated: null, sw: 1 },
    people: ['Mother', 'Father', 'Brother'],
    accounts: [
      { id: A.main, name: 'Main account', cur: 'USD', opening: 1500, openingDate: first, demo: true },
      { id: A.sav, name: 'Savings', cur: 'USD', opening: 600, openingDate: first, demo: true },
      { id: A.mm, name: 'Myanmar wallet', cur: 'MMK', opening: 450000, openingDate: first, demo: true }
    ],
    tx: [
      T('income', 2500, 'salary', A.main, nm(-4, 28), 'DEMO monthly salary', M),
      T('expense', 2000000, 'remit', A.main, nm(-4, 15), 'DEMO monthly support', M, { cur: 'MMK', fee: 4000, remit: { to: 'Mother', method: 'KBZPay' } }),
      T('expense', 1000000, 'remit', A.main, nm(-4, 25), 'DEMO monthly support', M, { cur: 'MMK', fee: 2000, remit: { to: 'Father', method: 'WavePay' } }),
      T('expense', 120, 'remit', A.main, nm(-1, 12), 'DEMO school fees help', null, { fee: 5, remit: { to: 'Brother', method: 'Agent / hundi' } }),
      T('expense', 400, 'savings', A.main, nm(-4, 28), 'DEMO car fund', M),
      T('expense', 30, 'phone', A.main, nm(-4, 5), 'DEMO phone & data', M),
      T('expense', 15, 'fun', A.main, nm(-4, 12), 'DEMO streaming', M),
      T('expense', 120, 'bills', A.main, nm(-4, 20), 'DEMO insurance', M),
      T('expense', 60, 'food', A.main, nextSat(), 'DEMO weekly shop', { freq: 'weekly', end: '' }),
      T('expense', 40, 'fun', A.main, nextMon(), 'DEMO gym / fun', { freq: 'biweekly', end: '' }),
      T('expense', 1500, 'other', A.main, nm(1, 8), 'DEMO UAE visa fee (AED)', null, { cur: 'AED' }),
      T('expense', 220, 'health', A.main, nm(1, 10), 'DEMO medical for new job', null),
      T('income', 600, 'bonus', A.main, nm(1, 18), 'DEMO year-end bonus', null),
      T('income', 4, 'inother', A.sav, nm(-4, 15), 'DEMO interest', M),
      T('expense', 120000, 'shop', A.mm, nm(0, 22), 'DEMO shopping in Yangon', null, { cur: 'MMK' })
    ],
    goals: [{ id: uid(), name: 'Car fund', cur: 'USD', target: 12000, saved: 2400, monthly: 400, by: nm(19, 30), demo: true }],
    ious: [
      { id: uid(), dir: 'owed', who: 'Ko Aung (demo)', amount: 150, cur: 'USD', due: nm(0, 26), note: 'Lent for his phone', payments: [{ id: uid(), date: nm(-1, 20), amount: 50 }], demo: true },
      { id: uid(), dir: 'owe', who: 'Ko Aung (demo)', amount: 20, cur: 'USD', due: nm(0, 30), note: 'Taxi money', payments: [], demo: true },
      { id: uid(), dir: 'owe', who: 'Brother (demo)', amount: 1500000, cur: 'MMK', due: nm(1, 15), note: 'Borrowed for flight', payments: [{ id: uid(), date: nm(0, 5), amount: 500000 }], demo: true }
    ],
    crypto: cd
  };
  st.tx.push(...demoTx);
  return st;
}
function blank() {
  const t = ymd(todayN());
  return migrate({ meta: { demo: false, created: Date.now() }, settings: { currency: 'USD', threshold: 300 }, accounts: [{ id: uid(), name: 'Main account', opening: 0, openingDate: fd(dayNum(t.y, t.m, t.d)) }], tx: [], goals: [], ious: [] });
}
function migrate(st) {
  st.settings = Object.assign({ currency: 'USD', threshold: 300, sw: 1 }, st.settings || {});
  const s = st.settings; s.rates = Object.assign({}, DEFAULT_RATES, s.rates || {}); s.rates.USD = 1; s.thrCur = s.thrCur || s.currency; s.ratesCustom = s.ratesCustom || {}; if (!('ratesUpdated' in s)) s.ratesUpdated = null;
  st.accounts.forEach(a => { a.cur = a.cur || s.currency; });
  st.tx = (st.tx || []).map(x => ({ skip: [], ...x }));
  st.ious = (st.ious || []).map(i => ({ payments: [], cur: s.currency, ...i }));
  st.goals = (st.goals || []).map(g => ({ cur: s.currency, ...g }));
  st.crypto = Object.assign(cryptoDefaults(), st.crypto || {});
  st.people = st.people && st.people.length ? st.people : ['Mother', 'Father'];
  st.meta = st.meta || { demo: false, created: Date.now() };
  return st;
}
function load() {
  state = ls.get(KEY, null);
  if (!state || !state.accounts) { state = seedDemo(); save(); } else { migrate(state); }
  ai = Object.assign({ provider: 'xai', baseUrl: '', model: 'grok-4.7', key: '', profile: 'I support my parents back home and I am saving for a car. I plan to relocate to the UAE in 2027.' }, ls.get(AIKEY, {}));
  chat = ls.get(CHATKEY, []);
  if (state.meta.demo && !state.crypto.snaps.length && state.crypto.trades.some(t => t.demo)) { state.crypto.snaps = demoSnaps(); save(); }
}

/* ---------- currency ---------- */
const disp = () => state.settings.currency;
const rate = c => (state.settings.rates && state.settings.rates[c]) || 1;
const conv = (n, from, to) => { to = to || disp(); from = from || to; return from === to ? n : n / rate(from) * rate(to); };
const fmt = (n, dec, cur) => {
  const c = cur || disp(); const d = c === 'MMK' ? 0 : (dec ?? (Math.abs(n) % 1 === 0 ? 0 : 2));
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }).format(n); } catch { return c + ' ' + n.toFixed(d); }
};
const fmtBoth = (n, cur) => !cur || cur === disp() ? fmt(n) : `${fmt(n, undefined, cur)} ≈ ${fmt(conv(n, cur))}`;
const short = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? s + Math.round(a / 1e3) + 'k' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'k' : s + Math.round(a); };
const accOf = id => state.accounts.find(a => a.id === id) || state.accounts[0];
const txCur = t => t.cur || (accOf(t.acc) || {}).cur || disp();
const total = t => t.amount + (t.fee || 0);
const dAmt = t => conv(total(t), txCur(t));
const signed = t => (t.type === 'income' ? 1 : -1) * dAmt(t);
const getThr = () => conv(+state.settings.threshold || 0, state.settings.thrCur || disp());
const fmtTx = t => fmtBoth(t.amount, txCur(t));
const remaining = i => i.paid ? 0 : Math.max(0, i.amount - (i.payments || []).reduce((s, p) => s + p.amount, 0));
const fmtDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/* ---------- projection engine ---------- */
function occurrences(t, from, to) {
  const start = pd(t.date), out = [];
  const end = t.rec && t.rec.end ? Math.min(to, pd(t.rec.end)) : to;
  if (!t.rec) { if (start >= from && start <= to) out.push(start); }
  else {
    const f = t.rec.freq;
    if (f === 'daily' || f === 'weekly' || f === 'biweekly') {
      const step = f === 'daily' ? 1 : f === 'weekly' ? 7 : 14;
      let n = start < from ? start + Math.ceil((from - start) / step) * step : start;
      for (; n <= end; n += step) out.push(n);
    } else {
      const s = ymd(start), stepM = f === 'monthly' ? 1 : 12, sm = s.y * 12 + s.m, fm = ymd(from), fmm = fm.y * 12 + fm.m;
      let k = 0; if (fmm > sm) k = Math.max(0, Math.floor((fmm - sm) / stepM) * stepM - stepM);
      for (; ; k += stepM) {
        const mm = sm + k, y = Math.floor(mm / 12), m = mm % 12, n = dayNum(y, m, Math.min(s.d, dim(y, m)));
        if (n > end) break; if (n >= from && n >= start) out.push(n);
      }
    }
  }
  return t.skip && t.skip.length ? out.filter(n => !t.skip.includes(fd(n))) : out;
}
function eventsIn(from, to, ids) {
  const out = [];
  for (const t of state.tx) { if (ids && !ids.includes(t.acc)) continue; for (const n of occurrences(t, from, to)) out.push({ n, t }); }
  return out.sort((a, b) => a.n - b.n);
}
function series(ids, from, to) {
  const out = new Array(to - from + 1).fill(0);
  for (const a of state.accounts.filter(a => ids.includes(a.id))) {
    const od = pd(a.openingDate); let run = conv(a.opening, a.cur); const delta = new Map();
    for (const e of eventsIn(od, to, [a.id])) { const s = signed(e.t); if (e.n < from) run += s; else delta.set(e.n, (delta.get(e.n) || 0) + s); }
    for (let d = from; d <= to; d++) { run += delta.get(d) || 0; out[d - from] += run; }
  }
  return out;
}
const status = b => { const th = getThr(); return b < th ? 'r' : b < th * 1.25 ? 'a' : 'g'; };
function monthTotals(ids, y, m) {
  let income = 0, spend = 0, saved = 0; const byCat = {};
  for (const e of eventsIn(dayNum(y, m, 1), dayNum(y, m, dim(y, m)), ids)) {
    const v = dAmt(e.t);
    if (e.t.type === 'income') income += v; else if (e.t.cat === 'savings' || e.t.cat === 'invest') saved += v; else { spend += v; byCat[e.t.cat] = (byCat[e.t.cat] || 0) + v; }
  }
  return { income, spend, saved, byCat };
}
const allIds = () => state.accounts.map(a => a.id);

/* ---------- UI state ---------- */
const ui = { tab: 'home', acc: 'all', y: 0, m: 0, ry: 0, rm: 0, coach: 'insights', busy: false, ptab: 'family', person: 'all', histN: 12 };
{ const t = ymd(todayN()); ui.y = ui.ry = t.y; ui.m = ui.rm = t.m; }
const curIds = () => ui.acc === 'all' ? allIds() : [ui.acc];
const accName = id => (state.accounts.find(a => a.id === id) || { name: '?' }).name;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function sheet(html, cls = '') { const r = $('#sheetRoot'); r.innerHTML = `<div class="overlay" data-a="closebg"><div class="sheet ${cls}" role="dialog"><div class="grab"></div>${html}</div></div>`; lockBody(); }
function closeSheet() { $('#sheetRoot').innerHTML = ''; unlockBody(); }
function ask(msg, ok = 'Confirm', danger = true) {
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'overlay'; d.style.zIndex = 90;
    d.innerHTML = `<div class="sheet"><div class="grab"></div><p style="font-size:16px;margin:4px 0 16px">${esc(msg)}</p><div class="row"><button class="btn grow" data-r="0">Cancel</button><button class="btn grow ${danger ? 'danger' : 'primary'}" data-r="1" id="askOk">${esc(ok)}</button></div></div>`;
    d.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b || e.target === d) { d.remove(); res(b && b.dataset.r === '1'); } });
    document.body.appendChild(d);
  });
}

const closeAll = () => { ui.dayOpen = null; closeSheet(); };
const back = () => ui.dayOpen ? openDay(ui.dayOpen) : closeSheet();
// native document scrolling; body is pinned (position:fixed) while a sheet is open and the scroll offset is restored on close
let lockY = null;
function lockBody() { if (lockY !== null) return; lockY = window.scrollY; const b = document.body.style; b.position = 'fixed'; b.top = (-lockY) + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'; }
function unlockBody() { if (lockY === null) return; const y = lockY; lockY = null; const b = document.body.style; b.position = b.top = b.left = b.right = b.width = ''; window.scrollTo(0, y); }
const getScroll = () => lockY !== null ? lockY : window.scrollY;
const setScroll = y => { if (lockY !== null) { lockY = y; document.body.style.top = (-y) + 'px'; } else window.scrollTo(0, y); };
function changed() { save(); const y = getScroll(); render(); setScroll(y); if (ui.dayOpen) openDay(ui.dayOpen); else closeSheet(); }
const iouDueOn = n => state.ious.filter(i => i.due === fd(n) && remaining(i) > 0);
const amtHtml = (t, sign) => { const c = txCur(t); return `<div class="amt ${t.type === 'income' ? 'pos' : 'neg'}">${sign || (t.type === 'income' ? '+' : '−')}${fmt(t.amount, undefined, c)}${c !== disp() ? `<div class="s" style="font-weight:400">≈ ${fmt(conv(t.amount, c))}</div>` : ''}</div>`; };
const titleOf = t => t.remit ? (t.note || `Family → ${t.remit.to}`) : (t.note || CATS[t.cat].l);

/* ---------- HOME ---------- */
function viewHome() {
  const ids = curIds(), t = todayN(), thr = getThr();
  const first = dayNum(ui.y, ui.m, 1), dm = dim(ui.y, ui.m);
  const gs = first - ((ymd(first).w + 6) % 7), rows = Math.ceil((first - gs + dm) / 7), ge = gs + rows * 7 - 1;
  const from = Math.min(gs, t), to = Math.max(ge, t + 365), ser = series(ids, from, to), bal = n => ser[n - from];
  const cur = bal(t);
  let dip = null; for (let d = t; d <= t + 365; d++) if (bal(d) < thr) { dip = d; break; }
  const o = ymd(t), eom = bal(dayNum(o.y, o.m, dim(o.y, o.m)));
  let warn;
  if (dip === t) warn = `<div class="warn red">⚠️ <div><b>Below your low-balance limit now.</b> ${fmt(cur)} is under ${fmt(thr)}. ${nextIncomeText(ids, t)}</div></div>`;
  else if (dip) warn = `<div class="warn ${dip - t <= 14 ? 'red' : 'amber'}">⚠️ <div><b>Low balance ahead:</b> projected to drop under ${fmt(thr)} on ${fmtDate(dip)} (${rel(dip)}) — ${fmt(bal(dip))}.</div></div>`;
  else warn = `<div class="warn green">✅ <div>Projected to stay above ${fmt(thr)} for the next 12 months.</div></div>`;
  const up = eventsIn(t + 1, t + 7, ids), outS = up.filter(e => e.t.type === 'expense').reduce((s, e) => s + dAmt(e.t), 0), inS = up.filter(e => e.t.type === 'income').reduce((s, e) => s + dAmt(e.t), 0);
  let ious7 = 0; for (let d = t + 1; d <= t + 7; d++) ious7 += iouDueOn(d).length;
  const nx = up[0];
  const banner = nx ? `<button class="glass banner" data-a="upcoming"><div class="ic">${CATS[nx.t.cat].e}</div><div class="grow"><div class="small muted">Next 7 days · ${up.length} item${up.length > 1 ? 's' : ''}${ious7 ? ` · ${ious7} IOU due` : ''}</div><b>${esc(titleOf(nx.t))} · ${nx.t.type === 'income' ? '+' : '−'}${fmt(conv(nx.t.amount, txCur(nx.t)))}</b><div class="small muted">${fmtDate(nx.n)} (${rel(nx.n)}) · out ${fmt(outS)}${inS ? ' · in ' + fmt(inS) : ''}</div></div><span class="muted">›</span></button>`
    : `<button class="glass banner" data-a="upcoming"><div class="ic">🗓️</div><div class="grow"><b>Nothing due in the next 7 days</b><div class="small muted">${ious7 ? `${ious7} IOU due · tap to see` : 'Tap + to add a bill or payday.'}</div></div></button>`;
  let cells = '';
  for (let n = gs; n <= ge; n++) {
    const od = ymd(n), inM = od.m === ui.m && od.y === ui.y, evs = eventsIn(n, n, ids), hasI = evs.some(e => e.t.type === 'income'), hasE = evs.some(e => e.t.type === 'expense'), hasQ = iouDueOn(n).length > 0;
    cells += `<button class="day ${status(bal(n))} ${inM ? '' : 'out'} ${n === t ? 'today' : ''} ${n < t ? 'past' : ''}" data-a="day" data-n="${n}" aria-label="${fmtDate(n)} balance ${Math.round(bal(n))}"><span class="n">${od.d}</span><span class="b">${short(bal(n))}</span><span class="dots">${hasI ? '<i class="dot i"></i>' : ''}${hasE ? '<i class="dot e"></i>' : ''}${hasQ ? '<i class="dot q"></i>' : ''}</span></button>`;
  }
  const accChips = `<div class="chips"><button class="chip ${ui.acc === 'all' ? 'on' : ''}" data-a="acc" data-id="all">All accounts</button>${state.accounts.map(a => `<button class="chip ${ui.acc === a.id ? 'on' : ''}" data-a="acc" data-id="${a.id}">${esc(a.name)}${a.cur !== disp() ? ' · ' + a.cur : ''}</button>`).join('')}</div>`;
  const demo = state.meta.demo ? `<div class="demo"><span>🧪 <b>Demo data</b> — sample numbers, not yours.</span><button class="btn sm danger" data-a="cleardemo">Clear demo data</button></div>` : '';
  const sel = ui.acc !== 'all' ? accOf(ui.acc) : null, native = sel && sel.cur !== disp() ? ` · ${fmt(conv(cur, disp(), sel.cur), undefined, sel.cur)}` : '';
  return `${demo}${accChips}${banner}
  <div class="glass"><div class="row between"><span class="muted small">Current balance · ${ui.acc === 'all' ? 'All accounts' : esc(accName(ui.acc))}</span><button class="chip" style="padding:4px 10px;font-size:12px" data-a="setthr">Limit ${fmt(thr)} ✎</button></div>
  <div class="bal ${cur < thr ? 'neg' : ''}">${fmt(cur, 2)}</div><div class="small muted">End of ${MONTHS[o.m]} projected: <b>${fmt(eom)}</b>${native}</div>${warn}</div>
  ${netWorthCard()}
  <div class="glass"><div class="cal-head"><button data-a="mprev" aria-label="Previous month">‹</button><div style="text-align:center"><b style="font-size:17px">${MONTHS[ui.m]} ${ui.y}</b><div class="small muted">Projected balance at end of each day (${disp()})</div></div><button data-a="mnext" aria-label="Next month">›</button></div>
  <div class="dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div><div class="grid">${cells}</div>
  <div class="legend"><span><i style="background:#3ddc97"></i>Safe</span><span><i style="background:#ffc24b"></i>Near limit</span><span><i style="background:#ff5d7a"></i>Below limit</span><span><i class="dot i" style="display:inline-block;margin-right:4px"></i>Income</span><span><i class="dot e" style="display:inline-block;margin-right:4px"></i>Expense</span><span><i class="dot q" style="display:inline-block;margin-right:4px"></i>IOU due</span></div>
  ${(ui.y !== o.y || ui.m !== o.m) ? `<button class="btn sm block" style="margin-top:10px" data-a="gotoday">Back to today</button>` : ''}</div>`;
}
function netWorthCard() {
  const w = netWorth(), io = w.io;
  return `<div class="glass"><div class="row between"><span class="muted small">Net worth</span><span class="small muted">accounts + crypto + IOUs</span></div><div class="bal" style="font-size:28px">${w.partial ? '~' : ''}${fmt(w.total, 0)}</div><div class="row wrap small"><span>🏦 ${fmt(w.acc, 0)}</span>${w.held ? `<button class="chip" style="padding:3px 10px;font-size:12px" data-a="tab" data-tab="crypto">₿ ${fmt(w.cr, 0)}</button>` : ''}<span>🤝 ${io < 0 ? '−' : '+'}${fmt(Math.abs(io), 0)}</span></div></div>`;
}
function nextIncomeText(ids, t) { const e = eventsIn(t + 1, t + 60, ids).find(e => e.t.type === 'income'); return e ? `Next income: ${fmt(conv(e.t.amount, txCur(e.t)))} ${rel(e.n)}.` : ''; }

function itemRow(e, opts = {}) {
  const t = e.t, c = CATS[t.cat];
  const sub = t.remit ? `To ${esc(t.remit.to)} · ${esc(t.remit.method)}${t.fee ? ' · fee ' + fmt(t.fee, undefined, txCur(t)) : ''}` : `${c.l} · ${esc(accName(t.acc))}`;
  return `<div class="item"><div class="ei">${c.e}</div><div class="grow"><div class="t">${esc(titleOf(t))}</div><div class="s">${sub}${t.rec ? ' · 🔁 ' + FREQ[t.rec.freq] : ''}${t.demo ? ' · demo' : ''}${opts.date ? ' · ' + fmtDate(e.n) : ''}</div></div>${amtHtml(t)}${opts.edit ? `<button class="iconbtn" data-a="edit" data-id="${t.id}" data-n="${e.n}" aria-label="Edit">✎</button><button class="iconbtn" data-a="del" data-id="${t.id}" data-n="${e.n}" aria-label="Delete">🗑</button>` : ''}</div>`;
}
function iouDueRow(i) {
  return `<div class="item"><div class="ei">🤝</div><div class="grow"><div class="t">${i.dir === 'owed' ? esc(i.who) + ' owes you' : 'You owe ' + esc(i.who)}</div><div class="s">IOU due · remaining ${fmtBoth(remaining(i), i.cur)}</div></div><button class="btn sm" data-a="pay" data-id="${i.id}">Record payment</button></div>`;
}
function openDay(n) {
  ui.dayOpen = n; const ids = curIds(), evs = eventsIn(n, n, ids), b = series(ids, n, n)[0], st = status(b), dues = iouDueOn(n);
  const inc = evs.filter(e => e.t.type === 'income').reduce((s, e) => s + dAmt(e.t), 0), exp = evs.filter(e => e.t.type === 'expense').reduce((s, e) => s + dAmt(e.t), 0);
  sheet(`<div class="row between"><div><h2 style="margin:0">${fmtDate(n)}${n === todayN() ? ' · Today' : ''}</h2><div class="small muted">End-of-day balance</div></div><div style="text-align:right"><b style="font-size:20px" class="${st === 'r' ? 'neg' : st === 'g' ? 'pos' : ''}" id="dayBal">${fmt(b, 2)}</b><div class="small muted">${st === 'r' ? 'below limit' : st === 'a' ? 'near limit' : 'safe'}</div></div></div>
  <div class="small muted" style="margin:6px 0">${evs.length ? `In ${fmt(inc)} · Out ${fmt(exp)}` : 'No bills or income this day.'}</div>
  <div id="dayItems">${evs.map(e => itemRow(e, { edit: true })).join('')}</div>
  ${dues.length ? `<h3 style="margin-top:10px">IOUs due</h3><div id="dayIous">${dues.map(iouDueRow).join('')}</div>` : ''}
  <div class="row" style="margin-top:12px"><button class="btn primary grow" data-a="add" data-n="${n}">+ Add item</button><button class="btn grow" data-a="closeall">Close</button></div>`);
}
function openUpcoming() {
  const t = todayN(), evs = eventsIn(t + 1, t + 7, curIds()); let dues = []; for (let d = t + 1; d <= t + 7; d++) iouDueOn(d).forEach(i => dues.push(i));
  sheet(`<h2>Next 7 days</h2>${evs.map(e => itemRow(e, { date: true })).join('') || '<p class="muted">No bills or income scheduled.</p>'}${dues.length ? `<h3 style="margin-top:10px">IOUs due</h3>${dues.map(iouDueRow).join('')}` : ''}<button class="btn block" style="margin-top:12px" data-a="closeall">Close</button>`);
}

/* ---------- ADD / EDIT ---------- */
let fctx = {};
const curOpts = sel => CURS.map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const FREQ_SHORT = { monthly: 'Monthly', biweekly: 'Every 2 weeks', weekly: 'Weekly' };
function catGrid(type, sel) { return catsOf(type).filter(k => k !== 'remit' || sel === 'remit').map(k => `<button type="button" class="${k === sel ? 'on' : ''}" data-a="pickcat" data-k="${k}"><span>${CATS[k].e}</span>${CATS[k].l}</button>`).join(''); }
function openTx(o = {}) {
  const t = o.id ? state.tx.find(x => x.id === o.id) : null;
  if (t && t.remit) return openRemit({ id: t.id });
  const type = t ? t.type : (o.type || 'expense');
  fctx = { id: t && t.id, type, cat: t ? t.cat : (type === 'expense' ? 'food' : 'salary') };
  const date = t ? t.date : (o.date || fd(todayN())), acc = t ? t.acc : (ui.acc !== 'all' ? ui.acc : state.accounts[0].id), quick = !!o.quick && !t, cur = t ? txCur(t) : accOf(acc).cur;
  sheet(`<form id="txForm" autocomplete="off"><div class="row between"><h2 style="margin:0">${t ? 'Edit item' : quick ? 'Quick add' : 'Add item'}</h2><button type="button" class="iconbtn" data-a="back" aria-label="Close">✕</button></div>
  ${quick ? `<div class="row wrap" style="margin-top:8px"><button type="button" class="btn sm grow" data-a="remitnew">👨‍👩‍👦 Send money to family</button><button type="button" class="btn sm grow" data-a="iou">🤝 Borrow / lend</button></div>` : ''}
  <div class="seg" style="margin:10px 0" id="typeSeg"><button type="button" data-a="settype" data-t="expense" class="${type === 'expense' ? 'on' : ''}">Expense</button><button type="button" data-a="settype" data-t="income" class="${type === 'income' ? 'on' : ''}">Income</button></div>
  <div class="row"><input class="amtbox grow" name="amount" id="fAmount" inputmode="decimal" placeholder="0.00" value="${t ? t.amount : ''}" aria-label="Amount" required style="min-width:0"><select name="cur" id="fCur" style="width:92px" aria-label="Currency">${curOpts(cur)}</select></div>
  <label class="f">Category</label><div class="catgrid" id="catGrid">${catGrid(type, fctx.cat)}</div>
  <label class="f">Account</label><select name="acc">${state.accounts.map(a => `<option value="${a.id}" ${a.id === acc ? 'selected' : ''}>${esc(a.name)} (${a.cur})</option>`).join('')}</select>
  ${quick ? `<button type="button" class="btn sm" style="margin-top:10px" data-a="more">More options ›</button>` : ''}
  <div id="more" ${quick ? 'hidden' : ''}>
    <label class="f">${t && t.rec ? 'Series starts on' : 'Date'}</label><input type="date" name="date" value="${date}" required>
    <label class="f">Repeat</label><select name="freq" id="fFreq"><option value="none">Does not repeat</option>${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${t && t.rec && t.rec.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <div id="endRow" ${t && t.rec ? '' : 'hidden'}><label class="f">Ends on (optional)</label><input type="date" name="end" value="${t && t.rec ? t.rec.end || '' : ''}"></div>
    <label class="f">Note</label><input name="note" maxlength="60" placeholder="e.g. Rent, Insurance" value="${t ? esc(t.note) : ''}">
    ${t && t.rec ? '<div class="small muted" style="margin-top:6px">Editing changes the whole repeating series.</div>' : ''}
  </div>
  <button class="btn primary block" style="margin-top:16px" type="submit">${t ? 'Save changes' : 'Add'}</button></form>`);
  setTimeout(() => { const a = $('#fAmount'); a && !t && a.focus(); }, 50);
}
function submitTx(f) {
  const v = new FormData(f), amount = parseFloat(String(v.get('amount')).replace(/,/g, ''));
  if (!(amount > 0)) { toast('Enter an amount above 0'); return; }
  const date = v.get('date') || fd(todayN()), freq = v.get('freq') || 'none', end = v.get('end') || '';
  if (freq !== 'none' && end && end < date) { toast('End date is before the start'); return; }
  const rec = freq === 'none' ? null : { freq, end };
  const data = { type: fctx.type, amount: Math.round(amount * 100) / 100, cur: v.get('cur'), cat: fctx.cat, acc: v.get('acc'), date, note: (v.get('note') || '').trim(), rec };
  if (fctx.id) { const t = state.tx.find(x => x.id === fctx.id); Object.assign(t, data); delete t.demo; if (!rec) t.skip = []; }
  else state.tx.push({ id: uid(), skip: [], ...data });
  toast(fctx.id ? 'Saved' : 'Added'); changed();
}
function openDel(id, n) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  if (!t.rec) { sheet(`<h2>Delete this item?</h2><p class="muted">${esc(titleOf(t))} · ${fmtTx(t)}</p><div class="row"><button class="btn grow" data-a="back">Cancel</button><button class="btn danger grow" data-a="delall" data-id="${id}">Delete</button></div>`); return; }
  sheet(`<h2>Delete repeating item</h2><p class="muted">${esc(titleOf(t))} · ${FREQ[t.rec.freq]}</p><div style="display:grid;gap:8px"><button class="btn" data-a="delskip" data-id="${id}" data-n="${n}">Skip only ${fmtDate(+n)}</button><button class="btn danger" data-a="delall" data-id="${id}">Delete the whole series</button><button class="btn" data-a="back">Cancel</button></div>`);
}

/* ---------- family remittance form ---------- */
function openRemit(o = {}) {
  const t = o.id ? state.tx.find(x => x.id === o.id) : null, acc = t ? t.acc : (ui.acc !== 'all' ? ui.acc : state.accounts[0].id);
  const cur = t ? txCur(t) : (state.settings.lastRemitCur || 'MMK'), to = t ? t.remit.to : (o.to || state.people[0]);
  const people = state.people.includes(to) ? state.people : [...state.people, to];
  fctx = { id: t && t.id };
  sheet(`<form id="remitForm" autocomplete="off"><div class="row between"><h2 style="margin:0">${t ? 'Edit remittance' : '👨‍👩‍👦 Send money to family'}</h2><button type="button" class="iconbtn" data-a="back" aria-label="Close">✕</button></div>
  <label class="f">Recipient</label><select name="to" id="rTo">${people.map(p => `<option ${p === to ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__new">＋ Add someone new…</option></select>
  <input name="newto" id="rNew" placeholder="Name or relation (e.g. Sister)" maxlength="30" hidden style="margin-top:6px">
  <label class="f">Amount sent</label><div class="row"><input class="amtbox grow" name="amount" id="rAmt" inputmode="decimal" placeholder="0" value="${t ? t.amount : ''}" required style="min-width:0"><select name="cur" id="rCur" style="width:92px">${curOpts(cur)}</select></div>
  <div class="row" style="margin-top:2px"><div class="grow"><label class="f">Fee (same currency)</label><input name="fee" id="rFee" inputmode="decimal" placeholder="0" value="${t && t.fee ? t.fee : ''}"></div><div class="grow"><label class="f">Method</label><select name="method">${METHODS.map(m => `<option ${t && t.remit.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
  <label class="f">Take it from account</label><select name="acc" id="rAcc">${state.accounts.map(a => `<option value="${a.id}" ${a.id === acc ? 'selected' : ''}>${esc(a.name)} (${a.cur})</option>`).join('')}</select>
  <div class="small muted" id="rPrev" style="margin-top:6px"></div>
  <label class="f">${t && t.rec ? 'Series starts on' : 'Date'}</label><input type="date" name="date" value="${t ? t.date : (o.date || fd(todayN()))}" required>
  <label class="f">Repeat</label><select name="freq" id="rFreq"><option value="none">One time</option>${Object.entries(FREQ_SHORT).map(([k, v]) => `<option value="${k}" ${t && t.rec && t.rec.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <div id="rEndRow" ${t && t.rec ? '' : 'hidden'}><label class="f">Ends on (optional)</label><input type="date" name="end" value="${t && t.rec ? t.rec.end || '' : ''}"></div>
  <label class="f">Note</label><input name="note" maxlength="60" placeholder="e.g. Monthly support, school fees" value="${t ? esc(t.note) : ''}">
  <button class="btn primary block" style="margin-top:16px" type="submit">${t ? 'Save changes' : 'Save remittance'}</button>
  ${t ? `<button type="button" class="btn danger block" style="margin-top:10px" data-a="del" data-id="${t.id}" data-n="${pd(t.date)}">Delete…</button>` : ''}</form>`);
  updateRemitPrev();
}
function updateRemitPrev() {
  const f = $('#remitForm'); if (!f) return;
  const amt = num(f.amount.value) || 0, fee = num(f.fee.value) || 0, cur = f.cur.value, tot = amt + fee, acc = accOf(f.acc.value);
  $('#rPrev').innerHTML = amt ? `Total taken: <b>${fmt(tot, undefined, cur)}</b>${cur !== acc.cur ? ` ≈ <b>${fmt(conv(tot, cur, acc.cur), undefined, acc.cur)}</b> from ${esc(acc.name)}` : ''}${cur !== disp() ? ` (≈ ${fmt(conv(tot, cur))})` : ''} · 1 USD = ${rate(cur).toLocaleString('en-US')} ${cur}` : 'Counts as an expense in your balance and calendar.';
}
function submitRemit(f) {
  const v = new FormData(f), amount = num(v.get('amount')), fee = num(v.get('fee')) || 0;
  if (!(amount > 0)) return toast('Enter the amount sent');
  let to = v.get('to'); if (to === '__new') { to = (v.get('newto') || '').trim(); if (!to) return toast('Type the recipient name'); if (!state.people.includes(to)) state.people.push(to); }
  const date = v.get('date'), freq = v.get('freq'), end = v.get('end') || ''; if (freq !== 'none' && end && end < date) return toast('End date is before the start');
  const data = { type: 'expense', cat: 'remit', amount: Math.round(amount * 100) / 100, fee: Math.round(fee * 100) / 100, cur: v.get('cur'), acc: v.get('acc'), date, note: (v.get('note') || '').trim(), rec: freq === 'none' ? null : { freq, end }, remit: { to, method: v.get('method') } };
  state.settings.lastRemitCur = data.cur;
  if (fctx.id) { const t = state.tx.find(x => x.id === fctx.id); Object.assign(t, data); delete t.demo; if (!data.rec) t.skip = []; } else state.tx.push({ id: uid(), skip: [], ...data });
  toast('Remittance saved'); changed();
}

/* ---------- REPORTS ---------- */
function donut(byCat, total) {
  const R = 58, C = 2 * Math.PI * R; let off = 0, segs = '';
  const ent = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of ent) { const len = v / total * C; segs += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${CATS[k].c}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`; off += len; }
  return `<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Spending by category"><circle r="${R}" cx="80" cy="80" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="26"/>${segs}<text x="80" y="76" text-anchor="middle" fill="#b9b0dc" font-size="11">Spent</text><text x="80" y="95" text-anchor="middle" fill="#fff" font-size="16" font-weight="800">${short(total)}</text></svg>`;
}
function viewReports() {
  const ids = curIds(), tt = monthTotals(ids, ui.ry, ui.rm), now = ymd(todayN());
  const ent = Object.entries(tt.byCat).sort((a, b) => b[1] - a[1]);
  const months = []; for (let i = -4; i <= 1; i++) { const k = ui.ry * 12 + ui.rm + i, y = Math.floor(k / 12), m = k % 12; months.push({ y, m, ...monthTotals(ids, y, m) }); }
  const mx = Math.max(1, ...months.flatMap(m => [m.income, m.spend])), W = 340, H = 170, bw = 18, gap = (W - 6 * bw * 2) / 7; let bars = '';
  months.forEach((m, i) => {
    const x = gap + i * (bw * 2 + gap), hI = m.income / mx * 110, hE = m.spend / mx * 110, fut = m.y * 12 + m.m > now.y * 12 + now.m;
    bars += `<g opacity="${fut ? .6 : 1}"><rect x="${x}" y="${130 - hI}" width="${bw}" height="${hI}" rx="5" fill="#3ddc97"/><rect x="${x + bw + 2}" y="${130 - hE}" width="${bw}" height="${hE}" rx="5" fill="#ff4fb3"/><text x="${x + bw}" y="148" text-anchor="middle" fill="#b9b0dc" font-size="11">${MONTHS[m.m].slice(0, 3)}</text>${m.income || m.spend ? `<text x="${x + bw - 1}" y="${126 - Math.max(hI, hE)}" text-anchor="middle" fill="#fff" font-size="9">${short(Math.max(m.income, m.spend))}</text>` : ''}</g>`;
  });
  const net = tt.income - tt.spend - tt.saved;
  return `<div class="glass tight"><div class="cal-head" style="margin:0"><button data-a="rprev">‹</button><div style="text-align:center"><b>${MONTHS[ui.rm]} ${ui.ry}</b><div class="small muted">${ui.acc === 'all' ? 'All accounts' : esc(accName(ui.acc))} · incl. planned items</div></div><button data-a="rnext">›</button></div></div>
  <div class="kpis"><div class="glass kpi"><small>Income</small><b class="pos">${fmt(tt.income)}</b></div><div class="glass kpi"><small>Spent</small><b class="neg">${fmt(tt.spend)}</b></div><div class="glass kpi"><small>Saved</small><b>${fmt(tt.saved)}</b></div></div>
  <div class="glass"><h2>Spending by category</h2>${ent.length ? `<div class="donutwrap">${donut(tt.byCat, tt.spend)}<div class="legendlist">${ent.map(([k, v]) => `<div><i style="background:${CATS[k].c}"></i>${CATS[k].e} ${CATS[k].l}<span class="v">${fmt(v)} <span class="muted small">${Math.round(v / tt.spend * 100)}%</span></span></div>`).join('')}</div></div>` : '<p class="muted">No spending this month.</p>'}</div>
  <div class="glass"><h2>Income vs expenses</h2><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Income versus expenses by month">${bars}</svg><div class="legend"><span><i style="background:#3ddc97"></i>Income</span><span><i style="background:#ff4fb3"></i>Spending</span><span>Faded = future (planned)</span></div></div>
  <div class="glass small muted">After spending and savings this month you ${net >= 0 ? 'keep' : 'are short by'} <b class="${net >= 0 ? 'pos' : 'neg'}">${fmt(Math.abs(net))}</b>.</div>`;
}

/* ---------- COACH: rule-based insights ---------- */
const mEq = t => !t.rec ? 0 : ({ daily: 30.44, weekly: 4.345, biweekly: 2.17, monthly: 1, yearly: 1 / 12 })[t.rec.freq];
function insights() {
  const ids = allIds(), t = todayN(), o = ymd(t), thr = getThr(), cur = monthTotals(ids, o.y, o.m), out = [];
  const ser = series(ids, t, t + 365); let dip = null; for (let i = 0; i < ser.length; i++) if (ser[i] < thr) { dip = t + i; break; }
  if (dip === t) out.push({ s: 'r', e: '🚨', tags: ['save', 'cut'], title: 'You are under your safety limit', text: `Balance ${fmt(ser[0])} is below your ${fmt(thr)} limit. Pause non-essential spending until the next income.` });
  else if (dip) out.push({ s: dip - t < 14 ? 'r' : 'a', e: '⏳', tags: ['save', 'cut'], title: `${dip - t} day${dip - t > 1 ? 's' : ''} until you hit your limit`, text: `On ${fmtDate(dip)} your balance is projected to drop to ${fmt(ser[dip - t])}, under your ${fmt(thr)} limit. Move a bill, or hold back spending before then.` });
  else out.push({ s: 'g', e: '🛡️', tags: ['save'], title: 'No low-balance days in the next 12 months', text: `Your projected balance never falls under ${fmt(thr)}. Lowest point: ${fmt(Math.min(...ser))}.` });
  const pay = eventsIn(t + 1, t + 62, ids).find(e => e.t.type === 'income' && e.t.cat === 'salary') || eventsIn(t + 1, t + 62, ids).find(e => e.t.type === 'income');
  if (pay) out.push({ s: 'b', e: '💸', tags: ['save'], title: `Next payday ${rel(pay.n)}`, text: `${fmt(conv(pay.t.amount, txCur(pay.t)))} lands on ${fmtDate(pay.n)}. Until then, keep daily spending around ${fmt(Math.max(0, (ser[0] - thr)) / Math.max(1, pay.n - t))} a day to stay above your limit.` });
  if (cur.income > 0) {
    const rate = (cur.income - cur.spend) / cur.income;
    out.push({ s: rate >= .2 ? 'g' : rate >= .1 ? 'a' : 'r', e: '📈', tags: ['save'], title: `Savings rate ${Math.round(rate * 100)}% this month`, text: `Income ${fmt(cur.income)}, spending ${fmt(cur.spend)}, so ${fmt(cur.income - cur.spend)} is left to save or already moved to savings (${fmt(cur.saved)}). ${rate >= .2 ? 'That is at or above the 20% target.' : `Reaching 20% means keeping ${fmt(cur.income * .2)} a month; you are ${fmt(Math.max(0, cur.income * .2 - (cur.income - cur.spend)))} short.`}` });
  }
  const top = Object.entries(cur.byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) out.push({ s: 'b', e: '🍰', tags: ['cut', 'save'], title: 'Where your money goes', text: top.map(([k, v]) => `${CATS[k].e} ${CATS[k].l} ${fmt(v)} (${Math.round(v / cur.spend * 100)}%)`).join(' · ') + `. Trimming your top category by 10% frees ${fmt(top[0][1] * .1)} a month.` });
  const rec = {}; for (const x of state.tx) if (x.type === 'expense' && x.rec && x.cat !== 'savings' && x.cat !== 'remit') rec[x.id] = { x, m: dAmt(x) * mEq(x) };
  const bigR = Object.values(rec).sort((a, b) => b.m - a.m).slice(0, 3);
  if (bigR.length) out.push({ s: 'b', e: '🔁', tags: ['cut'], title: 'Biggest repeating costs', text: bigR.map(r => `${esc(r.x.note.replace(/^DEMO /, '') || CATS[r.x.cat].l)} ≈ ${fmt(r.m)}/mo`).join(' · ') + '. Review these first; cutting a repeating cost saves every month.' });
  const rd = remitData(), yr = rd.filter(r => ymd(r.n).y === o.y), yrTot = yr.reduce((x, r) => x + r.v, 0), yrFee = yr.reduce((x, r) => x + r.fee, 0), rem = cur.byCat.remit || 0;
  if (rem > 0 && cur.income > 0) {
    const p = rem / cur.income, byP = {}; yr.forEach(r => byP[r.to] = (byP[r.to] || 0) + r.v); const top = Object.entries(byP).sort((a, b) => b[1] - a[1]).slice(0, 3);
    out.push({ s: p > .4 ? 'a' : 'g', e: '👨‍👩‍👦', tags: ['family', 'save'], title: `Family support is ${Math.round(p * 100)}% of income`, text: `This month you send about ${fmt(rem)} (${fmt(rem * 12)} a year at this pace). ${top.length ? 'So far this year: ' + top.map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(', ') + '. ' : ''}${p > .4 ? 'That is a big share; agree a fixed monthly amount and keep an emergency buffer.' : 'That is a healthy share. A fixed monthly day makes it predictable.'}` });
    if (yrFee > 0 && yrTot > 0) {
      const bm = {}; yr.forEach(r => { const k = (r.t.remit && r.t.remit.method) || 'Other'; (bm[k] = bm[k] || { s: 0, f: 0 }); bm[k].s += r.v; bm[k].f += r.fee; });
      const rates = Object.entries(bm).filter(([, x]) => x.s > 0).map(([k, x]) => [k, x.f / x.s * 100]).sort((a, b) => a[1] - b[1]);
      out.push({ s: 'b', e: '🧾', tags: ['family', 'cut', 'save'], title: `Transfer fees ${fmt(yrFee)} this year`, text: `That is ${(yrFee / yrTot * 100).toFixed(1)}% of what you sent. ${rates.length > 1 ? `Cheapest so far: ${rates[0][0]} (${rates[0][1].toFixed(2)}%); dearest: ${rates[rates.length - 1][0]} (${rates[rates.length - 1][1].toFixed(2)}%). Fewer, larger transfers usually cost less.` : 'Fewer, larger transfers usually cost less.'}` });
    }
  } else if (!rem) out.push({ s: 'b', e: '👨‍👩‍👦', tags: ['family'], title: 'Family support', text: 'Log what you send home in the People tab, so your calendar plans around it.' });
  for (const g of state.goals) {
    const gc = g.cur || disp(), tg = conv(g.target, gc), sv = conv(g.saved, gc), mo = conv(g.monthly || 0, gc), left = Math.max(0, tg - sv), pct = tg ? Math.round(sv / tg * 100) : 0; let txt = `${fmt(sv)} of ${fmt(tg)} saved (${pct}%).`, sev = 'b';
    if (left === 0) { txt += ' Goal reached! 🎉'; sev = 'g'; }
    else {
      if (mo > 0) { const mn = Math.ceil(left / mo); txt += ` At ${fmt(mo)}/month you finish in about ${mn} months (${MONTHS[ymd(t + mn * 30.44).m]} ${ymd(t + mn * 30.44).y}).`; const hundred = conv(100, 'USD'), m2 = Math.ceil(left / (mo + hundred)); if (m2 < mn) txt += ` Each extra ${fmt(hundred)} a month brings that forward by ${mn - m2} month${mn - m2 > 1 ? 's' : ''}.`; }
      else txt += ' Set a monthly amount to get an end date.';
      if (g.by) { const ml = Math.max(1, (pd(g.by) - t) / 30.44), need = left / ml; txt += ` To hit ${fmtDate(pd(g.by))} you need ${fmt(need)}/month.`; sev = mo >= need ? 'g' : 'a'; }
    }
    out.push({ s: sev, e: /car/i.test(g.name) ? '🚗' : '🎯', tags: ['car', 'save'], title: `${esc(g.name)} progress`, text: txt });
  }
  const nets = ioNets(), owedT = nets.filter(x => x.net > 0).reduce((s, x) => s + x.net, 0), oweT = nets.filter(x => x.net < 0).reduce((s, x) => s - x.net, 0), od = state.ious.filter(i => remaining(i) > 0 && i.due && pd(i.due) < t);
  if (nets.some(x => x.net !== 0)) out.push({ s: od.length ? 'a' : 'b', e: '🤝', tags: ['debt'], title: 'Borrow & lend', text: `After netting each person: owed to you ${fmt(owedT)}, you owe ${fmt(oweT)}.${od.length ? ` ${od.length} overdue.` : ''} ${nets.filter(x => x.net < 0).slice(0, 2).map(x => `You owe ${esc(x.who)} ${fmt(-x.net)}.`).join(' ')} Pay what you owe first; remind people before their due date.` });
  out.push(...cryptoInsights());
  if (state.tx.length === 0) out.unshift({ s: 'b', e: '👋', tags: [], title: 'Add your first items', text: 'Add your salary and your regular bills, then the calendar and coach fill in by themselves.' });
  return out;
}
const TIPS = {
  save: ['Pay yourself first: move your savings on payday, before you spend.', 'Make saving a repeating expense in the Savings category so the calendar plans around it.', 'Keep a buffer above your low-balance limit before putting extra into goals.'],
  cut: ['Start with your top category and your biggest repeating bills.', 'Wait 24 hours before any unplanned purchase over a set amount.', 'Cancel subscriptions you have not used in 30 days.'],
  car: ['Set a monthly amount and a target date on the goal, and the coach shows what you need each month.', 'Buy used or compare total cost of ownership (insurance, fuel, parking), not only the price.', 'Aim for a down payment of 20% or more to cut the loan cost.'],
  family: ['Agree a fixed monthly amount and a fixed day, so both sides can plan.', 'Keep a separate emergency buffer for family surprises.', 'Compare transfer fees and exchange rates before each remittance.'],
  debt: ['List everything you owe with due dates, and pay the highest-interest debt first (or the smallest first if you need quick wins).', 'Pay at least the minimum on everything, and put any extra on one target.', 'For money you lent, set a due date in the IOU tracker and remind politely before it.']
};
const TOPICS = { save: 'Save more', cut: 'Cut spending', car: 'Car fund plan', family: 'Family budget', debt: 'Debt payoff' };
function guessTopic(q) { q = q.toLowerCase(); return /car|vehicle|goal|down ?payment/.test(q) ? 'car' : /parent|family|remit|send home|mum|mom|dad/.test(q) ? 'family' : /debt|owe|loan|iou|borrow/.test(q) ? 'debt' : /cut|reduce|spend|expens|cheap|budget/.test(q) ? 'cut' : 'save'; }
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function offlineAnswer(topic, why) {
  const ins = insights().filter(i => i.tags.includes(topic)).slice(0, 3);
  return `${why}\n\n**${TOPICS[topic]} — from your own numbers:**\n${ins.map(i => `- **${unesc(i.title)}.** ${unesc(i.text)}`).join('\n')}\n\n**General tips:**\n${TIPS[topic].map(x => `- ${x}`).join('\n')}`;
}
function viewCoach() {
  const tabs = [['insights', 'Tips'], ['ai', 'Ask AI'], ['reports', 'Reports'], ['goals', 'Goals']];
  const seg = `<div class="seg sm" style="margin-bottom:12px">${tabs.map(([k, l]) => `<button class="${ui.coach === k ? 'on' : ''}" data-a="ctab" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (ui.coach === 'insights') return seg + `<div class="small muted" style="margin:0 2px 8px">Works offline. Built only from your own data, across all accounts.</div>` + insights().map(i => `<div class="insight ${i.s}"><div class="em">${i.e}</div><div><b>${i.title}</b><span>${i.text}</span></div></div>`).join('') + `<div class="disc">Not financial advice. Tips are rule-based estimates from the numbers you entered.</div>`;
  if (ui.coach === 'ai') return seg + viewAI();
  if (ui.coach === 'reports') return seg + viewReports();
  return seg + viewGoals();
}

/* ---------- COACH: Ask AI (bring-your-own-key) ---------- */
function mdLite(s) {
  const lines = esc(s).split('\n'); let h = '', inl = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!inl) { h += '<ul>'; inl = true; } h += `<li>${m[1]}</li>`; } else { if (inl) { h += '</ul>'; inl = false; } if (l.trim()) h += `<p>${l}</p>`; }
  }
  return h + (inl ? '</ul>' : '');
}
function renderChat() {
  const el = $('#chatlog'); if (!el) return;
  el.innerHTML = chat.length ? chat.map(m => `<div class="msg ${m.r === 'u' ? 'u' : 'a'} ${m.sys ? 'sys' : ''} ${m.typing ? 'typing' : ''}">${m.r === 'u' ? esc(m.t) : m.typing ? esc(m.t) : mdLite(m.t)}</div>`).join('') : `<div class="muted small" style="padding:6px">Ask a question about your money, or tap a topic below. Example: "How can I save for a car faster?"</div>`;
  el.scrollTop = el.scrollHeight;
}
function viewAI() {
  const hasKey = !!ai.key;
  return `<div class="glass"><div class="row between"><h2 style="margin:0">Ask the AI coach</h2><span class="badge" style="${hasKey ? 'background:rgba(61,220,151,.15);border-color:rgba(61,220,151,.5);color:#8cf0c2' : ''}">${hasKey ? 'Key set' : 'No key'}</span></div>
  ${hasKey ? '' : `<div class="warn amber" style="margin-top:8px">🔑 <div>AI chat needs your own API key. Add it in <a href="#" data-a="gosettings">Settings → AI coach</a>. Without it you still get offline tips from your own numbers.</div></div>`}
  <div class="chips" style="margin-top:10px">${Object.entries(TOPICS).map(([k, l]) => `<button class="chip" data-a="topic" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="chat" id="chatlog"></div>
  <form class="askbar" id="askForm"><input id="askInput" placeholder="Ask about saving or spending…" maxlength="400" autocomplete="off"><button class="btn primary" type="submit" id="askBtn">Send</button></form>
  <div class="row between" style="margin-top:8px"><button class="btn sm" data-a="preview">See what is sent</button><button class="btn sm" data-a="clearchat">Clear chat</button></div>
  <div class="disc">🔒 Only a compact summary of your numbers goes to the AI service you chose, never your key to anyone else. This is not financial advice. Check important decisions yourself.</div></div>`;
}
function buildSummary() {
  const ids = allIds(), t = todayN(), o = ymd(t), thr = getThr(), months = [], r = k => Math.round(k);
  for (let i = -2; i <= 0; i++) { const k = o.y * 12 + o.m + i, y = Math.floor(k / 12), m = k % 12, x = monthTotals(ids, y, m); months.push({ month: `${y}-${pad(m + 1)}${i === 0 ? ' (incl. planned)' : ''}`, income: r(x.income), spending: r(x.spend), savedToGoals: r(x.saved), spendingByCategory: Object.fromEntries(Object.entries(x.byCat).map(([k, v]) => [CATS[k].l, r(v)])) }); }
  const rec = { income: {}, expense: {} };
  for (const x of state.tx) if (x.rec) { const m = Math.round(dAmt(x) * mEq(x)); const b = rec[x.type]; const nm = CATS[x.cat].l; b[nm] = (b[nm] || 0) + m; }
  const ser = series(ids, t, t + 365); let dip = null; for (let i = 0; i < ser.length; i++) if (ser[i] < thr) { dip = i; break; }
  const pay = eventsIn(t + 1, t + 62, ids).find(e => e.t.type === 'income');
  const rd = remitData(), yr = rd.filter(x => ymd(x.n).y === o.y), mon = yr.filter(x => ymd(x.n).m === o.m), byR = {}; yr.forEach(x => byR[x.to] = (byR[x.to] || 0) + x.v);
  const nets = ioNets();
  return {
    amountsAre: `all amounts in ${disp()} (converted with the user's own rates: 1 USD = ${RATE_CURS.map(c => rate(c) + ' ' + c).join(', ')})`, today: fd(t), about_user: ai.profile || undefined,
    accounts: state.accounts.map(a => ({ name: a.name, nativeCurrency: a.cur, balance: r(series([a.id], t, t)[0]) })), lowBalanceLimit: r(thr),
    daysUntilBelowLimit: dip === null ? 'not within 12 months' : dip, daysUntilNextIncome: pay ? pay.n - t : null,
    months, monthlyRecurringEquivalent: rec,
    familySupportSent: { thisMonthSoFar: r(mon.reduce((s, x) => s + x.v, 0)), thisYear: r(yr.reduce((s, x) => s + x.v, 0)), feesThisYear: r(yr.reduce((s, x) => s + x.fee, 0)), byRecipientThisYear: Object.fromEntries(Object.entries(byR).map(([k, v]) => [k, r(v)])) },
    goals: state.goals.map(g => ({ name: g.name, target: r(conv(g.target, g.cur)), saved: r(conv(g.saved, g.cur)), plannedMonthly: r(conv(g.monthly || 0, g.cur)), targetDate: g.by || null })),
    crypto: cryptoSummary(), netWorth: (() => { const w = netWorth(); return { total: r(w.total), accounts: r(w.acc), crypto: r(w.cr), iouNet: r(w.io) }; })(),
    borrowLend: nets.filter(x => x.net !== 0).map(x => ({ direction: x.net > 0 ? 'owed to me (net)' : 'I owe (net)', amount: r(Math.abs(x.net)), earliestDue: x.due || null, overdue: !!(x.due && pd(x.due) < t) }))
  };
}
function endpoint() {
  let u = ai.provider === 'xai' ? 'https://api.x.ai/v1' : (ai.baseUrl || '').trim();
  if (!u) throw new Error('Add a base URL in Settings → AI coach.');
  u = u.replace(/\/+$/, ''); if (!/\/chat\/completions$/.test(u)) u += '/chat/completions';
  if (!/^https:\/\//.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u)) throw new Error('The AI address must start with https://');
  return u;
}
async function callAI(question, history) {
  const url = endpoint(), sys = `You are a friendly, practical personal-finance coach inside a budgeting app on the user's phone. Use ONLY the JSON summary of the user's finances below; never invent numbers. Reply in plain language, short (under 180 words), with 2-4 concrete actions and numbers in ${state.settings.currency}. If a question needs information you do not have, say what is missing. You are not a licensed adviser; add a brief reminder only when the topic is investing, borrowing or taxes.\n\nUSER DATA:\n${JSON.stringify(buildSummary())}`;
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.key }, body: JSON.stringify({ model: ai.model || 'grok-4.7', stream: false, messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: question }] }) });
    if (!r.ok) { let m = ''; try { const j = await r.json(); m = (j.error && (j.error.message || j.error)) || j.message || ''; } catch { } const e = new Error(r.status === 401 || r.status === 403 ? 'The AI service rejected your key. Check it in Settings.' : r.status === 429 ? 'Rate limit or no credit left on your AI account.' : `AI service error ${r.status}. ${String(m).slice(0, 140)}`); e.http = true; throw e; }
    const j = await r.json(), txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!txt) throw Object.assign(new Error('The AI sent an empty reply.'), { http: true });
    return String(txt);
  } finally { clearTimeout(to); }
}
async function sendQuestion(q, topic) {
  q = q.trim(); if (!q || ui.busy) return;
  topic = topic || guessTopic(q);
  const hist = chat.filter(m => !m.sys && !m.typing && !m.offline).slice(-8).map(m => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t }));
  chat.push({ r: 'u', t: q }); const offlineNow = !navigator.onLine;
  if (!ai.key || offlineNow) { chat.push({ r: 'a', t: offlineAnswer(topic, ai.key ? '📴 You are offline, so here is the offline coach instead.' : '🔑 No API key yet, so here is the offline coach. Add your key in Settings to chat with the AI.'), sys: true, offline: true }); saveChat(); renderChat(); return; }
  ui.busy = true; chat.push({ r: 'a', t: 'Thinking…', typing: true }); renderChat(); const b = $('#askBtn'); if (b) b.disabled = true;
  try { const a = await callAI(q, hist); chat.pop(); chat.push({ r: 'a', t: a }); }
  catch (e) { chat.pop(); const why = e.http ? '⚠️ ' + e.message : e.name === 'AbortError' ? '⏱️ The AI took too long.' : '📴 Could not reach the AI (offline or blocked).'; chat.push({ r: 'a', t: offlineAnswer(topic, why + ' Showing offline tips instead.'), sys: true, offline: true }); }
  ui.busy = false; saveChat(); renderChat(); const b2 = $('#askBtn'); if (b2) b2.disabled = false;
}

/* ---------- Goals ---------- */
function viewGoals() {
  return state.goals.map(g => { const gc = g.cur || disp(), pct = g.target ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0; return `<div class="glass"><div class="row between"><b>${/car/i.test(g.name) ? '🚗' : '🎯'} ${esc(g.name)}${g.demo ? ' <span class="muted small">(demo)</span>' : ''}</b><span class="muted small">${pct}%</span></div><div class="bar" style="margin:8px 0"><div style="width:${pct}%"></div></div><div class="row between small"><span>${fmtBoth(g.saved, gc)} saved</span><span class="muted">Target ${fmt(g.target, undefined, gc)}${g.by ? ' · by ' + fmtDate(pd(g.by)) : ''}</span></div><div class="row" style="margin-top:10px"><button class="btn sm primary grow" data-a="contrib" data-id="${g.id}">+ Add savings</button><button class="btn sm" data-a="goal" data-id="${g.id}">Edit</button></div></div>`; }).join('') + `<button class="btn block" data-a="goal">+ New goal</button><div class="disc">Goal amounts keep their own currency and convert to ${disp()} with your rates. "Add savings" can also record an expense in your calendar.</div>`;
}
function openGoal(id) {
  const g = state.goals.find(x => x.id === id) || {};
  sheet(`<form id="goalForm" data-id="${g.id || ''}"><h2>${g.id ? 'Edit goal' : 'New goal'}</h2><label class="f">Name</label><input name="name" required maxlength="40" value="${esc(g.name || '')}" placeholder="Car fund">
  <label class="f">Goal currency</label><select name="cur">${curOpts(g.cur || disp())}</select>
  <label class="f">Target amount</label><input name="target" inputmode="decimal" required value="${g.target || ''}"><label class="f">Saved so far</label><input name="saved" inputmode="decimal" value="${g.saved || 0}">
  <label class="f">Planned saving per month</label><input name="monthly" inputmode="decimal" value="${g.monthly || ''}"><label class="f">Target date (optional)</label><input type="date" name="by" value="${g.by || ''}">
  <div class="row" style="margin-top:14px"><button type="button" class="btn grow" data-a="closeall">Cancel</button><button class="btn primary grow" type="submit">Save</button></div>${g.id ? `<button type="button" class="btn danger block" style="margin-top:10px" data-a="delgoal" data-id="${g.id}">Delete goal</button>` : ''}</form>`);
}
function openContrib(id) {
  const g = state.goals.find(x => x.id === id);
  sheet(`<form id="contribForm" data-id="${id}"><h2>Add to ${esc(g.name)}</h2><div class="row"><input class="amtbox grow" name="amount" inputmode="decimal" placeholder="0.00" required id="fAmount" style="min-width:0"><div class="amtbox" style="font-size:18px">${g.cur || disp()}</div></div><label class="f">From account</label><select name="acc">${state.accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${a.cur})</option>`).join('')}</select>
  <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="rec" checked> Also record as a Savings expense today</label><div class="row" style="margin-top:14px"><button type="button" class="btn grow" data-a="closeall">Cancel</button><button class="btn primary grow" type="submit">Add</button></div></form>`);
}

/* ---------- People: family remittances + borrow & lend ---------- */
const pColor = n => { const i = state.people.indexOf(n); return i < 0 ? '#a29bfe' : PCOL[i % PCOL.length]; };
function remitData() {
  const t = todayN(), out = [];
  for (const x of state.tx) if (x.cat === 'remit') for (const n of occurrences(x, pd(x.date), t)) out.push({ n, t: x, to: (x.remit && x.remit.to) || 'Other', v: conv(x.amount, txCur(x)), fee: conv(x.fee || 0, txCur(x)), tot: dAmt(x) });
  return out.sort((a, b) => b.n - a.n);
}
function ioNets() {
  const g = new Map();
  for (const i of state.ious) {
    const k = i.who.trim().toLowerCase(); if (!g.has(k)) g.set(k, { who: i.who.trim(), net: 0, items: [], due: '' });
    const e = g.get(k), r = conv(remaining(i), i.cur); e.items.push(i); e.net += (i.dir === 'owed' ? 1 : -1) * r;
    if (remaining(i) > 0 && i.due && (!e.due || i.due < e.due)) e.due = i.due;
  }
  return [...g.values()].map(e => ({ ...e, net: Math.round(e.net * 100) / 100 })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
function viewPeople() {
  const seg = `<div class="seg sm" style="margin-bottom:12px"><button class="${ui.ptab === 'family' ? 'on' : ''}" data-a="ptab" data-k="family">👨‍👩‍👦 Family support</button><button class="${ui.ptab === 'iou' ? 'on' : ''}" data-a="ptab" data-k="iou">🤝 Borrow & lend</button></div>`;
  return seg + (ui.ptab === 'family' ? viewFamily() : viewIou());
}
function viewFamily() {
  const t = todayN(), o = ymd(t), all = remitData(), f = ui.person, rd = all.filter(r => f === 'all' || r.to === f);
  const sum = (arr, k = 'v') => arr.reduce((s, r) => s + r[k], 0), inMonth = (r, y, m) => { const d = ymd(r.n); return d.y === y && d.m === m; };
  const mo = rd.filter(r => inMonth(r, o.y, o.m)), yr = rd.filter(r => ymd(r.n).y === o.y);
  const names = [...state.people]; all.forEach(r => { if (!names.includes(r.to)) names.push(r.to); });
  const chips = `<div class="chips"><button class="chip ${f === 'all' ? 'on' : ''}" data-a="pfilter" data-p="all">Everyone</button>${names.map(p => `<button class="chip ${f === p ? 'on' : ''}" data-a="pfilter" data-p="${esc(p)}"><span style="color:${pColor(p)}">●</span> ${esc(p)}</button>`).join('')}<button class="chip" data-a="people">⚙ People</button></div>`;
  const rows = names.map(p => { const a = all.filter(r => r.to === p); return { p, m: sum(a.filter(r => inMonth(r, o.y, o.m)), 'tot'), y: sum(a.filter(r => ymd(r.n).y === o.y), 'tot'), fee: sum(a.filter(r => ymd(r.n).y === o.y), 'fee'), n: a.length }; }).filter(r => r.n);
  const table = rows.length ? `<div class="glass"><h2>Totals per person (${disp()})</h2><div class="ptable"><div class="ph"><span>Person</span><span>This month</span><span>${o.y}</span><span>Fees ${o.y}</span></div>${rows.map(r => `<div><span><b style="color:${pColor(r.p)}">●</b> ${esc(r.p)}</span><span>${fmt(r.m)}</span><span>${fmt(r.y)}</span><span class="muted">${fmt(r.fee)}</span></div>`).join('')}</div><div class="small muted" style="margin-top:6px">Includes fees. Counts only money already sent (up to today).</div></div>` : '';
  const months = []; for (let i = -5; i <= 0; i++) { const k = o.y * 12 + o.m + i, y = Math.floor(k / 12), m = k % 12, by = {}; rd.filter(r => inMonth(r, y, m)).forEach(r => by[r.to] = (by[r.to] || 0) + r.tot); months.push({ y, m, by, tot: Object.values(by).reduce((a, b) => a + b, 0) }); }
  const mx = Math.max(1, ...months.map(m => m.tot)), W = 340, bw = 36, gap = (W - 6 * bw) / 7; let bars = '';
  months.forEach((m, i) => { const x = gap + i * (bw + gap); let y0 = 120; for (const [p, v] of Object.entries(m.by)) { const h = v / mx * 95; y0 -= h; bars += `<rect x="${x}" y="${y0}" width="${bw}" height="${Math.max(h, 1)}" rx="4" fill="${pColor(p)}"/>`; } bars += `<text x="${x + bw / 2}" y="138" text-anchor="middle" fill="#b9b0dc" font-size="11">${MONTHS[m.m].slice(0, 3)}</text>${m.tot ? `<text x="${x + bw / 2}" y="${y0 - 4}" text-anchor="middle" fill="#fff" font-size="9">${short(m.tot)}</text>` : ''}`; });
  const chart = `<div class="glass"><h2>Sent per month</h2><svg viewBox="0 0 ${W} 148" width="100%" role="img" aria-label="Money sent to family by month">${bars}</svg><div class="legend">${[...new Set(rd.map(r => r.to))].map(p => `<span><i style="background:${pColor(p)}"></i>${esc(p)}</span>`).join('') || '<span>No remittances yet</span>'}</div></div>`;
  const up = eventsIn(t + 1, t + 60, null).filter(e => e.t.cat === 'remit' && (f === 'all' || (e.t.remit && e.t.remit.to === f))).slice(0, 5);
  const upc = up.length ? `<div class="glass"><h2>Scheduled next</h2>${up.map(e => itemRow(e, { date: true })).join('')}</div>` : '';
  const n = ui.histN || 12, hist = rd.slice(0, n);
  const histH = `<div class="glass"><h2>History${f !== 'all' ? ' · ' + esc(f) : ''}</h2>${hist.length ? hist.map(r => `<div class="item"><div class="ei" style="background:${pColor(r.to)}33">${r.t.rec ? '🔁' : '💸'}</div><div class="grow"><div class="t">${esc(r.to)} · ${esc((r.t.remit && r.t.remit.method) || '')}</div><div class="s">${fmtDay(fd(r.n))}${r.t.fee ? ' · fee ' + fmt(r.t.fee, undefined, txCur(r.t)) : ''}${r.t.note ? ' · ' + esc(r.t.note) : ''}${r.t.demo ? ' · demo' : ''}</div></div><div class="amt neg">${fmt(r.t.amount, undefined, txCur(r.t))}${txCur(r.t) !== disp() ? `<div class="s" style="font-weight:400">≈ ${fmt(r.v)}</div>` : ''}</div><button class="iconbtn" data-a="edit" data-id="${r.t.id}" data-n="${r.n}" aria-label="Edit">✎</button></div>`).join('') : '<p class="muted">Nothing logged yet. Tap the button above.</p>'}${rd.length > n ? `<button class="btn sm block" style="margin-top:8px" data-a="histmore">Show more (${rd.length - n})</button>` : ''}</div>`;
  return `${state.meta.demo ? `<div class="demo"><span>🧪 Demo data</span><button class="btn sm danger" data-a="cleardemo">Clear demo data</button></div>` : ''}${chips}<button class="btn primary block" data-a="remitnew" style="margin-bottom:12px">＋ Send money / log remittance</button>
  <div class="kpis"><div class="glass kpi"><small>This month</small><b>${fmt(sum(mo, 'tot'))}</b></div><div class="glass kpi"><small>This year</small><b>${fmt(sum(yr, 'tot'))}</b></div><div class="glass kpi"><small>Fees (year)</small><b>${fmt(sum(yr, 'fee'))}</b></div></div>${table}${chart}${upc}${histH}`;
}
function ioRow(i) {
  const rem = remaining(i), paid = (i.payments || []).reduce((s, p) => s + p.amount, 0), pct = Math.min(100, Math.round(paid / i.amount * 100)), t = todayN();
  return `<div class="item" style="${rem === 0 ? 'opacity:.55' : ''}"><div class="ei">${i.dir === 'owed' ? '⬅️' : '➡️'}</div><div class="grow"><div class="t">${i.dir === 'owed' ? 'You lent' : 'You borrowed'} ${fmt(i.amount, undefined, i.cur)}${i.note ? ' · ' + esc(i.note) : ''}</div><div class="s">${rem === 0 ? 'Settled ✓' : `Remaining ${fmtBoth(rem, i.cur)}`}${i.due && rem > 0 ? ' · due ' + fmtDate(pd(i.due)) + (pd(i.due) < t ? ' · <b style="color:#ffc24b">overdue</b>' : '') : ''}${paid ? ` · ${i.payments.length} payment${i.payments.length > 1 ? 's' : ''}` : ''}${i.demo ? ' · demo' : ''}</div>${paid && rem ? `<div class="bar" style="height:6px;margin-top:5px"><div style="width:${pct}%"></div></div>` : ''}</div>${rem > 0 ? `<button class="btn sm" data-a="pay" data-id="${i.id}">Pay</button>` : ''}<button class="iconbtn" data-a="iouedit" data-id="${i.id}" aria-label="Edit">✎</button></div>`;
}
function viewIou() {
  const nets = ioNets(), owed = nets.filter(x => x.net > 0).reduce((s, x) => s + x.net, 0), owe = nets.filter(x => x.net < 0).reduce((s, x) => s - x.net, 0);
  return `<div class="kpis" style="grid-template-columns:1fr 1fr"><div class="glass kpi"><small>Owed to you (net)</small><b class="pos">${fmt(owed)}</b></div><div class="glass kpi"><small>You owe (net)</small><b class="neg">${fmt(owe)}</b></div></div>
  <button class="btn primary block" data-a="iounew" style="margin-bottom:12px">＋ Add borrow / lend</button>
  ${nets.map(x => `<div class="glass"><div class="row between"><b>${esc(x.who)}</b><b class="${x.net > 0 ? 'pos' : x.net < 0 ? 'neg' : 'muted'}">${x.net > 0 ? `${esc(x.who)} owes you ${fmt(x.net)}` : x.net < 0 ? `You owe ${esc(x.who)} ${fmt(-x.net)}` : 'All settled'}</b></div>${x.due ? `<div class="small muted">Next due ${fmtDate(pd(x.due))}</div>` : ''}${x.items.sort((a, b) => (remaining(b) > 0) - (remaining(a) > 0)).map(ioRow).join('')}</div>`).join('') || '<div class="glass muted">No borrow or lend records yet.</div>'}
  <div class="disc">Each person is netted in ${disp()} using your exchange rates. IOUs with a due date show on the calendar.</div>`;
}
function openIou(id) {
  const i = state.ious.find(x => x.id === id) || { dir: 'owed', cur: disp() }, names = [...new Set(state.ious.map(x => x.who.trim()))];
  sheet(`<form id="iouForm" data-id="${i.id || ''}"><div class="row between"><h2 style="margin:0">${i.id ? 'Edit record' : 'Borrow / lend'}</h2><button type="button" class="iconbtn" data-a="back" aria-label="Close">✕</button></div><div class="seg" id="iouDir" style="margin-top:10px"><button type="button" data-a="ioudir" data-d="owed" class="${i.dir === 'owed' ? 'on' : ''}">I lent (they owe me)</button><button type="button" data-a="ioudir" data-d="owe" class="${i.dir === 'owe' ? 'on' : ''}">I borrowed (I owe)</button></div><input type="hidden" name="dir" value="${i.dir}">
  <label class="f">Person (a nickname is enough)</label><input name="who" required maxlength="40" list="iouNames" value="${esc(i.who || '')}"><datalist id="iouNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
  <label class="f">Amount</label><div class="row"><input name="amount" class="grow" inputmode="decimal" required value="${i.amount || ''}" style="min-width:0"><select name="cur" style="width:92px">${curOpts(i.cur)}</select></div>
  <label class="f">Due date (optional, shows on calendar)</label><input type="date" name="due" value="${i.due || ''}"><label class="f">Note</label><input name="note" maxlength="60" value="${esc(i.note || '')}" placeholder="e.g. For his phone">
  ${i.id ? (i.payments.length ? `<h3 style="margin-top:12px">Payments</h3>${i.payments.map(p => `<div class="item"><div class="grow"><div class="t">${fmt(p.amount, undefined, i.cur)}</div><div class="s">${fmtDay(p.date)}</div></div><button type="button" class="iconbtn" data-a="delpay" data-id="${i.id}" data-p="${p.id}" aria-label="Remove payment">🗑</button></div>`).join('')}` : '') : `<label class="f" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="rec"> Also record the money moving in my account today</label><select name="acc" style="margin-top:6px">${state.accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${a.cur})</option>`).join('')}</select>`}
  <button class="btn primary block" style="margin-top:14px" type="submit">Save</button>${i.id ? `<button type="button" class="btn danger block" style="margin-top:10px" data-a="deliou" data-id="${i.id}">Delete record</button>` : ''}</form>`);
}
function openPay(id) {
  const i = state.ious.find(x => x.id === id), rem = remaining(i);
  sheet(`<form id="payForm" data-id="${id}"><div class="row between"><h2 style="margin:0">Record payment</h2><button type="button" class="iconbtn" data-a="back" aria-label="Close">✕</button></div><p class="muted">${i.dir === 'owed' ? esc(i.who) + ' pays you back' : 'You pay back ' + esc(i.who)} · remaining <b>${fmt(rem, undefined, i.cur)}</b></p>
  <div class="row"><input class="amtbox grow" name="amount" id="fAmount" inputmode="decimal" value="${rem}" required style="min-width:0"><div class="amtbox" style="font-size:18px">${i.cur}</div></div><label class="f">Date</label><input type="date" name="date" value="${fd(todayN())}" required>
  <label class="f" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="rec" checked> Also record in my account (${i.dir === 'owed' ? 'income' : 'expense'})</label><select name="acc" style="margin-top:6px">${state.accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${a.cur})</option>`).join('')}</select>
  <button class="btn primary block" style="margin-top:14px" type="submit">Save payment</button></form>`);
}
function openPeople() {
  sheet(`<h2>People you support</h2><div id="peopleList">${state.people.map((p, k) => `<div class="item"><div class="ei" style="background:${PCOL[k % 8]}33">●</div><div class="grow t">${esc(p)}</div><button class="iconbtn" data-a="delperson" data-p="${esc(p)}" aria-label="Remove">🗑</button></div>`).join('')}</div>
  <form id="personForm" class="askbar"><input name="p" placeholder="Add person (e.g. Sister)" maxlength="30" required><button class="btn primary" type="submit">Add</button></form><div class="small muted" style="margin-top:6px">Removing a person keeps their past remittances in the history.</div><button class="btn block" style="margin-top:12px" data-a="closeall">Done</button>`);
}

/* ---------- SETTINGS ---------- */
let swState = 'checking…', deferredInstall = null;
const todayISO = () => fd(todayN());
function viewSettings() {
  const s = state.settings, maskKey = ai.key ? '•••• ' + ai.key.slice(-4) : 'not set', stale = s.ratesUpdated && (todayN() - pd(s.ratesUpdated)) > 30;
  const rrow = c => `<div class="row" style="margin:6px 0"><span style="width:62px" class="muted">1 USD =</span><input id="rate_${c}" data-ch="rate" data-c="${c}" inputmode="decimal" class="grow" value="${s.rates[c]}" aria-label="Rate for ${c}"><b style="width:44px">${c}</b></div><div class="small ${s.ratesCustom[c] ? 'pos' : 'muted'}" style="margin:-2px 0 4px 70px">${s.ratesCustom[c] ? 'your rate' : c === 'MMK' ? 'default estimate, please set your real rate' : 'default estimate, editable'}</div>`;
  return `${state.meta.demo ? `<div class="demo"><span>🧪 Demo data is loaded.</span><button class="btn sm danger" data-a="cleardemo">Clear demo data</button></div>` : ''}
  <div class="glass"><h2>Display & limits</h2><label class="f">Show everything in</label><select id="setCur" data-ch="cur">${CURS.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
  <label class="f">Low-balance limit (${s.currency})</label><input id="setThr" data-ch="thr" inputmode="decimal" value="${Math.round(getThr() * 100) / 100}"><div class="small muted" style="margin-top:6px">Days turn amber within 25% above this, and red below it.</div></div>
  <div class="glass"><h2>💱 Exchange rates (your own)</h2><div class="small muted" style="margin-bottom:6px">No internet needed. Balances, bills, remittances, IOUs and goals in other currencies convert to ${s.currency} with these rates. Myanmar kyat moves a lot, so set the rate you really get.</div>${RATE_CURS.map(rrow).join('')}
  <div class="small ${stale ? 'neg' : 'muted'}" style="margin-top:6px">${s.ratesUpdated ? `Last updated ${fmtDay(s.ratesUpdated)}${stale ? ' — over 30 days old, check your rates' : ''}` : 'Not updated yet — using built-in estimates'}</div>
  <div class="small" style="margin-top:4px" id="convEx">${s.currency !== 'MMK' ? `1,000,000 MMK ≈ ${fmt(conv(1e6, 'MMK'))}` : `100 USD ≈ ${fmt(conv(100, 'USD'), undefined, 'MMK')}`}</div>
  <button class="btn sm" style="margin-top:10px" data-a="resetrates">Reset to defaults</button></div>
  <div class="glass"><h2>Accounts</h2>${state.accounts.map(a => { const d = series([a.id], todayN(), todayN())[0]; return `<div class="item"><div class="ei">🏦</div><div class="grow"><div class="t">${esc(a.name)} <span class="muted small">${a.cur}</span></div><div class="s">Balance now ${a.cur !== s.currency ? fmt(conv(d, s.currency, a.cur), undefined, a.cur) + ' ≈ ' : ''}${fmt(d, 2)}</div></div><button class="iconbtn" data-a="acct" data-id="${a.id}">✎</button></div>`; }).join('')}<button class="btn block" style="margin-top:10px" data-a="acct">+ Add account</button></div>
  <div class="glass"><h2>🤖 AI coach (bring your own key)</h2>
  <div class="warn amber" style="margin:0 0 8px">🔒 <div>Your key is stored <b>only on this phone</b> (browser storage). It is sent only to the AI address below. It is never put in backups. Use a key with a spending limit.</div></div>
  <form id="aiForm"><label class="f">Provider</label><select name="provider" id="aiProv" data-ch="prov"><option value="xai" ${ai.provider === 'xai' ? 'selected' : ''}>xAI Grok (api.x.ai)</option><option value="custom" ${ai.provider === 'custom' ? 'selected' : ''}>Custom OpenAI-compatible</option></select>
  <div id="baseRow" ${ai.provider === 'xai' ? 'hidden' : ''}><label class="f">Base URL</label><input name="baseUrl" placeholder="https://api.openai.com/v1" value="${esc(ai.baseUrl)}"></div>
  <label class="f">Model name</label><input name="model" value="${esc(ai.model)}" placeholder="grok-4.7"><label class="f">API key (${maskKey})</label><input name="key" type="password" autocomplete="off" placeholder="${ai.key ? 'Leave blank to keep the saved key' : 'Paste your key'}">
  <label class="f">About me (optional, sent with your numbers)</label><textarea name="profile" rows="2" maxlength="240">${esc(ai.profile)}</textarea>
  <div class="row" style="margin-top:12px"><button class="btn primary grow" type="submit">Save AI settings</button><button type="button" class="btn" data-a="testai">Test</button></div>${ai.key ? `<button type="button" class="btn danger sm" style="margin-top:10px" data-a="rmkey">Remove saved key</button>` : ''}</form>
  <div class="disc">Sends monthly totals, categories, balances, goals, family-support totals by recipient label and net IOU amounts. Never your notes, IOU names or the key. Not financial advice.</div></div>
  <div class="glass"><h2>Backup & export</h2><div class="row wrap"><button class="btn grow" data-a="expjson">Backup JSON</button><button class="btn grow" data-a="impjson">Import JSON</button><button class="btn grow" data-a="expcsv">Export CSV</button></div><input type="file" id="impFile" accept="application/json,.json" hidden><div class="small muted" style="margin-top:6px">Backup includes accounts, items, remittances, IOUs, goals and exchange rates. Never the API key.</div></div>
  <div class="glass"><h2>App</h2><div class="small muted">Offline status: <b id="swState">${esc(swState)}</b> · Version 2.0</div>${deferredInstall ? `<button class="btn primary block" style="margin-top:10px" data-a="install">Install app</button>` : `<div class="small muted" style="margin-top:6px">To install: Chrome menu ⋮ → Add to Home screen / Install app.</div>`}</div>
  <div class="glass"><h2>Danger zone</h2><button class="btn danger block" data-a="clearall">Clear all my data</button></div>`;
}
function openAcct(id) {
  const a = state.accounts.find(x => x.id === id), cur = a ? series([a.id], todayN(), todayN())[0] : 0, nat = a ? conv(cur, disp(), a.cur) : 0;
  sheet(`<form id="acctForm" data-id="${id || ''}"><h2>${a ? 'Edit account' : 'Add account'}</h2><label class="f">Name</label><input name="name" required maxlength="30" value="${a ? esc(a.name) : ''}"><label class="f">Account currency</label><select name="cur">${curOpts(a ? a.cur : disp())}</select><label class="f">Balance right now (in that currency)</label><input name="bal" inputmode="decimal" required value="${a ? Math.round(nat * 100) / 100 : ''}">
  <div class="row" style="margin-top:14px"><button type="button" class="btn grow" data-a="closeall">Cancel</button><button class="btn primary grow" type="submit">Save</button></div>${a && state.accounts.length > 1 ? `<button type="button" class="btn danger block" style="margin-top:10px" data-a="delacct" data-id="${id}">Delete account and its items</button>` : ''}</form>`);
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
async function testAI() {
  if (!ai.key) { toast('Save your key first'); return; }
  toast('Testing…');
  try { const r = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key }, body: JSON.stringify({ model: ai.model, stream: false, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }) }); toast(r.ok ? '✅ Key works' : r.status === 401 || r.status === 403 ? '❌ Key rejected' : '⚠️ Error ' + r.status); }
  catch (e) { toast(e.message.startsWith('The AI') || e.message.startsWith('Add a') ? e.message : '📴 Could not reach the AI'); }
}
function addTxFromPay(i, amount, accId, date) {
  state.tx.push({ id: uid(), skip: [], type: i.dir === 'owed' ? 'income' : 'expense', amount, cur: i.cur, cat: i.dir === 'owed' ? 'repaid' : 'debt', acc: accId, date, note: i.dir === 'owed' ? `${i.who} paid back` : `Paid back ${i.who}`, rec: null });
}

/* ---------- actions ---------- */
const QP = { save: 'How can I save more each month?', cut: 'Where can I cut spending?', car: 'Give me a plan to reach my car fund faster.', family: 'How should I budget for supporting my family?', debt: 'What is the best way to pay off what I owe?' };
const A = {
  tab: d => { ui.tab = d.tab; ui.dayOpen = null; closeSheet(); render(); setScroll(0); if (d.tab === 'crypto') autoRefresh(); },
  acc: d => { ui.acc = d.id; render(); },
  mprev: () => { if (--ui.m < 0) { ui.m = 11; ui.y--; } render(); }, mnext: () => { if (++ui.m > 11) { ui.m = 0; ui.y++; } render(); },
  rprev: () => { if (--ui.rm < 0) { ui.rm = 11; ui.ry--; } render(); }, rnext: () => { if (++ui.rm > 11) { ui.rm = 0; ui.ry++; } render(); },
  gotoday: () => { const t = ymd(todayN()); ui.y = t.y; ui.m = t.m; render(); },
  day: d => openDay(+d.n), upcoming: openUpcoming, closeall: closeAll, back,
  add: d => openTx({ date: d.n ? fd(+d.n) : undefined }), fabadd: () => { ui.dayOpen = null; openTx({ quick: true }); },
  edit: d => openTx({ id: d.id }), del: d => openDel(d.id, d.n),
  delall: d => { state.tx = state.tx.filter(t => t.id !== d.id); toast('Deleted'); changed(); },
  delskip: d => { const t = state.tx.find(x => x.id === d.id); (t.skip = t.skip || []).push(fd(+d.n)); toast('Skipped that day'); changed(); },
  settype: d => { fctx.type = d.t; fctx.cat = d.t === 'expense' ? 'food' : 'salary'; $('#catGrid').innerHTML = catGrid(d.t, fctx.cat); document.querySelectorAll('#typeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === d.t)); },
  pickcat: d => { fctx.cat = d.k; document.querySelectorAll('#catGrid button').forEach(b => b.classList.toggle('on', b.dataset.k === d.k)); },
  more: (d, el) => { $('#more').hidden = false; el.remove(); },
  setthr: () => sheet(`<form id="thrForm"><h2>Low-balance limit</h2><p class="muted small">You get warnings and red days when the projected balance falls below this (${disp()}).</p><input class="amtbox" name="thr" inputmode="decimal" value="${Math.round(getThr() * 100) / 100}" id="fAmount"><div class="row" style="margin-top:14px"><button type="button" class="btn grow" data-a="closeall">Cancel</button><button class="btn primary grow" type="submit">Save</button></div></form>`),
  cleardemo: async () => {
    if (!await ask('Remove all demo accounts, bills, remittances, goals and IOUs? Anything you added yourself stays.', 'Clear demo data')) return;
    state.tx = state.tx.filter(t => !t.demo); state.goals = state.goals.filter(g => !g.demo); state.ious = state.ious.filter(i => !i.demo);
    state.accounts = state.accounts.filter(a => !a.demo || state.tx.some(t => t.acc === a.id)); state.accounts.forEach(a => { if (a.demo) { a.opening = 0; delete a.demo; } });
    if (!state.accounts.length) state.accounts = blank().accounts;
    state.people = state.people.filter(p => p !== 'Brother' || state.tx.some(t => t.remit && t.remit.to === p));
    { const k = cx(); k.trades = k.trades.filter(t => !t.demo); k.dca = k.dca.filter(p => !p.demo); const gone = k.coins.filter(c => c.demo && !k.trades.some(t => t.sym === c.sym)).map(c => c.sym); k.coins = k.coins.filter(c => !gone.includes(c.sym)); gone.forEach(s => { delete k.manual[s]; delete k.target[s]; }); k.snaps = k.snaps.filter(x => !x.demo); }
    state.meta.demo = false; if (state.settings.threshold === 1200) { state.settings.threshold = 300; state.settings.thrCur = 'USD'; } ui.acc = 'all'; ui.person = 'all'; toast('Demo data cleared'); changed();
  },
  ctab: d => { ui.coach = d.k; render(); }, gosettings: () => { ui.tab = 'settings'; render(); setScroll(0); },
  topic: d => sendQuestion(QP[d.k], d.k),
  preview: () => { let u = ''; try { u = endpoint(); } catch (e) { u = '(not set) ' + e.message; } sheet(`<h2>What the AI receives</h2><p class="small muted">Sent to: <b>${esc(u)}</b><br>Model: <b>${esc(ai.model)}</b><br>Plus your question and the last few chat messages.</p><pre class="preview">${esc(JSON.stringify(buildSummary(), null, 1))}</pre><button class="btn block" data-a="closeall">Close</button>`); },
  clearchat: () => { chat = []; saveChat(); renderChat(); },
  goal: d => openGoal(d.id), contrib: d => openContrib(d.id),
  delgoal: async d => { if (await ask('Delete this goal?', 'Delete')) { state.goals = state.goals.filter(g => g.id !== d.id); changed(); } },
  /* people */
  ptab: d => { ui.ptab = d.k; render(); }, pfilter: d => { ui.person = d.p; ui.histN = 12; render(); }, histmore: () => { ui.histN += 15; render(); },
  remitnew: () => { ui.dayOpen = null; openRemit({ to: ui.person !== 'all' ? ui.person : undefined }); },
  people: openPeople, delperson: d => { state.people = state.people.filter(p => p !== d.p); if (ui.person === d.p) ui.person = 'all'; save(); openPeople(); render(); },
  iounew: () => { ui.dayOpen = null; openIou(); }, iou: () => openIou(), iouedit: d => { ui.dayOpen = null; openIou(d.id); },
  ioudir: d => { document.querySelector('#iouForm [name=dir]').value = d.d; document.querySelectorAll('#iouDir button').forEach(b => b.classList.toggle('on', b.dataset.d === d.d)); },
  pay: d => openPay(d.id),
  delpay: d => { const i = state.ious.find(x => x.id === d.id); i.payments = i.payments.filter(p => p.id !== d.p); save(); render(); openIou(d.id); },
  deliou: async d => { if (await ask('Delete this record and its payments?', 'Delete')) { state.ious = state.ious.filter(i => i.id !== d.id); changed(); } },
  acct: d => openAcct(d.id),
  delacct: async d => { if (await ask('Delete this account and all its bills and income?', 'Delete')) { state.accounts = state.accounts.filter(a => a.id !== d.id); state.tx = state.tx.filter(t => t.acc !== d.id); if (ui.acc === d.id) ui.acc = 'all'; changed(); } },
  resetrates: async () => { if (await ask('Reset all exchange rates to the built-in estimates?', 'Reset')) { state.settings.rates = { ...DEFAULT_RATES }; state.settings.ratesCustom = {}; state.settings.ratesUpdated = null; save(); render(); toast('Rates reset'); } },
  testai: testAI,
  rmkey: async () => { if (await ask('Remove your saved API key from this phone?', 'Remove')) { ai.key = ''; saveAI(); render(); toast('Key removed'); } },
  expjson: () => { const { settings, accounts, tx, goals, ious, people, crypto } = state; download(`budgetpulse-backup-${todayISO()}.json`, JSON.stringify({ app: 'budgetpulse', v: 2, exported: new Date().toISOString(), data: { settings, accounts, tx, goals, ious, people, crypto } }, null, 1), 'application/json'); toast('Backup saved (no API key inside)'); },
  impjson: () => $('#impFile').click(),
  expcsv: () => { const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`; const rows = [['date', 'type', 'amount', 'currency', 'fee', 'category', 'account', 'recipient', 'method', 'note', 'repeat', 'repeat_until'].join(',')].concat(state.tx.map(t => [t.date, t.type, t.amount, txCur(t), t.fee || '', CATS[t.cat].l, accName(t.acc), t.remit ? t.remit.to : '', t.remit ? t.remit.method : '', t.note, t.rec ? t.rec.freq : '', t.rec ? t.rec.end : ''].map(q).join(','))); rows.push('', ['iou_person', 'direction', 'amount', 'currency', 'remaining', 'due', 'note'].join(',')); state.ious.forEach(i => rows.push([i.who, i.dir === 'owed' ? 'they owe me' : 'I owe', i.amount, i.cur, remaining(i), i.due, i.note].map(q).join(','))); download(`budgetpulse-export-${todayISO()}.csv`, rows.join('\n'), 'text/csv'); toast('CSV saved'); },
  install: async () => { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } },
  clearall: async () => { if (!await ask('This erases ALL accounts, bills, remittances, IOUs, goals and chat on this phone. Back up first if unsure. Continue?', 'Erase everything')) return; state = blank(); chat = []; ui.acc = 'all'; ui.person = 'all'; saveChat(); toast('All data cleared'); changed(); }
};
Object.assign(A, CRYPTO_ACTIONS);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return; const a = el.dataset.a;
  if (a === 'closebg') { if (e.target === el) closeAll(); return; }
  e.preventDefault(); if (A[a]) A[a](el.dataset, el, e);
});
document.addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, v = new FormData(f);
  if (cryptoSubmit(f, v)) return;
  if (f.id === 'txForm') submitTx(f);
  else if (f.id === 'remitForm') submitRemit(f);
  else if (f.id === 'askForm') { const i = $('#askInput'), q = i.value; i.value = ''; sendQuestion(q); }
  else if (f.id === 'thrForm') { const n = num(v.get('thr')); if (!(n >= 0)) return toast('Enter a number'); state.settings.threshold = n; state.settings.thrCur = disp(); changed(); }
  else if (f.id === 'goalForm') {
    const t = num(v.get('target')); if (!(t > 0)) return toast('Enter a target above 0');
    const g = { name: v.get('name').trim(), cur: v.get('cur'), target: t, saved: num(v.get('saved')) || 0, monthly: num(v.get('monthly')) || 0, by: v.get('by') || '' };
    if (f.dataset.id) { const x = state.goals.find(y => y.id === f.dataset.id); Object.assign(x, g); delete x.demo; } else state.goals.push({ id: uid(), ...g }); changed();
  } else if (f.id === 'contribForm') {
    const n = num(v.get('amount')); if (!(n > 0)) return toast('Enter an amount');
    const g = state.goals.find(x => x.id === f.dataset.id); g.saved += n; delete g.demo;
    if (v.get('rec')) state.tx.push({ id: uid(), type: 'expense', amount: n, cur: g.cur || disp(), cat: 'savings', acc: v.get('acc'), date: todayISO(), note: g.name, rec: null, skip: [] });
    toast('Savings added 🎉'); changed();
  } else if (f.id === 'iouForm') {
    const n = num(v.get('amount')); if (!(n > 0)) return toast('Enter an amount');
    const o = { dir: v.get('dir'), who: v.get('who').trim(), amount: n, cur: v.get('cur'), due: v.get('due') || '', note: (v.get('note') || '').trim() };
    if (f.dataset.id) { const x = state.ious.find(y => y.id === f.dataset.id); Object.assign(x, o); delete x.demo; }
    else { const rec = { id: uid(), payments: [], ...o }; state.ious.push(rec); if (v.get('rec')) state.tx.push({ id: uid(), skip: [], type: o.dir === 'owed' ? 'expense' : 'income', amount: n, cur: o.cur, cat: o.dir === 'owed' ? 'other' : 'inother', acc: v.get('acc'), date: todayISO(), note: o.dir === 'owed' ? `Lent to ${o.who}` : `Borrowed from ${o.who}`, rec: null }); }
    toast('Saved'); ui.ptab = 'iou'; changed();
  } else if (f.id === 'payForm') {
    const i = state.ious.find(x => x.id === f.dataset.id); let n = num(v.get('amount')); if (!(n > 0)) return toast('Enter an amount'); n = Math.min(n, remaining(i));
    i.payments.push({ id: uid(), date: v.get('date'), amount: n }); delete i.demo; if (v.get('rec')) addTxFromPay(i, n, v.get('acc'), v.get('date'));
    toast(remaining(i) === 0 ? 'Settled ✓' : 'Payment recorded'); changed();
  } else if (f.id === 'personForm') { const p = (v.get('p') || '').trim(); if (p && !state.people.includes(p)) { state.people.push(p); save(); openPeople(); render(); } }
  else if (f.id === 'acctForm') {
    const bal = num(v.get('bal')); if (!isFinite(bal)) return toast('Enter a balance'); const ncur = v.get('cur');
    if (f.dataset.id) { const a = state.accounts.find(x => x.id === f.dataset.id), now = series([a.id], todayN(), todayN())[0], D = now - conv(a.opening, a.cur); a.name = v.get('name').trim(); a.cur = ncur; a.opening = bal - conv(D, disp(), ncur); delete a.demo; }
    else state.accounts.push({ id: uid(), name: v.get('name').trim(), cur: ncur, opening: bal, openingDate: todayISO() });
    changed();
  } else if (f.id === 'aiForm') {
    ai.provider = v.get('provider'); ai.baseUrl = (v.get('baseUrl') || '').trim(); ai.model = (v.get('model') || '').trim() || (ai.provider === 'xai' ? 'grok-4.7' : ''); ai.profile = (v.get('profile') || '').trim();
    const k = (v.get('key') || '').trim(); if (k) ai.key = k; saveAI(); render(); toast('AI settings saved');
  }
});
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#remitForm')) updateRemitPrev(); cryptoOnInput(e); });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fFreq') $('#endRow').hidden = t.value === 'none';
  else if (t.id === 'rFreq') $('#rEndRow').hidden = t.value === 'none';
  else if (t.id === 'rTo') { $('#rNew').hidden = t.value !== '__new'; if (t.value === '__new') $('#rNew').focus(); }
  else if (t.id === 'rCur' || t.id === 'rAcc') updateRemitPrev();
  else if (t.name === 'acc' && t.form && t.form.id === 'txForm' && !fctx.id) { const c = t.form.querySelector('[name=cur]'); if (c) c.value = accOf(t.value).cur; }
  else if (t.id === 'aiProv') { $('#baseRow').hidden = t.value === 'xai'; }
  else if (t.id === 'setCur') { state.settings.currency = t.value; save(); toast('Showing everything in ' + t.value); render(); }
  else if (t.id === 'setThr') { const n = num(t.value); if (n >= 0) { state.settings.threshold = n; state.settings.thrCur = disp(); save(); toast('Limit saved'); } }
  else if (t.dataset && t.dataset.ch === 'rate') {
    const n = num(t.value), c = t.dataset.c; if (!(n > 0)) { toast('Enter a rate above 0'); t.value = state.settings.rates[c]; return; }
    state.settings.rates[c] = n; state.settings.ratesCustom[c] = true; state.settings.ratesUpdated = todayISO(); save(); toast(`1 USD = ${n.toLocaleString('en-US')} ${c} saved`); render();
  }
  else if (t.id === 'impFile' && t.files[0]) {
    const r = new FileReader(); r.onload = async () => {
      try {
        const j = JSON.parse(r.result), d = j.data || j; if (!Array.isArray(d.accounts) || !Array.isArray(d.tx) || !d.accounts.length) throw 0;
        if (!await ask(`Replace everything on this phone with this backup (${d.accounts.length} accounts, ${d.tx.length} items)?`, 'Import')) return;
        state = migrate({ meta: { demo: false, created: Date.now() }, settings: d.settings || {}, accounts: d.accounts, tx: d.tx, goals: d.goals || [], ious: d.ious || [], people: d.people, crypto: d.crypto });
        if (state.accounts.some(a => a.demo) || state.tx.some(x => x.demo)) state.meta.demo = true; ui.acc = 'all'; ui.person = 'all'; toast('Backup imported'); changed();
      } catch { toast('That file is not a valid backup'); }
    }; r.readAsText(t.files[0]); t.value = '';
  }
});
addEventListener('keydown', e => { if (e.key === 'Escape') { const o = document.querySelector('.overlay'); if (o && !o.style.zIndex) closeAll(); } });

/* ---------- render / init ---------- */
function render() {
  $('#view').innerHTML = ({ home: viewHome, people: viewPeople, crypto: viewCrypto, coach: viewCoach, settings: viewSettings })[ui.tab]();
  document.querySelectorAll('#nav button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  { const on = ui.tab === 'home' || ui.tab === 'people'; $('#fab').classList.toggle('show', on); document.body.classList.toggle('hasfab', on); }
  $('#subtitle').textContent = { home: 'Personal budget calendar', people: 'Family & people', crypto: 'Crypto portfolio', coach: 'Coach & reports', settings: 'Settings' }[ui.tab];
  if (ui.tab === 'coach' && ui.coach === 'ai') renderChat();
}
function netBadge() { $('#netbadge').hidden = navigator.onLine; }
addEventListener('online', netBadge); addEventListener('offline', netBadge);
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (ui.tab === 'settings') render(); });
function setSw(s) { swState = s; window.__swState = s; const el = $('#swState'); if (el) el.textContent = s; }
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    const done = () => setSw('Offline ready ✓');
    if (reg.active && navigator.serviceWorker.controller) done();
    else { const w = reg.installing || reg.waiting || reg.active; if (w) w.addEventListener('statechange', () => { if (w.state === 'activated') done(); }); if (reg.active && w === reg.active) done(); }
  }).catch(() => setSw('Not available in this browser')));
} else setSw('Not supported');
load(); render(); netBadge(); autoRefresh();
addEventListener('online', () => { netBadge(); autoRefresh(); });
window.__bp = { get state() { return state; }, series, eventsIn, occurrences, insights, buildSummary, fd, pd, todayN, conv, remitData, ioNets, remaining };
