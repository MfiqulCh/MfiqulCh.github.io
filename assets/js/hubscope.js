/* The hub screen — week 1.

   Two tabs (In / Out). A navy drawer slides down over the top of the screen
   holding the five characters for the current tab; the arrow at its bottom
   slides it back up. Picking a character flies their badge into the middle
   of the stage and draws every link around them — arriving on the In tab,
   leaving on the Out tab — with the character's file alongside.

   Every number and every quoted sentence comes from window.HUBS, which the
   week 1 notebook writes to weeks/week1/data/hubs.js. The paragraphs on why
   live in <template class="hs-hub"> elements in the page.

   Drawing: neighbours sit on a sunflower spiral (golden-angle steps, radius
   growing with rank), ranked by how many sentences name the other end of the
   link, so the closer a dot sits, the more the link is talked about. Dot size
   is that character's own in-degree. Red = the link runs both ways. */
(function () {
  "use strict";

  var root = document.getElementById("hubscope");
  if (!root || !window.HUBS) return;

  var DATA = window.HUBS;
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var BLUE = "#3F6FB0", RED = "#D22B2B";
  var C = 300, HUB_R = 46, R0 = 98, RMAX = 268;
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var LABELLED = 5;

  var tabs = [].slice.call(root.querySelectorAll(".hs-tab"));
  var panel = root.querySelector(".hs-screen");
  var drawer = root.querySelector(".hs-drawer");
  var toggle = root.querySelector(".hs-toggle");
  var picks = root.querySelector(".hs-picks");
  var drawerTitle = root.querySelector(".hs-drawer-title");
  var net = root.querySelector(".hs-net");
  var svg = net.querySelector("svg");
  var tip = net.querySelector(".hs-tip");
  var empty = net.querySelector(".hs-empty");
  var info = root.querySelector(".hs-info");
  var nojs = root.querySelector(".hs-nojs");
  if (nojs) nojs.hidden = true;
  info.removeAttribute("aria-live");
  var say = document.createElement("p");                 // short announcements for screen readers
  say.className = "sr";
  say.setAttribute("aria-live", "polite");
  root.appendChild(say);

  var mode = "in", current = null, nodes = [], active = -1, pinned = false, timers = [];

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
  function base(name) { return name.replace(/\s*\(.*?\)$/, ""); }
  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
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
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ---------- drawer ---------- */
  function measureDrawer() {
    var h = drawer.classList.contains("is-open") ? drawer.offsetHeight : 0;
    root.style.setProperty("--drawer-h", h + "px");
  }
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
  if (window.ResizeObserver) new ResizeObserver(measureDrawer).observe(drawer);
  else window.addEventListener("resize", measureDrawer);

  /* ---------- tabs ---------- */
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-mode") === m;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute("aria-labelledby", t.id);
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

  /* ---------- empty state / guide ---------- */
  function clear() {
    clearTimers();
    current = null;
    nodes = [];
    active = -1;
    hideTip();
    svg.innerHTML = "";
    svg.removeAttribute("tabindex");
    svg.setAttribute("aria-label", "Pick a character to draw their links");
    net.classList.remove("is-focus");
    var total = DATA[mode].reduce(function (a, h) { return a + h[mode]; }, 0);
    var share = (100 * total / DATA.links_total).toFixed(1) + "%";
    empty.innerHTML = "<strong>" + share + "</strong><span>of all " + num(DATA.links_total) +
      (mode === "in" ? " links point at one of these five." : " links are written by these five.") +
      "</span><em>Pick one to see who " + (mode === "in" ? "links to them." : "they link to.") + "</em>";
    empty.hidden = false;
    info.innerHTML =
      '<p class="hs-kicker">How to read the screen</p>' +
      "<p>" + (mode === "in"
        ? "Pick one of the five. They move to the middle, and every character whose article links to them appears around them, with the arrow pointing in."
        : "Pick one of the five. They move to the middle, and every character their article links to appears around them, with the arrow pointing out.") +
      "</p>" + legendHTML(null) +
      '<p class="hs-hint">The arrow at the bottom of the drawer slides it up out of the way.</p>';
  }

  function legendHTML(h) {
    var hub = h ? h.name : "the character in the middle";
    var near = mode === "in"
      ? "nearer the middle: their article names " + esc(hub) + " more often"
      : "nearer the middle: " + esc(hub) + "’s article names them more often";
    return '<ul class="hs-legend">' +
      '<li><span class="hs-key red"></span>links both ways' + (h ? " <b>" + h.both + "</b>" : "") + "</li>" +
      '<li><span class="hs-key blue"></span>one way only' + (h ? " <b>" + (h.links.length - h.both) + "</b>" : "") + "</li>" +
      '<li><span class="hs-key size"></span>bigger dot: more links in of its own</li>' +
      '<li><span class="hs-key ring"></span>' + near + "</li></ul>";
  }

  /* ---------- picking a character ---------- */
  function select(h, btn) {
    [].forEach.call(picks.children, function (b) {
      b.setAttribute("aria-pressed", String(b === btn));
    });
    current = h;
    empty.hidden = true;
    draw(h, btn);
    fillInfo(h);
    say.textContent = h.name + ": " + h.in + " links in, " + h.out + " out, " + h.both + " both ways.";
  }

  function fillInfo(h) {
    var m = meta(h.id), rank = DATA[mode].indexOf(h) + 1;
    info.style.setProperty("--c2", m.c2);
    var stat = function (label, value, main, small) {
      return '<div class="' + (main ? "is-main" : "") + '"><dt>' + label + "</dt><dd>" + value +
        (small ? "<small>" + small + "</small>" : "") + "</dd></div>";
    };
    var share = (100 * h[mode] / DATA.links_total).toFixed(1) + "% of all " + num(DATA.links_total) +
      " links " + (mode === "in" ? "end here." : "start here.");
    var list = h.links.map(function (l, i) {
      return '<li><button type="button" data-i="' + i + '">' + esc(l.name) + "</button>" +
        ' <span class="n">' + (l.same ? "same name" : l.n) + (l.both ? " ↔" : "") + "</span></li>";
    }).join("");
    info.innerHTML =
      '<p class="hs-kicker">No. ' + rank + (mode === "in" ? " · most linked to" : " · links out most") + "</p>" +
      '<h3 class="hs-name">' + esc(h.name) + "</h3>" +
      '<dl class="hs-stats">' +
        stat("Links in", h.in, mode === "in") +
        stat("Links out", h.out, mode === "out") +
        stat("Both ways", h.both) +
        stat("Article", num(h.length), false, "sentences · " + ordinal(h.length_rank) + " longest") +
      "</dl>" +
      '<p class="hs-share">' + share + "</p>" +
      "<h4>" + esc(m.title) + '</h4><div class="hs-why"></div>' +
      legendHTML(h) +
      '<p class="hs-hint">Hover or tap a dot for the sentence behind its link. With a keyboard, focus the drawing and use the arrow keys.</p>' +
      '<details class="hs-all"><summary>All ' + h.links.length + ", most talked-about first</summary><ol>" + list + "</ol></details>";
    if (m.why) info.querySelector(".hs-why").appendChild(m.why.cloneNode(true));
    info.scrollTop = 0;
    info.querySelector(".hs-all ol").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (!b) return;
      activate(Number(b.getAttribute("data-i")), true);
      var r = net.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) net.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }

  /* ---------- the drawing ---------- */
  function draw(h, btn) {
    clearTimers();
    hideTip();
    active = -1;
    svg.innerHTML = "";
    var m = meta(h.id);
    var N = h.links.length;

    var defs = el("defs", {});
    [["b", BLUE], ["r", RED]].forEach(function (a) {
      var mk = el("marker", { id: "hs-arrow-" + a[0], viewBox: "0 0 10 10", refX: "9", refY: "5",
        markerWidth: "7", markerHeight: "7", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
      mk.appendChild(el("path", { d: "M0,0.5 L10,5 L0,9.5 z", fill: a[1] }));
      defs.appendChild(mk);
    });
    var grad = el("linearGradient", { id: "hs-grad", x1: "0", y1: "0", x2: "1", y2: "1" });
    grad.appendChild(el("stop", { offset: "0", "stop-color": m.c1 }));
    grad.appendChild(el("stop", { offset: "1", "stop-color": m.c2 }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    var gEdges = el("g", {}), gFlow = el("g", {}), gNodes = el("g", {}), gLabels = el("g", {});
    svg.appendChild(gEdges); svg.appendChild(gFlow); svg.appendChild(gNodes); svg.appendChild(gLabels);

    var k = N > 1 ? (RMAX - R0) / Math.sqrt(N - 1) : 0;
    var stagger = Math.min(14, 700 / Math.max(N, 1));
    nodes = h.links.map(function (l, i) {
      var a = Math.PI / 2 + i * GOLDEN;                    // start at the bottom: the drawer covers the top
      var r = R0 + k * Math.sqrt(i);
      var x = C + r * Math.cos(a), y = C + r * Math.sin(a);
      var nr = 3 + 1.15 * Math.sqrt(l.in);
      var col = l.both ? RED : BLUE, key = l.both ? "r" : "b";
      var ux = (C - x) / r, uy = (C - y) / r;
      var atNode = [x + ux * (nr + 3), y + uy * (nr + 3)];
      var atHub = [C - ux * (HUB_R + 5), C - uy * (HUB_R + 5)];
      var from = mode === "in" ? atNode : atHub, to = mode === "in" ? atHub : atNode;
      var line = { x1: from[0].toFixed(1), y1: from[1].toFixed(1), x2: to[0].toFixed(1), y2: to[1].toFixed(1) };

      var edge = el("line", Object.assign({ class: "hs-edge", stroke: col, pathLength: "1",
        "stroke-dasharray": "1", "marker-end": "url(#hs-arrow-" + key + ")" }, line));
      if (l.both) edge.setAttribute("marker-start", "url(#hs-arrow-" + key + ")");
      gEdges.appendChild(edge);

      var flow = null;
      if (!reduce) {
        flow = el("line", Object.assign({ class: "hs-flowline", stroke: col }, line));
        flow.style.animationDelay = (0.8 + i * stagger / 1000).toFixed(3) + "s," + (0.5 + i * stagger / 1000).toFixed(3) + "s";
        gFlow.appendChild(flow);
      }

      var g = el("g", { class: "hs-nb", "data-i": i });
      g.appendChild(el("circle", { class: "hit", cx: x.toFixed(1), cy: y.toFixed(1), r: Math.max(nr + 4, 11).toFixed(1) }));
      g.appendChild(el("circle", { class: "dot", cx: x.toFixed(1), cy: y.toFixed(1), r: nr.toFixed(1), fill: col }));
      gNodes.appendChild(g);

      if (i < LABELLED) {
        var tx = x + Math.cos(a) * (nr + 6), ty = y + Math.sin(a) * (nr + 6) + 4;
        var anchor = Math.cos(a) > 0.35 ? "start" : Math.cos(a) < -0.35 ? "end" : "middle";
        if (anchor === "middle") ty = y + (Math.sin(a) > 0 ? nr + 15 : -(nr + 7));
        var t = el("text", { class: "hs-label", x: tx.toFixed(1), y: ty.toFixed(1), "text-anchor": anchor });
        t.textContent = l.name;
        gLabels.appendChild(t);
      }

      if (!reduce) {
        var d = (i * stagger).toFixed(0) + "ms";
        g.style.transitionDelay = d;
        edge.style.transitionDelay = (i * stagger + 120).toFixed(0) + "ms";
      }
      return { g: g, edge: edge, flow: flow, l: l, x: x, y: y, r: nr, col: col };
    });

    // the character in the middle
    var gHub = el("g", { transform: "translate(" + C + " " + C + ")" });
    var fly = el("g", { class: "hs-fly" });
    fly.appendChild(el("circle", { r: HUB_R, fill: "url(#hs-grad)", stroke: "#fff", "stroke-width": "3" }));
    fly.appendChild(el("circle", { r: HUB_R + 3, fill: "none", stroke: "#16224C", "stroke-width": "2" }));
    var ini = el("text", { "text-anchor": "middle", dy: "0.36em", fill: "#fff",
      style: "font-family:'Archivo Black',sans-serif;font-size:26px;letter-spacing:-.02em" });
    ini.textContent = m.ini;
    fly.appendChild(ini);
    gHub.appendChild(fly);
    var hubName = el("text", { class: "hs-hubname", "text-anchor": "middle", y: HUB_R + 24 });
    hubName.textContent = h.name;
    gHub.appendChild(hubName);
    svg.appendChild(gHub);

    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", h.name + ": " + N + (mode === "in"
      ? " characters link to them" : " characters they link to") +
      ". Use the arrow keys to step through them, most talked-about first.");

    if (reduce) return;

    // start from the badge, fly to the middle; everything else grows in behind
    net.classList.add("is-entering");
    var badge = btn && btn.querySelector(".hs-badge");
    var ctm = svg.getScreenCTM();
    if (badge && ctm) {
      var b = badge.getBoundingClientRect();
      var pt = svg.createSVGPoint();
      pt.x = b.left + b.width / 2;
      pt.y = b.top + b.height / 2;
      var u = pt.matrixTransform(ctm.inverse());
      var s = (b.width / ctm.a) / (2 * (HUB_R + 3));
      fly.style.transition = "none";
      fly.style.transform = "translate(" + (u.x - C).toFixed(1) + "px," + (u.y - C).toFixed(1) + "px) scale(" + s.toFixed(3) + ")";
      fly.getBoundingClientRect();
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fly.style.transition = "";
        fly.style.transform = "";
        net.classList.remove("is-entering");
      });
    });
  }

  /* ---------- the tooltip ---------- */
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

  function showTip(i) {
    var n = nodes[i];
    if (!n) return;
    tip.style.setProperty("--tip-c", n.col);
    tip.innerHTML = tipHTML(n);
    tip.hidden = false;
    // The card never sits on the drawing: on a wide screen it docks over the
    // file column, level with the dot; on a phone it docks just under the
    // drawing. The dot and its link stay lit, so the pairing is still clear.
    var box = net.getBoundingClientRect(), side = info.getBoundingClientRect();
    var dot = n.g.querySelector(".dot").getBoundingClientRect();
    var cy = dot.top + dot.height / 2 - box.top, left, top;
    if (side.left >= box.right - 2) {
      tip.style.width = Math.min(320, side.width - 28) + "px";
      var th = tip.offsetHeight;
      var minTop = drawer.classList.contains("is-open") ? drawer.offsetHeight + 26 : 14;
      left = side.left - box.left + 14;
      top = Math.max(minTop, Math.min(cy - th / 2, box.height - th - 14));
    } else {
      tip.style.width = (box.width - 24) + "px";
      left = 12;
      top = box.height + 8;
    }
    tip.style.left = left.toFixed(0) + "px";
    tip.style.top = top.toFixed(0) + "px";
  }
  function hideTip() {
    tip.hidden = true;
    pinned = false;
  }

  function activate(i, pin) {
    nodes.forEach(function (n, j) {
      var on = j === i;
      n.g.classList.toggle("is-on", on);
      n.edge.classList.toggle("is-on", on);
    });
    net.classList.toggle("is-focus", i >= 0);
    active = i;
    if (i >= 0) { showTip(i); pinned = !!pin; } else hideTip();
  }

  svg.addEventListener("pointerover", function (e) {
    if (pinned) return;
    var g = e.target.closest && e.target.closest(".hs-nb");
    if (g) activate(Number(g.getAttribute("data-i")), false);
  });
  svg.addEventListener("pointerleave", function () {
    if (!pinned) activate(-1);
  });
  svg.addEventListener("click", function (e) {
    var g = e.target.closest && e.target.closest(".hs-nb");
    if (g) activate(Number(g.getAttribute("data-i")), true);
    else activate(-1);
  });
  svg.addEventListener("keydown", function (e) {
    if (!nodes.length) return;
    var i = active, N = nodes.length;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % N;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = i <= 0 ? N - 1 : i - 1;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = N - 1;
    else if (e.key === "Escape") { activate(-1); return; }
    else return;
    e.preventDefault();
    activate(i, true);
  });
  document.addEventListener("click", function (e) {
    if (!pinned || active < 0) return;
    if (svg.contains(e.target) || e.target.closest(".hs-all button")) return;
    activate(-1);
  });

  /* ---------- go ---------- */
  buildPicks();
  clear();
  setDrawer(true);
})();
