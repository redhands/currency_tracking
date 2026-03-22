const currencyConfigs = [
  { code: "USD", name: "미국 달러", unitLabel: "1달러", color: "#c55a11" },
  { code: "JPY", name: "일본 엔", unitLabel: "100엔", color: "#0f7b85", scale: 100 },
  { code: "PHP", name: "필리핀 페소", unitLabel: "1페소", color: "#2d8f4e" },
  { code: "THB", name: "태국 바트", unitLabel: "1바트", color: "#8b5a2b" },
];

const runtimeConfig = {
  refreshMs: 60 * 1000,
  exchangerateHostAccessKey: "",
  ...window.FX_DASHBOARD_CONFIG,
};

const compareCodes = new Set(["USD", "JPY", "PHP", "THB"]);
const focusCode = { current: "USD" };
const chartMode = { current: "indexed" };
const state = {
  series: [],
  sourceLabel: "데이터 불러오는 중",
  syncStatus: "환율 데이터를 연결하고 있습니다.",
  updatedAt: new Date(),
};

const cardsRoot = document.querySelector("#summary-cards");
const legendRoot = document.querySelector("#legend");
const activeSeriesRoot = document.querySelector("#active-series");
const accordionRoot = document.querySelector("#details-accordion");
const tableRoot = document.querySelector("#details-table-body");
const chartCanvas = document.querySelector("#main-chart");
const tooltip = document.querySelector("#chart-tooltip");
const updatedAtNode = document.querySelector("#updated-at");
const sourceLabelNode = document.querySelector("#source-label");
const syncStatusNode = document.querySelector("#sync-status");
function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getHistoryStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 110);
  return date;
}

function getHistoryEndDate() {
  return new Date();
}

function formatNumber(value, code) {
  const digits = code === "PHP" ? 3 : 2;
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatRate(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatDiff(value, code) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, code)}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(value);
}

function formatUpdatedAt(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatAxisValue(value) {
  if (chartMode.current === "indexed") {
    return `${value.toFixed(1)}p`;
  }

  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function normalizeCurrencyValue(code, krwPerUnit) {
  const digits = code === "PHP" ? 3 : 2;
  return Number(krwPerUnit.toFixed(digits));
}

function computeKrwPerUnitFromUsdQuotes(quotes) {
  const usdToKrw = quotes.USDKRW;
  if (!usdToKrw) throw new Error("USDKRW quote is missing");

  return currencyConfigs.reduce((accumulator, config) => {
    if (config.code === "USD") {
      accumulator[config.code] = normalizeCurrencyValue(config.code, usdToKrw);
      return accumulator;
    }

    const usdToTarget = quotes[`USD${config.code}`];
    if (!usdToTarget) {
      throw new Error(`USD${config.code} quote is missing`);
    }

    const krwPerUnit = usdToKrw / usdToTarget;
    const scaled = config.scale ? krwPerUnit * config.scale : krwPerUnit;
    accumulator[config.code] = normalizeCurrencyValue(config.code, scaled);
    return accumulator;
  }, {});
}

async function fetchFrankfurterHistory() {
  const start = formatDateKey(getHistoryStartDate());
  const end = formatDateKey(getHistoryEndDate());
  const symbols = "KRW,JPY,PHP,THB";
  const url = `https://api.frankfurter.dev/v1/${start}..${end}?base=USD&symbols=${symbols}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Frankfurter history request failed: ${response.status}`);
  }

  const payload = await response.json();
  const dateKeys = Object.keys(payload.rates || {}).sort();
  if (dateKeys.length < 15) {
    throw new Error("Not enough history points from Frankfurter");
  }

  const series = currencyConfigs.map((config) => ({
    ...config,
    points: dateKeys.map((dateKey) => {
      const rates = payload.rates[dateKey];
      let value;

      if (config.code === "USD") {
        value = rates.KRW;
      } else {
        const krwPerUnit = rates.KRW / rates[config.code];
        value = config.scale ? krwPerUnit * config.scale : krwPerUnit;
      }

      return {
        date: new Date(dateKey),
        value: normalizeCurrencyValue(config.code, value),
      };
    }).slice(-90),
  }));

  return {
    updatedAt: new Date(`${payload.end_date || dateKeys[dateKeys.length - 1]}T16:00:00Z`),
    series,
  };
}

