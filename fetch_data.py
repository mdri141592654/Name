#!/usr/bin/env python3
"""
fetch_data.py
-------------
Holt Kursdaten via yfinance fuer eine Reihe von Symbolen/Timeframes und
speichert sie als JSON unter docs/data/. Wird per GitHub Actions geplant
ausgefuehrt.

Wichtig: Yahoo Finance liefert ueber yfinance nur begrenzte Intraday-Historie
(5m: ~60 Tage, 60m: ~730 Tage, 1d: voll). Damit trotzdem eine lange
Intraday-Historie entsteht, werden neu geladene Bars mit bereits
gespeicherten Bars GEMERGED statt sie zu ueberschreiben. Bei jedem Lauf
(z.B. taeglich) wachsen die 5m/1h-Dateien also weiter.

Neue Symbole hinzufuegen: einfach in SYMBOLS ergaenzen (Yahoo-Ticker-Format,
fuer Forex z.B. "EURUSD=X").
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

# Anzeigename -> Yahoo-Finance-Ticker
SYMBOLS = {
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "USDCHF": "USDCHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "USDCAD=X",
    "NZDUSD": "NZDUSD=X",
}

# interner Timeframe-Key -> (yfinance interval, yfinance period)
TIMEFRAMES = {
    "1d": {"interval": "1d", "period": "10y"},
    "1h": {"interval": "60m", "period": "730d"},
    "5m": {"interval": "5m", "period": "60d"},
}

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def fetch_one(ticker: str, interval: str, period: str) -> pd.DataFrame:
    """Laedt OHLC-Daten fuer einen Ticker/Timeframe von Yahoo Finance."""
    df = yf.Ticker(ticker).history(
        period=period,
        interval=interval,
        auto_adjust=False,
        actions=False,
    )
    if df is None or df.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close"])
    df = df[["Open", "High", "Low", "Close"]].dropna()
    return df


def df_to_records(df: pd.DataFrame) -> dict:
    """Wandelt DataFrame in {iso_timestamp: {o,h,l,c}} um."""
    records = {}
    for idx, row in df.iterrows():
        # idx ist ein Timestamp (ggf. tz-aware) -> ISO 8601 in UTC
        ts = idx.tz_convert("UTC") if idx.tzinfo is not None else idx.tz_localize("UTC")
        key = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        records[key] = {
            "o": round(float(row["Open"]), 6),
            "h": round(float(row["High"]), 6),
            "l": round(float(row["Low"]), 6),
            "c": round(float(row["Close"]), 6),
        }
    return records


def load_existing(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # gespeichertes Format ist eine Liste -> zurueck in dict konvertieren
        return {bar["t"]: {"o": bar["o"], "h": bar["h"], "l": bar["l"], "c": bar["c"]} for bar in data}
    except Exception as exc:  # robust gegen kaputte/leere Dateien
        print(f"  Warnung: konnte {path} nicht lesen ({exc}), starte neu.")
        return {}


def save_merged(path: Path, merged: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [{"t": t, **vals} for t, vals in sorted(merged.items())]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    return len(rows)


# ---------------------------------------------------------------------------
# Hauptlauf
# ---------------------------------------------------------------------------

def main():
    manifest = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "symbols": {}}
    had_error = False

    for display_name, ticker in SYMBOLS.items():
        manifest["symbols"].setdefault(display_name, {"name": display_name, "timeframes": {}})

        for tf_key, tf_cfg in TIMEFRAMES.items():
            out_path = OUT_DIR / f"{display_name}_{tf_key}.json"
            print(f"[{display_name} / {tf_key}] lade {ticker} ({tf_cfg['interval']}, {tf_cfg['period']}) ...")

            try:
                df = fetch_one(ticker, tf_cfg["interval"], tf_cfg["period"])
            except Exception as exc:
                print(f"  FEHLER beim Laden: {exc}")
                had_error = True
                continue

            new_records = df_to_records(df)
            existing = load_existing(out_path)
            existing.update(new_records)  # neue/aktualisierte Bars gewinnen
            total = save_merged(out_path, existing)

            print(f"  {len(new_records)} Bars geladen, {total} Bars insgesamt gespeichert.")

            if total > 0:
                all_ts = sorted(existing.keys())
                manifest["symbols"][display_name]["timeframes"][tf_key] = {
                    "bars": total,
                    "from": all_ts[0],
                    "to": all_ts[-1],
                }

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"\nmanifest.json geschrieben: {manifest_path}")

    if had_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
