const defaultCurrencyConfigs = [
  { code: "USD", name: "미국 달러", unitLabel: "1달러", color: "#c55a11" },
  { code: "JPY", name: "일본 엔", unitLabel: "100엔", color: "#0f7b85", scale: 100 },
  { code: "PHP", name: "필리핀 페소", unitLabel: "1페소", color: "#2d8f4e" },
  { code: "IDR", name: "인도네시아 루피아", unitLabel: "100루피아", color: "#8b5a2b", scale: 100 },
  { code: "AUD", name: "호주 달러" },
  { code: "CAD", name: "캐나다 달러" },
  { code: "CHF", name: "스위스 프랑" },
  { code: "CNY", name: "중국 위안" },
  { code: "EUR", name: "유로" },
  { code: "GBP", name: "영국 파운드" },
  { code: "HKD", name: "홍콩 달러" },
  { code: "NZD", name: "뉴질랜드 달러" },
  { code: "SGD", name: "싱가포르 달러" },
  { code: "THB", name: "태국 바트" },
];
const currencyConfigMap = new Map(
  defaultCurrencyConfigs.map((config) => [config.code, config])
);
const palette = [
  "#c55a11",
  "#0f7b85",
  "#2d8f4e",
  "#8b5a2b",
  "#a33b5e",
  "#355c7d",
  "#d08c00",
  "#6c5b7b",
  "#1f7a4f",
  "#9c6644",
];
const currencyDisplayNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames !== "undefined"
    ? new Intl.DisplayNames(["ko-KR"], { type: "currency" })
    : null;

const runtimeConfig = {
  refreshMs: 60 * 1000,
  exchangerateHostAccessKey: "",
  ...window.FX_DASHBOARD_CONFIG,
};
const isBundledApp = window.location.protocol === "app-assets:";

function buildApiUrl(providerPath) {
  if (isBundledApp) {
    return `app-assets://dashboard/api/${providerPath}`;
  }

  if (providerPath.startsWith("frankfurter/")) {
    return `https://api.frankfurter.dev/v1/${providerPath.replace("frankfurter/", "")}`;
  }

  if (providerPath.startsWith("exchangerate/")) {
    return `https://api.exchangerate.host/${providerPath.replace("exchangerate/", "")}`;
  }

  throw new Error(`Unknown provider path: ${providerPath}`);
}

const compareCodes = new Set(["USD", "JPY", "PHP", "IDR"]);
const focusCode = { current: "USD" };
const chartMode = { current: "indexed" };
const calculatorDirection = { current: "to-krw" };
const COOKIE_NAME = "favorite_cards_v1";
const state = {
  currencies: [],
  series: [],
  favoriteCodes: [],
  updatedAt: new Date(),
};

const cardsRoot = document.querySelector("#summary-cards");
const favoritesSelectNode = document.querySelector("#favorites-select");
const favoritesAddNode = document.querySelector("#favorites-add");
const favoritesMessageNode = document.querySelector("#favorites-message");
const activeSeriesRoot = document.querySelector("#active-series");
const accordionRoot = document.querySelector("#details-accordion");
const tableRoot = document.querySelector("#details-table-body");
const chartCanvas = document.querySelector("#main-chart");
const tooltip = document.querySelector("#chart-tooltip");
const updatedAtNode = document.querySelector("#updated-at");
const calculatorAmountNode = document.querySelector("#calculator-amount");
const calculatorAmountLabelNode = document.querySelector("#calculator-amount-label");
const calculatorDirectionNode = document.querySelector("#calculator-direction");
const calculatorResultLabelNode = document.querySelector("#calculator-result-label");
const calculatorSelectedCurrencyNode = document.querySelector("#calculator-selected-currency");
const calculatorResultNode = document.querySelector("#calculator-result");
const calculatorRateNode = document.querySelector("#calculator-rate");

const dataStatus = {
  level: "ok",
  message: "",
};
const chartStatus = {
  message: "",
};
function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getCookie(name) {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
}

function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getDefaultFavoriteCodes() {
  return defaultCurrencyConfigs.slice(0, 4).map((config) => config.code);
}

