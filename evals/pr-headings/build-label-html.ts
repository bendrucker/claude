import { readFileSync } from "fs";
import headings from "./headings.json";
import manifest from "./manifest.json";

type H = {
  text: string;
  words: number;
  kind: string;
  depth: number;
  url: string;
  mergedAt: string;
  repo: string;
  flagged: boolean;
};

type ManifestEntry = {
  file: string;
  url: string;
  repo: string;
  title: string;
  mergedAt: string;
};

const urlToFile = new Map<string, string>();
for (const m of manifest as ManifestEntry[]) {
  if (!urlToFile.has(m.url)) urlToFile.set(m.url, m.file);
}

const bodyCache = new Map<string, string[]>();
function bodyLines(file: string): string[] {
  if (bodyCache.has(file)) return bodyCache.get(file)!;
  let lines: string[] = [];
  try {
    const text = readFileSync(`${import.meta.dir}/bodies/${file}`, "utf8");
    lines = text.split("\n");
  } catch {
    lines = [];
  }
  bodyCache.set(file, lines);
  return lines;
}

const headingRe = /^(#{1,6})\s+(.*\S)\s*$/;

function headingLevel(line: string): number | null {
  const m = line.match(headingRe);
  if (!m) return null;
  return m[1].length;
}

function headingTextOf(line: string): string | null {
  const m = line.match(headingRe);
  if (!m) return null;
  return m[2].trim();
}

// Extract the section body for the first occurrence of `text` at `depth`.
function extractExcerpt(file: string, text: string, depth: number): string {
  const lines = bodyLines(file);
  for (let i = 0; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl === null) continue;
    if (headingTextOf(lines[i]) !== text) continue;
    // Found the heading. Collect until next heading of level <= lvl.
    const collected: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const nlvl = headingLevel(lines[j]);
      if (nlvl !== null && nlvl <= lvl) break;
      collected.push(lines[j]);
    }
    let excerpt = collected.join("\n").trim();
    if (excerpt.length > 600) excerpt = excerpt.slice(0, 600).trimEnd() + "…";
    return excerpt;
  }
  return "";
}

const hs = (headings as H[]).filter((h) => h.words >= 3);
const seen = new Set<string>();
const rows = hs
  .filter((h) => (seen.has(h.text) ? false : (seen.add(h.text), true)))
  .sort((a, b) => b.words - a.words);

type Item = {
  text: string;
  words: number;
  kind: string;
  url: string;
  excerpt: string;
};

const items: Item[] = rows.map((h) => {
  const file = urlToFile.get(h.url);
  const excerpt = file ? extractExcerpt(file, h.text, h.depth) : "";
  return {
    text: h.text,
    words: h.words,
    kind: h.kind,
    url: h.url,
    excerpt,
  };
});

const withExcerpt = items.filter((i) => i.excerpt.length > 0).length;
console.error(
  `prepared ${items.length} items, ${withExcerpt} with non-empty excerpt`,
);

