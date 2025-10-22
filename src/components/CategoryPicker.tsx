// @ts-nocheck
import React, { useMemo, useState } from "react";
import {
  ALL_DEPARTMENTS,
  DEPT_MAP,
  flattenAllMetrics,
} from "../constants/departments";

const BASE_EXPANDED_STATE = {
  Equipment: false,
  Rental: false,
  Parts: false,
  Service: false,
  Other: false,
};

const DEFAULT_THEME = {
  surface: "#ffffff",
  border: "#e2e8f0",
  shadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  textPrimary: "#0f172a",
  textMuted: "#64748b",
  controlSurface: "#f8fafc",
  controlBorder: "#cbd5e1",
  controlText: "#0f172a",
  controlSurfaceHover: "#eef2f7",
};

const KNOWN_METRICS_SET = new Set(flattenAllMetrics());

const CategoryPicker = ({
  selectedMetrics,
  onChange,
  defaultExpanded = [],
  availableMetrics,
  theme: themeProp,
}) => {
  const theme = { ...DEFAULT_THEME, ...(themeProp || {}) };
  const [expanded, setExpanded] = useState(() => {
    const base = { ...BASE_EXPANDED_STATE };
    defaultExpanded.forEach((dept) => {
      if (dept in base) base[dept] = true;
    });
    return base;
  });

  const availableSet = useMemo(() => {
    if (!Array.isArray(availableMetrics) || !availableMetrics.length) return null;
    return new Set(availableMetrics);
  }, [availableMetrics]);

  const metricsByDepartment = useMemo(() => {
    const result = {};
    ALL_DEPARTMENTS.forEach((dept) => {
      const entries = DEPT_MAP[dept] || [];
      result[dept] = availableSet
        ? entries.filter((metric) => availableSet.has(metric))
        : [...entries];
    });
    return result;
  }, [availableSet]);

  const extraMetrics = useMemo(() => {
    if (!Array.isArray(availableMetrics) || !availableMetrics.length) return [];
    return availableMetrics.filter((metric) => !KNOWN_METRICS_SET.has(metric));
  }, [availableMetrics]);

  const groups = useMemo(() => {
    const entries = ALL_DEPARTMENTS.map((dept) => ({
      key: dept,
      label: dept,
      metrics: metricsByDepartment[dept] || [],
    })).filter((group) => group.metrics.length > 0);
    if (extraMetrics.length) {
      entries.push({ key: "Other", label: "Other Metrics", metrics: extraMetrics });
    }
    return entries;
  }, [metricsByDepartment, extraMetrics]);

  const toggleExpand = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const isGroupAllSelected = (key) => {
    const group = groups.find((g) => g.key === key);
    if (!group || !group.metrics.length) return false;
    return group.metrics.every((metric) => selectedMetrics.includes(metric));
  };

  const isGroupPartiallySelected = (key) => {
    const group = groups.find((g) => g.key === key);
    if (!group || !group.metrics.length) return false;
    const count = group.metrics.filter((metric) => selectedMetrics.includes(metric)).length;
    return count > 0 && count < group.metrics.length;
  };

  const toggleGroupAll = (key) => {
    const group = groups.find((g) => g.key === key);
    if (!group || !group.metrics.length) return;
    if (isGroupAllSelected(key)) {
      onChange(selectedMetrics.filter((metric) => !group.metrics.includes(metric)));
    } else {
      const next = new Set(selectedMetrics);
      group.metrics.forEach((metric) => next.add(metric));
      onChange(Array.from(next));
    }
  };

  const toggleMetric = (metric) => {
    if (selectedMetrics.includes(metric)) {
      onChange(selectedMetrics.filter((m) => m !== metric));
    } else {
      onChange([...selectedMetrics, metric]);
    }
  };

  const allExpanded = useMemo(() => {
    if (!groups.length) return false;
    return groups.every((group) => expanded[group.key]);
  }, [groups, expanded]);

  const setAllExpanded = (value) => {
    setExpanded((prev) => {
      const next = { ...prev };
      groups.forEach((group) => {
        next[group.key] = value;
      });
      return next;
    });
  };

  const hasGroups = groups.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: theme.textPrimary,
        }}
      >
        <div style={{ fontWeight: 600 }}>Categories</div>
        <button
          type="button"
          onClick={() => hasGroups && setAllExpanded(!allExpanded)}
          style={{
            background: "transparent",
            border: "none",
            color: theme.textMuted,
            textDecoration: "underline",
            fontSize: 13,
            cursor: hasGroups ? "pointer" : "not-allowed",
            opacity: hasGroups ? 1 : 0.5,
            padding: 0,
          }}
          disabled={!hasGroups}
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {groups.map((group) => {
        const metrics = group.metrics;
        if (!metrics.length) {
          return null;
        }
        const all = isGroupAllSelected(group.key);
        const partial = isGroupPartiallySelected(group.key);

        return (
          <div
            key={group.key}
            style={{
              borderRadius: 12,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              boxShadow: theme.shadow,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => toggleExpand(group.key)}
                aria-label={`Toggle ${group.label}`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${theme.controlBorder}`,
                  background: theme.controlSurface,
                  color: theme.controlText,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                {expanded[group.key] ? "▾" : "▸"}
              </button>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  color: theme.textPrimary,
                  fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = partial && !all;
                  }}
                  onChange={() => toggleGroupAll(group.key)}
                  style={{ width: 18, height: 18 }}
                />
                <span>{group.label}</span>
                <span style={{ fontSize: 12, color: theme.textMuted }}>
                  {group.key === "Other" ? "(All other metrics)" : `(All in ${group.label})`}
                </span>
              </label>
            </div>

            {expanded[group.key] && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 8,
                }}
              >
                {metrics.map((metric) => (
                  <label
                    key={metric}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: theme.textPrimary,
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMetrics.includes(metric)}
                      onChange={() => toggleMetric(metric)}
                      style={{ width: 16, height: 16 }}
                    />
                    <span>{metric}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CategoryPicker;