function loadFavoriteCodes() {
  try {
    const raw = getCookie(COOKIE_NAME);
    if (!raw) return getDefaultFavoriteCodes();
    const parsed = JSON.parse(raw);
    const valid = parsed.filter((code) => state.currencies.some((config) => config.code === code));
    return valid.length ? valid.slice(0, 4) : getDefaultFavoriteCodes();
  } catch {
    return getDefaultFavoriteCodes();
  }
}

function saveFavoriteCodes() {
  setCookie(COOKIE_NAME, JSON.stringify(state.favoriteCodes.slice(0, 4)));
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

function isNetworkError(error) {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = String(error.message || error);
  return /Failed to fetch|Load failed|NetworkError|network/i.test(message);
}

function formatAxisValue(value) {
  if (chartMode.current === "indexed") {
    const diff = value - 100;
    const rounded = Math.round(diff);
    const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : " ";
    return `${sign}${Math.abs(rounded)}%`;
  }

  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function isCompactMobile() {
  return window.innerWidth <= 640;
}

function normalizeCurrencyValue(code, krwPerUnit) {
  const digits = code === "PHP" ? 3 : 2;
  return Number(krwPerUnit.toFixed(digits));
}

function getCurrencyConfig(code) {
  return state.currencies.find((config) => config.code === code);
}

function buildCurrencyConfig(code, name, index) {
  const override = currencyConfigMap.get(code);
  const translatedName = currencyDisplayNames?.of(code);
  return {
    code,
    name: override?.name || translatedName || name,
    unitLabel: override?.unitLabel || `1${code}`,
    color: override?.color || palette[index % palette.length],
    scale: override?.scale || 1,
  };
}

function computeKrwPerUnitFromUsdQuotes(quotes) {
  const usdToKrw = quotes.USDKRW;
  if (!usdToKrw) throw new Error("USDKRW quote is missing");

  return state.currencies.reduce((accumulator, config) => {
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

async function fetchCurrencyList() {
  const response = await fetch(buildApiUrl("frankfurter/currencies"));
  if (!response.ok) {
    throw new Error(`Frankfurter currencies request failed: ${response.status}`);
  }

  const payload = await response.json();
  const supportedCodes = Object.keys(payload)
    .filter((code) => code !== "KRW")
    .sort();

  const orderedCodes = supportedCodes;

  return orderedCodes.map((code, index) => buildCurrencyConfig(code, payload[code], index));
}

async function fetchFrankfurterHistory() {
  const start = formatDateKey(getHistoryStartDate());
  const end = formatDateKey(getHistoryEndDate());
  const url = buildApiUrl(`frankfurter/${start}..${end}?base=USD`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Frankfurter history request failed: ${response.status}`);
  }

  const payload = await response.json();
  const dateKeys = Object.keys(payload.rates || {}).sort();
  if (dateKeys.length < 15) {
    throw new Error("Not enough history points from Frankfurter");
  }

  const series = state.currencies.map((config) => ({
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

  const symbols = state.currencies.map((config) => config.code).join(",");
  const url = buildApiUrl(
    `exchangerate/live?access_key=${encodeURIComponent(
      runtimeConfig.exchangerateHostAccessKey
    )}&currencies=${symbols}`
  );
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
  const baselines = { USD: 1452, JPY: 973, PHP: 25.4, IDR: 8.9 };

  return state.currencies.map((config, configIndex) => ({
    ...config,
    points: Array.from({ length: 90 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (89 - index));
      const baseline = baselines[config.code] || (40 + configIndex * 6);
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
    if (!state.currencies.length) {
      state.currencies = await fetchCurrencyList();
    }
    const history = await fetchFrankfurterHistory();
    let mergedSeries = history.series;
    let updatedAt = history.updatedAt;

    try {
      const liveSnapshot = await fetchExchangerateHostLive();
      if (liveSnapshot) {
        mergedSeries = mergeLivePoint(history.series, liveSnapshot);
        updatedAt = liveSnapshot.updatedAt;
      }
    } catch (liveError) {
      console.warn(liveError);
      dataStatus.level = "warning";
      dataStatus.message =
        "실시간 시세 연결에 실패해 최근 수집 데이터로 표시 중입니다.";
    }

    if (dataStatus.level === "ok") {
      dataStatus.message = "";
    }
    return { series: mergedSeries, updatedAt };
  } catch (historyError) {
    console.warn(historyError);
    if (!state.currencies.length) {
      state.currencies = defaultCurrencyConfigs;
    }

    const message = isNetworkError(historyError)
      ? "네트워크에 연결되어 있지 않아 환율 데이터를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요."
      : "환율 데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

    dataStatus.level = "error";
    dataStatus.message = message;

    return {
      series: state.series.length ? state.series : [],
      updatedAt: state.updatedAt || new Date(),
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
  updatedAtNode.textContent = state.series.length ? formatUpdatedAt(state.updatedAt) : "-";
}

function renderStatus() {
  return;
}

function renderChartEmptyState() {
  const hasData = state.series.length > 0;
  const hasChartMessage = Boolean(chartStatus.message);
  chartCanvas.hidden = !hasData || hasChartMessage;
}

function renderCards() {
  cardsRoot.innerHTML = "";

  state.favoriteCodes
    .map((code) => getSeriesByCode(code))
    .filter(Boolean)
    .forEach((series, index) => {
    const stats = computeStats(series);
    const isFocused = focusCode.current === series.code;
    const card = document.createElement("article");
    card.className = `summary-card${isFocused ? " is-emphasized" : ""}`;
    card.dataset.code = series.code;
    const directionClass = stats.changeRate >= 0 ? "is-up" : "is-down";

    card.innerHTML = `
      <div class="summary-card__top">
        <div>
          <div class="summary-card__code">${series.code}/KRW</div>
          <div class="summary-card__name">${series.name}</div>
        </div>
        <div class="summary-card__actions">
          ${
            index === 0
              ? ""
              : '<button class="summary-card__icon-button" type="button" data-action="priority-left">←</button>'
          }
          ${
            index === state.favoriteCodes.length - 1
              ? ""
              : '<button class="summary-card__icon-button" type="button" data-action="priority-right">→</button>'
          }
          <button class="summary-card__icon-button" type="button" data-action="remove">×</button>
        </div>
      </div>
      <div class="summary-card__price-row">
        <div class="summary-card__price">${formatNumber(stats.current, series.code)}</div>
        <span class="metric ${directionClass}">${stats.trend}</span>
      </div>
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

    const priorityLeftButton = card.querySelector('[data-action="priority-left"]');
    if (priorityLeftButton) {
      priorityLeftButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (index === 0) return;
        const reordered = [...state.favoriteCodes];
        [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
        state.favoriteCodes = reordered;
        saveFavoriteCodes();
        render();
      });
    }

    const priorityRightButton = card.querySelector('[data-action="priority-right"]');
    if (priorityRightButton) {
      priorityRightButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (index >= state.favoriteCodes.length - 1) return;
        const reordered = [...state.favoriteCodes];
        [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
        state.favoriteCodes = reordered;
        saveFavoriteCodes();
        render();
      });
    }

    card.querySelector('[data-action="remove"]').addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.favoriteCodes.length === 1) return;
      state.favoriteCodes = state.favoriteCodes.filter((code) => code !== series.code);
      saveFavoriteCodes();
      render();
    });

    cardsRoot.appendChild(card);
    });

  cardsRoot.querySelectorAll(".sparkline").forEach((canvas) => {
    drawSparkline(canvas, getSeriesByCode(canvas.dataset.code));
  });
}

