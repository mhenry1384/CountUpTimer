const windowApi = window.__TAURI__.window;
const appWindow = windowApi.getCurrentWindow();

const CONFIG_PATH = "./config.json";
const STORAGE_KEY = "countup-timer-window-bounds-v2";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseConfig(json) {
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

function getTimeComponents(from, to) {
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

function createBar(kind, value, label, max) {
  const wrapper = document.createElement("div");
  wrapper.className = "bar";
  wrapper.dataset.kind = kind;

  const fillEl = document.createElement("div");
  fillEl.className = "bar__fill";
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  fillEl.style.width = `${pct}%`;

  const valueEl = document.createElement("div");
  valueEl.className = "bar__value";
  valueEl.textContent = String(value).padStart(2, "0");

  const labelEl = document.createElement("div");
  labelEl.className = "bar__label";
  labelEl.textContent = label;

  wrapper.append(fillEl, valueEl, labelEl);
  return wrapper;
}

function showError(message) {
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

function renderCountdown(components) {
  const container = document.getElementById("bars");
  if (!container) return;

  const rows = [];
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
  rows.push({
    kind: "hours",
    label: "hours",
    value: components.hours,
    max: 24,
  });
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
      const fill = bar.querySelector(".bar__fill");
      const val = bar.querySelector(".bar__value");
      if (fill) {
        const pct =
          row.max > 0 ? Math.min(100, (row.value / row.max) * 100) : 0;
        fill.style.width = `${pct}%`;
      }
      if (val) {
        val.textContent = String(row.value).padStart(2, "0");
      }
    });
  }
}

function loadStoredBounds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveBounds(position, size) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ position, size, savedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

async function ensureWindowOnScreen() {
  const saved = loadStoredBounds();
  if (!saved || !saved.position || !saved.size) return;

  try {
    const { position, size } = saved;
    await appWindow.setSize(size);

    const getMonitors = async () => {
      try {
        if (typeof windowApi.availableMonitors === "function") {
          const all = await windowApi.availableMonitors();
          if (Array.isArray(all)) {
            return all;
          }
        }
      } catch {
        // ignore
      }

      try {
        const current = await appWindow.currentMonitor();
        return current ? [current] : [];
      } catch {
        return [];
      }
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const monitors = await getMonitors();

      if (!Array.isArray(monitors) || monitors.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }

      const isOnConnectedMonitor = monitors.some((monitor) => {
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
        await appWindow.setPosition(position);
      }

      break;
    }
  } catch {
    // Ignore and let the window open normally.
  }
}

async function attachBoundsPersistence() {
  const save = async () => {
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

  await ensureWindowOnScreen();
  try {
    await attachBoundsPersistence();
  } catch {
    // ignore
  }

  try {
    const configResponse = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (!configResponse.ok) {
      throw new Error(`Failed to load config (${configResponse.status})`);
    }

    const configJson = await configResponse.json();
    const target = parseConfig(configJson);

    const tick = () => {
      const now = new Date();
      const components = getTimeComponents(now, target);
      renderCountdown(components);
    };

    hideError();
    tick();
    setInterval(tick, 1000);
  } catch (err) {
    console.error(err);
    showError(err.message || "Unable to load configuration");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error(err);
  });
});
