// chart.js
// Zeichnet den durchschnittlichen Kursverlauf nach einem Signal als
// Linienchart, mit allen Einzel-Trefferpfaden als duenne "Ghost-Lines"
// im Hintergrund (visualisiert die Streuung hinter dem Durchschnitt).

const MAX_GHOST_LINES = 180;

export function drawForwardChart(canvas, result, forwardSteps) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssHeight = 280;

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = cssHeight + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padL = 42;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  if (!result || result.sampleSize === 0) {
    ctx.fillStyle = "#8a93a3";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("Keine Treffer für diese Bedingungen.", padL, cssHeight / 2);
    return;
  }

  const { avgPath, stdPath, paths } = result;

  // Y-Range: deckt Ghost-Lines (sampled) und Avg+/-Std ab
  const sample = sampleArray(paths, MAX_GHOST_LINES);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of sample) {
    for (const v of p) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  for (let s = 0; s <= forwardSteps; s++) {
    const hi = avgPath[s] + stdPath[s];
    const lo = avgPath[s] - stdPath[s];
    if (hi > yMax) yMax = hi;
    if (lo < yMin) yMin = lo;
  }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const xToPx = (s) => padL + (s / forwardSteps) * plotW;
  const yToPx = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Gridlines + Y-Achsenbeschriftung
  ctx.strokeStyle = "#1f2630";
  ctx.fillStyle = "#8a93a3";
  ctx.font = "10px IBM Plex Mono, monospace";
  ctx.lineWidth = 1;
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const v = yMin + ((yMax - yMin) * i) / ySteps;
    const py = yToPx(v);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(cssWidth - padR, py);
    ctx.stroke();
    ctx.fillText(v.toFixed(2) + "%", 2, py + 3);
  }

  // Nulllinie hervorheben
  ctx.strokeStyle = "#3a4250";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, yToPx(0));
  ctx.lineTo(cssWidth - padR, yToPx(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // X-Achsenbeschriftung
  const xTicks = Math.min(forwardSteps, 5);
  for (let i = 0; i <= xTicks; i++) {
    const s = Math.round((forwardSteps * i) / xTicks);
    ctx.fillText("+" + s, xToPx(s) - 6, cssHeight - 6);
  }

  // Ghost-Lines (Einzelpfade)
  ctx.strokeStyle = "rgba(232, 163, 61, 0.07)";
  ctx.lineWidth = 1;
  for (const p of sample) {
    ctx.beginPath();
    for (let s = 0; s <= forwardSteps; s++) {
      const px = xToPx(s);
      const py = yToPx(p[s]);
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Std-Band um den Durchschnitt
  ctx.fillStyle = "rgba(232, 163, 61, 0.08)";
  ctx.beginPath();
  for (let s = 0; s <= forwardSteps; s++) ctx.lineTo(xToPx(s), yToPx(avgPath[s] + stdPath[s]));
  for (let s = forwardSteps; s >= 0; s--) ctx.lineTo(xToPx(s), yToPx(avgPath[s] - stdPath[s]));
  ctx.closePath();
  ctx.fill();

  // Durchschnittspfad (fett, Farbe je nach Endwert)
  const finalAvg = avgPath[forwardSteps];
  const lineColor = finalAvg > 0.02 ? "#3fb68b" : finalAvg < -0.02 ? "#e2566b" : "#e8eaee";
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let s = 0; s <= forwardSteps; s++) {
    const px = xToPx(s);
    const py = yToPx(avgPath[s]);
    if (s === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Endpunkt markieren
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.arc(xToPx(forwardSteps), yToPx(finalAvg), 3.2, 0, Math.PI * 2);
  ctx.fill();
}

function sampleArray(arr, maxN) {
  if (arr.length <= maxN) return arr;
  const step = arr.length / maxN;
  const out = [];
  for (let i = 0; i < maxN; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}