const dataLiteral = JSON.stringify(items);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PR Heading Labeler</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #171a21;
    --panel-2: #1f232c;
    --text: #e6e9ef;
    --muted: #9aa3b0;
    --border: #2a2f3a;
    --good: #2ea043;
    --good-d: #238636;
    --bad: #d23c3c;
    --bad-d: #b62828;
    --skip: #6b7280;
    --accent: #58a6ff;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7f9;
      --panel: #ffffff;
      --panel-2: #f0f2f5;
      --text: #1a1d23;
      --muted: #5b626d;
      --border: #d8dce2;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 20px 80px;
  }
  header.intro {
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
    margin-bottom: 20px;
  }
  header.intro h1 {
    font-size: 18px;
    margin: 0 0 6px;
  }
  header.intro p {
    margin: 4px 0;
    color: var(--muted);
    font-size: 13px;
  }
  header.intro b.good { color: var(--good); }
  header.intro b.bad { color: var(--bad); }

  .progress-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
    font-size: 13px;
    color: var(--muted);
  }
  .bar {
    flex: 1;
    height: 8px;
    background: var(--panel-2);
    border-radius: 5px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .bar > span {
    display: block;
    height: 100%;
    width: 0%;
    background: var(--accent);
    transition: width 0.2s;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 22px 20px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .pill {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .meta a { color: var(--accent); text-decoration: none; }
  .meta a:hover { text-decoration: underline; }

  .heading-text {
    font-size: 26px;
    font-weight: 650;
    line-height: 1.3;
    margin: 6px 0 16px;
  }
  .verdict-tag {
    display: inline-block;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    padding: 2px 8px;
    margin-left: 8px;
    vertical-align: middle;
  }
  .verdict-tag.good { background: var(--good-d); color: #fff; }
  .verdict-tag.bad { background: var(--bad-d); color: #fff; }
  .verdict-tag.skip { background: var(--skip); color: #fff; }

  .excerpt-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .excerpt {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    padding: 12px 14px;
    font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
    max-height: 360px;
    overflow: auto;
  }
  .excerpt.empty { color: var(--muted); font-style: italic; }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    flex-wrap: wrap;
  }
  button.act {
    flex: 1;
    min-width: 120px;
    border: none;
    border-radius: 9px;
    padding: 14px 16px;
    font-size: 15px;
    font-weight: 650;
    color: #fff;
    cursor: pointer;
  }
  button.act .k {
    opacity: 0.8;
    font-weight: 500;
    font-size: 12px;
    margin-left: 6px;
  }
  button.good { background: var(--good); }
  button.good:hover { background: var(--good-d); }
  button.bad { background: var(--bad); }
  button.bad:hover { background: var(--bad-d); }
  button.skip { background: var(--skip); }
  button.skip:hover { filter: brightness(1.1); }

  .notes-block {
    margin-top: 18px;
  }
  .notes-block label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  textarea#notes {
    width: 100%;
    min-height: 80px;
    resize: vertical;
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  textarea#notes:focus {
    outline: none;
    border-color: var(--accent);
  }

  .rewrite-block {
    margin-top: 14px;
  }
  .rewrite-block label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .rewrite-block label .cue {
    text-transform: none;
    letter-spacing: 0;
    color: var(--good);
    font-weight: 650;
    margin-left: 6px;
    display: none;
  }
  input#rewrite {
    width: 100%;
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  input#rewrite:focus {
    outline: none;
    border-color: var(--accent);
  }
  .rewrite-block.emphasize input#rewrite {
    border-color: var(--good);
    background: color-mix(in srgb, var(--good) 12%, var(--panel-2));
  }
  .rewrite-block.emphasize label .cue {
    display: inline;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 14px;
    font-size: 13px;
    color: var(--muted);
  }
  .filter-row .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .filter-row .chip {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .filter-row .chip.active {
    background: var(--accent);
    color: #07121f;
    border-color: var(--accent);
    font-weight: 650;
  }
  #filter-count { color: var(--muted); }

  .nav {
    display: flex;
    gap: 10px;
    margin-top: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .nav button {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .nav button:hover { border-color: var(--accent); }
  .nav .spacer { flex: 1; }

  .hints {
    margin-top: 18px;
    font-size: 12px;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  kbd {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 1px 6px;
    font: 12px ui-monospace, monospace;
  }

  .export-row {
    display: flex;
    gap: 10px;
    margin-top: 22px;
    flex-wrap: wrap;
  }
  .export-row button {
    background: var(--accent);
    color: #07121f;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
  }
  .export-row button.secondary {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  #toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  #toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="wrap">
  <header class="intro">
    <h1>PR Heading Labeler</h1>
    <p>Label each PR section heading: is it a clean summary of the section, or a sentence pretending to be a heading?</p>
    <p><b class="good">Good</b> = concise noun-phrase summary of the section. <b class="bad">Bad</b> = a run-on sentence or sentence fragment used as a heading instead of a summary.</p>
  </header>

  <div class="progress-row">
    <span id="progress-text">0 / 0 labeled</span>
    <div class="bar"><span id="bar-fill"></span></div>
    <span id="position-text"></span>
  </div>

  <div class="filter-row">
    <span>Walk:</span>
    <div class="chips" id="filter-chips">
      <span class="chip active" data-filter="all">All</span>
      <span class="chip" data-filter="good">good</span>
      <span class="chip" data-filter="bad">bad</span>
      <span class="chip" data-filter="skip">skip</span>
      <span class="chip" data-filter="un-noted">un-noted</span>
      <span class="chip" data-filter="un-rewritten-bad">un-rewritten bad</span>
    </div>
    <span id="filter-count"></span>
  </div>

  <div class="card">
    <div class="meta">
      <span class="pill" id="words-pill"></span>
      <span class="pill" id="kind-pill"></span>
      <a id="pr-link" href="#" target="_blank" rel="noopener">PR &#8599;</a>
    </div>
    <div class="heading-text" id="heading-text"></div>
    <div class="excerpt-label">Section it heads</div>
    <div class="excerpt" id="excerpt"></div>

    <div class="actions">
      <button class="act good" data-verdict="good">Good<span class="k">(g)</span></button>
      <button class="act bad" data-verdict="bad">Bad<span class="k">(b)</span></button>
      <button class="act skip" data-verdict="skip">Skip<span class="k">(s)</span></button>
    </div>
    <div class="notes-block">
      <label for="notes">Notes &#8212; what you like/dislike about this heading</label>
      <textarea id="notes" placeholder="Free-text rationale (autosaves)"></textarea>
    </div>

    <div class="rewrite-block" id="rewrite-block">
      <label for="rewrite">Rewrite &#8212; the heading you'd actually want<span class="cue">&#8592; write the good version</span></label>
      <input type="text" id="rewrite" placeholder="A concise noun-phrase summary (autosaves)">
    </div>

    <div class="nav">
      <button id="prev-btn">&#8592; Prev</button>
      <button id="next-btn">Next &#8594;</button>
      <button id="undo-btn">Undo label (u)</button>
      <span class="spacer"></span>
      <button id="next-unnoted-btn">Next un-noted (n)</button>
    </div>

    <div class="hints">
      <span><kbd>g</kbd> good</span>
      <span><kbd>b</kbd> bad</span>
      <span><kbd>s</kbd> skip</span>
      <span><kbd>&#8592;</kbd>/<kbd>&#8594;</kbd> move</span>
      <span><kbd>u</kbd> undo</span>
      <span><kbd>n</kbd> next un-noted</span>
      <span><kbd>r</kbd> next un-rewritten bad</span>
      <span class="muted">(keys ignored while typing in Notes/Rewrite)</span>
    </div>
  </div>

  <div class="export-row">
    <button id="export-btn">Export labels.json</button>
    <button id="copy-btn" class="secondary">Copy JSON</button>
    <button id="import-btn" class="secondary">Import labels.json</button>
    <input type="file" id="import-file" accept="application/json,.json" style="display:none">
    <button id="reset-btn" class="secondary">Reset all labels</button>
  </div>
</div>
<div id="toast"></div>

<script>
const DATA = ${dataLiteral};
const STORAGE_KEY = "pr-heading-labels-v1";
const POS_KEY = "pr-heading-pos-v1";
const NOTES_KEY = "pr-heading-notes-v1";
const REWRITES_KEY = "pr-heading-rewrites-v1";

function loadMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch (e) {
    return {};
  }
}
function saveLabels(l) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
}
function saveNotes(n) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(n));
}
function saveRewrites(r) {
  localStorage.setItem(REWRITES_KEY, JSON.stringify(r));
}

let labels = loadMap(STORAGE_KEY);
let notes = loadMap(NOTES_KEY);
let rewrites = loadMap(REWRITES_KEY);
let filter = "all";
let pos = 0;
const savedPos = parseInt(localStorage.getItem(POS_KEY) || "", 10);
if (!Number.isNaN(savedPos) && savedPos >= 0 && savedPos < DATA.length) {
  pos = savedPos;
}

const el = {
  progressText: document.getElementById("progress-text"),
  positionText: document.getElementById("position-text"),
  barFill: document.getElementById("bar-fill"),
  wordsPill: document.getElementById("words-pill"),
  kindPill: document.getElementById("kind-pill"),
  prLink: document.getElementById("pr-link"),
  headingText: document.getElementById("heading-text"),
  excerpt: document.getElementById("excerpt"),
  notes: document.getElementById("notes"),
  rewrite: document.getElementById("rewrite"),
  rewriteBlock: document.getElementById("rewrite-block"),
  filterCount: document.getElementById("filter-count"),
  toast: document.getElementById("toast"),
};

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1400);
}

function labeledCount() {
  return Object.keys(labels).length;
}

function hasNote(item) {
  const n = notes[item.text];
  return typeof n === "string" && n.trim().length > 0;
}

function hasRewrite(item) {
  const r = rewrites[item.text];
  return typeof r === "string" && r.trim().length > 0;
}

function matchesFilter(item) {
  switch (filter) {
    case "all": return true;
    case "good": return labels[item.text] === "good";
    case "bad": return labels[item.text] === "bad";
    case "skip": return labels[item.text] === "skip";
    case "un-noted": return !hasNote(item);
    case "un-rewritten-bad": return labels[item.text] === "bad" && !hasRewrite(item);
    default: return true;
  }
}

function filteredIndices() {
  const out = [];
  for (let i = 0; i < DATA.length; i++) {
    if (matchesFilter(DATA[i])) out.push(i);
  }
  return out;
}

function render() {
  const item = DATA[pos];
  el.wordsPill.textContent = item.words + " words";
  el.kindPill.textContent = item.kind;
  el.prLink.href = item.url;

  el.headingText.textContent = item.text;
  const v = labels[item.text];
  if (v) {
    const tag = document.createElement("span");
    tag.className = "verdict-tag " + v;
    tag.textContent = v.toUpperCase();
    el.headingText.appendChild(tag);
  }

  if (item.excerpt && item.excerpt.length) {
    el.excerpt.textContent = item.excerpt;
    el.excerpt.classList.remove("empty");
  } else {
    el.excerpt.textContent = "(no section body found)";
    el.excerpt.classList.add("empty");
  }

  el.notes.value = notes[item.text] || "";
  el.rewrite.value = rewrites[item.text] || "";
  el.rewriteBlock.classList.toggle("emphasize", labels[item.text] === "bad");

  const labeled = labeledCount();
  el.progressText.textContent = labeled + " / " + DATA.length + " labeled";
  el.positionText.textContent = "#" + (pos + 1) + " of " + DATA.length;
  el.barFill.style.width = (DATA.length ? (labeled / DATA.length) * 100 : 0) + "%";

  const inFilter = filteredIndices();
  const rank = inFilter.indexOf(pos);
  if (filter === "all") {
    el.filterCount.textContent = inFilter.length + " items";
  } else {
    el.filterCount.textContent =
      inFilter.length + " in '" + filter + "'" +
      (rank >= 0 ? " (" + (rank + 1) + "/" + inFilter.length + ")" : " (current item not in filter)");
  }

  localStorage.setItem(POS_KEY, String(pos));
}

// Step to the next/prev item within the active filter, wrapping around.
function stepFiltered(delta) {
  const list = filteredIndices();
  if (list.length === 0) return -1;
  const rank = list.indexOf(pos);
  if (rank === -1) {
    // Current item isn't in the filter; jump to nearest in the step direction.
    if (delta >= 0) {
      for (const i of list) if (i > pos) return i;
      return list[0];
    } else {
      for (let k = list.length - 1; k >= 0; k--) if (list[k] < pos) return list[k];
      return list[list.length - 1];
    }
  }
  const next = (rank + delta + list.length) % list.length;
  return list[next];
}

function nextUnNoted(from) {
  for (let i = from; i < DATA.length; i++) {
    if (!hasNote(DATA[i])) return i;
  }
  for (let i = 0; i < from; i++) {
    if (!hasNote(DATA[i])) return i;
  }
  return -1;
}

function nextUnRewrittenBad(from) {
  const bad = (i) => labels[DATA[i].text] === "bad" && !hasRewrite(DATA[i]);
  for (let i = from; i < DATA.length; i++) {
    if (bad(i)) return i;
  }
  for (let i = 0; i < from; i++) {
    if (bad(i)) return i;
  }
  return -1;
}

function setVerdict(v) {
  const item = DATA[pos];
  labels[item.text] = v;
  saveLabels(labels);
  const next = stepFiltered(1);
  if (next !== -1 && next !== pos) {
    pos = next;
  }
  render();
}

function clearVerdict() {
  const item = DATA[pos];
  if (labels[item.text]) {
    delete labels[item.text];
    saveLabels(labels);
    render();
    toast("Label cleared");
  }
}

function move(delta) {
  const next = stepFiltered(delta);
  if (next === -1) {
    toast("No items in '" + filter + "'");
    return;
  }
  pos = next;
  render();
}

function setFilter(f) {
  filter = f;
  document.querySelectorAll("#filter-chips .chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.filter === f);
  });
  // If the current item falls outside the new filter, jump to the first match.
  if (!matchesFilter(DATA[pos])) {
    const list = filteredIndices();
    if (list.length) pos = list[0];
  }
  render();
}

