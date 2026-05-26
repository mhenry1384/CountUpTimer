type TauriWindowApi = {
  getCurrentWindow: () => any;
  PhysicalPosition?: new (x: number, y: number) => any;
  LogicalPosition?: new (x: number, y: number) => any;
  PhysicalSize?: new (width: number, height: number) => any;
  LogicalSize?: new (width: number, height: number) => any;
  availableMonitors?: () => Promise<any[]>;
};

const windowApi = (window as any).__TAURI__?.window as TauriWindowApi;
if (!windowApi || typeof windowApi.getCurrentWindow !== "function") {
  throw new Error("Tauri window API is not available");
}
const appWindow = windowApi.getCurrentWindow();

const CONFIG_PATH = "./config.json";
const STORAGE_KEY = "countup-timer-window-bounds-v2";
const SETTINGS_STORAGE_KEY = "countup-timer-settings-v1";
const BOUNDS_DIAG = true;

let isRestoringWindowBounds = true;
let panelVisible = false;
let panelType: "about" | "settings" | null = null;
let originalWindowState: {
  position: { x: number; y: number };
  size: { width: number; height: number };
} | null = null;
let currentTarget: Date | null = null;
let cachedConfigJson: any = null;

const ABOUT_PANEL_SIZE = { width: 520, height: 300 };
const SETTINGS_PANEL_SIZE = { width: 520, height: 340 };

function boundsLog(...args: unknown[]) {
  if (!BOUNDS_DIAG) return;
  console.info("[bounds]", ...args);
}

function parseConfig(json: any): Date {
  if (typeof json !== "object" || json === null) {
    throw new Error("Invalid config");
  }

  if (json.datetime) {
    return new Date(json.datetime);
  }

  if (json.date && json.time) {
    return new Date(`${json.date}T${json.time}`);
  }

  if (json.date) {
    return new Date(json.date);
  }

  throw new Error("Config must include either datetime or date + time");
}

function loadSavedSettings(): { date: string; time: string } | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.date === "string" &&
      typeof parsed.time === "string"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveSettings(settings: { date: string; time: string }) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function renderSettingsForm() {
  const dateInput = document.getElementById(
    "settings-date",
  ) as HTMLInputElement | null;
  const timeInput = document.getElementById(
    "settings-time",
  ) as HTMLInputElement | null;
  if (!dateInput || !timeInput) return;

  const saved = loadSavedSettings();
  if (saved) {
    dateInput.value = saved.date;
    timeInput.value = saved.time;
    return;
  }

  if (cachedConfigJson) {
    dateInput.value = cachedConfigJson.date ?? "";
    timeInput.value = cachedConfigJson.time ?? "";
  }
}


function showPanel(type: "about" | "settings") {
  const panel = document.getElementById("app-panel");
  if (!panel) return;
  panelVisible = true;
  panelType = type;
  panel.classList.add("app__panel--visible");

  const aboutSection = document.getElementById("about-panel");
  const settingsSection = document.getElementById("settings-panel");
  if (aboutSection)
    aboutSection.style.display = type === "about" ? "block" : "none";
  if (settingsSection)
    settingsSection.style.display = type === "settings" ? "block" : "none";

  if (type === "settings") {
    renderSettingsForm();
  }
}

async function openPanel(type: "about" | "settings") {
  if (panelVisible) return;
  try {
    const currentPosition = await appWindow.outerPosition();
    const currentSize = await appWindow.outerSize();
    originalWindowState = {
      position: { x: currentPosition.x, y: currentPosition.y },
      size: { width: currentSize.width, height: currentSize.height },
    };
    const size = type === "about" ? ABOUT_PANEL_SIZE : SETTINGS_PANEL_SIZE;
    await setWindowLogicalSize(size.width, size.height);
  } catch {
    // ignore
  }
  showPanel(type);
}

async function closePanel() {
  if (!panelVisible) return;
  panelVisible = false;
  panelType = null;
  const panel = document.getElementById("app-panel");
  if (panel) {
    panel.classList.remove("app__panel--visible");
  }
  if (originalWindowState) {
    try {
      await setWindowPhysicalSize(
        originalWindowState.size.width,
        originalWindowState.size.height,
      );
      await setWindowPhysicalPosition(
        originalWindowState.position.x,
        originalWindowState.position.y,
      );
    } catch {
      // ignore
    }
    originalWindowState = null;
  }
}