async function fetchExchangerateHostLive() {
  if (!runtimeConfig.exchangerateHostAccessKey) return null;

  const symbols = "KRW,JPY,PHP,THB";
  const url = `https://api.exchangerate.host/live?access_key=${encodeURIComponent(
    runtimeConfig.exchangerateHostAccessKey
  )}&currencies=${symbols}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ExchangeRate.host live request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload.success === false || !payload.quotes) {
    throw new Error(payload.error?.info || "ExchangeRate.host live payload is invalid");
  }

  return {
    updatedAt: payload.timestamp ? new Date(payload.timestamp * 1000) : new Date(),
    values: computeKrwPerUnitFromUsdQuotes(payload.quotes),
  };
}

function mergeLivePoint(historySeries, liveSnapshot) {
  if (!liveSnapshot) return historySeries;

  return historySeries.map((series) => {
    const clonedPoints = series.points.map((point) => ({ ...point }));
    const latestDateKey = formatDateKey(clonedPoints[clonedPoints.length - 1].date);
    const liveDateKey = formatDateKey(liveSnapshot.updatedAt);
    const liveValue = liveSnapshot.values[series.code];

    if (latestDateKey === liveDateKey) {
      clonedPoints[clonedPoints.length - 1] = {
        date: new Date(liveSnapshot.updatedAt),
        value: liveValue,
      };
    } else {
      clonedPoints.push({
        date: new Date(liveSnapshot.updatedAt),
        value: liveValue,
      });
    }

    return {
      ...series,
      points: clonedPoints.slice(-90),
    };
  });
}

function buildDemoSeries() {
  const today = new Date();
  const baselines = { USD: 1452, JPY: 973, PHP: 25.4, THB: 42.4 };

  return currencyConfigs.map((config, configIndex) => ({
    ...config,
    points: Array.from({ length: 90 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (89 - index));
      const baseline = baselines[config.code];
      const wave = Math.sin((index + configIndex) * 0.16) * baseline * 0.02;
      const wave2 = Math.cos((index + configIndex * 1.8) * 0.09) * baseline * 0.01;
      const drift = index * baseline * 0.00055;

      return {
        date,
        value: normalizeCurrencyValue(config.code, baseline + wave + wave2 + drift),
      };
    }),
  }));
}

async function loadSeries() {
  try {
    const history = await fetchFrankfurterHistory();
    let mergedSeries = history.series;
    let sourceLabel = "Frankfurter 3개월 기준";
    let syncStatus =
      "최신 영업일 기준 3개월 추이입니다. 실시간 API 키를 연결하면 현재값을 1분마다 갱신합니다.";
    let updatedAt = history.updatedAt;

    try {
      const liveSnapshot = await fetchExchangerateHostLive();
      if (liveSnapshot) {
        mergedSeries = mergeLivePoint(history.series, liveSnapshot);
        sourceLabel = "Frankfurter + ExchangeRate.host";
        syncStatus = "실시간 환율 반영 중입니다. 현재값은 1분마다 자동 갱신됩니다.";
        updatedAt = liveSnapshot.updatedAt;
      }
    } catch (liveError) {
      syncStatus = "실시간 연결에 실패해 최신 일간 기준 값으로 표시 중입니다.";
      console.warn(liveError);
    }

    return { series: mergedSeries, sourceLabel, syncStatus, updatedAt };
  } catch (historyError) {
    console.warn(historyError);
    return {
      series: buildDemoSeries(),
      sourceLabel: "데모 샘플 데이터",
      syncStatus: "실데이터 연결에 실패해 데모 데이터로 표시 중입니다.",
      updatedAt: new Date(),
    };
  }
}

function computeStats(series) {
  const first = series.points[0].value;
  const last = series.points[series.points.length - 1].value;
  const prev = series.points[Math.max(0, series.points.length - 2)].value;
  const high = Math.max(...series.points.map((point) => point.value));
  const low = Math.min(...series.points.map((point) => point.value));
  const change = last - first;
  const changeRate = (change / first) * 100;
  const dailyChange = last - prev;
  const dailyRate = prev ? (dailyChange / prev) * 100 : 0;
  const trend = changeRate > 1 ? "상승" : changeRate < -1 ? "하락" : "박스권";

  return { current: last, first, high, low, range: high - low, change, changeRate, dailyRate, trend };
}

function getSeriesByCode(code) {
  return state.series.find((series) => series.code === code);
}

function getChartSeries() {
  if (chartMode.current === "absolute") {
    const focused = getSeriesByCode(focusCode.current);
    return focused ? [focused] : [];
  }

  return state.series.filter((series) => compareCodes.has(series.code));
}

function getDisplayValue(series, pointIndex) {
  const raw = series.points[pointIndex].value;
  if (chartMode.current === "absolute") return raw;
  const base = series.points[0].value;
  return (raw / base) * 100;
}

function renderMeta() {
  updatedAtNode.textContent = formatUpdatedAt(state.updatedAt);
  sourceLabelNode.textContent = state.sourceLabel;
  syncStatusNode.textContent = state.syncStatus;
}

function renderCards() {
  cardsRoot.innerHTML = "";

  state.series.forEach((series) => {
    const stats = computeStats(series);
    const isFocused = focusCode.current === series.code;
    const card = document.createElement("article");
    card.className = `summary-card${isFocused ? " is-emphasized" : ""}`;
    const directionClass = stats.changeRate >= 0 ? "is-up" : "is-down";

    card.innerHTML = `
      <div class="summary-card__top">
        <div>
          <div class="summary-card__code">${series.code}/KRW</div>
          <div class="summary-card__name">${series.name}</div>
        </div>
        <span class="metric ${directionClass}">${stats.trend}</span>
      </div>
      <div class="summary-card__price">${formatNumber(stats.current, series.code)}</div>
      <div class="summary-card__unit">${series.unitLabel} 기준</div>
      <canvas class="sparkline" width="320" height="56" data-code="${series.code}"></canvas>
      <div class="summary-card__bottom">
        <span class="metric ${stats.dailyRate >= 0 ? "is-up" : "is-down"}">전일 ${formatRate(stats.dailyRate)}</span>
        <span class="metric ${directionClass}">3개월 ${formatRate(stats.changeRate)}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      focusCode.current = series.code;
      if (chartMode.current === "indexed") {
        compareCodes.add(series.code);
      }
      render();
    });

    cardsRoot.appendChild(card);
  });

  cardsRoot.querySelectorAll(".sparkline").forEach((canvas) => {
    drawSparkline(canvas, getSeriesByCode(canvas.dataset.code));
  });
}