function renderFavoritesToolbar() {
  const availableConfigs = state.currencies.filter((config) => !state.favoriteCodes.includes(config.code));
  favoritesSelectNode.innerHTML = "";

  if (availableConfigs.length) {
    availableConfigs.forEach((config) => {
      const option = document.createElement("option");
      option.value = config.code;
      option.textContent = `${config.code} / ${config.name}`;
      favoritesSelectNode.appendChild(option);
    });
  } else {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "추가 가능한 통화 없음";
    favoritesSelectNode.appendChild(option);
  }
  favoritesAddNode.disabled = availableConfigs.length === 0;
}

function showFavoritesMessage(message) {
  favoritesMessageNode.textContent = message;
  favoritesMessageNode.hidden = !message;
}

function scrollSummaryCardIntoView(code) {
  const card = cardsRoot.querySelector(`[data-code="${code}"]`);
  if (!card) return;
  card.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center",
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
    const stats = computeStats(series);
    const rateText = formatRate(stats.changeRate);
    const chip = document.createElement("div");
    chip.className = "active-series__chip";
    chip.innerHTML = `
      <span class="active-series__dot" style="background:${series.color}"></span>
      <span>${series.code}/KRW</span>
      ${
        chartMode.current === "indexed"
          ? `<strong class="active-series__value">${rateText}</strong>`
          : ""
      }
    `;
    activeSeriesRoot.appendChild(chip);
  });
}