function setupContextMenu() {
  const form = document.getElementById(
    "settings-form",
  ) as HTMLFormElement | null;
  const closeButton = document.getElementById("panel-close");
  const settingsCancel = document.getElementById("settings-cancel");
  const aboutOk = document.getElementById("about-ok");
  const panel = document.getElementById("app-panel");

  // Right-click triggers the native OS context menu via Tauri
  document.addEventListener("contextmenu", async (event) => {
    event.preventDefault();
    const invoke = tauriInvoke();
    if (invoke) {
      try {
        await invoke("show_context_menu");
      } catch {
        // ignore
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePanel();
    }
  });

  // Listen for native context menu item selections
  appWindow
    .listen("contextmenu-action", (event: any) => {
      const action = event.payload as string;
      if (action === "about") openPanel("about").catch(() => {});
      else if (action === "settings") openPanel("settings").catch(() => {});
    })
    .catch(() => {});

  if (closeButton) {
    closeButton.addEventListener("click", () => closePanel());
  }

  if (aboutOk) {
    aboutOk.addEventListener("click", () => closePanel());
  }

  if (settingsCancel) {
    settingsCancel.addEventListener("click", () => closePanel());
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const dateInput = document.getElementById(
        "settings-date",
      ) as HTMLInputElement | null;
      const timeInput = document.getElementById(
        "settings-time",
      ) as HTMLInputElement | null;
      if (!dateInput || !timeInput) return;

      const date = dateInput.value.trim();
      const time = timeInput.value.trim();
      if (!date || !time) {
        showError("Please select both a date and a time.");
        return;
      }

      try {
        saveSettings({ date, time });
        currentTarget = parseConfig({ date, time });
        hideError();
        closePanel();
      } catch (err: any) {
        showError(err.message || "Unable to save settings");
      }
    });
  }

  if (panel) {
    panel.addEventListener("click", (event) => {
      if (event.target === panel) {
        closePanel();
      }
    });
  }
}

function loadTargetFromConfigJson(configJson: any): Date {
  cachedConfigJson = configJson;
  const saved = loadSavedSettings();
  if (saved) {
    return parseConfig(saved);
  }
  return parseConfig(configJson);
}

function getTimeComponents(from: Date, to: Date) {
  const start = new Date(from);
  const end = new Date(to);
  const future = end.getTime() >= start.getTime();

  const a = future ? start : end;
  const b = future ? end : start;

  let years = b.getFullYear() - a.getFullYear();
  let months = b.getMonth() - a.getMonth();
  let days = b.getDate() - a.getDate();
  let hours = b.getHours() - a.getHours();
  let minutes = b.getMinutes() - a.getMinutes();
  let seconds = b.getSeconds() - a.getSeconds();

  if (seconds < 0) {
    seconds += 60;
    minutes -= 1;
  }

  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
  }

  if (hours < 0) {
    hours += 24;
    days -= 1;
  }

  if (days < 0) {
    const daysInPreviousMonth = new Date(
      b.getFullYear(),
      b.getMonth(),
      0,
    ).getDate();
    days += daysInPreviousMonth;
    months -= 1;
  }

  if (months < 0) {
    months += 12;
    years -= 1;
  }

  return {
    years: Math.max(0, years),
    months: Math.max(0, months),
    days: Math.max(0, days),
    hours: Math.max(0, hours),
    minutes: Math.max(0, minutes),
    seconds: Math.max(0, seconds),
    future,
  };
}

function createBar(kind: string, value: number, label: string, max: number) {
  const wrapper = document.createElement("div");
  wrapper.className = "bar";
  wrapper.dataset.kind = kind;

  const fillEl = document.createElement("div");
  fillEl.className = "bar__fill";
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  fillEl.style.width = `${pct}%`;

  const valueEl = document.createElement("div");
  valueEl.className = "bar__value";
  valueEl.textContent = String(value);

  const labelEl = document.createElement("div");
  labelEl.className = "bar__label";
  labelEl.textContent = label;

  wrapper.append(fillEl, valueEl, labelEl);
  return wrapper;
}

function showError(message: string) {
  const errorEl = document.getElementById("error");
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.add("app__error--active");
}

