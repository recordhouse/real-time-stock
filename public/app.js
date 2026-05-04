const rows = document.querySelector("#stockRows");
const sourceLabel = document.querySelector("#sourceLabel");
const updatedAt = document.querySelector("#updatedAt");
const avgRate = document.querySelector("#avgRate");
const maxRate = document.querySelector("#maxRate");
const totalVolume = document.querySelector("#totalVolume");
const refreshButton = document.querySelector("#refreshButton");
const searchInput = document.querySelector("#searchInput");
const marketButtons = [...document.querySelectorAll(".segment")];
const baseTitle = "국내주식 실시간 급등주 TOP 20 | KOSPI·KOSDAQ 상승률 순위";

let stocks = [];
let marketFilter = "ALL";

const number = new Intl.NumberFormat("ko-KR");
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0
});

function formatRate(value) {
  return `+${Number(value).toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function updateSeoData(items) {
  if (!items.length) return;

  const leaders = items.slice(0, 3).map((stock) => stock.name).join(", ");
  document.title = `${leaders} 급등 | ${baseTitle}`;

  const description = document.querySelector("meta[name='description']");
  if (description) {
    description.content = `${leaders} 등 국내주식 급등주 TOP 20의 현재가, 등락률, 거래량을 실시간으로 확인하세요.`;
  }

  document.querySelector("#stockItemList")?.remove();
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id = "stockItemList";
  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "국내주식 실시간 급등주 TOP 20",
    "itemListElement": items.slice(0, 20).map((stock, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": `${stock.name} (${stock.code})`,
      "description": `${stock.market} ${stock.name} 등락률 ${formatRate(stock.rate)}, 현재가 ${won.format(stock.price)}`
    }))
  });
  document.head.appendChild(script);
}

function renderSummary(items) {
  if (!items.length) {
    avgRate.textContent = "--";
    maxRate.textContent = "--";
    totalVolume.textContent = "--";
    return;
  }

  const average = items.reduce((sum, stock) => sum + stock.rate, 0) / items.length;
  const highest = Math.max(...items.map((stock) => stock.rate));
  const volume = items.reduce((sum, stock) => sum + stock.volume, 0);

  avgRate.textContent = formatRate(average);
  maxRate.textContent = formatRate(highest);
  totalVolume.textContent = number.format(volume);
}

function getFilteredStocks() {
  const query = searchInput.value.trim().toLowerCase();

  return stocks.filter((stock) => {
    const matchesMarket = marketFilter === "ALL" || stock.market === marketFilter;
    const matchesQuery = !query ||
      stock.name.toLowerCase().includes(query) ||
      stock.code.includes(query);

    return matchesMarket && matchesQuery;
  });
}

function renderTable() {
  const filtered = getFilteredStocks();
  renderSummary(filtered);

  if (!filtered.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">조건에 맞는 종목이 없습니다.</td></tr>`;
    return;
  }

  rows.innerHTML = filtered.map((stock, index) => `
    <tr>
      <td><span class="rank">${index + 1}</span></td>
      <td>
        <div class="stock-name">
          <span class="market">${escapeHtml(stock.market)}</span>
          <strong>${escapeHtml(stock.name)}</strong>
          <span class="code">${escapeHtml(stock.code)}</span>
        </div>
      </td>
      <td>${won.format(stock.price)}</td>
      <td class="positive">+${number.format(stock.change)}</td>
      <td><span class="rate-pill">${formatRate(stock.rate)}</span></td>
      <td>${number.format(stock.volume)}</td>
    </tr>
  `).join("");
}

function setSource(source) {
  sourceLabel.className = source;
  sourceLabel.textContent = source === "live" ? "실시간 연결" : "데모 데이터";
}

async function loadStocks() {
  refreshButton.classList.add("loading");
  refreshButton.disabled = true;

  try {
    const response = await fetch("/api/rising", { cache: "no-store" });
    if (!response.ok) throw new Error("데이터 요청 실패");

    const data = await response.json();
    stocks = data.stocks;
    setSource(data.source);
    updateSeoData(stocks);
    updatedAt.textContent = new Date(data.fetchedAt).toLocaleTimeString("ko-KR", {
      hour12: false
    });
    renderTable();
  } catch {
    rows.innerHTML = `<tr><td colspan="6" class="empty">데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</td></tr>`;
    setSource("demo");
  } finally {
    refreshButton.classList.remove("loading");
    refreshButton.disabled = false;
  }
}

marketButtons.forEach((button) => {
  button.addEventListener("click", () => {
    marketButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    marketFilter = button.dataset.market;
    renderTable();
  });
});

searchInput.addEventListener("input", renderTable);
refreshButton.addEventListener("click", loadStocks);

loadStocks();
setInterval(loadStocks, 60_000);
