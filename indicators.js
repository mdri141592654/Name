// indicators.js
// Berechnung von Indikatoren + Scan-Engine fuer den Signal-Backtester.
// Neue Indikatoren hinzufuegen: einfach ein neues Objekt in INDICATOR_REGISTRY
// ergaenzen (siehe bestehende Eintraege als Vorlage). Die UI baut sich daraus
// automatisch zusammen (app.js liest params/valueType/categories aus).

// ---------------------------------------------------------------------------
// Grundbausteine
// ---------------------------------------------------------------------------

/** Einfacher EMA auf einer vollstaendigen (lueckenlosen) Zahlenreihe. */
function ema(values, period) {
  const n = values.length;
  const result = new Array(n).fill(null);
  if (n < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/** EMA auf einer Reihe, die am Anfang `null`-Werte enthalten darf. */
function emaSkipLeadingNulls(values, period) {
  const n = values.length;
  const result = new Array(n).fill(null);
  const start = values.findIndex((v) => v !== null && v !== undefined);
  if (start === -1 || n - start < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i];
  let prev = sum / period;
  result[start + period - 1] = prev;
  for (let i = start + period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

function rollingHighLow(highs, lows, period) {
  const n = highs.length;
  const hh = new Array(n).fill(null);
  const ll = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > h) h = highs[j];
      if (lows[j] < l) l = lows[j];
    }
    hh[i] = h;
    ll[i] = l;
  }
  return { hh, ll };
}

// ---------------------------------------------------------------------------
// Indikatoren
// ---------------------------------------------------------------------------

function calcRSI(bars, { period = 14 } = {}) {
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  if (n < period + 1) return result;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcSMI(bars, { kPeriod = 10, d1 = 3, d2 = 3 } = {}) {
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const { hh, ll } = rollingHighLow(highs, lows, kPeriod);

  const diff = new Array(n).fill(null);
  const range = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hh[i] === null) continue;
    diff[i] = closes[i] - (hh[i] + ll[i]) / 2;
    range[i] = hh[i] - ll[i];
  }

  const smoothDiff = emaSkipLeadingNulls(emaSkipLeadingNulls(diff, d1), d2);
  const smoothRange = emaSkipLeadingNulls(emaSkipLeadingNulls(range, d1), d2);

  const result = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smoothDiff[i] === null || !smoothRange[i]) continue;
    result[i] = (100 * smoothDiff[i]) / (0.5 * smoothRange[i]);
  }
  return result;
}

function calcRegime(bars, { emaFast = 50, emaSlow = 200 } = {}) {
  const closes = bars.map((b) => b.c);
  const fast = ema(closes, emaFast);
  const slow = ema(closes, emaSlow);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fast[i] === null || slow[i] === null) continue;
    if (closes[i] > slow[i] && fast[i] > slow[i]) result[i] = "bull";
    else if (closes[i] < slow[i] && fast[i] < slow[i]) result[i] = "bear";
    else result[i] = "neutral";
  }
  return result;
}

// ---------------------------------------------------------------------------
// Registry: hier neue Indikatoren ergaenzen
// ---------------------------------------------------------------------------

export const INDICATOR_REGISTRY = {
  regime: {
    id: "regime",
    label: "Regime (Trend)",
    description: "Bull/Bear/Neutral anhand zweier EMAs.",
    valueType: "category",
    categories: [
      { value: "bull", label: "Bull" },
      { value: "neutral", label: "Neutral" },
      { value: "bear", label: "Bear" },
    ],
    params: [
      { key: "emaFast", label: "EMA schnell", type: "number", default: 50, min: 2, max: 400 },
      { key: "emaSlow", label: "EMA langsam", type: "number", default: 200, min: 2, max: 400 },
    ],
    compute: calcRegime,
  },
  rsi: {
    id: "rsi",
    label: "RSI",
    description: "Relative Strength Index (Wilder).",
    valueType: "numeric",
    range: [0, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcRSI,
  },
  smi: {
    id: "smi",
    label: "SMI (Stochastic Momentum Index)",
    description: "Momentum-Oszillator nach W. Blau, Wertebereich ca. -100 bis +100.",
    valueType: "numeric",
    range: [-100, 100],
    params: [
      { key: "kPeriod", label: "%K Periode", type: "number", default: 10, min: 2, max: 100 },
      { key: "d1", label: "EMA 1", type: "number", default: 3, min: 1, max: 50 },
      { key: "d2", label: "EMA 2", type: "number", default: 3, min: 1, max: 50 },
    ],
    compute: calcSMI,
  },
};

// ---------------------------------------------------------------------------
// Condition-Auswertung
// ---------------------------------------------------------------------------

export function evalCondition(value, condition) {
  if (value === null || value === undefined) return false;
  switch (condition.op) {
    case "eq":
      return value === condition.value;
    case "gte":
      return value >= condition.value;
    case "lte":
      return value <= condition.value;
    case "gt":
      return value > condition.value;
    case "lt":
      return value < condition.value;
    case "between":
      return value >= condition.value && value <= condition.value2;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Scan-Engine
// ---------------------------------------------------------------------------

/**
 * @param {Array} bars  [{t,o,h,l,c}, ...] aufsteigend sortiert
 * @param {Array} indicatorConfigs  [{id, params, condition}, ...]
 * @param {number} forwardSteps  Anzahl Kerzen fuer die Prognose (Default 20)
 */
export function runScan(bars, indicatorConfigs, forwardSteps = 20) {
  const closes = bars.map((b) => b.c);
  const n = bars.length;

  const seriesList = indicatorConfigs.map((cfg) => {
    const def = INDICATOR_REGISTRY[cfg.id];
    return def.compute(bars, cfg.params);
  });

  const matchIdx = [];
  for (let i = 0; i < n; i++) {
    let allOk = true;
    for (let k = 0; k < indicatorConfigs.length; k++) {
      if (!evalCondition(seriesList[k][i], indicatorConfigs[k].condition)) {
        allOk = false;
        break;
      }
    }
    if (allOk) matchIdx.push(i);
  }

  const complete = matchIdx.filter((i) => i + forwardSteps < n);
  const open = matchIdx.filter((i) => i + forwardSteps >= n);

  const sums = new Array(forwardSteps + 1).fill(0);
  const sumsSq = new Array(forwardSteps + 1).fill(0);
  const paths = []; // fuer "Ghost"-Linien im Chart (alle Einzelpfade)

  for (const i of complete) {
    const base = closes[i];
    const path = [0];
    for (let s = 1; s <= forwardSteps; s++) {
      const ret = ((closes[i + s] - base) / base) * 100;
      sums[s] += ret;
      sumsSq[s] += ret * ret;
      path.push(ret);
    }
    paths.push(path);
  }

  const count = complete.length;
  const avgPath = sums.map((s) => (count > 0 ? s / count : null));
  const stdPath = sumsSq.map((sq, s) =>
    count > 0 ? Math.sqrt(Math.max(sq / count - avgPath[s] * avgPath[s], 0)) : null
  );

  let winRate = null;
  if (count > 0) {
    const wins = complete.filter((i) => closes[i + forwardSteps] > closes[i]).length;
    winRate = (wins / count) * 100;
  }

  return {
    totalBars: n,
    sampleSize: count,
    avgPath, // Index 0..forwardSteps, avgPath[0] = 0
    stdPath,
    winRate,
    paths, // fuer Ghost-Visualisierung (kann gross sein, App begrenzt das selbst)
    matchDates: complete.map((i) => bars[i].t),
    openSignals: open.map((i) => bars[i].t), // Treffer ohne vollstaendige 20er-Forward-Historie
  };
}