document.querySelectorAll("button.act").forEach((b) => {
  b.addEventListener("click", () => setVerdict(b.dataset.verdict));
});
document.getElementById("prev-btn").addEventListener("click", () => move(-1));
document.getElementById("next-btn").addEventListener("click", () => move(1));
document.getElementById("undo-btn").addEventListener("click", clearVerdict);
document.getElementById("next-unnoted-btn").addEventListener("click", () => {
  const n = nextUnNoted(pos + 1);
  if (n === -1) toast("Everything has notes");
  else { pos = n; render(); }
});
document.querySelectorAll("#filter-chips .chip").forEach((c) => {
  c.addEventListener("click", () => setFilter(c.dataset.filter));
});

el.notes.addEventListener("input", () => {
  const item = DATA[pos];
  const val = el.notes.value;
  if (val.length) notes[item.text] = val;
  else delete notes[item.text];
  saveNotes(notes);
});

el.rewrite.addEventListener("input", () => {
  const item = DATA[pos];
  const val = el.rewrite.value;
  if (val.length) rewrites[item.text] = val;
  else delete rewrites[item.text];
  saveRewrites(rewrites);
});

function typingInNotes() {
  return (
    document.activeElement === el.notes ||
    document.activeElement === el.rewrite
  );
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (typingInNotes()) return;
  switch (e.key) {
    case "g": case "G": setVerdict("good"); break;
    case "b": case "B": setVerdict("bad"); break;
    case "s": case "S": setVerdict("skip"); break;
    case "u": case "U": clearVerdict(); break;
    case "n": case "N": {
      const i = nextUnNoted(pos + 1);
      if (i === -1) toast("Everything has notes");
      else { pos = i; render(); }
      break;
    }
    case "r": case "R": {
      const i = nextUnRewrittenBad(pos + 1);
      if (i === -1) toast("No un-rewritten bad headings");
      else { pos = i; render(); }
      break;
    }
    case "ArrowLeft": move(-1); break;
    case "ArrowRight": move(1); break;
    default: return;
  }
  e.preventDefault();
});

