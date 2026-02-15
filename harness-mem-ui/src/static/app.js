const state = {
  tab: "search",
  pins: [],
  lastSearch: [],
};

const contentEl = document.getElementById("content");
const includePrivateEl = document.getElementById("include-private");
const healthDot = document.getElementById("health-dot");
const healthText = document.getElementById("health-text");

async function api(path, body = null) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

function toHtml(items) {
  if (!items || items.length === 0) return '<div class="item">No results</div>';
  return items
    .map((item) => {
      const tags = (item.tags || []).map((t) => `<span class="pill">${t}</span>`).join("");
      const privacy = (item.privacy_tags || []).map((t) => `<span class="pill">privacy:${t}</span>`).join("");
      const title = item.title || item.id || "untitled";
      const content = (item.content || item.summary || "").replace(/</g, "&lt;");
      return `
        <div class="item">
          <div><strong>${title}</strong></div>
          <div class="meta">id: ${item.id || "-"} / session: ${item.session_id || "-"}</div>
          <div style="margin-top:6px;white-space:pre-wrap;">${content}</div>
          <div style="margin-top:6px;">${tags}${privacy}</div>
          ${item.id ? `<button class="action" data-pin="${item.id}" style="margin-top:8px;">pin</button>` : ""}
        </div>
      `;
    })
    .join("");
}

function renderSearch() {
  contentEl.innerHTML = `
    <div class="row">
      <input id="q" placeholder="query" style="min-width:240px;" />
      <input id="project" placeholder="project (optional)" />
      <input id="session" placeholder="session_id (optional)" />
      <input id="limit" type="number" value="20" min="1" max="100" style="width:90px;" />
      <button class="action" id="run-search">search</button>
    </div>
    <div class="results" id="search-results"></div>
  `;

  document.getElementById("run-search").onclick = async () => {
    const payload = {
      query: document.getElementById("q").value,
      project: document.getElementById("project").value || undefined,
      session_id: document.getElementById("session").value || undefined,
      limit: Number(document.getElementById("limit").value || 20),
      include_private: includePrivateEl.checked,
    };
    const data = await api("/api/search", payload);
    state.lastSearch = data.items || [];
    document.getElementById("search-results").innerHTML = toHtml(data.items || []);
    wirePins();
  };
}

function renderTimeline() {
  contentEl.innerHTML = `
    <div class="row">
      <input id="timeline-id" placeholder="observation id" style="min-width:300px;" />
      <input id="before" type="number" value="5" min="0" max="50" style="width:90px;" />
      <input id="after" type="number" value="5" min="0" max="50" style="width:90px;" />
      <button class="action" id="run-timeline">timeline</button>
    </div>
    <div class="results" id="timeline-results"></div>
  `;
  document.getElementById("run-timeline").onclick = async () => {
    const data = await api("/api/timeline", {
      id: document.getElementById("timeline-id").value,
      before: Number(document.getElementById("before").value || 5),
      after: Number(document.getElementById("after").value || 5),
      include_private: includePrivateEl.checked,
    });
    document.getElementById("timeline-results").innerHTML = toHtml(data.items || []);
    wirePins();
  };
}

function renderObservation() {
  const pins = state.pins.join(",");
  contentEl.innerHTML = `
    <div class="row">
      <input id="obs-ids" placeholder="ids comma separated" style="min-width:380px;" value="${pins}" />
      <label><input id="compact" type="checkbox" checked /> compact</label>
      <button class="action" id="run-obs">load</button>
    </div>
    <div class="results" id="obs-results"></div>
  `;

  document.getElementById("run-obs").onclick = async () => {
    const ids = document
      .getElementById("obs-ids")
      .value.split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const data = await api("/api/observations", {
      ids,
      include_private: includePrivateEl.checked,
      compact: document.getElementById("compact").checked,
    });
    document.getElementById("obs-results").innerHTML = toHtml(data.items || []);
    wirePins();
  };
}

function renderSession() {
  contentEl.innerHTML = `
    <div class="row">
      <input id="resume-project" placeholder="project" />
      <input id="resume-session" placeholder="session_id (optional)" />
      <input id="resume-limit" type="number" value="5" min="1" max="20" style="width:90px;" />
      <button class="action" id="run-resume">resume pack</button>
      <button class="action" id="run-metrics" style="background:#0f766e;">metrics</button>
    </div>
    <div class="results" id="session-results"></div>
  `;

  document.getElementById("run-resume").onclick = async () => {
    const data = await api("/api/resume", {
      project: document.getElementById("resume-project").value,
      session_id: document.getElementById("resume-session").value || undefined,
      limit: Number(document.getElementById("resume-limit").value || 5),
      include_private: includePrivateEl.checked,
    });
    document.getElementById("session-results").innerHTML = toHtml(data.items || []);
    wirePins();
  };

  document.getElementById("run-metrics").onclick = async () => {
    const data = await api("/api/metrics");
    document.getElementById("session-results").innerHTML = toHtml(data.items || []);
  };
}

function wirePins() {
  for (const btn of document.querySelectorAll("button[data-pin]")) {
    btn.onclick = () => {
      const id = btn.getAttribute("data-pin");
      if (!id) return;
      if (!state.pins.includes(id)) state.pins.push(id);
      btn.textContent = "pinned";
    };
  }
}

function render() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === state.tab);
  }
  if (state.tab === "search") renderSearch();
  if (state.tab === "timeline") renderTimeline();
  if (state.tab === "observation") renderObservation();
  if (state.tab === "session") renderSession();
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.onclick = () => {
    state.tab = tab.dataset.tab;
    render();
  };
}

async function checkHealth() {
  const data = await api("/api/health");
  const ok = Boolean(data.ok);
  healthDot.classList.toggle("ok", ok);
  healthText.textContent = ok ? `daemon ok (${data.items?.[0]?.vector_engine || "unknown"})` : `daemon error`;
}

render();
checkHealth();
setInterval(checkHealth, 5000);
