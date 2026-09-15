/**
 * The board UI: one server-rendered page, no build step, no framework.
 * It fetches /api/board and re-renders whenever /stream says something moved.
 */
export function boardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Agent Board</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --surface: #ffffff; --border: #dfe3e8;
    --text: #1b1f24; --muted: #646d78;
    --accent: #0b6e75;
    --backlog: #8a8f98; --in_progress: #0b6e75; --waiting: #8a6410;
    --idle: #5b6472; --done: #2e6f4e;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14171a; --surface: #1c2024; --border: #2c3238;
      --text: #e8eaed; --muted: #97a0aa;
      --accent: #4fb3b9;
      --backlog: #7b828c; --in_progress: #4fb3b9; --waiting: #cf9a2e;
      --idle: #808995; --done: #5aa87c;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-size: 14px; }
  header {
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--surface);
  }
  h1 { font-size: 16px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
  .status { color: var(--muted); font-size: 12px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%;
         background: var(--muted); margin-right: 5px; vertical-align: middle; }
  .dot.live { background: var(--done); }
  main { display: grid; gap: 14px; padding: 16px 20px;
         grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
  section { min-width: 0; }
  .col-head {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
    padding-bottom: 8px; margin-bottom: 10px; border-bottom: 2px solid currentColor;
  }
  .col-head .count { font-weight: 500; opacity: 0.7; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; margin-bottom: 8px;
  }
  .card h2 {
    font-size: 13px; font-weight: 600; margin: 0 0 6px; line-height: 1.35; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
          font-size: 11px; color: var(--muted); }
  .chip { border: 1px solid var(--border); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
  .chip.unknown { border-color: var(--waiting); color: var(--waiting); }
  .summary {
    margin-top: 7px; font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
    font-size: 11px; color: var(--muted); line-height: 1.45; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .empty { color: var(--muted); font-size: 12px; font-style: italic; padding: 4px 0; }
</style>
</head>
<body>
<header>
  <h1>Agent Board</h1>
  <span class="status"><span class="dot" id="dot"></span><span id="conn">connecting…</span></span>
  <span class="status" id="counts"></span>
</header>
<main id="board"></main>
<script>
const COLUMNS = [
  ["backlog", "Backlog"],
  ["in_progress", "In progress"],
  ["waiting", "Waiting on me"],
  ["idle", "Idle"],
  ["done", "Done"],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function render(data) {
  const byColumn = Object.fromEntries(COLUMNS.map(([k]) => [k, []]));
  for (const t of data.tasks) (byColumn[t.board_column] ??= []).push(t);

  document.getElementById("counts").textContent =
    data.tasks.length + (data.tasks.length === 1 ? " card" : " cards");

  document.getElementById("board").innerHTML = COLUMNS.map(([key, label]) => {
    const cards = byColumn[key] ?? [];
    return \`<section>
      <div class="col-head" style="color: var(--\${key})">
        <span>\${label}</span><span class="count">\${cards.length}</span>
      </div>
      \${cards.length === 0 ? '<p class="empty">nothing here</p>' : cards.map(cardHtml).join("")}
    </section>\`;
  }).join("");
}

function cardHtml(t) {
  const host = t.host
    ? \`<span class="chip \${t.host_kind === "unknown" ? "unknown" : ""}">\${esc(t.host)}</span>\`
    : "";
  const sessions = t.sessions > 1 ? \`<span class="chip">\${t.sessions} sessions</span>\` : "";
  const summary = t.last_summary
    ? \`<div class="summary">\${esc(t.last_summary)}</div>\`
    : "";
  return \`<article class="card">
    <h2>\${esc(t.title)}</h2>
    <div class="meta">
      \${host}\${sessions}
      <span>\${esc(t.last_event ?? "")}</span>
      <span>· \${ago(t.updated_at)}</span>
    </div>
    \${summary}
  </article>\`;
}

async function refresh() {
  try {
    const res = await fetch("/api/board");
    render(await res.json());
  } catch (e) {
    console.error(e);
  }
}

function connect() {
  const src = new EventSource("/stream");
  src.onopen = () => {
    document.getElementById("dot").className = "dot live";
    document.getElementById("conn").textContent = "live";
    refresh();
  };
  src.onmessage = refresh;
  src.onerror = () => {
    document.getElementById("dot").className = "dot";
    document.getElementById("conn").textContent = "reconnecting…";
  };
}

refresh();
connect();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
}
