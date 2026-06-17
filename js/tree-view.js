// D3 tree diagram. Renders descendants of a focus root, with pan/zoom,
// click-to-focus, click-to-open-profile, and dashed lines for spouses
// and milk-kinship.

import { getData, getPerson, childrenOf, spousesOf, milkRelationsOf, lifespan } from "./data.js";

let focusId = null;
let onSelectCb = null;
let zoomBehavior = null;
let svgEl = null;

const NODE_W = 170;
const NODE_H = 56;
const H_GAP = 26;
const V_GAP = 38;

export function render(container, options = {}) {
  onSelectCb = options.onSelect || null;
  if (!focusId) focusId = pickInitialRoot();

  container.innerHTML = `
    <div class="tree-container">
      <div class="tree-controls">
        <button id="tv-zoom-in" title="تكبير">+</button>
        <button id="tv-zoom-out" title="تصغير">−</button>
        <button id="tv-fit" title="ملاءمة">◇</button>
        <button id="tv-up" title="إلى الأب">▲</button>
      </div>
      <div class="tree-legend">
        <div><span class="swatch" style="background:#2c5876"></span> ذكر &nbsp; <span class="swatch" style="background:#8a3a5e"></span> أنثى</div>
        <div><span class="swatch" style="background:#fff;border:1px dashed #aaa"></span> غير موثّق &nbsp; <span class="swatch" style="background:#b08947"></span> رضاعة</div>
      </div>
      <svg id="tree-svg"></svg>
    </div>
  `;

  svgEl = container.querySelector("#tree-svg");
  drawTree();

  container.querySelector("#tv-zoom-in").onclick = () => zoom(1.25);
  container.querySelector("#tv-zoom-out").onclick = () => zoom(0.8);
  container.querySelector("#tv-fit").onclick = () => fit();
  container.querySelector("#tv-up").onclick = () => {
    const p = getPerson(focusId);
    if (p && p.fatherId) { focusId = p.fatherId; drawTree(); }
  };
}

export function focus(id) { focusId = id; if (svgEl) drawTree(); }

function pickInitialRoot() {
  const data = getData();
  if (data.rootIds && data.rootIds.length) return data.rootIds[0];
  // earliest non-placeholder ancestor
  return Object.keys(data.people)[0];
}

function buildHierarchy(rootId, depth = 4) {
  // The visual tree uses patrilineal-with-fallback so D3 doesn't render
  // the same person twice when both parents are in the tree.
  const visit = (id, d) => {
    const p = getPerson(id);
    if (!p) return null;
    const kids = (d > 0) ? childrenOf(id, "patrilineal").map(c => visit(c.id, d - 1)).filter(Boolean) : [];
    return { id, person: p, children: kids };
  };
  return visit(rootId, depth);
}

