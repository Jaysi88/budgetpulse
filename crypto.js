'use strict';
/* BudgetPulse+ crypto module: holdings, trades, DCA plans, target allocation,
   CoinGecko prices (cached, optional) and value snapshots.
   Loaded before app.js. Only function declarations / constants at top level:
   everything that touches app state runs later, after app.js has loaded. */

const COIN_LIST = [['BTC', 'bitcoin', 'Bitcoin'], ['ETH', 'ethereum', 'Ethereum'], ['BNB', 'binancecoin', 'BNB'], ['SOL', 'solana', 'Solana'], ['XRP', 'ripple', 'XRP'], ['ADA', 'cardano', 'Cardano'], ['DOGE', 'dogecoin', 'Dogecoin'], ['TRX', 'tron', 'TRON'], ['TON', 'the-open-network', 'Toncoin'], ['AVAX', 'avalanche-2', 'Avalanche'], ['LINK', 'chainlink', 'Chainlink'], ['DOT', 'polkadot', 'Polkadot'], ['LTC', 'litecoin', 'Litecoin'], ['BCH', 'bitcoin-cash', 'Bitcoin Cash'], ['XLM', 'stellar', 'Stellar'], ['ATOM', 'cosmos', 'Cosmos'], ['UNI', 'uniswap', 'Uniswap'], ['NEAR', 'near', 'NEAR Protocol'], ['SUI', 'sui', 'Sui'], ['USDT', 'tether', 'Tether'], ['USDC', 'usd-coin', 'USDC']];
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'OKX', 'Kraken', 'Other'];
const COIN_COL = ['#f7931a', '#8b9cff', '#3ddc97', '#ff6b9d', '#feca57', '#48dbfb', '#c56cf0', '#ff9f43'];
const PRICE_KEY = 'budgetpulse.prices';
const PRICE_TTL = 5 * 60 * 1000;

const cryptoDefaults = () => ({ coins: [], trades: [], dca: [], target: {}, manual: {}, snaps: [] });
let _pc = null, priceStatus = { state: 'idle', msg: '' }, refreshing = false;
const pcache = () => _pc || (_pc = ls.get(PRICE_KEY, { t: 0, usd: {}, chg: {} }));
const cx = () => state.crypto;
const coinColor = sym => COIN_COL[Math.max(0, cx().coins.findIndex(c => c.sym === sym)) % COIN_COL.length];
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/* ---------- prices ---------- */
function priceOf(c) {
  const p = pcache();
  if (p.usd[c.id] != null) return { p: p.usd[c.id], src: 'live', t: p.t, chg: p.chg[c.id] };
  const m = cx().manual[c.sym]; if (m > 0) return { p: m, src: 'manual' };
  return null;
}
async function refreshPrices(showToast) {
  const ids = cx().coins.map(c => c.id).filter(Boolean);
  if (!ids.length || refreshing) return;
  if (!navigator.onLine) { priceStatus = { state: 'offline' }; if (showToast) toast('Offline: showing last saved prices'); return cryptoRerender(); }
  refreshing = true; cryptoRerender();
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? 'rate' : 'http');
    const j = await r.json(), p = pcache();
    for (const id of ids) if (j[id] && j[id].usd != null) { p.usd[id] = j[id].usd; p.chg[id] = j[id].usd_24h_change; }
    p.t = Date.now(); ls.set(PRICE_KEY, p); priceStatus = { state: 'live' }; recordSnapshot(); if (showToast) toast('Prices updated');
  } catch (e) { priceStatus = { state: 'error', msg: e.message === 'rate' ? 'CoinGecko is rate-limiting, try again in a minute' : 'Could not reach CoinGecko' }; if (showToast) toast(priceStatus.msg); }
  clearTimeout(to); refreshing = false; cryptoRerender(); if (ui.tab === 'home') render();
}
function cryptoRerender() { if (ui.tab === 'crypto') { const y = getScroll(); render(); setScroll(y); } }
function autoRefresh() { if (cx().coins.length && navigator.onLine && Date.now() - pcache().t > PRICE_TTL) refreshPrices(false); }

