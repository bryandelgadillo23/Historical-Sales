const LIGHTNESS_STOPS = [45, 52, 58, 64];
const SATURATION = 65;

export function colorFromString(key) {
  const input = String(key ?? "");
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const lightness = LIGHTNESS_STOPS[hash % LIGHTNESS_STOPS.length];
  return `hsl(${hue}, ${SATURATION}%, ${lightness}%)`;
}

function readStorage(storageKey) {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("Failed to read stored color map", err);
    return {};
  }
}

function writeStorage(storageKey, payload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(storageKey, JSON.stringify(payload));
  } catch (err) {
    console.warn("Failed to persist color map", err);
  }
}

export function getPersistentColorMap(keys, storageKey, overrides = {}) {
  const validKeys = Array.isArray(keys) ? keys.filter(Boolean) : [];
  const stored = readStorage(storageKey);
  const map = {};

  for (const key of validKeys) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      map[key] = overrides[key];
      continue;
    }
    if (stored && Object.prototype.hasOwnProperty.call(stored, key)) {
      map[key] = stored[key];
      continue;
    }
    map[key] = colorFromString(key);
  }

  const merged = { ...stored, ...map };
  for (const [overrideKey, value] of Object.entries(overrides)) {
    merged[overrideKey] = value;
    if (validKeys.includes(overrideKey)) {
      map[overrideKey] = value;
    }
  }

  writeStorage(storageKey, merged);
  return map;
}
