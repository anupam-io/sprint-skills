#!/usr/bin/env node
// Wave planner — deterministic topological layering with file-collision splitting.
//
// Reads a JSON array of issues and produces a wave schedule. Each wave is a set
// of issues that (a) have every dep satisfied by an earlier wave and (b) own no
// file in common with another issue in the SAME wave. A shared file is a
// scheduling edge: the later issue is pushed to a subsequent wave even with no
// logical dep, so two pods never edit one file in parallel. This is the rule the
// driver used to discover at fire time and shrink waves over — here it's precomputed.
//
// Usage:
//   node wave-sort.mjs issues.json                       # text table + writes dag.mmd + dag.html beside input
//   node wave-sort.mjs issues.json --out DIR             # write artifacts into DIR
//   node wave-sort.mjs issues.json --max-wave-width 16   # cap each wave to cluster headroom (default 16)
//   cat issues.json | node wave-sort.mjs -               # read stdin (then --out is required for files)
//
// issues.json schema — one object per issue:
//   [{ "id": 12, "title": "transfers schema", "type": "feature",
//      "deps": [], "files": ["db/schema/transfers.ts"] }, ...]
//   deps  = issue ids this one blocks on (logical prerequisite). [] for a leaf.
//   files = paths/globs this issue will own. Used only for collision splitting.
//
// Exit: 0 ok · 1 cycle detected (remaining ids printed) · 2 bad input.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function die(code, msg) { console.error(msg); process.exit(code); }