function drawSparkline(canvas, series) {
  if (!series) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const values = series.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = series.color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 6) - 3;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function renderActiveSeries() {
  const activeSeries = getChartSeries();
  activeSeriesRoot.innerHTML = "";

  activeSeries.forEach((series) => {
    const chip = document.createElement("div");
    chip.className = "active-series__chip";
    chip.innerHTML = `
      <span class="active-series__dot" style="background:${series.color}"></span>
      <span>${series.code}/KRW</span>
    `;
    activeSeriesRoot.appendChild(chip);
  });
}

function renderLegend() {
  legendRoot.innerHTML = "";

  state.series.forEach((series) => {
    const button = document.createElement("button");
    button.type = "button";
    const isActive = chartMode.current === "absolute"
      ? focusCode.current === series.code
      : compareCodes.has(series.code);

    button.className = `legend__item${isActive ? " is-active" : " is-hidden"}`;
    button.innerHTML = `
      <span class="legend__swatch" style="background:${series.color}"></span>
      <span>${series.code}/KRW</span>
    `;

    button.addEventListener("click", () => {
      if (chartMode.current === "absolute") {
        focusCode.current = series.code;
      } else {
        if (compareCodes.has(series.code) && compareCodes.size > 1) {
          compareCodes.delete(series.code);
        } else {
          compareCodes.add(series.code);
        }
        if (!compareCodes.has(focusCode.current)) {
          focusCode.current = [...compareCodes][0];
        }
      }
      render();
    });

    legendRoot.appendChild(button);
  });
}

