// app.js
import { INDICATOR_REGISTRY, runScan } from "./indicators.js";
import { drawForwardChart } from "./chart.js";

const symbolSelect = document.getElementById("symbolSelect");
const timeframeSelect = document.getElementById("timeframeSelect");
const dataMeta = document.getElementById("dataMeta");
const dataGenerated = document.getElementById("dataGenerated");
const forwardStepsInput = document.getElementById("forwardSteps");
const conditionsList = document.getElementById("conditionsList");
const addConditionBtn = document.getElementById("addConditionBtn");
const scanBtn = document.getElementById("scanBtn");
const statusMsg = document.getElementById("statusMsg");
const resultsPanel = document.getElementById("resultsPanel");
const rowTemplate = document.getElementById("conditionRowTemplate");

const TIMEFRAME_LABELS = { "1d": "1 Tag", "1h": "1 Stunde", "5m": "5 Minuten" };

let manifest = null;
let barsCache = new Map(); // "SYMBOL_TF" -> bars array
let rowCounter = 0;

const OPERATORS_NUMERIC = [
  { value: "gte", label: "≥ größer/gleich" },
  { value: "lte", label: "≤ kleiner/gleich" },
  { value: "gt", label: "> größer" },
  { value: "lt", label: "< kleiner" },
  { value: "between", label: "zwischen" },
];

// --------------------------------------------------------------- Init

async function init() {
  try {
    const res = await fetch("data/manifest.json", { cache: "no-store" });
    manifest = await res.json();
  } catch (e) {
    manifest = { symbols: {}, generated_at: null };
  }

  const symbols = Object.keys(manifest.symbols || {});
  if (symbols.length === 0) {
    showEmptyDataWarning();
    return;
  }

  dataGenerated.textContent = manifest.generated_at
    ? "Daten aktualisiert: " + formatTimestamp(manifest.generated_at)
    : "";

  symbolSelect.innerHTML = symbols.map((s) => `<option value="${s}">${s}</option>`).join("");
  symbolSelect.addEventListener("change", refreshTimeframeOptions);
  timeframeSelect.addEventListener("change", updateDataMeta);
  refreshTimeframeOptions();

  addConditionBtn.addEventListener("click", () => addConditionRow());
  scanBtn.addEventListener("click", handleScan);

  addConditionRow("regime");
}

function showEmptyDataWarning() {
  resultsPanel.innerHTML = `
    <div class="empty-state">
      <p><strong>Noch keine Kursdaten vorhanden.</strong></p>
      <p class="empty-state-sub">
        Im GitHub-Repo unter <em>Actions → Update market data → Run workflow</em>
        einmal manuell starten. Danach lädt diese Seite die Daten automatisch.
      </p>
    </div>`;
  scanBtn.disabled = true;
  addConditionBtn.disabled = true;
}

function refreshTimeframeOptions() {
  const sym = symbolSelect.value;
  const tfs = Object.keys(manifest.symbols[sym]?.timeframes || {});
  const order = ["1d", "1h", "5m"];
  const sorted = order.filter((tf) => tfs.includes(tf));
  timeframeSelect.innerHTML = sorted
    .map((tf) => `<option value="${tf}">${TIMEFRAME_LABELS[tf] || tf}</option>`)
    .join("");
  updateDataMeta();
}

function updateDataMeta() {
  const sym = symbolSelect.value;
  const tf = timeframeSelect.value;
  const info = manifest.symbols[sym]?.timeframes?.[tf];
  if (!info) { dataMeta.textContent = ""; return; }
  dataMeta.textContent = `${info.bars.toLocaleString("de-DE")} Kerzen · ${formatTimestamp(info.from)} – ${formatTimestamp(info.to)}`;
}

// ------------------------------------------------------ Condition rows

function addConditionRow(defaultIndicatorId) {
  rowCounter += 1;
  const id = "row" + rowCounter;
  const node = rowTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.rowId = id;

  const indicatorSelect = node.querySelector(".indicator-select");
  indicatorSelect.innerHTML = Object.values(INDICATOR_REGISTRY)
    .map((def) => `<option value="${def.id}">${def.label}</option>`)
    .join("");
  indicatorSelect.value = defaultIndicatorId || Object.keys(INDICATOR_REGISTRY)[0];

  indicatorSelect.addEventListener("change", () => renderRowBody(node));
  node.querySelector(".remove-btn").addEventListener("click", () => node.remove());

  conditionsList.appendChild(node);
  renderRowBody(node);
}

function renderRowBody(node) {
  const indicatorId = node.querySelector(".indicator-select").value;
  const def = INDICATOR_REGISTRY[indicatorId];

  const paramsRow = node.querySelector(".params-row");
  paramsRow.innerHTML = def.params
    .map(
      (p) => `
      <div class="param-field">
        <label>${p.label}</label>
        <input type="number" class="param-input" data-key="${p.key}"
               value="${p.default}" min="${p.min}" max="${p.max}" step="1" />
      </div>`
    )
    .join("");

  const conditionControl = node.querySelector(".condition-control");
  if (def.valueType === "category") {
    conditionControl.innerHTML = `
      <div>
        <label>Bedingung</label>
        <select class="cond-category">
          ${def.categories.map((c) => `<option value="${c.value}">ist ${c.label}</option>`).join("")}
        </select>
      </div>`;
  } else {
    conditionControl.innerHTML = `
      <div>
        <label>Vergleich</label>
        <select class="cond-op">
          ${OPERATORS_NUMERIC.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Wert</label>
        <input type="number" class="cond-value" step="0.1" value="0" />
      </div>
      <div class="cond-value2-wrap" style="display:none">
        <label>bis</label>
        <input type="number" class="cond-value2" step="0.1" value="0" />
      </div>`;
    const opSelect = conditionControl.querySelector(".cond-op");
    const value2Wrap = conditionControl.querySelector(".cond-value2-wrap");
    opSelect.addEventListener("change", () => {
      value2Wrap.style.display = opSelect.value === "between" ? "" : "none";
    });
  }
}