function renderCalculator() {
  updateCalculator();
}

function updateCalculator() {
  const selectedCode = focusCode.current;
  const selectedSeries = getSeriesByCode(selectedCode);
  if (!selectedSeries) {
    calculatorSelectedCurrencyNode.textContent = "-";
    calculatorResultNode.textContent = "-";
    calculatorRateNode.textContent = "-";
    return;
  }

  const amount = Number(calculatorAmountNode.value || 0);
  const currentRate = computeStats(selectedSeries).current;
  calculatorSelectedCurrencyNode.textContent = `${selectedSeries.code}/KRW`;

  if (calculatorDirection.current === "to-krw") {
    const krwValue = amount * currentRate;
    calculatorAmountLabelNode.textContent = `${selectedSeries.code} 금액`;
    calculatorResultLabelNode.textContent = "원화 환산";
    calculatorResultNode.textContent = `${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 0,
    }).format(krwValue)} KRW`;
    calculatorRateNode.textContent = `${selectedSeries.unitLabel} = ${formatNumber(currentRate, selectedSeries.code)} KRW`;
  } else {
    const foreignValue = currentRate ? amount / currentRate : 0;
    calculatorAmountLabelNode.textContent = "원화 금액";
    calculatorResultLabelNode.textContent = `${selectedSeries.code} 환산`;
    calculatorResultNode.textContent = `${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 3,
    }).format(foreignValue)} ${selectedSeries.code}`;
    calculatorRateNode.textContent = `1 KRW = ${(1 / currentRate).toFixed(6)} ${selectedSeries.code}`;
  }
}