// Escape chars that break Mermaid node labels (rendered inside "..."), using
// numeric HTML entities Mermaid understands — keeps dag.html from silently
// failing to render when a title contains [] {} <> or quotes.
const mermaidLabel = s => String(s)
  .replace(/"/g, "#34;").replace(/\[/g, "#91;").replace(/\]/g, "#93;")
  .replace(/\{/g, "#123;").replace(/\}/g, "#125;")
  .replace(/</g, "#60;").replace(/>/g, "#62;");

// ---- args ----
const argv = process.argv.slice(2);
const inPath = argv[0];
if (!inPath) die(2, "usage: wave-sort.mjs <issues.json|-> [--out DIR]");
const outIdx = argv.indexOf("--out");
const outDir = outIdx >= 0 ? argv[outIdx + 1] : (inPath === "-" ? null : dirname(inPath));
const wIdx = argv.indexOf("--max-wave-width");
const MAX_WIDTH = wIdx >= 0 ? Number(argv[wIdx + 1]) : 16;   // never fire a wave wider than cluster headroom
if (!(MAX_WIDTH >= 1)) die(2, "--max-wave-width must be >= 1");

let raw;
try { raw = inPath === "-" ? readFileSync(0, "utf8") : readFileSync(inPath, "utf8"); }
catch (e) { die(2, `cannot read input: ${e.message}`); }

let issues;
try { issues = JSON.parse(raw); } catch (e) { die(2, `bad JSON: ${e.message}`); }
if (!Array.isArray(issues) || issues.length === 0) die(2, "input must be a non-empty JSON array");

// ---- normalise + validate ----
const byId = new Map();
const GLOB = /[*?[\]{}]/;        // the collision check is literal string equality — a glob would silently never collide
for (const it of issues) {
  if (it.id == null) die(2, `issue missing id: ${JSON.stringify(it)}`);
  it.id = Number(it.id);         // coerce once so deps / placed / waveOf all speak the same type
  if (Number.isNaN(it.id)) die(2, `issue id is not a number: ${JSON.stringify(it)}`);
  if (byId.has(it.id)) die(2, `duplicate issue id: #${it.id}`);
  it.deps = (it.deps || []).map(Number);
  it.files = it.files || [];
  for (const f of it.files)
    if (GLOB.test(f)) die(2, `issue #${it.id} file "${f}" contains a glob — list exact paths only (the collision check is literal, so a glob would never split a wave)`);
  it.type = it.type || "feature";
  it.title = String(it.title || `issue ${it.id}`);
  byId.set(it.id, it);
}
for (const it of issues)
  for (const d of it.deps)
    if (!byId.has(d)) die(2, `issue #${it.id} deps on #${d} which is not in the set`);

// ---- topological layering with file-disjoint packing ----
const placed = new Set();
const waveOf = new Map();          // id -> wave number (1-based)
const collisionEdges = [];        // [laterId, earlierId] pushed apart by a shared file
const waves = [];

while (placed.size < issues.length) {
  const ready = issues
    .filter(it => !placed.has(it.id) && it.deps.every(d => placed.has(d)))
    .sort((a, b) => a.id - b.id);
  if (ready.length === 0) {
    const stuck = issues.filter(it => !placed.has(it.id)).map(it => `#${it.id}`);
    die(1, `dependency cycle — cannot place: ${stuck.join(", ")}`);
  }
  const wave = [];
  const usedFiles = new Map();     // file -> id that claimed it this wave
  for (const it of ready) {
    if (wave.length >= MAX_WIDTH) break;   // wave full — remaining ready issues form the next (sub-)wave
    const clash = it.files.find(f => usedFiles.has(f));
    if (clash) { collisionEdges.push([it.id, usedFiles.get(clash)]); continue; } // defer to a later wave
    wave.push(it);
    for (const f of it.files) usedFiles.set(f, it.id);
  }
  const n = waves.length + 1;
  for (const it of wave) { placed.add(it.id); waveOf.set(it.id, n); }
  waves.push(wave);
}

// ---- text table ----
const pad = (s, w) => String(s).padEnd(w);
console.log(`\n${issues.length} issues → ${waves.length} waves\n`);
console.log(`${pad("wave", 5)}${pad("#", 6)}${pad("type", 14)}${pad("deps", 10)}title`);
console.log("-".repeat(72));
for (const [i, wave] of waves.entries())
  for (const it of wave)
    console.log(`${pad(i + 1, 5)}${pad("#" + it.id, 6)}${pad(it.type, 14)}${pad(it.deps.map(d => "#" + d).join(",") || "-", 10)}${it.title}`);
console.log("");

// ---- mermaid ----
const nid = id => `n${id}`;
let mmd = "flowchart LR\n";
for (const [i, wave] of waves.entries()) {
  mmd += `  subgraph W${i + 1}["Wave ${i + 1}"]\n`;
  for (const it of wave) mmd += `    ${nid(it.id)}["#${it.id} ${mermaidLabel(it.title)}"]\n`;
  mmd += "  end\n";
}
for (const it of issues)
  for (const d of it.deps) mmd += `  ${nid(d)} --> ${nid(it.id)}\n`;
for (const [later, earlier] of collisionEdges)
  mmd += `  ${nid(earlier)} -. shared file .-> ${nid(later)}\n`;

// ---- pretty interactive DAG (self-contained, data-driven) ----
const nodes = issues
  .slice().sort((a, b) => (waveOf.get(a.id) - waveOf.get(b.id)) || (a.id - b.id))
  .map(it => ({ id: it.id, title: it.title, type: it.type, wave: waveOf.get(it.id),
                file: it.files[0] || "", nfiles: it.files.length }));
const edges = [];
for (const it of issues) for (const d of it.deps) edges.push([d, it.id, "hard"]);
for (const [later, earlier] of collisionEdges) edges.push([earlier, later, "soft"]);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprint Wave DAG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{ --bg:#0b0f14; --card:#141b24; --edge:#232d3a; --ink:#e8edf2; --ink2:#97a3b2; --ink3:#5c6878; --accent:#2dd4bf; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ background:var(--bg); }
  body{ font-family:'IBM Plex Mono',ui-monospace,monospace; color:var(--ink); min-height:100vh;
    background:
      radial-gradient(1200px 600px at 70% -10%, rgba(45,212,191,.07), transparent 60%),
      radial-gradient(900px 500px at 0% 100%, rgba(91,156,245,.05), transparent 60%), var(--bg); }
  body::before{ content:''; position:fixed; inset:0; pointer-events:none;
    background-image:radial-gradient(rgba(151,163,178,.10) 1px, transparent 1px); background-size:26px 26px; }
  header{ padding:40px 48px 6px; }
  .kicker{ font-size:11px; letter-spacing:.32em; text-transform:uppercase; color:var(--accent); margin-bottom:10px; }
  h1{ font-family:'Instrument Serif',serif; font-weight:400; font-style:italic; font-size:46px; line-height:1.02; }
  h1 em{ font-style:normal; color:var(--accent); }
  .sub{ margin-top:10px; font-size:12px; color:var(--ink2); }
  .sub b{ color:var(--ink); font-weight:600; }
  .legend{ display:flex; gap:22px; flex-wrap:wrap; align-items:center; margin:16px 48px 4px; font-size:10.5px; color:var(--ink2); }
  .legend .li{ display:flex; align-items:center; gap:7px; }
  .lk{ width:26px; height:0; border-top:2px solid var(--accent); }
  .lk.dash{ border-top-style:dashed; border-top-color:var(--ink3); }
  .hint{ margin-left:auto; color:var(--ink3); font-style:italic; }
  .scroller{ overflow-x:auto; padding:10px 0 24px; }
  #canvas{ position:relative; margin:0 30px; min-height:300px; }
  #wires{ position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
  #wires path{ transition:opacity .18s ease; } #wires path.dim{ opacity:.07; }
  .col-head{ position:absolute; top:0; width:272px; font-size:10px; letter-spacing:.22em; text-transform:uppercase;
    color:var(--ink2); border-top:2px solid var(--edge); padding-top:7px; }
  .col-head b{ color:var(--accent); font-weight:600; margin-right:8px; }
  .node{ position:absolute; width:272px; min-height:80px; background:var(--card); border:1px solid var(--edge);
    border-left:3px solid var(--pc,var(--ink3)); border-radius:8px; padding:9px 12px 10px;
    transition:opacity .18s ease, transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
  .node:hover{ transform:translateY(-1px); }
  .node.dim{ opacity:.14; }
  .node.lit{ border-color:color-mix(in srgb, var(--pc) 55%, var(--edge));
    box-shadow:0 0 0 1px color-mix(in srgb, var(--pc) 30%, transparent), 0 8px 28px -10px color-mix(in srgb, var(--pc) 45%, transparent); }
  .node.pinned{ outline:1px dashed var(--accent); outline-offset:3px; }
  .nrow{ display:flex; align-items:center; gap:7px; margin-bottom:5px; }
  .pri{ font-size:9px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; padding:1px 7px; border-radius:9px; }
  .nid{ font-size:9.5px; color:var(--ink3); margin-left:auto; }
  .ntitle{ font-size:12px; font-weight:600; line-height:1.3; color:var(--ink); }
  .nmeta{ display:flex; align-items:center; gap:6px; margin-top:6px; font-size:10px; color:var(--ink2); }
  .nmeta .dot{ width:7px; height:7px; border-radius:50%; background:var(--pc,var(--ink3)); flex-shrink:0; }
  footer{ text-align:center; font-size:10px; color:var(--ink3); padding:0 0 32px; letter-spacing:.08em; }
</style></head>
<body>
<header>
  <div class="kicker">Sprint Planning</div>
  <h1>Wave <em>dependency graph</em></h1>
  <div class="sub"><b>${issues.length}</b> issues · <b>${waves.length}</b> waves · columns are waves — <b>wave 1 starts now</b>, each next wave unlocks as the one before it merges</div>
</header>
<div class="legend">
  <span class="li"><span class="lk"></span> dependency</span>
  <span class="li"><span class="lk dash"></span> same-file split (one file, one owner)</span>
  <span class="li">card colour = type · pill = type</span>
  <span class="hint">hover a card to trace its chain · click to pin</span>
</div>
<div class="scroller"><div id="canvas"><svg id="wires"></svg></div></div>
<footer>GENERATED BY WAVE-SORT</footer>
<script>
const NODES = ${JSON.stringify(nodes)};
const EDGES = ${JSON.stringify(edges)};
const NWAVES = ${waves.length};
NODES.forEach(n => { n.id = String(n.id); });
EDGES.forEach(e => { e[0] = String(e[0]); e[1] = String(e[1]); });
const TYPE_COLORS = { feature:'#5b9cf5', bug:'#f0564f', improvement:'#e8a13c', research:'#2dd4bf', qa:'#a78bfa' };
const COLW = 312, ROWH = 104, TOPPAD = 60, LEFT = 0;
const cx = w => LEFT + (w - 1) * COLW;
const canvas = document.getElementById('canvas');
const svg = document.getElementById('wires');

const byWave = {};
NODES.forEach(n => { (byWave[n.wave] = byWave[n.wave] || []).push(n); });
const pos = {}; let maxRows = 0;
Object.keys(byWave).forEach(w => {
  byWave[w].forEach((n, i) => { pos[n.id] = { x: cx(+w), y: TOPPAD + i * ROWH }; });
  maxRows = Math.max(maxRows, byWave[w].length);
});
canvas.style.width = (NWAVES * COLW) + 'px';
canvas.style.height = (TOPPAD + maxRows * ROWH + 20) + 'px';

for (let w = 1; w <= NWAVES; w++) {
  const h = document.createElement('div');
  h.className = 'col-head'; h.style.left = cx(w) + 'px';
  h.innerHTML = '<b>W' + w + '</b>' + (w === 1 ? 'start now' : (w === 2 ? 'one hop out' : (w - 1) + ' hops out'));
  canvas.appendChild(h);
}

const elById = {};
NODES.forEach(n => {
  const c = TYPE_COLORS[n.type] || '#5c6878';
  const el = document.createElement('div');
  el.className = 'node'; el.style.left = pos[n.id].x + 'px'; el.style.top = pos[n.id].y + 'px';
  el.style.setProperty('--pc', c);
  const row = document.createElement('div'); row.className = 'nrow';
  const pill = document.createElement('span'); pill.className = 'pri';
  pill.style.background = 'color-mix(in srgb, ' + c + ' 16%, transparent)'; pill.style.color = c; pill.textContent = n.type;
  const nid = document.createElement('span'); nid.className = 'nid'; nid.textContent = '#' + n.id;
  row.appendChild(pill); row.appendChild(nid);
  const title = document.createElement('div'); title.className = 'ntitle'; title.textContent = n.title;
  const mt = document.createElement('div'); mt.className = 'nmeta';
  const dot = document.createElement('span'); dot.className = 'dot';
  const mtx = document.createElement('span'); mtx.textContent = n.nfiles > 1 ? (n.nfiles + ' files') : (n.file || '—');
  mt.appendChild(dot); mt.appendChild(mtx);
  el.appendChild(row); el.appendChild(title); el.appendChild(mt);
  canvas.appendChild(el); elById[n.id] = el;
});

svg.innerHTML = '<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" fill="rgba(160,176,194,.85)"/></marker></defs>';
const NS = 'http://www.w3.org/2000/svg';
const edgeEls = [];
EDGES.forEach(e => {
  const a = elById[e[0]], b = elById[e[1]]; if (!a || !b) return;
  const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
  const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
  const dx = Math.max(54, (x2 - x1) * 0.45);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', e[2] === 'hard' ? 'rgba(45,212,191,.7)' : 'rgba(151,163,178,.45)');
  p.setAttribute('stroke-width', e[2] === 'hard' ? 1.7 : 1.3);
  if (e[2] === 'soft') p.setAttribute('stroke-dasharray', '5 4');
  p.setAttribute('marker-end', 'url(#arr)');
  svg.appendChild(p); edgeEls.push({ from: e[0], to: e[1], p: p });
});

const up = {}, down = {};
edgeEls.forEach(e => { (down[e.from] = down[e.from] || []).push(e.to); (up[e.to] = up[e.to] || []).push(e.from); });
function reach(start, dir) { const seen = new Set([start]), q = [start];
  while (q.length) { const c = q.pop(); (dir[c] || []).forEach(nx => { if (!seen.has(nx)) { seen.add(nx); q.push(nx); } }); } return seen; }
let pinned = null;
function hi(id) { const lit = new Set([...reach(id, up), ...reach(id, down)]);
  Object.keys(elById).forEach(k => { elById[k].classList.toggle('lit', lit.has(k)); elById[k].classList.toggle('dim', !lit.has(k)); });
  edgeEls.forEach(e => e.p.classList.toggle('dim', !(lit.has(e.from) && lit.has(e.to)))); }
function clr() { Object.keys(elById).forEach(k => elById[k].classList.remove('lit', 'dim')); edgeEls.forEach(e => e.p.classList.remove('dim')); }
NODES.forEach(n => {
  const el = elById[n.id];
  el.addEventListener('mouseenter', () => { if (!pinned) hi(n.id); });
  el.addEventListener('mouseleave', () => { if (!pinned) clr(); });
  el.addEventListener('click', () => {
    if (pinned === n.id) { pinned = null; el.classList.remove('pinned'); clr(); }
    else { if (pinned) elById[pinned].classList.remove('pinned'); pinned = n.id; el.classList.add('pinned'); hi(n.id); }
  });
});
</script>
</body></html>`;

// ---- machine-readable plan (the runner reads this, not the markdown) ----
const plan = issues
  .slice()
  .sort((a, b) => (waveOf.get(a.id) - waveOf.get(b.id)) || (a.id - b.id))
  .map(it => ({ id: it.id, title: it.title, type: it.type, deps: it.deps, wave: waveOf.get(it.id), files: it.files }));

if (outDir) {
  writeFileSync(join(outDir, "dag.mmd"), mmd);
  writeFileSync(join(outDir, "dag.html"), html);
  writeFileSync(join(outDir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`wrote ${join(outDir, "dag.mmd")}, ${join(outDir, "dag.html")} and ${join(outDir, "plan.json")}`);
} else {
  console.log("(no --out and stdin input — skipping file artifacts; mermaid below)\n");
  console.log(mmd);
}
