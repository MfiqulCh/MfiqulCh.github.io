/* The hub screen — week 1.

   Two tabs (In / Out). A navy drawer slides down over the top of the screen
   holding the five characters for the current tab; the arrow at its bottom
   slides it back up.

   Picking a character fills the whole screen with their links: they sit in
   the middle, and every character linked to them sits around them, with the
   links arriving (In) or leaving (Out). The drawing can be dragged around and
   zoomed (buttons, Ctrl/Cmd + scroll, trackpad pinch, two fingers on a
   phone); zooming in far enough shows every name. "Open <name>'s file" at
   the bottom left slides the character's file in from the left.

   Every number and every quoted sentence comes from window.HUBS, which the
   week 1 notebook writes to weeks/week1/data/hubs.js. The paragraphs on why
   live in <template class="hs-hub"> elements in the page.

   Drawing: neighbours sit on a sunflower spiral (golden-angle steps, radius
   growing with rank), ranked by how many sentences name the other end of the
   link, so the closer a dot sits, the more the link is talked about. Dot size
   is that character's own in-degree. Red = the link runs both ways.

   Zoom is a transform on one world group. Positions scale with it; text,
   line widths and arrowheads are redrawn at a constant size on screen, and
   dots grow only with the square root of the zoom, so zooming in actually
   pulls crowded dots apart. */
