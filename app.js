const STORAGE_KEY = "paperTraderProfileV1";
const API_BASE = "https://finnhub.io/api/v1/quote";
const API_TOKEN = "demo";

let state = loadState();
let latestQuotes = {};
let lastAction = "buy";

const profileForm = document.getElementById("profileForm");
const tradeForm = document.getElementById("tradeForm");
const refreshQuoteBtn = document.getElementById("refreshQuoteBtn");
const quotePanel = document.getElementById("quotePanel");
const statsGrid = document.getElementById("statsGrid");
const portfolioTableWrap = document.getElementById("portfolioTableWrap");
const historyTableWrap = document.getElementById("historyTableWrap");

profileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("displayName").value.trim();
  const startingCash = Number(document.getElementById("startingCash").value);
  if (!name || startingCash <= 0) return;

  state = {
    name,
    startingCash,
    cash: startingCash,
    holdings: {},
    tradeHistory: [],
    realizedPnL: 0,
  };
  saveState();
  render();
});

tradeForm.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON" && e.target.dataset.action) {
    lastAction = e.target.dataset.action;
  }
});

tradeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.name) {
    alert("Create your profile first.");
    return;
  }

  const symbol = document.getElementById("symbol").value.trim().toUpperCase();
  const shares = Number(document.getElementById("shares").value);
  if (!symbol || shares <= 0) return;

  const quote = await fetchQuote(symbol);
  if (!quote) return;

  const price = quote.c;
  if (!price || price <= 0) {
    alert("Invalid quote. Try another symbol.");
    return;
  }

  if (lastAction === "buy") {
    executeBuy(symbol, shares, price);
  } else {
    executeSell(symbol, shares, price);
  }

  saveState();
  render();
});

refreshQuoteBtn.addEventListener("click", async () => {
  const symbol = document.getElementById("symbol").value.trim().toUpperCase();
  if (!symbol) return;
  await fetchQuote(symbol, true);
});

function executeBuy(symbol, shares, price) {
  const cost = shares * price;
  if (state.cash < cost) {
    alert("Not enough cash to buy.");
    return;
  }
  const position = state.holdings[symbol] || { shares: 0, avgCost: 0 };
  const totalCost = position.avgCost * position.shares + cost;
  position.shares += shares;
  position.avgCost = totalCost / position.shares;
  state.holdings[symbol] = position;
  state.cash -= cost;
  state.tradeHistory.unshift({ type: "BUY", symbol, shares, price, ts: new Date().toISOString() });
}

function executeSell(symbol, shares, price) {
  const position = state.holdings[symbol];
  if (!position || position.shares < shares) {
    alert("Not enough shares to sell.");
    return;
  }

  const proceeds = shares * price;
  const realized = (price - position.avgCost) * shares;
  state.realizedPnL += realized;
  state.cash += proceeds;
  position.shares -= shares;
  if (position.shares === 0) {
    delete state.holdings[symbol];
  } else {
    state.holdings[symbol] = position;
  }
  state.tradeHistory.unshift({ type: "SELL", symbol, shares, price, ts: new Date().toISOString(), realized });
}

async function fetchQuote(symbol, manual = false) {
  try {
    const res = await fetch(`${API_BASE}?symbol=${encodeURIComponent(symbol)}&token=${API_TOKEN}`);
    const data = await res.json();
    if (!data || typeof data.c !== "number") throw new Error("No price");
    latestQuotes[symbol] = data;
    quotePanel.innerHTML = `<strong>${symbol}</strong>: $${data.c.toFixed(2)} (High $${data.h.toFixed(2)}, Low $${data.l.toFixed(2)}, Prev Close $${data.pc.toFixed(2)})`;
    if (manual) render();
    return data;
  } catch {
    quotePanel.textContent = "Quote lookup failed. Check internet/API availability and symbol.";
    return null;
  }
}

function computeStats() {
  const holdingEntries = Object.entries(state.holdings);
  const marketValue = holdingEntries.reduce((sum, [sym, pos]) => {
    const price = latestQuotes[sym]?.c || pos.avgCost;
    return sum + pos.shares * price;
  }, 0);
  const equity = state.cash + marketValue;
  const unrealizedPnL = holdingEntries.reduce((sum, [sym, pos]) => {
    const price = latestQuotes[sym]?.c || pos.avgCost;
    return sum + (price - pos.avgCost) * pos.shares;
  }, 0);
  const totalPnL = state.realizedPnL + unrealizedPnL;

  const sells = state.tradeHistory.filter((t) => t.type === "SELL");
  const winningSells = sells.filter((t) => (t.realized || 0) > 0).length;
  const winRate = sells.length ? (winningSells / sells.length) * 100 : 0;

  return { marketValue, equity, unrealizedPnL, totalPnL, winRate, sells: sells.length };
}

function render() {
  document.getElementById("displayName").value = state.name || "";
  document.getElementById("startingCash").value = state.startingCash || 10000;

  const stats = computeStats();
  const rows = [
    ["Trader", state.name || "Not set"],
    ["Cash", usd(state.cash || 0)],
    ["Portfolio Value", usd(stats.marketValue)],
    ["Total Equity", usd(stats.equity)],
    ["Realized P/L", spanPnL(state.realizedPnL)],
    ["Unrealized P/L", spanPnL(stats.unrealizedPnL)],
    ["Total P/L", spanPnL(stats.totalPnL)],
    ["Win Rate", `${stats.winRate.toFixed(1)}% (${stats.sells} closed)`],
  ];
  statsGrid.innerHTML = rows.map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");

  const holdings = Object.entries(state.holdings);
  if (!holdings.length) {
    portfolioTableWrap.innerHTML = "<p class='muted'>No holdings yet.</p>";
  } else {
    portfolioTableWrap.innerHTML = `<table><thead><tr><th>Symbol</th><th>Shares</th><th>Avg Cost</th><th>Last Price</th><th>Unrealized P/L</th></tr></thead><tbody>${holdings.map(([sym, pos]) => {
      const last = latestQuotes[sym]?.c || pos.avgCost;
      const upnl = (last - pos.avgCost) * pos.shares;
      return `<tr><td>${sym}</td><td>${pos.shares}</td><td>${usd(pos.avgCost)}</td><td>${usd(last)}</td><td>${spanPnL(upnl)}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  if (!state.tradeHistory.length) {
    historyTableWrap.innerHTML = "<p class='muted'>No trades yet.</p>";
  } else {
    historyTableWrap.innerHTML = `<table><thead><tr><th>Time (UTC)</th><th>Type</th><th>Symbol</th><th>Shares</th><th>Price</th><th>Realized</th></tr></thead><tbody>${state.tradeHistory.slice(0, 30).map((t) => `<tr><td>${new Date(t.ts).toISOString().replace('T',' ').slice(0,19)}</td><td>${t.type}</td><td>${t.symbol}</td><td>${t.shares}</td><td>${usd(t.price)}</td><td>${t.type === "SELL" ? spanPnL(t.realized || 0) : "-"}</td></tr>`).join("")}</tbody></table>`;
  }
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { name: "", startingCash: 10000, cash: 10000, holdings: {}, tradeHistory: [], realizedPnL: 0 };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { name: "", startingCash: 10000, cash: 10000, holdings: {}, tradeHistory: [], realizedPnL: 0 };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function usd(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function spanPnL(v) {
  const cls = v >= 0 ? "pos" : "neg";
  const sign = v >= 0 ? "+" : "";
  return `<span class="${cls}">${sign}${usd(v)}</span>`;
}

render();