function hideError() {
  const errorEl = document.getElementById("error");
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.classList.remove("app__error--active");
}

function getDaysInCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

function renderCountdown(components: ReturnType<typeof getTimeComponents>) {
  const container = document.getElementById("bars");
  if (!container) return;

  const rows: Array<{
    kind: string;
    label: string;
    value: number;
    max: number;
  }> = [];

  if (components.years >= 1) {
    rows.push({
      kind: "years",
      label: "years",
      value: components.years,
      max: Math.max(10, components.years),
    });
  }
  if (components.months >= 1) {
    rows.push({
      kind: "months",
      label: "months",
      value: components.months,
      max: 12,
    });
  }

  rows.push({
    kind: "days",
    label: "days",
    value: components.days,
    max: getDaysInCurrentMonth(),
  });
  rows.push({ kind: "hours", label: "hours", value: components.hours, max: 24 });
  rows.push({
    kind: "minutes",
    label: "minutes",
    value: components.minutes,
    max: 60,
  });
  rows.push({
    kind: "seconds",
    label: "seconds",
    value: components.seconds,
    max: 60,
  });

  const kindKey = rows.map((r) => r.kind).join(",");
  if (container.dataset.kinds !== kindKey) {
    container.innerHTML = "";
    container.dataset.kinds = kindKey;
    rows.forEach((row) =>
      container.appendChild(createBar(row.kind, row.value, row.label, row.max)),
    );
  } else {
    rows.forEach((row, i) => {
      const bar = container.children[i];
      if (!bar) return;
      const fill = bar.querySelector<HTMLElement>(".bar__fill");
      const val = bar.querySelector<HTMLElement>(".bar__value");
      if (fill) {
        const pct =
          row.max > 0 ? Math.min(100, (row.value / row.max) * 100) : 0;
        fill.style.width = `${pct}%`;
      }
      if (val) {
        val.textContent = String(row.value);
      }
    });
  }
}

function loadStoredBounds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    boundsLog("loaded", parsed);
    return parsed;
  } catch {
    boundsLog("failed to parse stored bounds");
    return null;
  }
}

function normalizePosition(position: any) {
  if (!position) return null;

  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x: Math.round(x), y: Math.round(y) };
}

function normalizeSize(size: any) {
  if (!size) return null;

  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: Math.max(120, Math.round(width)),
    height: Math.max(90, Math.round(height)),
  };
}

function toTauriPosition(position: { x: number; y: number } | null) {
  if (!position) return position;
  if (typeof windowApi.PhysicalPosition === "function") {
    return new windowApi.PhysicalPosition(position.x, position.y);
  }
  return position;
}

function toTauriSize(size: { width: number; height: number } | null) {
  if (!size) return size;
  if (typeof windowApi.PhysicalSize === "function") {
    return new windowApi.PhysicalSize(size.width, size.height);
  }
  return size;
}

function tauriInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<any>) | null {
  const t = (window as any).__TAURI__;
  return t?.core?.invoke ?? t?.tauri?.invoke ?? null;
}

async function setWindowLogicalSize(width: number, height: number) {
  const invoke = tauriInvoke();
  if (invoke) await invoke("set_logical_size", { width, height });
}

async function setWindowPhysicalSize(width: number, height: number) {
  const invoke = tauriInvoke();
  if (invoke) await invoke("set_physical_size", { width, height });
}

async function setWindowPhysicalPosition(x: number, y: number) {
  const invoke = tauriInvoke();
  if (invoke) await invoke("set_physical_position", { x, y });
}

function saveBounds(position: any, size: any) {
  try {
    const safePosition = normalizePosition(position);
    const safeSize = normalizeSize(size);
    if (!safePosition || !safeSize) {
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        position: safePosition,
        size: safeSize,
        savedAt: Date.now(),
      }),
    );
    boundsLog("saved", { position: safePosition, size: safeSize });
  } catch {
    // ignore
  }
}

async function getOuterPositionSafe() {
  try {
    const pos = await appWindow.outerPosition();
    return normalizePosition(pos);
  } catch {
    return null;
  }
}

function isApproxSamePosition(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
  tolerance = 2,
) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

