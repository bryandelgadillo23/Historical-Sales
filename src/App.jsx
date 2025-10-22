import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Papa from "papaparse";
import { getPersistentColorMap } from "./color-utils";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
} from "recharts";

const monthNames = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

const DIMENSION_COLUMN_NAMES = new Set([
  "date",
  "month",
  "year",
  "period",
  "branch",
]);

const COLOR_STORAGE_KEY = "salesSeriesColorMap";

const BRAND_COLOR_OVERRIDES = {
  "Parts All": "#1f77b4",
  "Service All": "#2ca02c",
};

// YYYY-MM helpers
const ymToKey = (y, m) => y * 100 + m;
const keyFromStr = (s) => { if (!s) return null; const [yy, mm] = s.split("-").map(Number); if (!yy || !mm) return null; return ymToKey(yy, mm); };
const strFromYM = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const clampYM = (s, minS, maxS) => {
  const k = keyFromStr(s), minK = keyFromStr(minS), maxK = keyFromStr(maxS);
  if (!k || !minK || !maxK) return s;
  if (k < minK) return minS;
  if (k > maxK) return maxS;
  return s;
};
const addMonths = (s, delta) => {
  const [yy, mm] = s.split("-").map(Number);
  const d0 = new Date(yy, mm - 1, 1);
  d0.setMonth(d0.getMonth() + delta);
  const y = d0.getFullYear();
  const m = d0.getMonth() + 1;
  return strFromYM(y, m);
};
const toMonthIndex = (m) => {
  if (m == null) return null;
  const s = String(m).trim();
  const n = Number(s);
  if (!Number.isNaN(n)) return Math.max(1, Math.min(12, n));
  const idx = monthNames.findIndex((x) => x.toLowerCase() === s.slice(0, 3).toLowerCase());
  return idx >= 0 ? idx + 1 : null;
};

// Abbreviated numbers + currency for revenue
const formatAbbrev = (n) => {
  if (n == null || isNaN(n)) return n;
  const abs = Math.abs(n);
  const fmt = (v, s) => `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${s}`;
  if (abs >= 1_000_000_000) return fmt(n / 1_000_000_000, "B");
  if (abs >= 1_000_000)     return fmt(n / 1_000_000, "M");
  if (abs >= 1_000)         return fmt(n / 1_000, "K");
  return new Intl.NumberFormat().format(n);
};

const DATASET_OVERRIDES = {
  "historical_all.csv": {
    id: "Historical_All",
    label: "Historical All ($)",
    instructions:
      "Year, Period, Branch, Equipment, Rental, Parts, Service, Total",
    colors: {
      Equipment: "#2563EB",
      Rental: "#7C3AED",
      Parts: "#0EA5E9",
      Service: "#F97316",
      Total: "#FACC15",
    },
    defaultCategory: "Total",
    valueType: "currency",
  },
  "historical_sales.csv": {
    id: "Historical_Sales",
    label: "Historical Equipment Sales ($)",
    instructions:
      "Year, Period, Branch, New Equipment Sales, Used Equipment Sales, RPO Sales, Re-Marketing Sales, Trade-In Sales, RtoR Sales, Other, Total Equipment",
    colors: {
      "New Equipment Sales": "#2563EB",
      "Used Equipment Sales": "#7C3AED",
      "RPO Sales": "#0EA5E9",
      "Re-Marketing Sales": "#F97316",
      "Trade-In Sales": "#F43F5E",
      "RtoR Sales": "#10B981",
      Other: "#94A3B8",
      "Total Equipment": "#FACC15",
    },
    defaultCategory: "Total Equipment",
    valueType: "currency",
  },
};

const DEFAULT_DATASET = "Historical_All";

