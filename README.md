# BudgetPulse+ (personal budget calendar PWA)

Offline-first, no backend, no accounts. All data stays in the browser (localStorage).

Features: projected-balance calendar, multi-currency (own exchange rates incl. MMK), family remittance log,
borrow/lend tracker with partial repayments, crypto portfolio + DCA (CoinGecko prices, cached), reports,
rule-based coach and an optional "Ask AI" chat (bring your own key).

- Hosted on GitHub Pages (static). Open once online; it then works offline. Install via Chrome menu -> Install app.
- Local test: `python3 -m http.server 8765` then open http://localhost:8765
- All URLs are relative, so it works under a sub-path such as `/budgetpulse/`.
- AI coach: Settings -> AI coach. Default: xAI `https://api.x.ai/v1/chat/completions`, model `grok-4.7`, or any OpenAI-compatible base URL + model. The key lives only in localStorage (`budgetpulse.ai`) and is never exported or committed.
- Files: `app.js` (budget, people, coach, settings), `crypto.js` (crypto module), `sw.js` (service worker; bump `CACHE` on every release).
- Not financial advice.