function drawTree() {
  const root = buildHierarchy(focusId, 4);
  if (!root) return;

  const hier = d3.hierarchy(root);
  // tree layout horizontal: x = depth, y = sibling order. We'll mirror for RTL.
  const layout = d3.tree().nodeSize([NODE_H + V_GAP, NODE_W + H_GAP]);
  layout(hier);

  // Compute extent
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  hier.each(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });
  const width = (maxY - minY) + NODE_W * 2;
  const height = (maxX - minX) + NODE_H * 2;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("class", "viewport");

  // Position translation: y is depth (horizontal). For RTL, mirror so root sits on the right.
  const xOf = n => maxY - n.y;       // RTL flip
  const yOf = n => n.x - minX + NODE_H;

  // Links (parent -> child)
  g.append("g").attr("class", "links")
    .selectAll("path")
    .data(hier.links())
    .enter().append("path")
    .attr("class", "link")
    .attr("d", d => {
      const sx = xOf(d.source) - NODE_W / 2;   // left edge of source (RTL: that's where children connect)
      const sy = yOf(d.source);
      const tx = xOf(d.target) + NODE_W / 2;   // right edge of target
      const ty = yOf(d.target);
      const mid = (sx + tx) / 2;
      return `M${sx},${sy} C${mid},${sy} ${mid},${ty} ${tx},${ty}`;
    });

  // Spouse links (dashed) — for the focus person + visible nodes, draw to spouse if present
  const spouseGroup = g.append("g").attr("class", "spouses");
  hier.descendants().forEach(node => {
    const sps = spousesOf(node.data.id);
    sps.forEach((s, i) => {
      // we don't have a spouse position; draw a stub to the side
      const x = xOf(node);
      const y = yOf(node) + NODE_H + 4 + i * 18;
      const stubX = x + NODE_W / 2 + 22;
      spouseGroup.append("path")
        .attr("class", "link spouse")
        .attr("d", `M${x + NODE_W / 2},${yOf(node)} L${stubX},${yOf(node)} L${stubX},${y}`);
      const sp = getPerson(s.spouseId);
      spouseGroup.append("text")
        .attr("class", "node-text meta")
        .attr("x", stubX + 4).attr("y", y + 4)
        .style("cursor", "pointer")
        .text(`⚭ ${sp ? sp.fullName : ""}`)
        .on("click", () => onSelectCb && onSelectCb(s.spouseId));
    });
  });

  // Milk-kinship links (dashed)
  hier.descendants().forEach(node => {
    const milks = milkRelationsOf(node.data.id);
    milks.forEach((r, i) => {
      const x = xOf(node);
      const y = yOf(node) - 4 - i * 18;
      const stubX = x - NODE_W / 2 - 22;
      g.append("path")
        .attr("class", "link milk")
        .attr("d", `M${x - NODE_W / 2},${yOf(node)} L${stubX},${yOf(node)} L${stubX},${y}`);
      g.append("text")
        .attr("class", "node-text meta")
        .attr("x", stubX - 4).attr("y", y + 4)
        .attr("text-anchor", "end")
        .style("fill", "var(--milk)")
        .text("↔ رضاع: " + (r.milkSiblingNames || []).join("، "));
    });
  });

  // Nodes
  const nodes = g.append("g").attr("class", "nodes")
    .selectAll("g")
    .data(hier.descendants())
    .enter().append("g")
    .attr("class", d => `node-g ${d.data.person.gender || ""} ${d.data.person.isPlaceholder ? "placeholder" : ""}`)
    .attr("transform", d => `translate(${xOf(d) - NODE_W / 2}, ${yOf(d) - NODE_H / 2})`)
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      if (event.shiftKey) { focusId = d.data.id; drawTree(); }
      else if (onSelectCb) onSelectCb(d.data.id);
    });

  nodes.append("rect")
    .attr("class", d => {
      const cls = ["node-rect"];
      if (d.data.person.gender) cls.push(d.data.person.gender);
      if (d.data.person.isPlaceholder) cls.push("placeholder");
      if (d.data.id === getData().currentUserId) cls.push("current-user");
      return cls.join(" ");
    })
    .attr("width", NODE_W).attr("height", NODE_H)
    .attr("rx", 6);

  nodes.append("text")
    .attr("class", "node-text title")
    .attr("x", NODE_W / 2).attr("y", 22)
    .attr("text-anchor", "middle")
    .each(function(d) { fitText(this, shortName(d.data.person), NODE_W - 16); });

  nodes.append("text")
    .attr("class", "node-text meta")
    .attr("x", NODE_W / 2).attr("y", 42)
    .attr("text-anchor", "middle")
    .text(d => lifespan(d.data.person) || (d.data.person.tribe || ""));

  // Indicator if has more children below the rendered depth
  nodes.filter(d => {
    const realKids = childrenOf(d.data.id, "patrilineal");
    return realKids.length > (d.children?.length || 0);
  })
  .append("text")
    .attr("class", "node-text meta")
    .attr("x", NODE_W / 2).attr("y", NODE_H - 4)
    .attr("text-anchor", "middle")
    .style("fill", "var(--accent)")
    .text("⋯ المزيد (Shift+click للتركيز)");

  // Zoom behavior
  zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 3])
    .on("zoom", e => g.attr("transform", e.transform));
  svg.call(zoomBehavior);

  // Initial fit
  setTimeout(fit, 0);
}

function zoom(factor) {
  if (!svgEl || !zoomBehavior) return;
  d3.select(svgEl).transition().duration(200).call(zoomBehavior.scaleBy, factor);
}

function fit() {
  if (!svgEl) return;
  const svg = d3.select(svgEl);
  const g = svg.select("g.viewport");
  const node = g.node();
  if (!node) return;
  const bbox = node.getBBox();
  const fullW = svgEl.clientWidth;
  const fullH = svgEl.clientHeight;
  const k = Math.min(fullW / (bbox.width + 80), fullH / (bbox.height + 80), 1.2);
  const tx = fullW / 2 - (bbox.x + bbox.width / 2) * k;
  const ty = fullH / 2 - (bbox.y + bbox.height / 2) * k;
  svg.transition().duration(300).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(tx, ty).scale(k)
  );
}

function shortName(person) {
  // For tree boxes: just given + family is plenty
  if (!person) return "";
  return `${person.given || ""} ${person.family || ""}`.trim() || person.fullName || "";
}

function fitText(textEl, str, maxWidth) {
  const t = d3.select(textEl).text(str);
  let len = textEl.getComputedTextLength();
  let s = str;
  while (len > maxWidth && s.length > 4) {
    s = s.slice(0, -2);
    t.text(s + "…");
    len = textEl.getComputedTextLength();
  }
}