const splitFileSegments = (fileName) =>
  fileName
    .replace(/\.csv$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

const capitalize = (segment) =>
  segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment;

const buildDatasetEntry = (fileName, meta = {}) => {
  if (!fileName) return null;
  const override = DATASET_OVERRIDES[fileName] || {};
  const segments = splitFileSegments(fileName);
  const defaultId = segments.length
    ? segments.map((seg) => capitalize(seg)).join("_")
    : fileName.replace(/\.csv$/i, "");
  const defaultLabel = segments.length
    ? segments.map((seg) => capitalize(seg)).join(" ")
    : fileName.replace(/\.csv$/i, "");

  return {
    id: override.id || defaultId,
    label: override.label || defaultLabel || fileName,
    file: `/${fileName}`,
    fileName,
    instructions: override.instructions || null,
    colors: override.colors ? { ...override.colors } : undefined,
    defaultCategory: override.defaultCategory || null,
    valueType: override.valueType || null,
    size: typeof meta.size === "number" ? meta.size : null,
    lastModified: meta.lastModified || null,
  };
};

const normalizeDatasetRecords = (records) => {
  if (!Array.isArray(records)) return [];
  const map = new Map();
  for (const record of records) {
    if (!record || !record.file) continue;
    const entry = buildDatasetEntry(record.file, record);
    if (!entry) continue;
    if (map.has(entry.id)) {
      const existing = map.get(entry.id);
      map.set(entry.id, {
        ...existing,
        size: existing.size ?? entry.size,
        lastModified: existing.lastModified ?? entry.lastModified,
      });
    } else {
      map.set(entry.id, entry);
    }
  }

  const entries = Array.from(map.values());
  entries.sort((a, b) => {
    if (a.id === DEFAULT_DATASET) return -1;
    if (b.id === DEFAULT_DATASET) return 1;
    const aLabel = a.label || a.id;
    const bLabel = b.label || b.id;
    return aLabel.localeCompare(bLabel, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return entries;
};

const fmtValue = (v, datasetConfig) => {
  if (typeof v !== "number") return v;
  if (datasetConfig?.valueType === "currency") {
    const abs = Math.abs(v);
    if (abs >= 1000) {
      const text = formatAbbrev(v);
      return v < 0 ? `-$${text.replace("-", "")}` : `$${text}`;
    }
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(v);
  }
  return formatAbbrev(v);
};
const fmtPct = (v) =>
  typeof v === "number" && isFinite(v)
    ? `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 2 : 1)}%`
    : "";

const formatFileSize = (bytes) => {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatTimestamp = (iso) => {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString();
};

// Sentinel for multi-select "All"
const ALL = "__ALL__";

/* ---------- Dark-mode detector (for tooltip styling) ---------- */
function usePrefersDark() {
  const [isDark, setIsDark] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = (e) => setIsDark(e.matches);
    setIsDark(mql.matches);
    (mql.addEventListener || mql.addListener).call(mql, "change", onChange);
    return () => {
      (mql.removeEventListener || mql.removeListener).call(mql, "change", onChange);
    };
  }, []);
  return isDark;
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState("all");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [viewMode, setViewMode] = useState("line");
  const [metric, setMetric] = useState("value"); // "value" | "r12" | "r12Value"

  const [allBranches, setAllBranches] = useState([]);
  const [selectedBranches, setSelectedBranches] = useState([ALL]);

  const [dataset, setDataset] = useState(DEFAULT_DATASET);
  const [availableDatasets, setAvailableDatasets] = useState([]);
  const [hoveredCategory, setHoveredCategory] = useState(null);

  const datasetMap = useMemo(
    () => Object.fromEntries(availableDatasets.map((d) => [d.id, d])),
    [availableDatasets]
  );
  const datasetFiles = useMemo(
    () => Object.fromEntries(availableDatasets.map((d) => [d.id, d.file])),
    [availableDatasets]
  );
  const datasetConfig =
    datasetMap[dataset] || datasetMap[DEFAULT_DATASET] || availableDatasets[0] || null;

  // Date range + hard limits
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [minMonthStr, setMinMonthStr] = useState("");
  const [maxMonthStr, setMaxMonthStr] = useState("");

  // Track if user explicitly set a date range (so we can preserve it across dataset switches)
  const userRangeRef = useRef({ touched: false, start: null, end: null });
  const savedPrefsRef = useRef();
  const isDark = usePrefersDark();
  const theme = useMemo(
    () =>
      isDark
        ? {
            surface: "#0f172a",
            surfaceRaised: "#111c2f",
            surfaceMuted: "#1e293b",
            border: "#1e293b",
            borderStrong: "#334155",
            textPrimary: "#e2e8f0",
            textMuted: "#94a3b8",
            controlSurface: "#1e293b",
            controlSurfaceHover: "#27344a",
            controlBorder: "#334155",
            controlBorderHover: "#475569",
            controlText: "#e2e8f0",
            primarySurface: "#2563eb",
            primarySurfaceHover: "#1d4ed8",
            primaryText: "#f8fafc",
            focusRing: "rgba(96,165,250,0.45)",
            focusBorder: "#60a5fa",
            shadow: "0 1px 2px rgba(15, 23, 42, 0.5)",
            chartGrid: "#1f2a40",
            chartAxis: "#334155",
            chartTick: "#e2e8f0",
            chartLegend: "#e2e8f0",
            chartReference: "#475569",
            chartCursor: "#475569",
            tooltipBackground: "#111c2f",
            tooltipBorder: "#334155",
            tooltipText: "#e2e8f0",
            caption: "#94a3b8",
            tableHeaderBg: "#111c2f",
            tableFooterBg: "#111827",
            tableRowBorder: "#1f2937",
            brushFill: "#0f172a",
            brushStroke: "#334155",
          }
        : {
            surface: "#ffffff",
            surfaceRaised: "#ffffff",
            surfaceMuted: "#f1f5f9",
            border: "#e2e8f0",
            borderStrong: "#cbd5e1",
            textPrimary: "#0f172a",
            textMuted: "#64748b",
            controlSurface: "#f8fafc",
            controlSurfaceHover: "#eef2f7",
            controlBorder: "#cbd5e1",
            controlBorderHover: "#b6c3d1",
            controlText: "#0f172a",
            primarySurface: "#2563eb",
            primarySurfaceHover: "#1d4ed8",
            primaryText: "#ffffff",
            focusRing: "rgba(96,165,250,0.35)",
            focusBorder: "#60a5fa",
            shadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
            chartGrid: "#e2e8f0",
            chartAxis: "#cbd5e1",
            chartTick: "#475569",
            chartLegend: "#0f172a",
            chartReference: "#94a3b8",
            chartCursor: "#94a3b8",
            tooltipBackground: "#ffffff",
            tooltipBorder: "#cbd5e1",
            tooltipText: "#0f172a",
            caption: "#64748b",
            tableHeaderBg: "#f8fafc",
            tableFooterBg: "#fafafa",
            tableRowBorder: "#f1f5f9",
            brushFill: "#f8fafc",
            brushStroke: "#cbd5e1",
          },
    [isDark]
  );

  useEffect(() => {
    if (savedPrefsRef.current !== undefined) return;
    try {
      const raw = localStorage.getItem("psdash:v1");
      if (!raw) {
        savedPrefsRef.current = null;
        return;
      }
      const parsed = JSON.parse(raw);
      savedPrefsRef.current =
        parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      console.error(err);
      savedPrefsRef.current = null;
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    const fallbackDatasets = () =>
      normalizeDatasetRecords(
        Object.keys(DATASET_OVERRIDES).map((file) => ({ file }))
      );

    async function loadDatasets() {
      try {
        const resp = await fetch("/dataset-list.json", { cache: "no-store" });
        if (!resp.ok) {
          throw new Error(`Failed to load dataset list (${resp.status})`);
        }
        const json = await resp.json();
        const records = Array.isArray(json?.datasets)
          ? json.datasets
          : Array.isArray(json)
          ? json
          : [];
        const normalized = normalizeDatasetRecords(records);
        if (ignore) return;
        if (normalized.length) setAvailableDatasets(normalized);
        else setAvailableDatasets(fallbackDatasets());
      } catch (err) {
        console.error(err);
        if (ignore) return;
        const fallback = fallbackDatasets();
        if (fallback.length) {
          setAvailableDatasets(fallback);
        } else {
          setError((prev) => prev || "No CSV datasets found in public/ directory.");
        }
      }
    }

    loadDatasets();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!availableDatasets.length) return;

    const availableIds = new Set(availableDatasets.map((d) => d.id));
    const fallbackId = availableIds.has(DEFAULT_DATASET)
      ? DEFAULT_DATASET
      : availableDatasets[0]?.id;

    const saved = savedPrefsRef.current;
    if (saved !== undefined) {
      const prefs = saved && typeof saved === "object" ? saved : {};
      if (prefs.viewMode) setViewMode(prefs.viewMode);
      if (Array.isArray(prefs.selectedBranches) && prefs.selectedBranches.length)
        setSelectedBranches(prefs.selectedBranches);
      if (prefs.dateStart) setDateStart(prefs.dateStart);
      if (prefs.dateEnd) setDateEnd(prefs.dateEnd);
      if (prefs.metric) setMetric(prefs.metric);

      if (prefs.dataset && availableIds.has(prefs.dataset)) {
        setDataset(prefs.dataset);
      } else if (fallbackId && dataset !== fallbackId) {
        setDataset(fallbackId);
      }

      savedPrefsRef.current = undefined;
      return;
    }

    if (!availableIds.has(dataset) && fallbackId && dataset !== fallbackId) {
      setDataset(fallbackId);
    }
  }, [availableDatasets]);

  const onStartChange = (s) => {
    const clamped = clampYM(s, minMonthStr, maxMonthStr);
    const sk = keyFromStr(clamped), ek = keyFromStr(dateEnd);
    if (sk && ek && sk > ek) setDateEnd(clamped);
    setDateStart(clamped);
    userRangeRef.current = { touched: true, start: clamped, end: ek ? dateEnd : clamped };
  };
  const onEndChange = (s) => {
    const clamped = clampYM(s, minMonthStr, maxMonthStr);
    const ek = keyFromStr(clamped), sk = keyFromStr(dateStart);
    if (sk && ek && ek < sk) setDateStart(clamped);
    setDateEnd(clamped);
    userRangeRef.current = { touched: true, start: sk ? dateStart : clamped, end: clamped };
  };

  const onYearPick = (val) => {
    setSelectedYear(val);
    if (val === "all" || !minMonthStr || !maxMonthStr) return;
    const y = Number(val);
    if (!Number.isFinite(y)) return;
    const wantStart = clampYM(`${y}-01`, minMonthStr, maxMonthStr);
    const wantEnd   = clampYM(`${y}-12`, minMonthStr, maxMonthStr);
    setDateStart(wantStart);
    setDateEnd(wantEnd);
    userRangeRef.current = { touched: true, start: wantStart, end: wantEnd };
  };

  const onBranchesChange = (e) => {
    const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
    if (vals.includes(ALL) || vals.length === 0) setSelectedBranches([ALL]);
    else setSelectedBranches(vals);
  };

  const setPresetAll = () => {
    if (minMonthStr && maxMonthStr) {
      setDateStart(minMonthStr);
      setDateEnd(maxMonthStr);
      setSelectedYear("all");
      userRangeRef.current = { touched: true, start: minMonthStr, end: maxMonthStr };
    }
  };
  const setPresetLastN = (n) => {
    if (!maxMonthStr) return;
    const end = maxMonthStr;
    const start = clampYM(addMonths(end, -n + 1), minMonthStr, maxMonthStr);
    setDateStart(start);
    setDateEnd(end);
    setSelectedYear("all");
    userRangeRef.current = { touched: true, start, end };
  };
  const setPresetYTD = () => {
    if (!maxMonthStr) return;
    const [maxY] = maxMonthStr.split("-").map(Number);
    const start = clampYM(`${maxY}-01`, minMonthStr, maxMonthStr);
    setDateStart(start);
    setDateEnd(maxMonthStr);
    setSelectedYear(String(maxY));
    userRangeRef.current = { touched: true, start, end: maxMonthStr };
  };

  const normalizeParsedRows = (data, metaFields) => {
    const records = Array.isArray(data) ? data : [];
    const headers = (metaFields && metaFields.length ? metaFields : Object.keys(records[0] || {}))
      .map((h) => (typeof h === "string" ? h.trim() : h))
      .filter(Boolean);

    if (!headers.length) throw new Error("No headers found in CSV.");

    const yearCol = headers.find((h) => /^(year|yr|fy|fiscal year)$/i.test(h));
    const periodCol = headers.find((h) => /^(period|per|month)$/i.test(h));
    const branchCol = headers.find((h) => /^(branch name|branch|store|location)$/i.test(h));
    if (!yearCol || !periodCol) throw new Error("Missing Year or Period/Month columns.");

    const idSet = new Set([yearCol, periodCol, branchCol].filter(Boolean));
    const catCols = headers
      .filter((h) => h && !idSet.has(h))
      .filter((h) => !DIMENSION_COLUMN_NAMES.has(String(h).trim().toLowerCase()));

    const parsed = [];
    for (const row of records) {
      const Y = Number(row[yearCol]);
      const M = toMonthIndex(row[periodCol]) || Number(row[periodCol]);
      if (!Y || !M) continue;
      const B = branchCol ? row[branchCol] : undefined;
      for (const col of catCols) {
        const raw = row[col];
        const value = Number(String(raw ?? "").replace(/,/g, ""));
        if (Number.isNaN(value)) continue;
        parsed.push({
          Year: Y,
          Month: M,
          Category: String(col).trim(),
          Value: value,
          Branch: B ? String(B).trim() : undefined,
        });
      }
    }

    if (!parsed.length) throw new Error("No valid rows found in CSV.");
    return parsed;
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (res) => {
        try {
          const parsed = normalizeParsedRows(res.data, res.meta.fields);
          hydrateFromParsed(parsed);
        } catch (err) {
          setError(err.message || String(err));
          setRows([]);
        }
      },
      error: (err) => setError(err.message || String(err)),
    });
  };

  const parseTextDataset = (text) =>
    new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (res) => {
          try {
            resolve(normalizeParsedRows(res.data, res.meta.fields));
          } catch (e) {
            reject(e);
          }
        },
        error: reject,
      });
    });

  // Default categories prefer dataset-configured total for a quick summary
  const pickDefaultCategories = useCallback(
    (cats) => {
      if (!Array.isArray(cats) || !cats.length) return [];
      const preferred = datasetConfig?.defaultCategory;
      if (preferred && cats.includes(preferred)) return [preferred];
      return cats.slice(0, Math.min(2, cats.length));
    },
    [datasetConfig]
  );

  // Apply parsed data to state (preserve user range if they've touched it)
  const hydrateFromParsed = (parsed) => {
    setRows(parsed);

    const minKey = Math.min(...parsed.map((r) => ymToKey(r.Year, r.Month)));
    const maxKey = Math.max(...parsed.map((r) => ymToKey(r.Year, r.Month)));
    const minY = Math.floor(minKey / 100), minM = minKey % 100;
    const maxY = Math.floor(maxKey / 100), maxM = maxKey % 100;
    const minStr = strFromYM(minY, minM);
    const maxStr = strFromYM(maxY, maxM);
    setMinMonthStr(minStr);
    setMaxMonthStr(maxStr);

    if (userRangeRef.current.touched && (userRangeRef.current.start || userRangeRef.current.end)) {
      const preservedStart = clampYM(userRangeRef.current.start ?? minStr, minStr, maxStr);
      const preservedEnd   = clampYM(userRangeRef.current.end ?? maxStr,   minStr, maxStr);
      const pk = keyFromStr(preservedStart), qk = keyFromStr(preservedEnd);
      if (pk && qk && pk <= qk) {
        setDateStart(preservedStart);
        setDateEnd(preservedEnd);
      } else {
        setDateStart(minStr);
        setDateEnd(maxStr);
      }
    } else {
      setDateStart(minStr);
      setDateEnd(maxStr);
    }

    const cats = [...new Set(parsed.map((r) => r.Category))];
    setSelectedCategories((prev) => {
      const preserved = prev.filter((c) => cats.includes(c));
      return preserved.length ? preserved : pickDefaultCategories(cats);
    });

    const branches = [...new Set(parsed.map((r) => r.Branch).filter(Boolean))].sort();
    setAllBranches(branches);
    setSelectedBranches((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return [ALL];
      if (prev.includes(ALL)) return [ALL];
      const valid = prev.filter((b) => branches.includes(b));
      return valid.length ? valid : [ALL];
    });
    setError("");
  };

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.Year))].sort((a, b) => a - b),
    [rows]
  );

  const allCategories = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    for (const row of rows) {
      const name = row?.Category;
      if (!name) continue;
      const normalized = String(name).trim().toLowerCase();
      if (DIMENSION_COLUMN_NAMES.has(normalized)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      ordered.push(name);
    }
    return ordered;
  }, [rows]);

  // Build chart data (Value metric): sum across branches (All or selected subset) and date range
  const chartData = useMemo(() => {
    if (!rows.length) return [];
    const startKey = keyFromStr(dateStart);
    const endKey = keyFromStr(dateEnd);
    const hasRange = startKey && endKey && startKey <= endKey;

    const includeAll = selectedBranches.includes(ALL);
    const matchBranch = (r) => {
      if (includeAll) return true;
      if (!r.Branch) return false;
      return selectedBranches.includes(r.Branch);
    };

    const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
    const map = new Map();

    for (const r of rows) {
      if (!matchBranch(r)) continue;
      const k = ymToKey(r.Year, r.Month);
      if (hasRange && (k < startKey || k > endKey)) continue;

      const compound = key(r.Year, r.Month);
      if (!map.has(compound)) {
        map.set(compound, { month: `${monthNames[r.Month - 1]} ${r.Year}`, Year: r.Year, Month: r.Month });
      }
      const obj = map.get(compound);
      if (selectedCategories.includes(r.Category)) {
        obj[r.Category] = (obj[r.Category] || 0) + r.Value;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.Year - b.Year || a.Month - b.Month);
  }, [rows, selectedCategories, selectedBranches, dateStart, dateEnd]);

  // Monthly aggregation across ALL months (for R12 computation), filtered by selected branches only
  const monthlyAggAllMonths = useMemo(() => {
    if (!rows.length) return [];
    const includeAll = selectedBranches.includes(ALL);
    const matchBranch = (r) => {
      if (includeAll) return true;
      if (!r.Branch) return false;
      return selectedBranches.includes(r.Branch);
    };

    const map = new Map(); // "YYYY-MM" -> {Year,Month,month, cat sums...}
    const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

    for (const r of rows) {
      if (!matchBranch(r)) continue;
      const k = key(r.Year, r.Month);
      if (!map.has(k)) {
        map.set(k, { Year: r.Year, Month: r.Month, month: `${monthNames[r.Month - 1]} ${r.Year}` });
      }
      const obj = map.get(k);
      obj[r.Category] = (obj[r.Category] || 0) + (Number(r.Value) || 0);
    }

    return Array.from(map.values()).sort((a, b) => a.Year - b.Year || a.Month - b.Month);
  }, [rows, selectedBranches]);

  // Compute R12 growth % for selected categories
  const r12Data = useMemo(() => {
    if (!monthlyAggAllMonths.length || !selectedCategories.length) return [];

    const data = [];
    const A = monthlyAggAllMonths;

    for (let i = 0; i < A.length; i++) {
      // Need at least 24 months history to form first YoY-R12 growth
      if (i < 23) {
        data.push({ Year: A[i].Year, Month: A[i].Month, month: A[i].month });
        continue;
      }
      const row = { Year: A[i].Year, Month: A[i].Month, month: A[i].month };

      for (const cat of selectedCategories) {
        let curr12 = 0, prev12 = 0;
        for (let j = i - 11; j <= i; j++) curr12 += Number(A[j][cat] || 0);
        for (let j = i - 23; j <= i - 12; j++) prev12 += Number(A[j][cat] || 0);
        row[cat] = prev12 !== 0 ? (curr12 - prev12) / prev12 : null;
      }
      data.push(row);
    }

    // Display clipped to current date window (math uses all months)
    const startKey = keyFromStr(dateStart);
    const endKey = keyFromStr(dateEnd);
    if (startKey && endKey && startKey <= endKey) {
      return data.filter((d) => {
        const k = ymToKey(d.Year, d.Month);
        return k >= startKey && k <= endKey;
      });
    }
    return data;
  }, [monthlyAggAllMonths, selectedCategories, dateStart, dateEnd]);

  // Compute Rolling 12 Value for selected categories
  const r12ValueData = useMemo(() => {
    if (!monthlyAggAllMonths.length || !selectedCategories.length) return [];

    const data = [];
    const A = monthlyAggAllMonths;

    for (let i = 0; i < A.length; i++) {
      const row = { Year: A[i].Year, Month: A[i].Month, month: A[i].month };

      for (const cat of selectedCategories) {
        if (i < 11) {
          row[cat] = null;
          continue;
        }
        let sum = 0;
        for (let j = i - 11; j <= i; j++) {
          sum += Number(A[j][cat] || 0);
        }
        row[cat] = sum;
      }
      data.push(row);
    }

    const startKey = keyFromStr(dateStart);
    const endKey = keyFromStr(dateEnd);
    if (startKey && endKey && startKey <= endKey) {
      return data.filter((d) => {
        const k = ymToKey(d.Year, d.Month);
        return k >= startKey && k <= endKey;
      });
    }
    return data;
  }, [monthlyAggAllMonths, selectedCategories, dateStart, dateEnd]);

  // Auto-zoom to available R12-style data if user hasn't chosen a range
  useEffect(() => {
    if (metric === "value") return;
    const source = metric === "r12" ? r12Data : r12ValueData;
    if (!source.length) return;
    if (userRangeRef.current.touched) return;

    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < source.length; i++) {
      const hasAny = selectedCategories.some(c => typeof source[i][c] === "number" && isFinite(source[i][c]));
      if (hasAny) { firstIdx = i; break; }
    }
    for (let i = source.length - 1; i >= 0; i--) {
      const hasAny = selectedCategories.some(c => typeof source[i][c] === "number" && isFinite(source[i][c]));
      if (hasAny) { lastIdx = i; break; }
    }
    if (firstIdx === -1 || lastIdx === -1) return;

    const first = `${source[firstIdx].Year}-${String(source[firstIdx].Month).padStart(2,"0")}`;
    const last  = `${source[lastIdx].Year}-${String(source[lastIdx].Month).padStart(2,"0")}`;

    const start = clampYM(first, minMonthStr, maxMonthStr);
    const end   = clampYM(last,  minMonthStr, maxMonthStr);

    setDateStart(start);
    setDateEnd(end);
    // Don't mark touched – keep auto-fitting until user interacts.
  }, [metric, r12Data, r12ValueData, selectedCategories, minMonthStr, maxMonthStr]);

  const summaryStats = useMemo(() => {
    const stats = {};
    const source =
      metric === "r12" ? r12Data : metric === "r12Value" ? r12ValueData : chartData;
    for (const cat of selectedCategories) {
      const vals = source.map((d) => d[cat]).filter((v) => typeof v === "number" && isFinite(v));
      if (!vals.length) continue;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const latest = vals[vals.length - 1];
      stats[cat] = { avg, latest };
    }
    return stats;
  }, [chartData, r12Data, selectedCategories, metric]);

  // Branch-level totals (Value metric only)
  const branchSummary = useMemo(() => {
    if (!rows.length || !selectedCategories.length) return { rows: [], totals: {} };

    const startKey = keyFromStr(dateStart);
    const endKey = keyFromStr(dateEnd);
    const hasRange = startKey && endKey && startKey <= endKey;

    const includeAll = selectedBranches.includes(ALL);
    const matchBranch = (r) => {
      if (includeAll) return true;
      if (!r.Branch) return false;
      return selectedBranches.includes(r.Branch);
    };

    const byBranch = new Map(); // branch -> { [cat]: sum, __total: sum }
    const totals = Object.fromEntries(selectedCategories.map((c) => [c, 0]));
    let grand = 0;

    for (const r of rows) {
      if (!matchBranch(r)) continue;
      const k = ymToKey(r.Year, r.Month);
      if (hasRange && (k < startKey || k > endKey)) continue;
      if (!selectedCategories.includes(r.Category)) continue;

      const b = (r.Branch && String(r.Branch).trim()) || "(Blank)";
      if (!byBranch.has(b)) {
        const init = Object.fromEntries(selectedCategories.map((c) => [c, 0]));
        init.__total = 0;
        byBranch.set(b, init);
      }
      const acc = byBranch.get(b);
      const v = Number(r.Value) || 0;
      acc[r.Category] += v;
      acc.__total += v;
      totals[r.Category] += v;
      grand += v;
    }

    const outRows = Array.from(byBranch.entries())
      .map(([Branch, sums]) => ({ Branch, ...sums }))
      .sort((a, b) => a.Branch.localeCompare(b.Branch, undefined, { numeric: true }));

    return { rows: outRows, totals: { ...totals, __total: grand } };
  }, [rows, selectedCategories, selectedBranches, dateStart, dateEnd]);

  // Load dataset when selection changes
  useEffect(() => {
    if (!availableDatasets.length) return;

    const fallbackEntry =
      datasetMap[DEFAULT_DATASET] || availableDatasets[0] || null;
    const fallbackId = fallbackEntry?.id;
    const targetFile = datasetFiles[dataset];

    if (!targetFile) {
      if (fallbackId && dataset !== fallbackId) setDataset(fallbackId);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function loadDatasetFromFile(url) {
      try {
        setError("");
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) throw new Error(`Failed to load ${url}`);
        const text = await resp.text();
        if (cancelled || controller.signal.aborted) return;
        const parsed = await parseTextDataset(text);
        if (cancelled || controller.signal.aborted) return;
        hydrateFromParsed(parsed);
      } catch (e) {
        if (controller.signal.aborted || cancelled) return;
        console.error(e);
        setError(e.message || String(e));
      }
    }

    loadDatasetFromFile(targetFile);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dataset, datasetFiles, availableDatasets, datasetMap]);

  // Persist prefs
  useEffect(() => {
    const payload = { dataset, viewMode, selectedBranches, dateStart, dateEnd, metric };
    localStorage.setItem("psdash:v1", JSON.stringify(payload));
  }, [dataset, viewMode, selectedBranches, dateStart, dateEnd, metric]);

  const categoryColors = useMemo(() => {
    const overrides = { ...(datasetConfig?.colors || {}), ...BRAND_COLOR_OVERRIDES };
    if (!allCategories.length) return overrides;
    return getPersistentColorMap(allCategories, COLOR_STORAGE_KEY, overrides);
  }, [allCategories, datasetConfig]);

  const toggleCategory = (c) => {
    setSelectedCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const downloadViewCsv = () => {
    const source =
      metric === "r12" ? r12Data : metric === "r12Value" ? r12ValueData : chartData;
    if (!source.length) return;
    const header = ["Year", "Month", "Label", ...selectedCategories];
    const rowsForExport = source.map((d) => [
      d.Year, d.Month, d.month, ...selectedCategories.map((c) => d[c] ?? "")
    ]);
    const csv = [[...header], ...rowsForExport].map(r =>
      r.map(x => (x == null ? "" : String(x).includes(",") ? `"${String(x).replace(/"/g, '""')}"` : x)).join(",")
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      metric === "r12"
        ? "dashboard_r12_growth.csv"
        : metric === "r12Value"
        ? "dashboard_r12_value.csv"
        : "dashboard_view.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartSource =
    metric === "r12" ? r12Data : metric === "r12Value" ? r12ValueData : chartData;
  const datasetLabel = datasetConfig?.label || datasetConfig?.id || dataset;
  const datasetSizeText = formatFileSize(datasetConfig?.size);
  const datasetUpdatedText = formatTimestamp(datasetConfig?.lastModified);
  const chartTitle =
    metric === "r12"
      ? "R12 Growth %"
      : metric === "r12Value"
      ? `Rolling 12 ${datasetLabel}`
      : datasetLabel;
  const activeHover =
    hoveredCategory && selectedCategories.includes(hoveredCategory)
      ? hoveredCategory
      : null;

  const thCell = useMemo(
    () => ({
      padding: "10px 10px",
      textAlign: "left",
      fontWeight: 600,
      color: theme.textPrimary,
      borderBottom: `1px solid ${theme.borderStrong}`,
      whiteSpace: "nowrap",
    }),
    [theme]
  );

  const tdCell = useMemo(
    () => ({
      padding: "8px 10px",
      color: theme.textPrimary,
      whiteSpace: "nowrap",
    }),
    [theme]
  );

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
        color: theme.textPrimary,
      }}
    >
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>Product Support Dashboard</h1>
      <p style={{ color: theme.textMuted, marginTop: 6 }}>
        Upload your CSV
        {datasetConfig?.instructions ? ` (${datasetConfig.instructions})` : ""}.
        Values for selected branches are summed.
      </p>

      {/* Top controls */}
      <div className="toolbar">
        <div className="field">
          <label className="label">Dataset</label>
          <select
            className="select"
            value={availableDatasets.length ? dataset : ""}
            onChange={(e) => setDataset(e.target.value)}
            disabled={!availableDatasets.length}
          >
            {availableDatasets.length ? (
              availableDatasets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label || option.id}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Loading datasets...
              </option>
            )}
          </select>
          {(datasetSizeText || datasetUpdatedText) && (
            <div className="dataset-meta">
              {datasetSizeText && <span>Size: {datasetSizeText}</span>}
              {datasetSizeText && datasetUpdatedText && (
                <span className="dataset-meta__bullet" aria-hidden="true">•</span>
              )}
              {datasetUpdatedText && <span>Updated: {datasetUpdatedText}</span>}
            </div>
          )}
        </div>

        <div className="field">
          <label className="label">Year</label>
          <select className="select" value={selectedYear} onChange={(e) => onYearPick(e.target.value)}>
            <option value="all">All Years</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Chart</label>
          <select className="select" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
            <option value="line">Line</option>
            <option value="bar">Bar</option>
          </select>
        </div>

        <div className="field">
          <label className="label">Metric</label>
          <select className="select" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="value">Value</option>
            <option value="r12">R12 Growth %</option>
            <option value="r12Value">Rolling 12 Value</option>
          </select>
        </div>

        <div className="field">
          <label className="label">From</label>
          <input
            className="select"
            type="month"
            value={dateStart}
            min={minMonthStr || undefined}
            max={maxMonthStr || undefined}
            onChange={(e) => onStartChange(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label">To</label>
          <input
            className="select"
            type="month"
            value={dateEnd}
            min={minMonthStr || undefined}
            max={maxMonthStr || undefined}
            onChange={(e) => onEndChange(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label">CSV Upload</label>
          <input className="file" type="file" accept=".csv" onChange={handleFile} />
        </div>
      </div>

      {/* Presets + export */}
      <div className="toolbar toolbar--row">
        <button className="btn" onClick={setPresetAll}>All</button>
        <button className="btn" onClick={() => setPresetYTD()}>YTD</button>
        <button className="btn" onClick={() => setPresetLastN(12)}>Last 12M</button>
        <button className="btn" onClick={() => setPresetLastN(24)}>Last 24M</button>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={downloadViewCsv}>Export View (CSV)</button>
      </div>

      {/* Toolbar styles */}
      <style>{`
        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          padding: 12px;
          background: ${theme.surface};
          border: 1px solid ${theme.border};
          border-radius: 10px;
          box-shadow: ${theme.shadow};
          align-items: flex-end;
          margin-top: 8px;
        }

        .toolbar--row {
          align-items: center;
          padding: 10px 12px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .dataset-meta {
          margin-top: 4px;
          font-size: 12px;
          color: ${theme.textMuted};
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }

        .dataset-meta__bullet {
          color: ${theme.textMuted};
        }

        .label {
          font-size: 12px;
          color: ${theme.textMuted};
          font-weight: 600;
          letter-spacing: .01em;
        }

        .select {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          padding: 8px 10px;
          min-width: 150px;
          border: 1px solid ${theme.controlBorder};
          border-radius: 8px;
          background-color: ${theme.controlSurface};
          color: ${theme.controlText};
          line-height: 1.3;
          font-size: 14px;
          box-shadow: ${isDark ? "inset 0 1px 1px rgba(15,23,42,0.4)" : "inset 0 1px 1px rgba(0,0,0,0.02)"};
          transition: border-color .12s ease, box-shadow .12s ease, background-color .12s ease;
        }

        /* smoother month picker inputs */
        .select[type="month"] {
          padding-top: 7px;
          padding-bottom: 7px;
        }

        .select:focus {
          outline: none;
          border-color: ${theme.focusBorder};
          box-shadow: 0 0 0 3px ${theme.focusRing};
        }

        .file {
          min-width: 220px;
        }

        .btn {
          padding: 8px 12px;
          border: 1px solid ${theme.controlBorder};
          border-radius: 8px;
          background: ${theme.controlSurface};
          color: ${theme.controlText};
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: transform .04s ease, background-color .12s ease, border-color .12s ease, box-shadow .12s ease;
        }

        .btn:hover {
          background: ${theme.controlSurfaceHover};
          border-color: ${theme.controlBorderHover};
        }

        .btn:active {
          transform: translateY(1px);
        }

        .btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px ${theme.focusRing};
          border-color: ${theme.focusBorder};
        }

        .btn--primary {
          background: ${theme.primarySurface};
          color: ${theme.primaryText};
          border-color: ${theme.primarySurface};
        }

        .btn--primary:hover {
          background: ${theme.primarySurfaceHover};
          border-color: ${theme.primarySurfaceHover};
        }

        .spacer {
          flex: 1 1 auto;
        }

        @media (max-width: 720px) {
          .select { min-width: 120px; }
          .file { min-width: 160px; }
        }
      `}</style>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {rows.length > 0 && (
        <>
          {/* Branch & Region toggle chips */}
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <strong>Branches & Regions:</strong>

            {/* Region buttons */}
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              {[
                { name: "All (sum)", value: ALL },
                { name: "NC", branches: ["113", "114", "117", "160"] },
                { name: "SC", branches: ["215", "216", "218"] },
                { name: "GA", branches: ["364", "365", "367"] },
                { name: "TN", branches: ["520", "536"] },
              ].map((region) => {
                const isAll = region.value === ALL;
                const active = isAll
                  ? selectedBranches.includes(ALL)
                  : region.branches?.every((b) => selectedBranches.includes(b));
                return (
                  <button
                    key={region.name}
                    onClick={() => {
                      if (isAll) {
                        setSelectedBranches([ALL]);
                        return;
                      }
                      const alreadyAllSelected = region.branches.every((b) => selectedBranches.includes(b));
                      if (alreadyAllSelected) {
                        const remaining = selectedBranches.filter((x) => !region.branches.includes(x));
                        setSelectedBranches(remaining.length ? remaining : [ALL]);
                      } else {
                        const clean = selectedBranches.filter((x) => x !== ALL);
                        setSelectedBranches([...new Set([...clean, ...region.branches])]);
                      }
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: `1px solid ${active ? theme.primarySurface : theme.controlBorder}`,
                      background: active ? theme.primarySurface : theme.controlSurface,
                      color: active ? theme.primaryText : theme.controlText,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "background-color .15s ease, transform .05s ease",
                    }}
                  >
                    {region.name}
                  </button>
                );
              })}
            </div>

            {/* Branch buttons */}
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              {allBranches.map((b) => {
                const active = selectedBranches.includes(b);
                return (
                  <button
                    key={b}
                    onClick={() =>
                      setSelectedBranches((prev) => {
                        if (prev.includes(ALL)) return [b];
                        if (active) {
                          const next = prev.filter((x) => x !== b);
                          return next.length === 0 ? [ALL] : next;
                        }
                        return [...prev, b];
                      })
                    }
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${active ? theme.primarySurface : theme.controlBorder}`,
                      background: active ? theme.primarySurface : theme.controlSurface,
                      color: active ? theme.primaryText : theme.controlText,
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "background-color .15s ease, transform .05s ease",
                    }}
                  >
                    {b}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: theme.caption, marginTop: 6 }}>
              Click regions or branches to filter. <b>All (sum)</b> resets the full company view.
            </div>
          </div>

          {/* Category chips */}
          <div style={{ marginTop: 16 }}>
            <strong>Categories:</strong><br />
            {allCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                onMouseEnter={() => setHoveredCategory(cat)}
                onMouseLeave={() =>
                  setHoveredCategory((prev) => (prev === cat ? null : prev))
                }
                style={{
                  margin: 4,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: `1px solid ${
                    selectedCategories.includes(cat)
                      ? categoryColors[cat] || theme.primarySurface
                      : theme.controlBorder
                  }`,
                  background: selectedCategories.includes(cat)
                    ? categoryColors[cat] || theme.primarySurface
                    : theme.controlSurface,
                  color: selectedCategories.includes(cat) ? theme.primaryText : theme.controlText,
                  cursor: "pointer",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Chart */}
          <div
            style={{
              marginTop: 24,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: 16,
              boxShadow: theme.shadow,
            }}
          >
            <h2 style={{ margin: "0 0 10px 0", fontSize: "1.1rem" }}>{chartTitle}</h2>

            <ResponsiveContainer width="100%" height={420}>
              {viewMode === "line" ? (
                <LineChart data={chartSource}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
                  <XAxis
                    dataKey="month"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: theme.chartTick }}
                    axisLine={{ stroke: theme.chartAxis }}
                    tickLine={{ stroke: theme.chartAxis }}
                  />
                  <YAxis
                    tickFormatter={(v) => (metric === "r12" ? fmtPct(v) : formatAbbrev(v))}
                    label={{
                      value: chartTitle,
                      angle: -90,
                      position: "insideLeft",
                      fill: theme.chartTick,
                    }}
                    tick={{ fill: theme.chartTick }}
                    axisLine={{ stroke: theme.chartAxis }}
                    tickLine={{ stroke: theme.chartAxis }}
                  />
                  <Tooltip
                    labelFormatter={(label) => label}
                    formatter={(v) =>
                      metric === "r12" ? fmtPct(v) : fmtValue(v, datasetConfig)
                    }
                    contentStyle={{
                      backgroundColor: theme.tooltipBackground,
                      border: `1px solid ${theme.tooltipBorder}`,
                      borderRadius: 8,
                      color: theme.tooltipText,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                    }}
                    labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: theme.tooltipText }}
                    cursor={{ stroke: theme.chartCursor, strokeDasharray: "3 3" }}
                  />
                  <Legend
                    wrapperStyle={{ color: theme.chartLegend }}
                    onMouseEnter={(o) => {
                      if (o?.value) setHoveredCategory(o.value);
                    }}
                    onMouseLeave={() => setHoveredCategory(null)}
                  />
                  <ReferenceLine y={0} stroke={theme.chartReference} strokeDasharray="3 3" />
                  {selectedCategories.map((cat) => (
                    <Line
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      stroke={categoryColors[cat] || theme.primarySurface}
                      strokeWidth={activeHover === cat ? 2.75 : 2}
                      strokeOpacity={activeHover && activeHover !== cat ? 0.25 : 1}
                      dot={{
                        r: 2,
                        stroke: categoryColors[cat] || theme.primarySurface,
                        fill: categoryColors[cat] || theme.primarySurface,
                        strokeOpacity: activeHover && activeHover !== cat ? 0.25 : 1,
                        fillOpacity: activeHover && activeHover !== cat ? 0.25 : 1,
                      }}
                      activeDot={{
                        r: 4,
                        stroke: categoryColors[cat] || theme.primarySurface,
                        fill: categoryColors[cat] || theme.primarySurface,
                      }}
                      connectNulls
                    />
                  ))}
                  <Brush
                    dataKey="month"
                    height={24}
                    travellerWidth={8}
                    stroke={theme.brushStroke}
                    fill={theme.brushFill}
                  />
                </LineChart>
              ) : (
                <BarChart data={chartSource}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
                  <XAxis
                    dataKey="month"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: theme.chartTick }}
                    axisLine={{ stroke: theme.chartAxis }}
                    tickLine={{ stroke: theme.chartAxis }}
                  />
                  <YAxis
                    tickFormatter={(v) => (metric === "r12" ? fmtPct(v) : formatAbbrev(v))}
                    label={{
                      value: chartTitle,
                      angle: -90,
                      position: "insideLeft",
                      fill: theme.chartTick,
                    }}
                    tick={{ fill: theme.chartTick }}
                    axisLine={{ stroke: theme.chartAxis }}
                    tickLine={{ stroke: theme.chartAxis }}
                  />
                  <Tooltip
                    labelFormatter={(label) => label}
                    formatter={(v) =>
                      metric === "r12" ? fmtPct(v) : fmtValue(v, datasetConfig)
                    }
                    contentStyle={{
                      backgroundColor: theme.tooltipBackground,
                      border: `1px solid ${theme.tooltipBorder}`,
                      borderRadius: 8,
                      color: theme.tooltipText,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                    }}
                    labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: theme.tooltipText }}
                    cursor={{ stroke: theme.chartCursor, strokeDasharray: "3 3" }}
                  />
                  <Legend
                    wrapperStyle={{ color: theme.chartLegend }}
                    onMouseEnter={(o) => {
                      if (o?.value) setHoveredCategory(o.value);
                    }}
                    onMouseLeave={() => setHoveredCategory(null)}
                  />
                  <ReferenceLine y={0} stroke={theme.chartReference} strokeDasharray="3 3" />
                  {selectedCategories.map((cat) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      fill={categoryColors[cat] || theme.primarySurface}
                      fillOpacity={activeHover && activeHover !== cat ? 0.35 : 1}
                    />
                  ))}
                  <Brush
                    dataKey="month"
                    height={24}
                    travellerWidth={8}
                    stroke={theme.brushStroke}
                    fill={theme.brushFill}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>

            {metric === "r12" && (
              <div style={{ marginTop: 6, fontSize: 12, color: theme.caption }}>
                R12 growth requires 24 months of history. Early months without a full prior 12-month baseline are shown as blanks.
              </div>
            )}
            {metric === "r12Value" && (
              <div style={{ marginTop: 6, fontSize: 12, color: theme.caption }}>
                Rolling 12 values require 12 months of history. Months before a full 12-month window are shown as blanks.
              </div>
            )}
          </div>

          {/* Summary */}
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 8px 0", textAlign: "center" }}>Summary</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {selectedCategories.map((cat) => {
                const s = summaryStats[cat];
                if (!s) return null;
                return (
                  <div key={cat} className="summary-card" style={{ flex: "1 1 220px" }}>
                    <div className="summary-title">{cat}</div>
                    <div className="summary-row">
                      Latest: <b>{metric === "r12" ? fmtPct(s.latest) : fmtValue(s.latest, datasetConfig)}</b>
                    </div>
                    <div className="summary-row">
                      Avg: <b>{metric === "r12" ? fmtPct(s.avg) : fmtValue(s.avg, datasetConfig)}</b>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary by Branch (value metric) */}
            {metric !== "r12" && branchSummary.rows.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", textAlign: "center" }}>
                  Summary by Branch (current selection)
                </h4>
                <div
                  style={{
                    overflowX: "auto",
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    background: theme.surface,
                    boxShadow: theme.shadow,
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: theme.tableHeaderBg }}>
                        <th style={thCell}>Branch</th>
                        {selectedCategories.map((c) => (
                          <th key={c} style={{ ...thCell, textAlign: "right" }}>{c}</th>
                        ))}
                        <th style={{ ...thCell, textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchSummary.rows.map((r) => (
                        <tr key={r.Branch} style={{ borderTop: `1px solid ${theme.tableRowBorder}` }}>
                          <td style={tdCell}>{r.Branch}</td>
                          {selectedCategories.map((c) => (
                            <td key={c} style={{ ...tdCell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {fmtValue(r[c] || 0, datasetConfig)}
                            </td>
                          ))}
                          <td style={{ ...tdCell, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            {fmtValue(r.__total || 0, datasetConfig)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: `2px solid ${theme.borderStrong}`, background: theme.tableFooterBg }}>
                        <td style={{ ...tdCell, fontWeight: 700 }}>Total</td>
                        {selectedCategories.map((c) => (
                          <td key={c} style={{ ...tdCell, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                            {fmtValue(branchSummary.totals[c] || 0, datasetConfig)}
                          </td>
                        ))}
                        <td style={{ ...tdCell, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                          {fmtValue(branchSummary.totals.__total || 0, datasetConfig)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style={{ color: theme.caption, fontSize: 12, marginTop: 6, textAlign: "center" }}>
                  Includes filters: date range, branch picker, and selected categories.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