/* ---------- portfolio maths (average-cost method, USD) ---------- */
function portfolio() {
  const rows = {}; for (const c of cx().coins) rows[c.sym] = { ...c, qty: 0, cost: 0, realized: 0, fees: 0, n: 0 };
  const trades = [...cx().trades].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const t of trades) {
    const r = rows[t.sym]; if (!r) continue; r.n++; r.fees += t.fee || 0;
    if (t.side === 'buy') { r.qty += t.qty; r.cost += t.qty * t.price + (t.fee || 0); }
    else { const avg = r.qty > 0 ? r.cost / r.qty : 0, q = Math.min(t.qty, r.qty); r.realized += t.qty * t.price - (t.fee || 0) - avg * q; r.cost -= avg * q; r.qty -= q; if (r.qty < 1e-12) { r.qty = 0; r.cost = 0; } }
  }
  let value = 0, cost = 0, realized = 0, unpriced = 0;
  const list = Object.values(rows).map(r => {
    const pr = priceOf(r), v = pr ? r.qty * pr.p : 0;
    if (r.qty > 0 && !pr) unpriced++;
    value += v; cost += r.cost; realized += r.realized;
    return { ...r, price: pr, value: v, avg: r.qty > 0 ? r.cost / r.qty : 0, pl: pr && r.qty > 0 ? v - r.cost : 0, plPct: pr && r.cost > 0 ? (v - r.cost) / r.cost * 100 : 0 };
  });
  list.forEach(r => r.alloc = value > 0 ? r.value / value * 100 : 0);
  return { rows: list.sort((a, b) => b.value - a.value), value, cost, pl: value - cost, plPct: cost > 0 ? (value - cost) / cost * 100 : 0, realized, unpriced, held: list.some(r => r.qty > 0) };
}
function netWorth() {
  const t = todayN(), acc = series(allIds(), t, t)[0], pf = portfolio(), cr = conv(pf.value, 'USD'), io = ioNets().reduce((s, x) => s + x.net, 0);
  return { acc, cr, io, total: acc + cr + io, held: pf.held, partial: pf.unpriced > 0 };
}
function cryptoSummary() {
  const pf = portfolio(); if (!pf.held) return undefined;
  const tg = cx().target, r0 = n => Math.round(n), plans = cx().dca.map(p => ({ coin: p.sym, perMonthUSD: p.amount }));
  return {
    note: 'portfolio totals only, in USD', totalValueUSD: r0(pf.value), investedUSD: r0(pf.cost), unrealisedPLUSD: r0(pf.pl), unrealisedPLPercent: Math.round(pf.plPct * 10) / 10,
    holdings: pf.rows.filter(r => r.qty > 0).map(r => ({ coin: r.sym, allocationPercent: Math.round(r.alloc), targetPercent: tg[r.sym] ?? null, plPercent: Math.round(r.plPct) })), dcaPlans: plans, dcaTotalPerMonthUSD: plans.reduce((s, p) => s + p.perMonthUSD, 0)
  };
}
function cryptoInsights() {
  const pf = portfolio(); if (!pf.held) return [];
  const out = [], nw = netWorth(), tg = cx().target, tot = Object.values(tg).reduce((a, b) => a + b, 0);
  const share = nw.total > 0 ? conv(pf.value, 'USD') / nw.total * 100 : 0;
  out.push({ s: share > 40 ? 'a' : 'b', e: '₿', tags: ['save', 'invest'], title: `Crypto is ${Math.round(share)}% of your net worth`, text: `Portfolio ${fmt(conv(pf.value, 'USD'))} for ${fmt(conv(pf.cost, 'USD'))} invested (${pf.pl >= 0 ? '+' : '−'}${fmt(Math.abs(conv(pf.pl, 'USD')))}, ${pf.plPct.toFixed(1)}%). ${share > 40 ? 'That is a big share for a volatile asset; keep your emergency cash and car fund separate.' : 'Keep an emergency cash buffer before adding more.'}` });
  if (tot > 0) {
    const drift = pf.rows.filter(r => tg[r.sym] != null).map(r => ({ sym: r.sym, d: r.alloc - tg[r.sym] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    if (drift && Math.abs(drift.d) >= 5) { const low = pf.rows.filter(r => tg[r.sym] != null).map(r => ({ sym: r.sym, d: r.alloc - tg[r.sym] })).sort((a, b) => a.d - b.d)[0]; out.push({ s: 'a', e: '⚖️', tags: ['invest'], title: 'Allocation has drifted from your target', text: `${drift.sym} is ${Math.abs(drift.d).toFixed(0)} points ${drift.d > 0 ? 'above' : 'below'} target. Point your next DCA buys at ${low.sym} to rebalance without selling.` }); }
  }
  const due = pendingDca().length; if (due) out.push({ s: 'a', e: '🗓️', tags: ['invest'], title: `${due} DCA buy${due > 1 ? 's' : ''} waiting to be recorded`, text: 'Open the Crypto tab and tap "Record" once you have made the purchase on your exchange.' });
  return out;
}

/* ---------- DCA plans ---------- */
function planDates(p) {
  const s = pd(p.start), out = [], t = todayN(), end = p.end ? Math.min(t, pd(p.end)) : t;
  for (let k = 0; ; k++) { const mm = ymd(s).y * 12 + ymd(s).m + k, y = Math.floor(mm / 12), m = mm % 12, n = dayNum(y, m, Math.min(p.day, dim(y, m))); if (n > end) break; if (n >= s) out.push(fd(n)); }
  return out;
}
const pendingDca = () => cx().dca.flatMap(p => planDates(p).filter(d => !(p.done || []).includes(d)).map(d => ({ p, d })));
function recordPending(planId, date, atPrice) {
  const p = cx().dca.find(x => x.id === planId), c = cx().coins.find(x => x.sym === p.sym), pr = c && priceOf(c);
  if (!pr) return toast('No price yet: refresh prices or set a manual price first');
  cx().trades.push({ id: uid(), sym: p.sym, side: 'buy', date, qty: p.amount / pr.p, price: pr.p, fee: 0, ex: p.ex || '', note: 'DCA', dca: true });
  (p.done = p.done || []).push(date); save(); toast(`Recorded ${p.sym} buy at ${fmt(pr.p, undefined, 'USD')}`); render();
}

/* ---------- snapshots ---------- */
function recordSnapshot() {
  const pf = portfolio(); if (!pf.held || pf.unpriced) return;
  const d = fd(todayN()), s = cx().snaps, last = s[s.length - 1], inv = Math.round(pf.cost * 100) / 100, v = Math.round(pf.value * 100) / 100;
  if (last && last.d === d) { last.v = v; last.i = inv; delete last.demo; } else s.push({ d, v, i: inv });
  if (s.length > 800) s.splice(0, s.length - 800); save();
}
function demoSnaps() {
  const t = todayN(), out = [], tr = cx().trades;
  for (let k = 45; k >= 1; k--) {
    const n = t - k; let v = 0, inv = 0;
    for (const c of cx().coins) {
      const ts = tr.filter(x => x.sym === c.sym).sort((a, b) => a.date < b.date ? -1 : 1), pts = ts.map(x => [pd(x.date), x.price]); const now = priceOf(c); if (now) pts.push([t, now.p]);
      let q = 0; ts.forEach(x => { if (pd(x.date) <= n) q += x.side === 'buy' ? x.qty : -x.qty; }); if (q <= 0 || !pts.length) continue;
      let pr = pts[0][1]; for (let i = 0; i < pts.length - 1; i++) if (n >= pts[i][0] && n <= pts[i + 1][0]) { const f = (n - pts[i][0]) / Math.max(1, pts[i + 1][0] - pts[i][0]); pr = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f; }
      v += q * pr;
    }
    inv = tr.filter(x => pd(x.date) <= n).reduce((s, x) => s + (x.side === 'buy' ? x.qty * x.price + (x.fee || 0) : -x.qty * x.price), 0);
    if (v > 0) out.push({ d: fd(n), v: Math.round(v), i: Math.round(inv), demo: true });
  }
  return out;
}

/* ---------- seed demo ---------- */
function cryptoDemo(accId) {
  const t = ymd(todayN()), nm = (mo, d) => { const y = t.y + Math.floor((t.m + mo) / 12), m = (((t.m + mo) % 12) + 12) % 12; return fd(dayNum(y, m, Math.min(d, dim(y, m)))); };
  const tr = (sym, date, usd, price, fee, ex, note) => ({ id: uid(), sym, side: 'buy', date, qty: usd / price, price, fee, ex, note: note || 'DCA', dca: true, demo: true });
  const coins = [{ sym: 'BTC', id: 'bitcoin', name: 'Bitcoin', demo: true }, { sym: 'ETH', id: 'ethereum', name: 'Ethereum', demo: true }, { sym: 'SOL', id: 'solana', name: 'Solana', demo: true }];
  const btc = [79000, 74000, 70000, 85000], eth = [2900, 2700, 2500, 2600], trades = [];
  for (let i = 0; i < 4; i++) { trades.push(tr('BTC', nm(i - 4, 1), 120, btc[i], 0.6, 'Binance'), tr('ETH', nm(i - 4, 1), 180, eth[i], 0.9, 'Binance')); }
  trades.push(tr('ETH', nm(0, 1), 180, 1850, 0.9, 'Binance'), { id: uid(), sym: 'SOL', side: 'buy', date: nm(-2, 15), qty: 5, price: 150, fee: 1, ex: 'Binance', note: 'Demo extra coin', demo: true });
  const done = d => d;
  return {
    coins, trades, target: { ETH: 60, BTC: 40 }, manual: { BTC: 62500, ETH: 1770, SOL: 73 }, snaps: [],
    dca: [
      { id: uid(), sym: 'ETH', amount: 180, day: 1, start: nm(-4, 1), end: '', ex: 'Binance', done: [nm(-4, 1), nm(-3, 1), nm(-2, 1), nm(-1, 1), nm(0, 1)].map(done), demo: true },
      { id: uid(), sym: 'BTC', amount: 120, day: 1, start: nm(-4, 1), end: '', ex: 'Binance', done: [nm(-4, 1), nm(-3, 1), nm(-2, 1), nm(-1, 1)], demo: true }
    ],
    _txDemo: [{ id: uid(), skip: [], type: 'expense', amount: 300, cur: 'USD', cat: 'invest', acc: accId, date: nm(-4, 1), note: 'DEMO crypto DCA ($300/mo)', rec: { freq: 'monthly', end: '' }, demo: true }]
  };
}

/* ---------- views ---------- */
function allocDonut(rows, tg, total) {
  const R = 58, C = 2 * Math.PI * R, r2 = 34, C2 = 2 * Math.PI * r2; let off = 0, a = '', off2 = 0, b = '';
  const held = rows.filter(r => r.qty > 0 && r.value > 0), tsum = Object.values(tg).reduce((x, y) => x + y, 0);
  for (const r of held) { const len = r.value / total * C; a += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${coinColor(r.sym)}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`; off += len; }
  if (tsum > 0) for (const [sym, pct] of Object.entries(tg)) { if (!pct) continue; const len = pct / tsum * C2; b += `<circle r="${r2}" cx="80" cy="80" fill="none" stroke="${coinColor(sym)}" stroke-opacity=".55" stroke-width="8" stroke-dasharray="${len} ${C2 - len}" stroke-dashoffset="${-off2}" transform="rotate(-90 80 80)"/>`; off2 += len; }
  return `<svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="Allocation versus target"><circle r="${R}" cx="80" cy="80" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="20"/>${a}${b}<text x="80" y="78" text-anchor="middle" fill="#b9b0dc" font-size="9">outer: now</text><text x="80" y="92" text-anchor="middle" fill="#b9b0dc" font-size="9">inner: target</text></svg>`;
}
function valueChart() {
  const snaps = cx().snaps.filter(s => todayN() - pd(s.d) <= 120);
  if (snaps.length < 2) return '<p class="muted small">The chart fills in as the app records a value each day you open it with prices available.</p>';
  const W = 340, H = 150, pad = 8, vs = snaps.map(s => conv(s.v, 'USD')), is = snaps.map(s => conv(s.i ?? s.v, 'USD')), mn = Math.min(...vs, ...is) * .97, mx = Math.max(...vs, ...is) * 1.03 || 1;
  const x = i => pad + i / (snaps.length - 1) * (W - 2 * pad), y = v => H - 18 - (v - mn) / (mx - mn || 1) * (H - 34);
  const line = a => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Portfolio value over time"><defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4fb3" stop-opacity=".45"/><stop offset="1" stop-color="#8b5cff" stop-opacity="0"/></linearGradient></defs><path d="${line(vs)} L${x(vs.length - 1)},${H - 18} L${x(0)},${H - 18} Z" fill="url(#vg)"/><path d="${line(is)}" fill="none" stroke="#b9b0dc" stroke-width="1.5" stroke-dasharray="4 3"/><path d="${line(vs)}" fill="none" stroke="#ff7ac8" stroke-width="2.5" stroke-linejoin="round"/><text x="${pad}" y="${H - 3}" fill="#b9b0dc" font-size="10">${fmtDay(snaps[0].d)}</text><text x="${W - pad}" y="${H - 3}" text-anchor="end" fill="#b9b0dc" font-size="10">${fmtDay(snaps[snaps.length - 1].d)}</text><text x="${W - pad}" y="12" text-anchor="end" fill="#fff" font-size="11" font-weight="700">${short(vs[vs.length - 1])}</text></svg><div class="legend"><span><i style="background:#ff7ac8"></i>Value</span><span><i style="background:#b9b0dc"></i>Invested</span>${snaps.some(s => s.demo) ? '<span>Demo history</span>' : ''}</div>`;
}
function statusLine() {
  const p = pcache(), live = p.t && Date.now() - p.t < PRICE_TTL * 2;
  if (refreshing) return '⏳ Updating prices…';
  if (!cx().coins.length) return 'Add a coin to start.';
  if (!navigator.onLine || priceStatus.state === 'offline') return `📴 Offline · ${p.t ? 'showing prices saved ' + ago(p.t) : 'using your manual prices'}`;
  if (priceStatus.state === 'error') return `⚠️ ${esc(priceStatus.msg)} · ${p.t ? 'showing prices from ' + ago(p.t) : 'using manual prices'}`;
  return p.t ? `${live ? '🟢 Live' : '🕓 Saved'} prices from CoinGecko · updated ${ago(p.t)}` : 'No live prices yet: tap Refresh (or set a manual price).';
}
const plCls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted', sg = v => v > 0 ? '+' : v < 0 ? '−' : '';
function viewCrypto() {
  const pf = portfolio(), tg = cx().target, tsum = Object.values(tg).reduce((a, b) => a + b, 0), pend = pendingDca();
  const demo = state.meta.demo && (cx().trades.some(t => t.demo)) ? `<div class="demo"><span>🧪 <b>Demo holdings</b> — sample coins and prices.</span><button class="btn sm danger" data-a="cleardemo">Clear demo data</button></div>` : '';
  const head = `<div class="glass"><div class="row between"><span class="muted small">Crypto portfolio value${pf.unpriced ? ' (some coins unpriced)' : ''}</span><button class="btn sm" data-a="crefresh" ${refreshing ? 'disabled' : ''}>↻ Refresh</button></div>
  <div class="bal">${fmt(conv(pf.value, 'USD'), 2)}</div>
  <div class="row wrap small"><span>Invested <b>${fmt(conv(pf.cost, 'USD'))}</b></span><span class="${plCls(pf.pl)}"><b>${sg(pf.pl)}${fmt(Math.abs(conv(pf.pl, 'USD')))} (${sg(pf.plPct)}${Math.abs(pf.plPct).toFixed(1)}%)</b> unrealised</span>${pf.realized ? `<span class="${plCls(pf.realized)}">Realised ${sg(pf.realized)}${fmt(Math.abs(conv(pf.realized, 'USD')))}</span>` : ''}</div>
  <div class="small muted" style="margin-top:6px">${statusLine()}</div></div>`;
  const pendH = pend.length ? `<div class="glass"><h2>🗓️ DCA buys due</h2>${pend.slice(0, 6).map(({ p, d }) => `<div class="item"><div class="ei">${p.sym.slice(0, 3)}</div><div class="grow"><div class="t">${p.sym} · ${fmt(p.amount, undefined, 'USD')}</div><div class="s">${fmtDay(d)} · ${esc(p.ex || '')}</div></div><button class="btn sm primary" data-a="crec" data-p="${p.id}" data-d="${d}">Record</button><button class="iconbtn" data-a="cprefill" data-p="${p.id}" data-d="${d}" aria-label="Edit before saving">✎</button></div>`).join('')}<div class="small muted">"Record" saves the buy at the current price. Tap ✎ to enter the exact fill from your exchange.</div></div>` : '';
  const rowsH = cx().coins.length ? pf.rows.map(r => `<button class="item" style="width:100%;background:none;border:0;border-bottom:1px solid rgba(255,255,255,.1);color:inherit;text-align:left;font:inherit" data-a="ccoin" data-sym="${r.sym}"><div class="ei" style="background:${coinColor(r.sym)}33;font-size:12px;font-weight:800">${r.sym.slice(0, 4)}</div><div class="grow"><div class="t">${esc(r.name)}${r.demo ? '' : ''} <span class="muted small">${r.qty > 0 ? (+r.qty.toFixed(6)).toString() + ' ' + r.sym : 'no holdings'}</span></div><div class="s">${r.price ? `${fmt(r.price.p, r.price.p < 1 ? 4 : 2, 'USD')} ${r.price.src === 'manual' ? '(manual)' : ''}${r.price.chg != null ? ` · <span class="${plCls(r.price.chg)}">${sg(r.price.chg)}${Math.abs(r.price.chg).toFixed(1)}% 24h</span>` : ''}` : '<b style="color:#ffc24b">no price: tap to set</b>'}${r.qty > 0 ? ` · avg ${fmt(r.avg, r.avg < 1 ? 4 : 2, 'USD')}` : ''}</div></div><div style="text-align:right"><div class="amt">${r.qty > 0 ? fmt(conv(r.value, 'USD')) : '—'}</div>${r.qty > 0 && r.price ? `<div class="small ${plCls(r.pl)}">${sg(r.pl)}${fmt(Math.abs(conv(r.pl, 'USD')))} · ${sg(r.plPct)}${Math.abs(r.plPct).toFixed(1)}%</div>` : ''}</div></button>`).join('') : '<p class="muted">No coins yet. Add one to track it.</p>';
  const holdings = `<div class="glass"><div class="row between"><h2 style="margin:0">Holdings</h2><div class="row"><button class="btn sm" data-a="ccoinadd">＋ Coin</button><button class="btn sm primary" data-a="ctrade">＋ Trade</button></div></div><div style="margin-top:6px">${rowsH}</div></div>`;
  const held = pf.rows.filter(r => r.qty > 0 && r.value > 0);
  const alloc = held.length ? `<div class="glass"><div class="row between"><h2 style="margin:0">Allocation vs target</h2><button class="btn sm" data-a="ctarget">Set targets</button></div><div class="donutwrap" style="margin-top:8px">${allocDonut(pf.rows, tg, pf.value)}<div class="legendlist">${pf.rows.filter(r => r.qty > 0 || tg[r.sym]).map(r => { const t = tg[r.sym], d = t != null ? r.alloc - t : null; return `<div><i style="background:${coinColor(r.sym)}"></i>${r.sym}<span class="v">${r.alloc.toFixed(0)}%${t != null ? ` <span class="muted small">/ ${t}%</span>` : ''}${d != null && Math.abs(d) >= 5 ? `<span style="color:#ffc24b" class="small"> ${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(0)}</span>` : ''}</span></div>`; }).join('')}</div></div>${tsum && Math.round(tsum) !== 100 ? `<div class="small neg">Targets add up to ${tsum}%, not 100%.</div>` : ''}</div>` : '';
  const dcaTot = cx().dca.reduce((s, p) => s + p.amount, 0);
  const dca = `<div class="glass"><div class="row between"><h2 style="margin:0">DCA plans</h2><button class="btn sm" data-a="cplan">＋ Plan</button></div>${cx().dca.length ? `<div class="small muted" style="margin:6px 0">${fmt(dcaTot, undefined, 'USD')} per month: ${cx().dca.map(p => `${p.sym} ${Math.round(p.amount / dcaTot * 100)}%`).join(' · ')}</div>` + cx().dca.map(p => `<div class="item"><div class="ei">🔁</div><div class="grow"><div class="t">${p.sym} · ${fmt(p.amount, undefined, 'USD')} monthly</div><div class="s">Day ${p.day} · from ${fmtDay(p.start)}${p.ex ? ' · ' + esc(p.ex) : ''}${p.demo ? ' · demo' : ''}</div></div><button class="iconbtn" data-a="cdelplan" data-p="${p.id}" aria-label="Delete plan">🗑</button></div>`).join('') : '<p class="muted small">Add a monthly plan, e.g. ETH 180 + BTC 120 for a 60/40 split of 300. It shows on your calendar and reminds you to record each buy.</p>'}</div>`;
  const chart = `<div class="glass"><h2>Value over time</h2>${valueChart()}</div>`;
  return `${demo}${head}${pendH}${holdings}${alloc}${chart}${dca}<div class="disc">Not financial advice. Prices from CoinGecko's free API can be delayed or unavailable; you can set a manual price per coin. Crypto is volatile and you can lose money.</div>`;
}

/* ---------- sheets ---------- */
function openCoinAdd(q = '') {
  sheet(`<div class="row between"><h2 style="margin:0">Add a coin</h2><button class="iconbtn" data-a="closeall" aria-label="Close">✕</button></div><input id="coinQ" placeholder="Search symbol or name (BTC, SOL…)" autocomplete="off" style="margin:10px 0" value="${esc(q)}"><div id="coinRes"></div>
  <form id="coinForm"><h3 style="margin-top:10px">Not listed? Add it manually</h3><div class="row"><input name="sym" placeholder="Symbol" maxlength="10" required style="text-transform:uppercase"><input name="name" placeholder="Name" maxlength="30"></div><div class="row" style="margin-top:6px"><input name="price" inputmode="decimal" placeholder="Manual price (USD)"><button class="btn primary" type="submit">Add</button></div></form>`);
  coinSearch(q);
}
let _cs = 0;
async function coinSearch(q) {
  const my = ++_cs, ql = q.trim().toLowerCase(), have = new Set(cx().coins.map(c => c.id));
  let list = COIN_LIST.filter(c => !ql || c[0].toLowerCase().includes(ql) || c[2].toLowerCase().includes(ql)).slice(0, 8).map(c => ({ sym: c[0], id: c[1], name: c[2] }));
  const draw = (extra = '') => { const el = $('#coinRes'); if (!el || my !== _cs) return; el.innerHTML = list.filter(c => !have.has(c.id)).map(c => `<button class="item" style="width:100%;background:none;border:0;border-bottom:1px solid rgba(255,255,255,.1);color:inherit;text-align:left;font:inherit" data-a="cpick" data-sym="${esc(c.sym)}" data-id="${esc(c.id)}" data-name="${esc(c.name)}"><div class="ei" style="font-size:12px;font-weight:800">${esc(c.sym.slice(0, 4))}</div><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.sym)}</div></div><span class="muted">＋</span></button>`).join('') || '<p class="muted small">No match in the quick list.</p>'; if (extra) el.insertAdjacentHTML('beforeend', `<div class="small muted">${extra}</div>`); };
  draw();
  if (ql.length >= 2 && navigator.onLine) {
    try { const r = await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(ql)); if (r.ok) { const j = await r.json(); const more = (j.coins || []).slice(0, 8).map(c => ({ sym: String(c.symbol).toUpperCase(), id: c.id, name: c.name })); const seen = new Set(list.map(c => c.id)); list = [...list, ...more.filter(c => !seen.has(c.id))]; draw('Results from CoinGecko'); } } catch { draw('Offline search: quick list only'); }
  } else if (ql.length >= 2) draw('Offline: showing the quick list only. Use "add manually" below.');
}
function addCoin(c, price) {
  if (cx().coins.some(x => x.sym === c.sym)) return toast(c.sym + ' is already in your list');
  cx().coins.push(c); if (price > 0) cx().manual[c.sym] = price; save(); toast(c.sym + ' added'); refreshPrices(false); changed();
}
function openTrade(o = {}) {
  if (!cx().coins.length) { toast('Add a coin first'); return openCoinAdd(); }
  const t = o.id ? cx().trades.find(x => x.id === o.id) : null, sym = t ? t.sym : (o.sym || cx().coins[0].sym), coin = cx().coins.find(c => c.sym === sym), pr = coin && priceOf(coin);
  fctx = { id: t && t.id, dca: o.dca || null };
  sheet(`<form id="tradeForm" autocomplete="off"><div class="row between"><h2 style="margin:0">${t ? 'Edit trade' : 'Add trade'}</h2><button type="button" class="iconbtn" data-a="closeall" aria-label="Close">✕</button></div>
  <div class="seg" id="sideSeg" style="margin:10px 0"><button type="button" data-a="cside" data-s="buy" class="${!t || t.side === 'buy' ? 'on' : ''}">Buy</button><button type="button" data-a="cside" data-s="sell" class="${t && t.side === 'sell' ? 'on' : ''}">Sell</button></div><input type="hidden" name="side" value="${t ? t.side : 'buy'}">
  <label class="f">Coin</label><select name="sym" id="tSym">${cx().coins.map(c => `<option ${c.sym === sym ? 'selected' : ''}>${c.sym}</option>`).join('')}</select>
  <div class="row"><div class="grow"><label class="f">Price per coin (USD)</label><input name="price" id="tPrice" inputmode="decimal" required value="${t ? t.price : (pr ? +pr.p.toPrecision(7) : '')}"></div><div class="grow"><label class="f">Quantity</label><input name="qty" id="tQty" inputmode="decimal" placeholder="${o.spent ? 'auto from amount' : ''}" value="${t ? t.qty : ''}"></div></div>
  <div class="row"><div class="grow"><label class="f">…or amount spent / received (USD)</label><input name="spent" id="tSpent" inputmode="decimal" value="${o.spent || ''}"></div><div class="grow"><label class="f">Fee (USD)</label><input name="fee" inputmode="decimal" value="${t && t.fee ? t.fee : ''}"></div></div>
  <div class="small muted" id="tPrev" style="margin-top:6px"></div>
  <label class="f">Date</label><input type="date" name="date" value="${t ? t.date : (o.date || fd(todayN()))}" required>
  <label class="f">Exchange</label><input name="ex" list="exList" maxlength="30" value="${esc(t ? t.ex : (o.ex || 'Binance'))}"><datalist id="exList">${EXCHANGES.map(e => `<option value="${e}">`).join('')}</datalist>
  <label class="f">Note</label><input name="note" maxlength="60" value="${esc(t ? t.note : '')}">
  <button class="btn primary block" style="margin-top:14px" type="submit">${t ? 'Save changes' : 'Save trade'}</button>${t ? `<button type="button" class="btn danger block" style="margin-top:10px" data-a="cdeltrade" data-id="${t.id}">Delete trade</button>` : ''}</form>`);
  tradePrev();
}
function tradePrev() {
  const f = $('#tradeForm'); if (!f) return; const p = num(f.price.value), q = num(f.qty.value), sp = num(f.spent.value), fee = num(f.fee.value) || 0;
  const qty = q > 0 ? q : (sp > 0 && p > 0 ? sp / p : 0);
  $('#tPrev').innerHTML = qty > 0 && p > 0 ? `${f.side.value === 'buy' ? 'Buying' : 'Selling'} <b>${+qty.toFixed(8)}</b> ${f.sym.value} · total <b>${fmt(qty * p + (f.side.value === 'buy' ? fee : -fee), undefined, 'USD')}</b>` : 'Enter the quantity, or the USD amount and the price.';
}
function submitTrade(f, v) {
  const price = num(v.get('price')), fee = num(v.get('fee')) || 0, spent = num(v.get('spent')); let qty = num(v.get('qty'));
  if (!(price > 0)) return toast('Enter the price'); if (!(qty > 0)) { if (spent > 0) qty = spent / price; else return toast('Enter a quantity or amount'); }
  const o = { sym: v.get('sym'), side: v.get('side'), date: v.get('date'), qty, price, fee, ex: (v.get('ex') || '').trim(), note: (v.get('note') || '').trim() };
  if (o.side === 'sell') { const r = portfolio().rows.find(x => x.sym === o.sym), have = (r ? r.qty : 0) + (fctx.id ? (cx().trades.find(x => x.id === fctx.id) || {}).qty || 0 : 0); if (qty > have + 1e-9) return toast(`You only hold ${+have.toFixed(6)} ${o.sym}`); }
  if (fctx.id) { Object.assign(cx().trades.find(x => x.id === fctx.id), o); delete cx().trades.find(x => x.id === fctx.id).demo; }
  else { cx().trades.push({ id: uid(), ...o, dca: !!fctx.dca }); if (fctx.dca) { const p = cx().dca.find(x => x.id === fctx.dca.plan); if (p) (p.done = p.done || []).push(fctx.dca.date); } }
  recordSnapshot(); toast('Trade saved'); changed();
}
function openCoinDetail(sym) {
  const c = cx().coins.find(x => x.sym === sym), r = portfolio().rows.find(x => x.sym === sym), trades = cx().trades.filter(t => t.sym === sym).sort((a, b) => a.date < b.date ? 1 : -1);
  sheet(`<div class="row between"><h2 style="margin:0">${esc(c.name)} <span class="muted small">${sym}</span></h2><button class="iconbtn" data-a="closeall" aria-label="Close">✕</button></div>
  <div class="small muted" style="margin:6px 0">${r.qty > 0 ? `Holding ${+r.qty.toFixed(8)} · avg cost ${fmt(r.avg, r.avg < 1 ? 4 : 2, 'USD')} · fees paid ${fmt(r.fees, undefined, 'USD')}${r.realized ? ' · realised ' + sg(r.realized) + fmt(Math.abs(r.realized), undefined, 'USD') : ''}` : 'No holdings yet.'}</div>
  <form id="manualForm" data-sym="${sym}" class="askbar"><input name="p" inputmode="decimal" placeholder="Manual price (USD) — used when live price is missing" value="${cx().manual[sym] || ''}"><button class="btn" type="submit">Save</button></form>
  <h3 style="margin-top:12px">Trades</h3>${trades.map(t => `<div class="item"><div class="ei">${t.side === 'buy' ? '🟢' : '🔴'}</div><div class="grow"><div class="t">${t.side === 'buy' ? 'Bought' : 'Sold'} ${+t.qty.toFixed(6)} @ ${fmt(t.price, t.price < 1 ? 4 : 2, 'USD')}</div><div class="s">${fmtDay(t.date)}${t.ex ? ' · ' + esc(t.ex) : ''}${t.fee ? ' · fee ' + fmt(t.fee, undefined, 'USD') : ''}${t.dca ? ' · DCA' : ''}${t.demo ? ' · demo' : ''}</div></div><button class="iconbtn" data-a="ctradeedit" data-id="${t.id}">✎</button></div>`).join('') || '<p class="muted small">No trades.</p>'}
  <div class="row" style="margin-top:12px"><button class="btn primary grow" data-a="ctrade" data-sym="${sym}">＋ Trade</button><button class="btn danger" data-a="cremcoin" data-sym="${sym}">Remove coin</button></div>`);
}
function openTargets() {
  const tg = cx().target;
  sheet(`<form id="targetForm"><h2>Target allocation</h2><p class="muted small">Percent of the portfolio you want in each coin. Should add up to 100.</p>${cx().coins.map(c => `<div class="row" style="margin:6px 0"><b style="width:56px">${c.sym}</b><input name="t_${c.sym}" inputmode="decimal" value="${tg[c.sym] ?? ''}" placeholder="0"><span>%</span></div>`).join('')}<div class="row" style="margin-top:14px"><button type="button" class="btn grow" data-a="closeall">Cancel</button><button class="btn primary grow" type="submit">Save</button></div></form>`);
}
function openPlan() {
  if (!cx().coins.length) { toast('Add a coin first'); return openCoinAdd(); }
  sheet(`<form id="planForm"><h2>New monthly DCA plan</h2><label class="f">Coin</label><select name="sym">${cx().coins.map(c => `<option>${c.sym}</option>`).join('')}</select>
  <label class="f">Amount per month (USD)</label><input name="amount" inputmode="decimal" required placeholder="180"><div class="row"><div class="grow"><label class="f">Day of month</label><input name="day" type="number" min="1" max="31" value="1"></div><div class="grow"><label class="f">Starts</label><input type="date" name="start" value="${fd(todayN())}"></div></div>
  <label class="f">Exchange</label><input name="ex" value="Binance" list="exList"><datalist id="exList">${EXCHANGES.map(e => `<option value="${e}">`).join('')}</datalist>
  <label class="f" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="link" checked> Show on my calendar as a monthly expense</label><select name="acc">${state.accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${a.cur})</option>`).join('')}</select>
  <div class="row" style="margin-top:14px"><button type="button" class="btn grow" data-a="closeall">Cancel</button><button class="btn primary grow" type="submit">Add plan</button></div></form>`);
}

/* ---------- actions & submit hooks (merged by app.js) ---------- */
const CRYPTO_ACTIONS = {
  crefresh: () => refreshPrices(true), ctrade: d => openTrade({ sym: d.sym }), ccoinadd: () => openCoinAdd(), ccoin: d => openCoinDetail(d.sym),
  cpick: d => addCoin({ sym: d.sym, id: d.id, name: d.name }), cside: d => { document.querySelector('#tradeForm [name=side]').value = d.s; document.querySelectorAll('#sideSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === d.s)); tradePrev(); },
  ctradeedit: d => openTrade({ id: d.id }), ctarget: openTargets, cplan: openPlan,
  cdeltrade: async d => { if (await ask('Delete this trade?', 'Delete')) { cx().trades = cx().trades.filter(t => t.id !== d.id); changed(); } },
  cremcoin: async d => { if (await ask(`Remove ${d.sym} and all its trades?`, 'Remove')) { cx().coins = cx().coins.filter(c => c.sym !== d.sym); cx().trades = cx().trades.filter(t => t.sym !== d.sym); cx().dca = cx().dca.filter(p => p.sym !== d.sym); delete cx().target[d.sym]; changed(); } },
  cdelplan: async d => { if (!await ask('Delete this DCA plan (and its calendar expense)?', 'Delete')) return; const p = cx().dca.find(x => x.id === d.p); if (p && p.txId) state.tx = state.tx.filter(t => t.id !== p.txId); cx().dca = cx().dca.filter(x => x.id !== d.p); changed(); },
  crec: d => recordPending(d.p, d.d), cprefill: d => { const p = cx().dca.find(x => x.id === d.p); openTrade({ sym: p.sym, spent: p.amount, date: d.d, ex: p.ex, dca: { plan: p.id, date: d.d } }); }
};
function cryptoSubmit(f, v) {
  if (f.id === 'tradeForm') { submitTrade(f, v); return true; }
  if (f.id === 'coinForm') { const sym = (v.get('sym') || '').trim().toUpperCase(); if (sym) addCoin({ sym, id: '', name: (v.get('name') || '').trim() || sym }, num(v.get('price'))); return true; }
  if (f.id === 'manualForm') { const p = num(v.get('p')), sym = f.dataset.sym; if (p > 0) cx().manual[sym] = p; else delete cx().manual[sym]; save(); toast('Manual price saved'); changed(); return true; }
  if (f.id === 'targetForm') { const t = {}; for (const c of cx().coins) { const n = num(v.get('t_' + c.sym)); if (n > 0) t[c.sym] = n; } cx().target = t; const s = Object.values(t).reduce((a, b) => a + b, 0); toast(s && Math.round(s) !== 100 ? `Saved. Note: targets add up to ${s}%` : 'Targets saved'); changed(); return true; }
  if (f.id === 'planForm') {
    const amount = num(v.get('amount')), day = Math.min(31, Math.max(1, parseInt(v.get('day')) || 1)); if (!(amount > 0)) { toast('Enter the monthly amount'); return true; }
    const p = { id: uid(), sym: v.get('sym'), amount, day, start: v.get('start'), end: '', ex: (v.get('ex') || '').trim(), done: [] };
    if (v.get('link')) { const tx = { id: uid(), skip: [], type: 'expense', amount, cur: 'USD', cat: 'invest', acc: v.get('acc'), date: fd(dayNum(ymd(pd(p.start)).y, ymd(pd(p.start)).m, Math.min(day, dim(ymd(pd(p.start)).y, ymd(pd(p.start)).m)))), note: `Crypto DCA ${p.sym}`, rec: { freq: 'monthly', end: '' } }; state.tx.push(tx); p.txId = tx.id; }
    cx().dca.push(p); toast('DCA plan added'); changed(); return true;
  }
  return false;
}
function cryptoOnInput(e) {
  const t = e.target;
  if (t.id === 'coinQ') { clearTimeout(cryptoOnInput.t); cryptoOnInput.t = setTimeout(() => coinSearch(t.value), 250); }
  else if (t.closest && t.closest('#tradeForm')) tradePrev();
}