function buildPayload() {
  return DATA.map((item) => ({
    text: item.text,
    words: item.words,
    kind: item.kind,
    url: item.url,
    verdict: labels[item.text] || null,
    notes: notes[item.text] || "",
    rewrite: rewrites[item.text] || "",
  }));
}

document.getElementById("export-btn").addEventListener("click", () => {
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "labels.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Downloaded labels.json");
});

document.getElementById("copy-btn").addEventListener("click", async () => {
  const text = JSON.stringify(buildPayload(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied JSON to clipboard");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Copied JSON to clipboard");
  }
});

document.getElementById("import-btn").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (err) {
      toast("Import failed: invalid JSON");
      e.target.value = "";
      return;
    }
    if (!Array.isArray(parsed)) {
      toast("Import failed: expected an array");
      e.target.value = "";
      return;
    }
    let mergedV = 0;
    let mergedN = 0;
    let mergedR = 0;
    for (const row of parsed) {
      if (!row || typeof row.text !== "string") continue;
      if (row.verdict === "good" || row.verdict === "bad" || row.verdict === "skip") {
        labels[row.text] = row.verdict;
        mergedV++;
      }
      if (typeof row.notes === "string" && row.notes.length) {
        notes[row.text] = row.notes;
        mergedN++;
      }
      if (typeof row.rewrite === "string" && row.rewrite.length) {
        rewrites[row.text] = row.rewrite;
        mergedR++;
      }
    }
    saveLabels(labels);
    saveNotes(notes);
    saveRewrites(rewrites);
    render();
    toast("Imported " + mergedV + " verdicts, " + mergedN + " notes, " + mergedR + " rewrites");
    e.target.value = "";
  };
  reader.readAsText(file);
});

document.getElementById("reset-btn").addEventListener("click", () => {
  if (!confirm("Clear ALL labels, notes, and rewrites? This cannot be undone.")) return;
  labels = {};
  notes = {};
  rewrites = {};
  saveLabels(labels);
  saveNotes(notes);
  saveRewrites(rewrites);
  pos = 0;
  render();
  toast("All labels, notes, and rewrites cleared");
});

render();
</script>
</body>
</html>
`;

await Bun.write(`${import.meta.dir}/label.html`, html);
console.error(`wrote label.html (${html.length} bytes)`);