(function () {
  "use strict";

  var root = document.getElementById("hubscope");
  if (!root || !window.HUBS) return;

  var DATA = window.HUBS;
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia("(pointer: coarse)").matches;
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var BLUE = "#3F6FB0", RED = "#D22B2B";
  var C = 300, HUB_R = 46, R0 = 98, RMAX = 268;
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var LABELLED = 5, KMIN = 0.7, KMAX = 8, ALL_NAMES_AT = 2.3;

  var tabs = [].slice.call(root.querySelectorAll(".hs-tab"));
  var screen = root.querySelector(".hs-screen");
  var drawer = root.querySelector(".hs-drawer");
  var toggle = root.querySelector(".hs-toggle");
  var picks = root.querySelector(".hs-picks");
  var drawerTitle = root.querySelector(".hs-drawer-title");
  var stage = root.querySelector(".hs-stage");
  var net = root.querySelector(".hs-net");
  var svg = net.querySelector("svg");
  var tip = net.querySelector(".hs-tip");
  var empty = net.querySelector(".hs-empty");
  var openBtn = net.querySelector(".hs-open");
  var zoomBox = net.querySelector(".hs-zoom");
  var hint = net.querySelector(".hs-hint");
  var keys = root.querySelector(".hs-keys");
  var nojs = root.querySelector(".hs-nojs");
  if (nojs) nojs.hidden = true;
  keys.querySelector(".hs-keys-how").textContent = coarse
    ? "two fingers to move and zoom"
    : "drag to move · " + (mac ? "⌘" : "Ctrl") + " + scroll or ± to zoom";

  var say = document.createElement("p");                 // short announcements for screen readers
  say.className = "sr";
  say.setAttribute("aria-live", "polite");
  root.appendChild(say);

  var file = document.createElement("section");          // the character's file, slides in from the left
  file.className = "hs-file";
  file.hidden = true;
  file.setAttribute("aria-labelledby", "hs-file-name");
  screen.appendChild(file);

  var mode = "in", current = null, nodes = [], active = -1, pinned = false;
  var k = 1, tx = 0, ty = 0, world = null, parts = null, anim = 0;
  var fileOpen = false;

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function num(n) { return Number(n).toLocaleString("en-US"); }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function base(name) { return name.replace(/\s*\(.*?\)$/, ""); }
  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    return e;
  }
  function meta(id) {
    var t = document.querySelector('template.hs-hub[data-id="' + id.replace(/"/g, '\\"') + '"]');
    return {
      ini: t ? t.getAttribute("data-ini") : id.slice(0, 2).toUpperCase(),
      c1: t ? t.getAttribute("data-c1") : "#16224C",
      c2: t ? t.getAttribute("data-c2") : "#3F6FB0",
      title: t ? t.getAttribute("data-title") : "Why",
      why: t ? t.content : null
    };
  }
  function drawerH() { return drawer.classList.contains("is-open") ? drawer.offsetHeight : 0; }
  var hintTimer = 0;
  function showHint(text) {
    hint.textContent = text;
    hint.classList.add("is-on");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.remove("is-on"); }, 1600);
  }

  /* ---------- drawer ---------- */
  function measureDrawer() { root.style.setProperty("--drawer-h", drawerH() + "px"); }
  function setDrawer(open) {
    drawer.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".sr").textContent = open ? "Hide the five" : "Show the five";
    if ("inert" in picks) picks.inert = !open;
    measureDrawer();
  }
  toggle.addEventListener("click", function () {
    setDrawer(!drawer.classList.contains("is-open"));
  });
  if (window.ResizeObserver) {
    new ResizeObserver(measureDrawer).observe(drawer);
    new ResizeObserver(function () { if (current) layout(); }).observe(net);
  } else {
    window.addEventListener("resize", function () { measureDrawer(); if (current) layout(); });
  }

  /* ---------- tabs ---------- */
  function setMode(m) {
    if (m === mode) return;
    closeFile(true);
    mode = m;
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-mode") === m;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) screen.setAttribute("aria-labelledby", t.id);
    });
    buildPicks();
    clear();
    setDrawer(true);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { setMode(t.getAttribute("data-mode")); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      setMode(next.getAttribute("data-mode"));
    });
  });

  /* ---------- the five ---------- */
  function buildPicks() {
    picks.innerHTML = "";
    drawerTitle.textContent = mode === "in" ? "The five most linked to" : "The five who link out most";
    DATA[mode].forEach(function (h, i) {
      var m = meta(h.id);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hs-pick";
      b.setAttribute("data-id", h.id);
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", h.name + ", number " + (i + 1) + ", " + h[mode] +
        (mode === "in" ? " links received" : " links made"));
      b.style.setProperty("--c1", m.c1);
      b.style.setProperty("--c2", m.c2);
      b.innerHTML = '<span class="hs-badge"><span class="hs-rank">' + (i + 1) + "</span>" + esc(m.ini) +
        '</span><span class="hs-pick-name">' + esc(h.name) + '</span><span class="hs-pick-n">' +
        h[mode] + (mode === "in" ? " in" : " out") + "</span>";
      b.addEventListener("click", function () { select(h, b); });
      picks.appendChild(b);
    });
  }

  /* ---------- start screen ---------- */
  function clear() {
    current = null;
    nodes = [];
    world = parts = null;
    active = -1;
    hideTip();
    svg.innerHTML = "";
    svg.removeAttribute("tabindex");
    svg.setAttribute("aria-label", "Pick a character to draw their links");
    net.classList.remove("is-focus", "is-entering", "is-zoomed");
    stage.classList.remove("is-picked");
    openBtn.hidden = zoomBox.hidden = keys.hidden = true;
    var total = DATA[mode].reduce(function (a, h) { return a + h[mode]; }, 0);
    var share = (100 * total / DATA.links_total).toFixed(1) + "%";
    empty.innerHTML = "<strong>" + share + "</strong><span>of all " + num(DATA.links_total) +
      (mode === "in" ? " links point at one of these five." : " links are written by these five.") +
      "</span><em>Pick one to see who " + (mode === "in" ? "links to them." : "they link to.") + "</em>";
    empty.hidden = false;
  }

  /* ---------- picking a character ---------- */
  function select(h, btn) {
    [].forEach.call(picks.children, function (b) {
      b.setAttribute("aria-pressed", String(b === btn));
    });
    current = h;
    empty.hidden = true;
    stage.classList.add("is-picked");
    openBtn.hidden = zoomBox.hidden = keys.hidden = false;
    openBtn.textContent = "Open " + h.name + "’s file";
    keys.querySelector(".hs-swatch.near").parentNode.lastChild.textContent = mode === "in"
      ? "closer: their article names " + h.name + " more"
      : "closer: " + h.name + "’s article names them more";
    draw(h);
    if (fileOpen) fillFile(h);
    say.textContent = h.name + ": " + h.links.length + (mode === "in" ? " characters link in." : " characters linked to.") +
      " Open the file for the details.";
  }

  /* ---------- the file ---------- */
  function fillFile(h) {
    var m = meta(h.id), rank = DATA[mode].indexOf(h) + 1;
    file.style.setProperty("--c1", m.c1);
    file.style.setProperty("--c2", m.c2);
    var stat = function (label, value, main, small) {
      return '<div class="' + (main ? "is-main" : "") + '"><dt>' + label + "</dt><dd>" + value +
        (small ? "<small>" + small + "</small>" : "") + "</dd></div>";
    };
    var share = (100 * h[mode] / DATA.links_total).toFixed(1) + "% of all " + num(DATA.links_total) +
      " links " + (mode === "in" ? "end here." : "start here.");
    var item = function (l, i) {
      return '<li><button type="button" data-i="' + i + '">' + esc(l.name) + '</button> <span class="n">' +
        (l.same ? "same name" : l.n + (l.n === 1 ? " sentence" : " sentences")) +
        (l.both ? ' · <span class="both">both ways</span>' : "") + "</span></li>";
    };
    var everyone = mode === "in"
      ? "Everyone who links to " + esc(h.name) + " (" + h.links.length + ")"
      : "Everyone " + esc(h.name) + " links to (" + h.links.length + ")";
    var topTitle = mode === "in"
      ? "Their articles talk about " + esc(h.name) + " most"
      : esc(h.name) + "’s article talks about them most";
    file.innerHTML =
      '<button type="button" class="hs-file-close" aria-label="Close the file">×</button>' +
      '<div class="hs-file-head">' +
        '<div class="hs-file-badge" aria-hidden="true">' + esc(m.ini) + "</div>" +
        '<div><p class="hs-file-kicker">No. ' + rank + (mode === "in" ? " · most linked to" : " · links out most") + "</p>" +
        '<h3 id="hs-file-name">' + esc(h.name) + "</h3></div>" +
      "</div>" +
      '<dl class="hs-file-stats">' +
        stat("Links in", h.in, mode === "in") +
        stat("Links out", h.out, mode === "out") +
        stat("Both ways", h.both) +
        stat("Article", num(h.length), false, "sentences · " + ordinal(h.length_rank) + " longest") +
      "</dl>" +
      '<p class="hs-file-share">' + share + "</p>" +
      "<h4>" + esc(m.title) + '</h4><div class="hs-file-why"></div>' +
      "<h4>" + topTitle + '</h4><ol class="hs-file-list">' + h.links.slice(0, 5).map(item).join("") + "</ol>" +
      '<details class="hs-file-all"><summary>' + everyone + '</summary><ol class="hs-file-list">' +
        h.links.map(item).join("") + "</ol></details>" +
      '<button type="button" class="hs-file-back">← Back to the links</button>';
    if (m.why) file.querySelector(".hs-file-why").appendChild(m.why.cloneNode(true));
    file.querySelector(".hs-file-close").addEventListener("click", function () { closeFile(); });
    file.querySelector(".hs-file-back").addEventListener("click", function () { closeFile(); });
    file.scrollTop = 0;
  }
  file.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    var i = Number(b.getAttribute("data-i"));
    closeFile(false, true);
    setTimeout(function () { activate(i, true, true); svg.focus({ preventScroll: true }); }, reduce ? 0 : 320);
  });
  function fixedFile() { return getComputedStyle(file).position === "fixed"; }

  function openFile() {
    if (!current || fileOpen) return;
    fillFile(current);
    activate(-1);
    fileOpen = true;
    file.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    if (fixedFile()) document.body.classList.add("hm-lock");
    file.getBoundingClientRect();
    file.classList.add("is-open");
    document.addEventListener("keydown", fileKeys);
    setTimeout(function () {
      var x = file.querySelector(".hs-file-close");
      if (x && fileOpen) x.focus({ preventScroll: true });
    }, reduce ? 0 : 200);
  }
  function closeFile(instant, keepFocus) {
    if (!fileOpen) return;
    fileOpen = false;
    file.classList.remove("is-open");
    openBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("hm-lock");
    document.removeEventListener("keydown", fileKeys);
    var done = function () { if (!fileOpen) file.hidden = true; };
    if (instant || reduce) done(); else setTimeout(done, 320);
    if (!instant && !keepFocus && !openBtn.hidden) openBtn.focus({ preventScroll: true });
  }
  function fileKeys(e) {
    if (e.key === "Escape") { e.preventDefault(); closeFile(); return; }
    if (e.key !== "Tab" || !fixedFile()) return;          // only the full-screen phone version traps focus
    var f = [].filter.call(file.querySelectorAll("button, summary"), function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!file.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  openBtn.addEventListener("click", openFile);
  openBtn.setAttribute("aria-expanded", "false");

  /* ---------- the drawing ---------- */
  function draw(h) {
    hideTip();
    active = -1;
    k = 1; tx = 0; ty = 0;
    net.classList.remove("is-zoomed", "is-focus");
    svg.innerHTML = "";
    var m = meta(h.id);
    var N = h.links.length;

    var defs = el("defs", {});
    var markers = [["b", BLUE], ["r", RED]].map(function (a) {
      var mk = el("marker", { id: "hs-arrow-" + a[0], viewBox: "0 0 10 10", refX: "9", refY: "5",
        markerWidth: "7", markerHeight: "7", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
      mk.appendChild(el("path", { d: "M0,0.5 L10,5 L0,9.5 z", fill: a[1] }));
      defs.appendChild(mk);
      return mk;
    });
    var grad = el("linearGradient", { id: "hs-grad", x1: "0", y1: "0", x2: "1", y2: "1" });
    grad.appendChild(el("stop", { offset: "0", "stop-color": m.c1 }));
    grad.appendChild(el("stop", { offset: "1", "stop-color": m.c2 }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    world = el("g", { class: "hs-world" });
    var gEdges = el("g", {}), gFlow = el("g", { class: "hs-flows" }), gNodes = el("g", {}), gLabels = el("g", {});
    [gEdges, gFlow, gNodes, gLabels].forEach(function (g) { world.appendChild(g); });
    svg.appendChild(world);

    var kk = N > 1 ? (RMAX - R0) / Math.sqrt(N - 1) : 0;
    var stagger = Math.min(14, 700 / Math.max(N, 1));
    nodes = h.links.map(function (l, i) {
      var a = Math.PI / 2 + i * GOLDEN;                    // start at the bottom: the drawer covers the top
      var r = R0 + kk * Math.sqrt(i);
      var x = C + r * Math.cos(a), y = C + r * Math.sin(a);
      var col = l.both ? RED : BLUE, key = l.both ? "r" : "b";
      var edge = el("line", { class: "hs-edge", stroke: col, pathLength: "1", "stroke-dasharray": "1",
        "marker-end": "url(#hs-arrow-" + key + ")" });
      if (l.both) edge.setAttribute("marker-start", "url(#hs-arrow-" + key + ")");
      gEdges.appendChild(edge);
      var g = el("g", { class: "hs-nb", "data-i": i });
      var hit = el("circle", { class: "hit", cx: x.toFixed(1), cy: y.toFixed(1) });
      var dot = el("circle", { class: "dot", cx: x.toFixed(1), cy: y.toFixed(1), fill: col });
      g.appendChild(hit); g.appendChild(dot);
      gNodes.appendChild(g);
      var label = el("text", { class: "hs-label" + (i < LABELLED ? "" : " more"), "data-i": i });
      label.textContent = l.name;
      gLabels.appendChild(label);
      if (!reduce) {
        g.style.transitionDelay = (i * stagger).toFixed(0) + "ms";
        edge.style.transitionDelay = (i * stagger + 120).toFixed(0) + "ms";
      }
      return { l: l, g: g, dot: dot, hit: hit, edge: edge, label: label, flow: null, col: col,
               x: x, y: y, ang: a, ux: (C - x) / r, uy: (C - y) / r,
               r0: 3 + 1.15 * Math.sqrt(l.in), delay: i * stagger };
    });

    // the character in the middle
    var gHub = el("g", { class: "hs-hubnode", transform: "translate(" + C + " " + C + ")" });
    var disc = el("g", {});
    disc.appendChild(el("circle", { r: HUB_R, fill: "url(#hs-grad)", stroke: "#fff", "stroke-width": "3" }));
    disc.appendChild(el("circle", { r: HUB_R + 3, fill: "none", stroke: "#16224C", "stroke-width": "2" }));
    var ini = el("text", { "text-anchor": "middle", dy: "0.36em", fill: "#fff",
      style: "font-family:'Archivo Black',sans-serif;font-size:26px;letter-spacing:-.02em" });
    ini.textContent = m.ini;
    disc.appendChild(ini);
    gHub.appendChild(disc);
    var hubName = el("text", { class: "hs-hubname", "text-anchor": "middle" });
    hubName.textContent = h.name;
    gHub.appendChild(hubName);
    world.appendChild(gHub);

    parts = { markers: markers, edges: gEdges, flows: gFlow, nodes: gNodes, labels: gLabels, hubName: hubName, disc: disc };

    if (!reduce) {
      net.classList.add("is-entering");
      nodes.forEach(function (n) {                        // the links flow in once, for a few seconds
        var f = el("line", { class: "hs-flowline", stroke: n.col });
        f.style.animationDelay = (0.8 + n.delay / 1000).toFixed(3) + "s," + (0.5 + n.delay / 1000).toFixed(3) + "s";
        gFlow.appendChild(f);
        n.flow = f;
      });
    }
    applyWorld();
    layout();

    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", h.name + ": " + N + (mode === "in"
      ? " characters link to them" : " characters they link to") +
      ". Arrow keys step through them, most talked-about first; plus and minus zoom, zero resets.");

    if (!reduce) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { net.classList.remove("is-entering"); });
      });
    }
  }

  // px on screen per unit of the viewBox, before our own zoom
  function screenScale() {
    var m = svg.getScreenCTM();
    return m && m.a ? m.a : 1;
  }

  function applyWorld() {
    if (world) world.setAttribute("transform", "translate(" + tx.toFixed(2) + " " + ty.toFixed(2) + ") scale(" + k.toFixed(4) + ")");
  }

  // Redraw everything that should keep its size on screen at the current zoom.
  function layout() {
    if (!parts) return;
    var s = screenScale() * k;                         // screen px per world unit
    var grow = 1 / Math.sqrt(k);                       // dots grow only with sqrt(zoom)
    var font = 11.5 / s, gap = 5 / s;
    parts.edges.style.setProperty("--sw", (1.15 / s).toFixed(4));
    parts.nodes.style.setProperty("--ring", (1.6 / s).toFixed(4));
    parts.labels.style.fontSize = font.toFixed(3) + "px";
    parts.labels.style.strokeWidth = (3.5 / s).toFixed(3) + "px";
    parts.flows.style.setProperty("--sw", (1.8 / s).toFixed(4));
    parts.flows.style.setProperty("--period", (12 / s).toFixed(3));
    parts.markers.forEach(function (mk) {
      mk.setAttribute("markerWidth", (7 / s).toFixed(3));
      mk.setAttribute("markerHeight", (7 / s).toFixed(3));
    });
    parts.hubName.style.fontSize = (15 / s).toFixed(3) + "px";
    parts.hubName.style.strokeWidth = (4 / s).toFixed(3) + "px";
    var hubR = HUB_R * grow;
    parts.disc.setAttribute("transform", "scale(" + grow.toFixed(4) + ")");
    parts.hubName.setAttribute("y", (hubR + 21 / s).toFixed(2));
    svg.classList.toggle("all-names", s >= ALL_NAMES_AT);

    nodes.forEach(function (n) {
      var r = n.r0 * grow;
      n.dot.setAttribute("r", r.toFixed(2));
      n.hit.setAttribute("r", Math.max(r + 4 / s, 11 / s).toFixed(2));
      var gn = r + 3 / s, gh = hubR + 5 / s;
      var atNode = [n.x + n.ux * gn, n.y + n.uy * gn], atHub = [C - n.ux * gh, C - n.uy * gh];
      var from = mode === "in" ? atNode : atHub, to = mode === "in" ? atHub : atNode;
      var line = { x1: from[0].toFixed(2), y1: from[1].toFixed(2), x2: to[0].toFixed(2), y2: to[1].toFixed(2) };
      for (var a in line) { n.edge.setAttribute(a, line[a]); if (n.flow) n.flow.setAttribute(a, line[a]); }
      if (n.flow) n.flow.setAttribute("stroke-dasharray", (2 / s).toFixed(2) + " " + (10 / s).toFixed(2));
      // label sits just outside the dot, on the side facing away from the middle
      var c = Math.cos(n.ang), sn = Math.sin(n.ang);
      var anchor = c > 0.35 ? "start" : c < -0.35 ? "end" : "middle";
      var lx = n.x + c * (r + gap), ly = n.y + sn * (r + gap) + font * 0.35;
      if (anchor === "middle") ly = n.y + (sn > 0 ? r + gap + font * 0.8 : -(r + gap));
      n.label.setAttribute("text-anchor", anchor);
      n.label.setAttribute("x", lx.toFixed(2));
      n.label.setAttribute("y", ly.toFixed(2));
    });
    if (k < 1.05) keepLabelsInside();
  }

  // at the full view, flip a named label to the other side of its dot if it would run off the edge
  function keepLabelsInside() {
    var box = svg.getBoundingClientRect();
    var gap = 5 / (screenScale() * k);
    nodes.slice(0, LABELLED).forEach(function (n) {
      var b = n.label.getBoundingClientRect();
      if (!b.width) return;
      var r = Number(n.dot.getAttribute("r"));
      if (b.right > box.right - 4) { n.label.setAttribute("text-anchor", "end"); n.label.setAttribute("x", (n.x - r - gap).toFixed(2)); }
      else if (b.left < box.left + 4) { n.label.setAttribute("text-anchor", "start"); n.label.setAttribute("x", (n.x + r + gap).toFixed(2)); }
    });
  }

  /* ---------- zoom and pan ---------- */
  function toUser(sx, sy) {
    var p = svg.createSVGPoint();
    p.x = sx; p.y = sy;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function setView(nk, ntx, nty) {
    k = nk; tx = ntx; ty = nty;
    applyWorld();
    layout();
    net.classList.toggle("is-zoomed", k > 1.02);
    if (active >= 0) showTip(active);
  }
  // keep the world point under (sx, sy) where it is while the zoom changes
  function zoomedAbout(nk, sx, sy) {
    nk = clamp(nk, KMIN, KMAX);
    var u = toUser(sx, sy);
    return [nk, u.x - (nk / k) * (u.x - tx), u.y - (nk / k) * (u.y - ty)];
  }
  function animateView(target, ms) {
    cancelAnimationFrame(anim);
    if (reduce || !ms) { setView(target[0], target[1], target[2]); return; }
    var k0 = k, x0 = tx, y0 = ty, t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      setView(k0 * Math.pow(target[0] / k0, e), x0 + (target[1] - x0) * e, y0 + (target[2] - y0) * e);
      if (p < 1) anim = requestAnimationFrame(step);
    })(t0);
  }
  function visibleCentre() {
    var r = net.getBoundingClientRect(), top = r.top + drawerH();
    return [r.left + r.width / 2, (top + r.bottom) / 2];
  }
  function zoomBy(f) {
    var c = visibleCentre();
    animateView(zoomedAbout(k * f, c[0], c[1]), 220);
  }
  zoomBox.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-zoom]");
    if (!b) return;
    var z = b.getAttribute("data-zoom");
    if (z === "in") zoomBy(1.6);
    else if (z === "out") zoomBy(1 / 1.6);
    else animateView([1, 0, 0], 260);
  });

  svg.addEventListener("wheel", function (e) {
    if (!current) return;
    if (!(e.ctrlKey || e.metaKey)) {                       // leave plain scrolling to the page
      showHint("Hold " + (mac ? "⌘" : "Ctrl") + " and scroll to zoom");
      return;
    }
    e.preventDefault();
    var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
    var t = zoomedAbout(k * f, e.clientX, e.clientY);
    cancelAnimationFrame(anim);
    setView(t[0], t[1], t[2]);
  }, { passive: false });

  svg.addEventListener("dblclick", function (e) {
    if (!current || (e.target.closest && e.target.closest(".hs-nb"))) return;
    animateView(zoomedAbout(k * 1.8, e.clientX, e.clientY), 240);
  });

  // drag with a mouse or one finger (one finger only once zoomed in, so the
  // page still scrolls normally); pinch or two-finger drag on a touch screen
  var pointers = {}, drag = null, pinch = null, swallowClick = false, touchHinted = false;
  function count() { return Object.keys(pointers).length; }
  function pinchStart() {
    var p = Object.keys(pointers).map(function (id) { return pointers[id]; });
    var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2, u = toUser(mx, my);
    return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, k: k,
             wx: (u.x - tx) / k, wy: (u.y - ty) / k };
  }
  svg.addEventListener("pointerdown", function (e) {
    if (!current || (e.pointerType === "mouse" && e.button !== 0)) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (count() === 1) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: tx, ty: ty, moved: false, touch: e.pointerType === "touch" };
      if (drag.touch && k <= 1.02 && !touchHinted) { touchHinted = true; showHint("Two fingers to move and zoom"); }
    } else if (count() === 2) {
      drag = null;
      pinch = pinchStart();
    }
  });
  svg.addEventListener("pointermove", function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch && count() === 2) {
      var p = Object.keys(pointers).map(function (id) { return pointers[id]; });
      var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      var nk = clamp(pinch.k * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / pinch.d, KMIN, KMAX);
      var u = toUser(mx, my);
      cancelAnimationFrame(anim);
      setView(nk, u.x - nk * pinch.wx, u.y - nk * pinch.wy);
      swallowClick = true;
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      if (drag.touch && k <= 1.02) { drag = null; return; }  // a one-finger swipe at full view scrolls the page
      drag.moved = true;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      net.classList.add("is-panning");
    }
    var sc = screenScale();
    cancelAnimationFrame(anim);
    setView(k, drag.tx + dx / sc, drag.ty + dy / sc);
  });
  function pointerEnd(e) {
    delete pointers[e.pointerId];
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) swallowClick = true;
      drag = null;
      net.classList.remove("is-panning");
    }
    if (count() < 2) pinch = null;
  }
  svg.addEventListener("pointerup", pointerEnd);
  svg.addEventListener("pointercancel", pointerEnd);

  /* ---------- the hover card ---------- */
  function highlight(re, text) {
    return esc(text).replace(re, "<mark>$&</mark>");
  }
  function tipHTML(n) {
    var h = current, l = n.l;
    var target = mode === "in" ? base(h.name) : base(l.name);
    var source = mode === "in" ? l.name : h.name;
    var rel = mode === "in"
      ? (l.both ? "↔ " + h.name + " links back" : "→ " + h.name + " doesn’t link back")
      : (l.both ? "↔ they link back to " + h.name : "→ they don’t link back");
    var body;
    if (l.same) {
      body = '<span class="cnt">Both articles go by the same name, so we can’t tell which sentences mean which.</span>';
    } else if (!l.n) {
      body = '<span class="cnt">No sentence in ' + esc(source) + "’s article names " + esc(target) +
        " directly — the link probably sits in an infobox, a list, or under a name we don’t match.</span>";
    } else {
      var re = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      body = '<span class="cnt">' + esc(source) + "’s article names " + esc(target) + " in " + l.n +
        (l.n === 1 ? " sentence." : " sentences. The first:") + "</span><q>" + highlight(re, l.s) + "</q>";
    }
    return "<strong>" + esc(l.name) + '</strong><span class="deg">' + l.in + " links in · " + l.out +
      ' out</span><span class="rel">' + rel + "</span>" + body;
  }

  // The card docks on the side of the screen away from the dot (or, on a
  // narrow screen, at the bottom), so it never covers the dot it describes.
  function showTip(i) {
    var n = nodes[i];
    if (!n) return;
    tip.style.setProperty("--tip-c", n.col);
    tip.innerHTML = tipHTML(n);
    tip.hidden = false;
    var box = net.getBoundingClientRect(), dot = n.dot.getBoundingClientRect();
    var cx = dot.left + dot.width / 2 - box.left, cy = dot.top + dot.height / 2 - box.top;
    var top0 = drawerH() + 14, bottom0 = box.height - 58, left, top;
    if (box.width >= 640) {
      tip.style.width = "300px";
      var th = tip.offsetHeight;
      left = cx < box.width / 2 ? box.width - 314 : 14;
      top = clamp(cy - th / 2, top0, Math.max(top0, bottom0 - th));
    } else {
      tip.style.width = (box.width - 24) + "px";
      left = 12;
      top = Math.max(top0, bottom0 - tip.offsetHeight);
    }
    tip.style.left = left.toFixed(0) + "px";
    tip.style.top = top.toFixed(0) + "px";
  }
  function hideTip() {
    tip.hidden = true;
    pinned = false;
  }

  // pan so dot i is in the clear part of the screen (below the drawer, not under the card)
  function bringIntoView(i) {
    var n = nodes[i];
    if (!n) return;
    var box = net.getBoundingClientRect(), dot = n.dot.getBoundingClientRect();
    var cx = dot.left + dot.width / 2, cy = dot.top + dot.height / 2;
    var top = box.top + drawerH() + 20, bottom = box.bottom - 70, left = box.left + 20, right = box.right - 20;
    if (!tip.hidden) {
      var t = tip.getBoundingClientRect();
      if (box.width >= 640) { if (t.left > box.left + box.width / 2) right = t.left - 16; else left = t.right + 16; }
      else bottom = t.top - 16;
    }
    if (cx >= left && cx <= right && cy >= top && cy <= bottom) return;
    var sc = screenScale();
    var dx = cx < left || cx > right ? ((left + right) / 2 - cx) / sc : 0;
    var dy = cy < top || cy > bottom ? ((top + bottom) / 2 - cy) / sc : 0;
    animateView([k, tx + dx, ty + dy], 260);
  }

  function activate(i, pin, reveal) {
    nodes.forEach(function (n, j) {
      var on = j === i;
      n.g.classList.toggle("is-on", on);
      n.edge.classList.toggle("is-on", on);
      n.label.classList.toggle("is-on", on);
    });
    net.classList.toggle("is-focus", i >= 0);
    active = i;
    if (i >= 0) {
      showTip(i);
      pinned = !!pin;
      if (reveal) bringIntoView(i);
    } else hideTip();
  }

  svg.addEventListener("pointerover", function (e) {
    if (pinned || drag || pinch) return;
    var g = e.target.closest && e.target.closest(".hs-nb");
    if (g) activate(Number(g.getAttribute("data-i")), false);
  });
  svg.addEventListener("pointerleave", function () {
    if (!pinned && !drag) activate(-1);
  });
  svg.addEventListener("click", function (e) {
    if (swallowClick) { swallowClick = false; return; }
    var g = e.target.closest && e.target.closest(".hs-nb");
    if (g) activate(Number(g.getAttribute("data-i")), true);
    else activate(-1);
  });
  svg.addEventListener("keydown", function (e) {
    if (!nodes.length) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.6); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.6); return; }
    if (e.key === "0") { e.preventDefault(); animateView([1, 0, 0], 260); return; }
    var i = active, N = nodes.length;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % N;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = i <= 0 ? N - 1 : i - 1;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = N - 1;
    else if (e.key === "Escape") { activate(-1); return; }
    else return;
    e.preventDefault();
    activate(i, true, true);
  });
  document.addEventListener("click", function (e) {
    if (!pinned || active < 0) return;
    if (svg.contains(e.target) || file.contains(e.target) || zoomBox.contains(e.target)) return;
    activate(-1);
  });

  /* ---------- go ---------- */
  buildPicks();
  clear();
  setDrawer(true);
})();