function renderDetails() {
  accordionRoot.innerHTML = "";
  tableRoot.innerHTML = "";

  state.series.forEach((series, index) => {
    const stats = computeStats(series);
    const directionClass = stats.changeRate >= 0 ? "is-up" : "is-down";

    const details = document.createElement("details");
    details.className = "accordion-item";
    if (index === 0) details.open = true;
    details.innerHTML = `
      <summary>
        <div class="accordion-item__title">
          <strong>${series.code}/KRW</strong>
          <span>${series.name}</span>
        </div>
        <span class="metric ${directionClass}">${formatRate(stats.changeRate)}</span>
      </summary>
      <div class="accordion-item__body">
        <div class="detail-stat"><span>현재가</span><strong>${formatNumber(stats.current, series.code)}</strong></div>
        <div class="detail-stat"><span>3개월 전</span><strong>${formatNumber(stats.first, series.code)}</strong></div>
        <div class="detail-stat"><span>증감액</span><strong>${formatDiff(stats.change, series.code)}</strong></div>
        <div class="detail-stat"><span>최고가</span><strong>${formatNumber(stats.high, series.code)}</strong></div>
        <div class="detail-stat"><span>최저가</span><strong>${formatNumber(stats.low, series.code)}</strong></div>
        <div class="detail-stat"><span>변동폭</span><strong>${formatNumber(stats.range, series.code)}</strong></div>
      </div>
    `;
    accordionRoot.appendChild(details);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${series.code}/KRW</td>
      <td>${formatNumber(stats.current, series.code)}</td>
      <td>${formatNumber(stats.first, series.code)}</td>
      <td>${formatDiff(stats.change, series.code)}</td>
      <td class="${directionClass}">${formatRate(stats.changeRate)}</td>
      <td>${formatNumber(stats.high, series.code)}</td>
      <td>${formatNumber(stats.low, series.code)}</td>
      <td>${formatNumber(stats.range, series.code)}</td>
    `;
    tableRoot.appendChild(row);
  });
}

function drawMainChart(activeIndex = null) {
  const visibleSeries = getChartSeries();
  if (!visibleSeries.length) return;

  const ctx = chartCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = chartCanvas.clientWidth;
  const cssHeight = Math.max(288, Math.min(416, Math.round(window.innerHeight * 0.352)));
  chartCanvas.width = cssWidth * dpr;
  chartCanvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = cssWidth;
  const height = cssHeight;
  const padding = { top: 20, right: 16, bottom: 38, left: 12 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const pointCount = visibleSeries[0].points.length;
  const values = visibleSeries.flatMap((series) =>
    series.points.map((_, index) => getDisplayValue(series, index))
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(92, 72, 38, 0.12)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(103, 87, 70, 0.82)";
  ctx.font = '11px "Nanum Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

  for (let i = 0; i < 4; i += 1) {
    const y = padding.top + (innerHeight / 3) * i;
    const axisValue = max - (range / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(formatAxisValue(axisValue), padding.left + 6, y - (i === 0 ? -12 : 6));
  }

  ctx.fillStyle = "#7d6b58";
  ctx.font = '12px "Nanum Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  ctx.textAlign = "left";

  const firstDate = visibleSeries[0].points[0].date;
  const middleDate = visibleSeries[0].points[Math.floor((pointCount - 1) / 2)].date;
  const lastDate = visibleSeries[0].points[pointCount - 1].date;

  [firstDate, middleDate, lastDate].forEach((date, index) => {
    const x = padding.left + (innerWidth / 2) * index;
    ctx.fillText(formatDate(date), x, height - 12);
  });

  visibleSeries.forEach((series) => {
    ctx.beginPath();
    ctx.lineWidth = focusCode.current === series.code ? 3.4 : 2.1;
    ctx.strokeStyle = series.color;
    ctx.globalAlpha = focusCode.current === series.code ? 1 : 0.72;

    series.points.forEach((point, index) => {
      const value = getDisplayValue(series, index);
      const x = padding.left + (index / (pointCount - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((value - min) / range) * innerHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  ctx.globalAlpha = 1;

  if (activeIndex !== null) {
    const x = padding.left + (activeIndex / (pointCount - 1)) * innerWidth;
    ctx.strokeStyle = "rgba(31, 26, 20, 0.18)";
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();

    visibleSeries.forEach((series) => {
      const value = getDisplayValue(series, activeIndex);
      const y = padding.top + innerHeight - ((value - min) / range) * innerHeight;
      ctx.fillStyle = series.color;
      ctx.beginPath();
      ctx.arc(x, y, focusCode.current === series.code ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff9ef";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  chartCanvas.dataset.paddingLeft = String(padding.left);
  chartCanvas.dataset.innerWidth = String(innerWidth);
  chartCanvas.dataset.pointCount = String(pointCount);
}

function showTooltip(pointIndex, clientX, clientY) {
  const visibleSeries = getChartSeries();
  const date = visibleSeries[0].points[pointIndex].date;

  tooltip.innerHTML = `
    <div class="chart-tooltip__date">${formatDate(date)}</div>
    ${visibleSeries
      .map((series) => {
        const rawValue = series.points[pointIndex].value;
        const display = chartMode.current === "absolute"
          ? formatNumber(rawValue, series.code)
          : `${getDisplayValue(series, pointIndex).toFixed(2)}p`;
        return `
          <div class="chart-tooltip__row">
            <div><span class="chart-tooltip__swatch" style="background:${series.color}"></span>${series.code}/KRW</div>
            <strong>${display}</strong>
          </div>
        `;
      })
      .join("")}
  `;
  tooltip.hidden = false;

  const panel = chartCanvas.parentElement.getBoundingClientRect();
  const left = Math.min(Math.max(clientX - panel.left + 12, 12), panel.width - tooltip.offsetWidth - 12);
  const top = Math.min(Math.max(clientY - panel.top + 12, 12), panel.height - tooltip.offsetHeight - 12);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
  drawMainChart();
}

function attachChartEvents() {
  const handleMove = (event) => {
    const rect = chartCanvas.getBoundingClientRect();
    const x = event.clientX ? event.clientX - rect.left : event.touches[0].clientX - rect.left;
    const paddingLeft = Number(chartCanvas.dataset.paddingLeft);
    const innerWidth = Number(chartCanvas.dataset.innerWidth);
    const pointCount = Number(chartCanvas.dataset.pointCount);
    const clamped = Math.min(Math.max(x - paddingLeft, 0), innerWidth);
    const pointIndex = Math.round((clamped / innerWidth) * (pointCount - 1));
    drawMainChart(pointIndex);
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;
    showTooltip(pointIndex, clientX, clientY);
  };

  chartCanvas.addEventListener("mousemove", handleMove);
  chartCanvas.addEventListener("mouseleave", hideTooltip);
  chartCanvas.addEventListener("touchstart", handleMove, { passive: true });
  chartCanvas.addEventListener("touchmove", handleMove, { passive: true });
  chartCanvas.addEventListener("touchend", hideTooltip);
}

function attachUiEvents() {
  document.querySelector("#mode-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    chartMode.current = button.dataset.mode;
    document.querySelectorAll(".toggle-group__button").forEach((node) => {
      node.classList.toggle("is-active", node === button);
    });
    render();
  });

  window.addEventListener("resize", () => drawMainChart());
}

function render() {
  renderMeta();
  renderCards();
  renderActiveSeries();
  renderLegend();
  renderDetails();
  drawMainChart();
}

async function refreshData() {
  const payload = await loadSeries();
  state.series = payload.series;
  state.sourceLabel = payload.sourceLabel;
  state.syncStatus = payload.syncStatus;
  state.updatedAt = payload.updatedAt;

  if (!getSeriesByCode(focusCode.current)) {
    focusCode.current = state.series[0]?.code || "USD";
  }

  render();
}

async function init() {
  await refreshData();
  attachChartEvents();
  attachUiEvents();
  window.setInterval(refreshData, runtimeConfig.refreshMs);
}

init();