function readConditionRows() {
  const rows = Array.from(conditionsList.querySelectorAll(".condition-row"));
  return rows.map((node) => {
    const indicatorId = node.querySelector(".indicator-select").value;
    const def = INDICATOR_REGISTRY[indicatorId];
    const params = {};
    node.querySelectorAll(".param-input").forEach((inp) => {
      params[inp.dataset.key] = Number(inp.value);
    });

    let condition;
    if (def.valueType === "category") {
      condition = { op: "eq", value: node.querySelector(".cond-category").value };
    } else {
      const op = node.querySelector(".cond-op").value;
      const value = Number(node.querySelector(".cond-value").value);
      const value2 = Number(node.querySelector(".cond-value2")?.value ?? 0);
      condition = { op, value, value2 };
    }
    return { id: indicatorId, params, condition };
  });
}

// -------------------------------------------------------------- Scan

async function getBars(symbol, timeframe) {
  const key = symbol + "_" + timeframe;
  if (barsCache.has(key)) return barsCache.get(key);
  const res = await fetch(`data/${key}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error("Daten konnten nicht geladen werden (" + res.status + ")");
  const bars = await res.json();
  barsCache.set(key, bars);
  return bars;
}

async function handleScan() {
  const symbol = symbolSelect.value;
  const timeframe = timeframeSelect.value;
  const forwardSteps = Math.max(1, Number(forwardStepsInput.value) || 20);
  const indicatorConfigs = readConditionRows();

  if (indicatorConfigs.length === 0) {
    setStatus("Mindestens einen Indikator hinzufügen.", true);
    return;
  }

  setStatus("Lade Daten und scanne …", false);
  scanBtn.disabled = true;
  try {
    const bars = await getBars(symbol, timeframe);
    if (!bars || bars.length < forwardSteps + 20) {
      setStatus("Zu wenig historische Daten für diesen Zeitraum.", true);
      return;
    }
    const result = runScan(bars, indicatorConfigs, forwardSteps);
    renderResults(result, forwardSteps, timeframe, symbol);
    setStatus(`Fertig: ${result.sampleSize} Treffer in ${result.totalBars.toLocaleString("de-DE")} Kerzen.`, false);
  } catch (e) {
    console.error(e);
    setStatus("Fehler: " + e.message, true);
  } finally {
    scanBtn.disabled = false;
  }
}

function setStatus(text, isError) {
  statusMsg.textContent = text;
  statusMsg.classList.toggle("error", !!isError);
}

// ---------------------------------------------------------- Rendering

function renderResults(result, forwardSteps, timeframe, symbol) {
  const final = result.avgPath[forwardSteps];
  const finalClass = final > 0.02 ? "positive" : final < -0.02 ? "negative" : "";

  resultsPanel.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Treffer</div>
        <div class="stat-value">${result.sampleSize}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Ø Return nach ${forwardSteps} Kerzen</div>
        <div class="stat-value ${finalClass}">${formatPct(final)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Trefferquote (positiv)</div>
        <div class="stat-value">${result.winRate !== null ? result.winRate.toFixed(1) + "%" : "–"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Offene Signale</div>
        <div class="stat-value">${result.openSignals.length}</div>
      </div>
    </div>

    <div class="chart-wrap">
      <canvas id="forwardChart"></canvas>
      <p class="chart-caption">
        Durchschnittlicher %-Kursverlauf nach Signal (dicke Linie) · jede dünne Linie ist ein einzelner historischer Treffer · Band = ±1 Std.-Abw.
      </p>
    </div>

    <div class="signals-section">
      <h3>Letzte Trefferdaten (${symbol}, ${TIMEFRAME_LABELS[timeframe] || timeframe})</h3>
      <div class="signals-list">${formatSignalsList(result)}</div>
    </div>
  `;

  const canvas = document.getElementById("forwardChart");
  drawForwardChart(canvas, result, forwardSteps);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => drawForwardChart(canvas, result, forwardSteps), 120);
  });
}

function formatSignalsList(result) {
  const allDates = [...result.matchDates.map((t) => [t, false]), ...result.openSignals.map((t) => [t, true])];
  allDates.sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const shown = allDates.slice(0, 60);
  if (shown.length === 0) return "Keine Treffer.";
  return shown
    .map(([t, open]) => formatTimestamp(t) + (open ? '<span class="open-tag">offen (noch keine 20 Kerzen danach)</span>' : ""))
    .join("<br/>");
}

function formatPct(v) {
  if (v === null || v === undefined) return "–";
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(2) + "%";
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

init();