function renderDetails() {
  accordionRoot.innerHTML = "";
  tableRoot.innerHTML = "";

  state.favoriteCodes
    .map((code) => getSeriesByCode(code))
    .filter(Boolean)
    .forEach((series, index) => {
    const stats = computeStats(series);
    const directionClass = stats.changeRate >= 0 ? "is-up" : "is-down";
    const isSelected =
      focusCode.current === series.code ||
      (index === 0 && !state.favoriteCodes.includes(focusCode.current));

    const details = document.createElement("details");
    details.className = `accordion-item${isSelected ? " is-selected" : ""}`;
    details.open = isSelected;
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

    details.querySelector("summary").addEventListener("click", (event) => {
      event.preventDefault();
      if (focusCode.current === series.code) return;
      focusCode.current = series.code;
      render();
      window.requestAnimationFrame(() => {
        scrollSummaryCardIntoView(series.code);
      });
    });

    accordionRoot.appendChild(details);

    const row = document.createElement("tr");
    row.className = isSelected ? "details-table__row is-selected" : "details-table__row";
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
  if (!visibleSeries.length) {
    chartStatus.message = "표시할 차트 데이터가 없습니다.";
    return false;
  }

  const ctx = chartCanvas.getContext("2d");
  if (!ctx) {
    chartStatus.message = "이 기기에서 차트를 그리지 못했습니다.";
    return false;
  }
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.round(
    chartCanvas.getBoundingClientRect().width ||
      chartCanvas.clientWidth ||
      chartCanvas.parentElement?.clientWidth ||
      0
  );
  const cssHeight = Math.max(202, Math.min(291, Math.round(window.innerHeight * 0.2464)));
  if (cssWidth < 120) {
    window.requestAnimationFrame(() => {
      if (!chartCanvas.hidden) {
        drawMainChart(activeIndex);
      }
    });
    return false;
  }
  chartCanvas.width = cssWidth * dpr;
  chartCanvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = cssWidth;
  const height = cssHeight;
  const padding = { top: 20, right: 16, bottom: 38, left: 12 };
  const innerWidth = Math.max(1, width - padding.left - padding.right);
  const innerHeight = Math.max(1, height - padding.top - padding.bottom);
  const pointCount = visibleSeries[0].points.length;
  if (!pointCount) {
    chartStatus.message = "차트 포인트가 없어 그래프를 표시할 수 없습니다.";
    return false;
  }
  const xDivisor = Math.max(1, pointCount - 1);
  const values = visibleSeries.flatMap((series) =>
    series.points.map((_, index) => getDisplayValue(series, index))
  );
  let min = Math.min(...values);
  let max = Math.max(...values);

  // In compare mode, keep the chart symmetric around 0% so gains/losses are visually balanced.
  if (chartMode.current === "indexed") {
    const maxAbsDiff = Math.max(Math.abs(max - 100), Math.abs(min - 100));
    min = 100 - maxAbsDiff;
    max = 100 + maxAbsDiff;
  }

  const range = max - min || 1;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(92, 72, 38, 0.12)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(103, 87, 70, 0.82)";
  ctx.font = '11px "Nanum Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  ctx.textAlign = "left";

  if (chartMode.current === "indexed") {
    const minPercent = Math.round(min - 100);
    const maxPercent = Math.round(max - 100);

    for (let percent = minPercent; percent <= maxPercent; percent += 1) {
      const axisValue = 100 + percent;
      const y = padding.top + innerHeight - ((axisValue - min) / range) * innerHeight;
      ctx.strokeStyle = percent === 0 ? "rgba(197, 90, 17, 0.35)" : "rgba(92, 72, 38, 0.12)";
      ctx.lineWidth = percent === 0 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      ctx.fillStyle = percent === 0 ? "rgba(197, 90, 17, 0.9)" : "rgba(103, 87, 70, 0.82)";
      ctx.fillText(formatAxisValue(axisValue), padding.left + 6, y - 6);
    }
  } else {
    for (let i = 0; i < 4; i += 1) {
      const y = padding.top + (innerHeight / 3) * i;
      const axisValue = max - (range / 3) * i;
      ctx.strokeStyle = "rgba(92, 72, 38, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(103, 87, 70, 0.82)";
      ctx.fillText(formatAxisValue(axisValue), padding.left + 6, y - (i === 0 ? -12 : 6));
    }
  }

  ctx.fillStyle = "#7d6b58";
  ctx.font = '12px "Nanum Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  ctx.textAlign = "left";

  const firstDate = visibleSeries[0].points[0].date;
  const middleDate = visibleSeries[0].points[Math.floor((pointCount - 1) / 2)].date;
  const lastDate = visibleSeries[0].points[pointCount - 1].date;

  // Weekly guide lines on the time axis.
  for (let index = 0; index < pointCount; index += 7) {
    const x = padding.left + (index / xDivisor) * innerWidth;
    ctx.strokeStyle = "rgba(92, 72, 38, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
  }

  [firstDate, middleDate, lastDate].forEach((date, index) => {
    const x = padding.left + (innerWidth / 2) * index;
    ctx.fillText(formatDate(date), x, height - 12);
  });

  visibleSeries.forEach((series) => {
    ctx.beginPath();
    ctx.lineWidth = focusCode.current === series.code ? 3.15 : 2.1;
    ctx.strokeStyle = series.color;
    ctx.globalAlpha = focusCode.current === series.code ? 1 : 0.3;

    series.points.forEach((point, index) => {
      const value = getDisplayValue(series, index);
      const x = padding.left + (index / xDivisor) * innerWidth;
      const y = padding.top + innerHeight - ((value - min) / range) * innerHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  ctx.globalAlpha = 1;

  if (activeIndex !== null) {
    const x = padding.left + (activeIndex / xDivisor) * innerWidth;
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
  chartStatus.message = "";
  return true;
}

function showTooltip(pointIndex, clientX, clientY) {
  const visibleSeries = getChartSeries();
  if (!visibleSeries.length || pointIndex < 0 || pointIndex >= visibleSeries[0].points.length) return;
  const date = visibleSeries[0].points[pointIndex].date;
  const compact = isCompactMobile();
  const primarySeries =
    visibleSeries.find((series) => series.code === focusCode.current) || visibleSeries[0];

  if (compact) {
    const rawValue = primarySeries.points[pointIndex].value;
    const display =
      chartMode.current === "absolute"
        ? formatNumber(rawValue, primarySeries.code)
        : `${formatRate(getDisplayValue(primarySeries, pointIndex) - 100)}`;
    const extraCount = Math.max(0, visibleSeries.length - 1);

    tooltip.innerHTML = `
      <div class="chart-tooltip__date">${formatDate(date)}</div>
      <div class="chart-tooltip__row">
        <div><span class="chart-tooltip__swatch" style="background:${primarySeries.color}"></span>${primarySeries.code}/KRW</div>
        <strong>${display}</strong>
      </div>
      ${
        extraCount
          ? `<div class="chart-tooltip__meta">외 ${extraCount}개 통화 비교 중</div>`
          : ""
      }
    `;
  } else {
    tooltip.innerHTML = `
      <div class="chart-tooltip__date">${formatDate(date)}</div>
      ${visibleSeries
        .map((series) => {
          const rawValue = series.points[pointIndex].value;
          const display = chartMode.current === "absolute"
            ? formatNumber(rawValue, series.code)
            : formatRate(getDisplayValue(series, pointIndex) - 100);
          return `
            <div class="chart-tooltip__row">
              <div><span class="chart-tooltip__swatch" style="background:${series.color}"></span>${series.code}/KRW</div>
              <strong>${display}</strong>
            </div>
          `;
        })
        .join("")}
    `;
  }
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
    if (!innerWidth || !pointCount) return;
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

  calculatorDirectionNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-direction]");
    if (!button) return;
    calculatorDirection.current = button.dataset.direction;
    calculatorDirectionNode.querySelectorAll(".toggle-group__button").forEach((node) => {
      node.classList.toggle("is-active", node === button);
    });
    updateCalculator();
  });

  calculatorAmountNode.addEventListener("input", () => {
    updateCalculator();
  });

  favoritesAddNode.addEventListener("click", () => {
    const code = favoritesSelectNode.value;
    if (!code || state.favoriteCodes.includes(code)) return;
    if (state.favoriteCodes.length >= 4) {
      showFavoritesMessage("즐겨찾기는 최대 4개까지 등록할 수 있습니다.");
      return;
    }
    state.favoriteCodes = [...state.favoriteCodes, code];
    saveFavoriteCodes();
    showFavoritesMessage("");
    render();
  });

  window.addEventListener("resize", () => drawMainChart());
  window.addEventListener("offline", () => {
    dataStatus.level = "error";
    dataStatus.message =
      "네트워크에 연결되어 있지 않아 환율 데이터를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.";
    render();
  });
  window.addEventListener("online", () => {
    refreshData();
  });
}

function render() {
  renderStatus();
  renderMeta();
  renderFavoritesToolbar();
  renderCards();
  renderActiveSeries();
  renderCalculator();
  renderDetails();
  renderChartEmptyState();
  if (state.series.length) {
    try {
      drawMainChart();
    } catch (error) {
      console.error(error);
      chartStatus.message = "이 기기에서 차트를 렌더링하는 중 문제가 발생했습니다.";
      renderChartEmptyState();
    }
  }
}

async function refreshData() {
  dataStatus.level = "ok";
  dataStatus.message = "";
  chartStatus.message = "";
  const payload = await loadSeries();
  state.series = payload.series;
  state.updatedAt = payload.updatedAt;
  if (!state.favoriteCodes.length) {
    state.favoriteCodes = loadFavoriteCodes();
  }
  state.favoriteCodes = state.favoriteCodes.filter((code) => getSeriesByCode(code)).slice(0, 4);
  if (!state.favoriteCodes.length) {
    state.favoriteCodes = getDefaultFavoriteCodes().filter((code) => getSeriesByCode(code));
  }

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