async function applyWindowPosition(
  position: { x: number; y: number } | null,
) {
  if (!position) return false;

  try {
    await appWindow.setPosition(toTauriPosition(position));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterPhysical = await getOuterPositionSafe();
    boundsLog("after physical setPosition", {
      target: position,
      actual: afterPhysical,
    });
    if (isApproxSamePosition(afterPhysical, position)) {
      return true;
    }
  } catch {
    boundsLog("physical setPosition failed");
  }

  try {
    if (typeof windowApi.LogicalPosition === "function") {
      await appWindow.setPosition(
        new windowApi.LogicalPosition(position.x, position.y),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      const afterLogical = await getOuterPositionSafe();
      boundsLog("after logical setPosition", {
        target: position,
        actual: afterLogical,
      });
      return isApproxSamePosition(afterLogical, position);
    }
  } catch {
    boundsLog("logical setPosition failed");
  }

  return false;
}

async function ensureWindowOnScreen() {
  const saved = loadStoredBounds();
  if (!saved || !saved.position || !saved.size) return;

  try {
    const position = normalizePosition(saved.position);
    const size = normalizeSize(saved.size);
    if (!position || !size) return;

    await appWindow.setSize(toTauriSize(size));
    boundsLog("restoring size", size);

    const getMonitors = async () => {
      try {
        if (typeof appWindow.availableMonitors === "function") {
          const all = await appWindow.availableMonitors();
          if (Array.isArray(all)) return all;
        }
      } catch {
        boundsLog("appWindow.availableMonitors failed");
      }

      try {
        if (typeof windowApi.availableMonitors === "function") {
          const all = await windowApi.availableMonitors();
          if (Array.isArray(all)) return all;
        }
      } catch {
        boundsLog("windowApi.availableMonitors failed");
      }

      try {
        const monitorApi = (window as any).__TAURI__?.monitor;
        if (monitorApi && typeof monitorApi.availableMonitors === "function") {
          const all = await monitorApi.availableMonitors();
          if (Array.isArray(all)) return all;
        }
      } catch {
        boundsLog("monitor.availableMonitors failed");
      }

      try {
        const current = await appWindow.currentMonitor();
        return current ? [current] : [];
      } catch {
        boundsLog("currentMonitor failed");
        return [];
      }
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const monitors = await getMonitors();
      boundsLog("monitor query", { attempt, count: monitors.length });

      if (!Array.isArray(monitors) || monitors.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }

      const isOnConnectedMonitor = monitors.some((monitor: any) => {
        const left = monitor.position.x;
        const top = monitor.position.y;
        const right = left + monitor.size.width;
        const bottom = top + monitor.size.height;
        return (
          position.x >= left &&
          position.x < right &&
          position.y >= top &&
          position.y < bottom
        );
      });

      if (isOnConnectedMonitor) {
        const didApply = await applyWindowPosition(position);
        boundsLog("restore position result", {
          position,
          isOnConnectedMonitor,
          didApply,
        });
      } else {
        boundsLog("skipped position restore: not on connected monitor", position);
      }

      break;
    }
  } catch {
    boundsLog("ensureWindowOnScreen failed");
  }
}

async function attachBoundsPersistence() {
  const save = async () => {
    if (isRestoringWindowBounds) return;
    try {
      const position = await appWindow.outerPosition();
      const size = await appWindow.outerSize();
      if (position && size) {
        saveBounds(position, size);
      }
    } catch {
      // ignore
    }
  };

  appWindow.onResized(save);
  appWindow.onMoved(save);
  appWindow.onCloseRequested(save);
}

async function init() {
  try {
    await appWindow.setAlwaysOnTop(true);
  } catch {
    // ignore
  }
  isRestoringWindowBounds = false;

  try {
    const configResponse = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (!configResponse.ok) {
      throw new Error(`Failed to load config (${configResponse.status})`);
    }

    const configJson = await configResponse.json();
    currentTarget = loadTargetFromConfigJson(configJson);

    const tick = () => {
      const now = new Date();
      const components = getTimeComponents(now, currentTarget!);
      renderCountdown(components);
    };

    hideError();
    tick();
    setInterval(tick, 1000);
  } catch (err: any) {
    console.error(err);
    showError(err.message || "Unable to load configuration");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setupContextMenu();
  init().catch((err) => {
    console.error(err);
  });
});
