/* The hub screen — week 1.

   Two tabs (In / Out). A navy drawer slides down over the top of the screen
   holding the five characters for the current tab; the arrow at its bottom
   slides it back up.

   Picking a character does two things at once:
     - the screen draws that character in the middle with every link around
       them, arriving on the In tab and leaving on the Out tab;
     - their file pops open on top of it, growing out of the icon that was
       clicked. Closing the file shrinks it into the middle of the drawing,
       and the links flow in.
   The character in the middle (or the button in the guide) opens the file
   again.

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
  var LABELLED = 5, POP_MS = 560;

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
  var guide = root.querySelector(".hs-info");
  var nojs = root.querySelector(".hs-nojs");
  if (nojs) nojs.hidden = true;
  guide.removeAttribute("aria-live");

  var say = document.createElement("p");                 // short announcements for screen readers
  say.className = "sr";
  say.setAttribute("aria-live", "polite");
  root.appendChild(say);

  var pop = document.createElement("div");               // the character's file
  pop.className = "hs-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "true");
  pop.setAttribute("aria-labelledby", "hs-pop-name");
  screen.appendChild(pop);

  var mode = "in", current = null, nodes = [], active = -1, pinned = false;
  var popOpen = false, popBusy = false, popTrigger = null, revealed = false, after = null;

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
  function setInert(on) {
    [drawer, stage].forEach(function (x) { if ("inert" in x) x.inert = on; });
  }

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
    if (popOpen) closePop(true);
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
        (mode === "in" ? " links received" : " links made") + ". Opens their file.");
      b.style.setProperty("--c1", m.c1);
      b.style.setProperty("--c2", m.c2);
      b.innerHTML = '<span class="hs-badge"><span class="hs-rank">' + (i + 1) + "</span>" + esc(m.ini) +
        '</span><span class="hs-pick-name">' + esc(h.name) + '</span><span class="hs-pick-n">' +
        h[mode] + (mode === "in" ? " in" : " out") + "</span>";
      b.addEventListener("click", function () { select(h, b); });
      picks.appendChild(b);
    });
  }

  /* ---------- the guide beside the drawing ---------- */
  function legendHTML(h) {
    var hub = h ? esc(h.name) : "the character in the middle";
    var near = mode === "in"
      ? "nearer the middle: their article names " + hub + " more often"
      : "nearer the middle: " + (h ? hub + "’s" : "that character’s") + " article names them more often";
    return '<ul class="hs-legend">' +
      '<li><span class="hs-key red"></span>links both ways</li>' +
      '<li><span class="hs-key blue"></span>one way only</li>' +
      '<li><span class="hs-key size"></span>bigger dot: more links in of its own</li>' +
      '<li><span class="hs-key ring"></span>' + near + "</li></ul>";
  }

  function clear() {
    current = null;
    nodes = [];
    active = -1;
    revealed = false;
    hideTip();
    svg.innerHTML = "";
    svg.removeAttribute("tabindex");
    svg.setAttribute("aria-label", "Pick a character to draw their links");
    net.classList.remove("is-focus", "is-entering");
    var total = DATA[mode].reduce(function (a, h) { return a + h[mode]; }, 0);
    var share = (100 * total / DATA.links_total).toFixed(1) + "%";
    empty.innerHTML = "<strong>" + share + "</strong><span>of all " + num(DATA.links_total) +
      (mode === "in" ? " links point at one of these five." : " links are written by these five.") +
      "</span><em>Pick one to see who " + (mode === "in" ? "links to them." : "they link to.") + "</em>";
    empty.hidden = false;
    guide.innerHTML =
      '<p class="hs-kicker">How to read the screen</p>' +
      "<p>" + (mode === "in"
        ? "Pick one of the five. Their file opens, and behind it the screen draws every character whose article links to them, with the arrow pointing in."
        : "Pick one of the five. Their file opens, and behind it the screen draws every character their article links to, with the arrow pointing out.") +
      "</p>" + legendHTML(null) +
      '<p class="hs-hint">The arrow at the bottom of the drawer slides it up out of the way.</p>';
  }

  function fillGuide(h) {
    guide.innerHTML =
      '<p class="hs-kicker">How to read the screen</p>' +
      "<p>" + esc(h.name) + (mode === "in"
        ? " sits in the middle. Around the outside is every character whose article links to " + esc(h.name) + ", each arrow pointing in."
        : " sits in the middle. Around the outside is every character " + esc(h.name) + "’s article links to, each arrow pointing out.") +
      "</p>" + legendHTML(h) +
      '<p class="hs-hint">Hover or tap a dot for the sentence behind its link. With a keyboard, focus the drawing and use the arrow keys.</p>' +
      '<button type="button" class="hs-open">Open ' + esc(h.name) + "’s file</button>";
    guide.querySelector(".hs-open").addEventListener("click", function (e) {
      openPop(current, e.currentTarget, e.currentTarget);
    });
  }

  /* ---------- picking a character ---------- */
  function select(h, btn) {
    if (popOpen || popBusy) return;
    [].forEach.call(picks.children, function (b) {
      b.setAttribute("aria-pressed", String(b === btn));
    });
    current = h;
    revealed = false;
    empty.hidden = true;
    draw(h);
    fillGuide(h);
    openPop(h, btn.querySelector(".hs-badge"), btn);
  }

  /* ---------- the file ---------- */
  function fillPop(h) {
    var m = meta(h.id), rank = DATA[mode].indexOf(h) + 1;
    pop.style.setProperty("--c1", m.c1);
    pop.style.setProperty("--c2", m.c2);
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
    var top = h.links.slice(0, 5).map(item).join("");
    var all = h.links.map(item).join("");
    var everyone = mode === "in"
      ? "Everyone who links to " + esc(h.name) + " (" + h.links.length + ")"
      : "Everyone " + esc(h.name) + " links to (" + h.links.length + ")";
    var topTitle = mode === "in" ? "Their articles talk about " + esc(h.name) + " most" : esc(h.name) + "’s article talks about them most";
    pop.innerHTML =
      '<button type="button" class="hs-pop-close" aria-label="Close the file">×</button>' +
      '<div class="hs-pop-inner">' +
        '<div class="hs-pop-side">' +
          '<div class="hs-pop-badge" aria-hidden="true">' + esc(m.ini) + "</div>" +
          '<p class="hs-pop-kicker">No. ' + rank + (mode === "in" ? " · most linked to" : " · links out most") + "</p>" +
          '<h3 id="hs-pop-name">' + esc(h.name) + "</h3>" +
          '<dl class="hs-pop-stats">' +
            stat("Links in", h.in, mode === "in") +
            stat("Links out", h.out, mode === "out") +
            stat("Both ways", h.both) +
            stat("Article", num(h.length), false, "sentences · " + ordinal(h.length_rank) + " longest") +
          "</dl>" +
          '<p class="hs-pop-share">' + share + "</p>" +
        "</div>" +
        '<div class="hs-pop-main">' +
          "<h4>" + esc(m.title) + '</h4><div class="hs-pop-why"></div>' +
          "<h4>" + topTitle + '</h4><ol class="hs-pop-list">' + top + "</ol>" +
          '<details class="hs-pop-all"><summary>' + everyone + '</summary><ol class="hs-pop-list">' + all + "</ol></details>" +
          '<button type="button" class="hs-pop-go">See the links →</button>' +
        "</div>" +
      "</div>";
    if (m.why) pop.querySelector(".hs-pop-why").appendChild(m.why.cloneNode(true));
    pop.querySelector(".hs-pop-close").addEventListener("click", function () { closePop(); });
    pop.querySelector(".hs-pop-go").addEventListener("click", function () { closePop(); });
    pop.querySelector(".hs-pop-main").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (!b) return;
      var i = Number(b.getAttribute("data-i"));
      popTrigger = svg;                                    // keep going with the arrow keys from there
      closePop(false, function () { activate(i, true); });
    });
  }

  function circleAt(rect, ref, grow) {
    var cx = rect.left + rect.width / 2 - ref.left, cy = rect.top + rect.height / 2 - ref.top;
    var r = grow
      ? Math.hypot(Math.max(cx, ref.width - cx), Math.max(cy, ref.height - cy)) + 8
      : Math.max(rect.width, rect.height) / 2;
    return "circle(" + r.toFixed(1) + "px at " + cx.toFixed(1) + "px " + cy.toFixed(1) + "px)";
  }

  function hubRect() {
    var ctm = svg.getScreenCTM();
    var hub = svg.querySelector(".hs-hubnode circle");
    return hub && ctm ? hub.getBoundingClientRect() : null;
  }

  function openPop(h, fromEl, trigger) {
    if (popOpen || popBusy || !h) return;
    activate(-1);
    fillPop(h);
    popTrigger = trigger || null;
    popOpen = true;
    pop.hidden = false;
    pop.classList.remove("is-closing");
    var fixed = getComputedStyle(pop).position === "fixed";
    if (fixed) document.body.classList.add("hm-lock");
    setInert(true);
    say.textContent = h.name + "’s file: " + h.in + " links in, " + h.out + " out, " + h.both + " both ways.";
    document.addEventListener("keydown", popKeys);

    if (reduce || !fromEl) {
      pop.style.clipPath = "";
      pop.classList.add("is-open");
      focusLater(0);
      return;
    }
    popBusy = true;
    var ref = pop.getBoundingClientRect(), from = fromEl.getBoundingClientRect();
    pop.style.transition = "none";
    pop.style.clipPath = circleAt(from, ref, false);
    pop.getBoundingClientRect();
    pop.style.transition = "";
    pop.classList.add("is-open");
    pop.style.clipPath = circleAt(from, ref, true);
    setTimeout(function () { popBusy = false; pop.style.clipPath = ""; }, POP_MS);
    focusLater(POP_MS * 0.6);
  }

  function focusLater(ms) {
    setTimeout(function () {
      var x = pop.querySelector(".hs-pop-close");
      if (x && popOpen) x.focus({ preventScroll: true });
    }, ms);
  }

  // instant: skip the animation (used when switching tabs)
  // then: run after the file has gone, e.g. to light up a link picked in the list
  function closePop(instant, then) {
    if (!popOpen || popBusy) return;
    popOpen = false;
    document.removeEventListener("keydown", popKeys);
    after = then || null;
    var done = function () {
      pop.hidden = true;
      pop.classList.remove("is-open", "is-closing");
      pop.style.clipPath = "";
      popBusy = false;
      document.body.classList.remove("hm-lock");
      setInert(false);
      if (!instant) {
        if (!revealed) reveal();
        if (popTrigger && document.contains(popTrigger)) popTrigger.focus({ preventScroll: true });
        if (after) setTimeout(after, revealed && !reduce ? 260 : 0);
      }
      after = null;
    };
    document.body.classList.remove("hm-lock");
    if (!instant) {
      var nr = net.getBoundingClientRect();
      if (nr.top < 0 || nr.bottom > window.innerHeight) net.scrollIntoView({ block: "center" });
    }
    var target = instant || reduce ? null : hubRect();
    if (!target) { done(); return; }
    popBusy = true;
    var ref = pop.getBoundingClientRect();
    pop.style.transition = "none";
    pop.style.clipPath = circleAt(target, ref, true);
    pop.getBoundingClientRect();
    pop.style.transition = "";
    pop.classList.add("is-closing");
    pop.style.clipPath = circleAt(target, ref, false);
    setTimeout(done, POP_MS);
  }

  function popKeys(e) {
    if (e.key === "Escape") { e.preventDefault(); closePop(); return; }
    if (e.key !== "Tab") return;
    var f = [].filter.call(pop.querySelectorAll("button, summary, a[href]"), function (x) {
      return x.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!pop.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- the drawing ---------- */
  function draw(h) {
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

    var gEdges = el("g", {}), gFlow = el("g", { class: "hs-flows" }), gNodes = el("g", {}), gLabels = el("g", {});
    svg.appendChild(gEdges); svg.appendChild(gFlow); svg.appendChild(gNodes); svg.appendChild(gLabels);

    var labels = [];
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

      var g = el("g", { class: "hs-nb", "data-i": i });
      g.appendChild(el("circle", { class: "hit", cx: x.toFixed(1), cy: y.toFixed(1), r: Math.max(nr + 4, 11).toFixed(1) }));
      g.appendChild(el("circle", { class: "dot", cx: x.toFixed(1), cy: y.toFixed(1), r: nr.toFixed(1), fill: col }));
      gNodes.appendChild(g);

      if (i < LABELLED) {
        var tx = x + Math.cos(a) * (nr + 6), ty = y + Math.sin(a) * (nr + 6) + 4;
        var anchor = Math.cos(a) > 0.35 ? "start" : Math.cos(a) < -0.35 ? "end" : "middle";
        if (anchor === "middle") ty = y + (Math.sin(a) > 0 ? nr + 15 : -(nr + 7));
        var t = el("text", { class: "hs-label", x: tx.toFixed(1), y: ty.toFixed(1), "text-anchor": anchor, "data-i": i });
        t.textContent = l.name;
        gLabels.appendChild(t);
        labels.push({ t: t, x: x, nr: nr });
      }

      if (!reduce) {
        g.style.transitionDelay = (i * stagger).toFixed(0) + "ms";
        edge.style.transitionDelay = (i * stagger + 120).toFixed(0) + "ms";
      }
      return { g: g, edge: edge, l: l, line: line, col: col, delay: i * stagger };
    });

    labels.forEach(function (o) {
      var w = o.t.getComputedTextLength(), anchor = o.t.getAttribute("text-anchor");
      var x = Number(o.t.getAttribute("x"));
      var lo = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2, hi = lo + w;
      if (hi > 594) { o.t.setAttribute("text-anchor", "end"); o.t.setAttribute("x", (o.x - o.nr - 6).toFixed(1)); }
      else if (lo < 6) { o.t.setAttribute("text-anchor", "start"); o.t.setAttribute("x", (o.x + o.nr + 6).toFixed(1)); }
    });

    // the character in the middle; clicking it opens their file again
    var gHub = el("g", { class: "hs-hubnode", transform: "translate(" + C + " " + C + ")" });
    var tt = el("title", {});
    tt.textContent = "Open " + h.name + "’s file";
    gHub.appendChild(tt);
    gHub.appendChild(el("circle", { r: HUB_R, fill: "url(#hs-grad)", stroke: "#fff", "stroke-width": "3" }));
    gHub.appendChild(el("circle", { r: HUB_R + 3, fill: "none", stroke: "#16224C", "stroke-width": "2" }));
    var ini = el("text", { "text-anchor": "middle", dy: "0.36em", fill: "#fff",
      style: "font-family:'Archivo Black',sans-serif;font-size:26px;letter-spacing:-.02em" });
    ini.textContent = m.ini;
    gHub.appendChild(ini);
    var hubName = el("text", { class: "hs-hubname", "text-anchor": "middle", y: HUB_R + 24 });
    hubName.textContent = h.name;
    gHub.appendChild(hubName);
    svg.appendChild(gHub);

    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", h.name + ": " + N + (mode === "in"
      ? " characters link to them" : " characters they link to") +
      ". Use the arrow keys to step through them, most talked-about first.");

    // hidden until the file closes, so the links arrive in front of the reader
    if (!reduce) net.classList.add("is-entering");
  }

  function reveal() {
    revealed = true;
    if (reduce) { net.classList.remove("is-entering"); return; }
    var gFlow = svg.querySelector(".hs-flows");
    nodes.forEach(function (n) {
      var f = el("line", Object.assign({ class: "hs-flowline", stroke: n.col }, n.line));
      f.style.animationDelay = (0.8 + n.delay / 1000).toFixed(3) + "s," + (0.5 + n.delay / 1000).toFixed(3) + "s";
      gFlow.appendChild(f);
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { net.classList.remove("is-entering"); });
    });
  }

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

  function showTip(i) {
    var n = nodes[i];
    if (!n) return;
    tip.style.setProperty("--tip-c", n.col);
    tip.innerHTML = tipHTML(n);
    tip.hidden = false;
    // The card never sits on the drawing: on a wide screen it docks over the
    // guide column, level with the dot; on a phone it docks just under the
    // drawing. The dot and its link stay lit, so the pairing is still clear.
    var box = net.getBoundingClientRect(), side = guide.getBoundingClientRect();
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
    [].forEach.call(svg.querySelectorAll(".hs-label"), function (t) {
      t.classList.toggle("is-on", Number(t.getAttribute("data-i")) === i);
    });
    net.classList.toggle("is-focus", i >= 0);
    active = i;
    if (i >= 0) { showTip(i); pinned = !!pin; } else hideTip();
  }

  svg.addEventListener("pointerover", function (e) {
    if (pinned || popOpen) return;
    var g = e.target.closest && e.target.closest(".hs-nb");
    if (g) activate(Number(g.getAttribute("data-i")), false);
  });
  svg.addEventListener("pointerleave", function () {
    if (!pinned) activate(-1);
  });
  svg.addEventListener("click", function (e) {
    var hub = e.target.closest && e.target.closest(".hs-hubnode");
    if (hub && current) { openPop(current, hub.querySelector("circle"), svg); return; }
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
    if (svg.contains(e.target) || pop.contains(e.target)) return;
    activate(-1);
  });

  /* ---------- go ---------- */
  buildPicks();
  clear();
  setDrawer(true);
})();
