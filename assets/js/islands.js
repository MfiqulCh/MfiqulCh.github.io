/* The islands map — week 1, components.

   Every component is an island and every link a stretch of track. Pick
   where you start and where you're going (type a name, or click two towns):
   if a track connects them the train takes the shortest route along the
   links, and if not — different islands — you fly.

   Everything drawn comes from window.ISLANDS, written by the week 1 notebook
   to weeks/week1/data/islands.js: town positions (the mainland keeps the
   force layout from the network figure), the tracks, and the trip facts.
   Links count in either direction, as they do for components.

   Like the hub screen, the map pans and zooms; geography scales with the
   zoom, while town dots, labels, tracks and the route keep their size on
   screen, and more town names appear the further you zoom in. */
(function () {
  "use strict";

  var root = document.getElementById("islands");
  if (!root || !window.ISLANDS) return;

  var D = window.ISLANDS;
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia("(pointer: coarse)").matches;
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var W = D.world[0], H = D.world[1], KMIN = 0.8, KMAX = 10;

  var form = root.querySelector(".im-bar");
  var fromIn = root.querySelector("#im-from");
  var toIn = root.querySelector("#im-to");
  var map = root.querySelector(".im-map");
  var svg = map.querySelector("svg");
  var zoomBox = map.querySelector(".im-zoom");
  var hint = map.querySelector(".im-hint");
  var ticket = root.querySelector(".im-ticket");
  var places = root.querySelector(".im-places");
  var keyHow = root.querySelector(".im-keys-how");
  var nojs = root.querySelector(".hs-nojs");
  if (nojs) nojs.hidden = true;
  if (keyHow) keyHow.textContent = coarse ? "two fingers to move and zoom"
    : "drag to move · " + (mac ? "⌘" : "Ctrl") + " + scroll or ± to zoom";

  /* ---------- the data ---------- */
  var towns = D.towns.map(function (t, i) {
    return { i: i, name: t[0], x: t[1], y: t[2], comp: t[3], in: t[4], out: t[5] };
  });
  var adj = towns.map(function () { return []; });
  D.tracks.forEach(function (e) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
  var byName = {};
  towns.forEach(function (t) { byName[t.name.toLowerCase()] = t.i; });
  function islandName(c) {
    return c === 0 ? "the mainland" : c === 1 ? "Morituri Island" : "an islet of their own";
  }

  /* ---------- helpers ---------- */
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  var hintTimer = 0;
  function showHint(text) {
    hint.textContent = text;
    hint.classList.add("is-on");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.remove("is-on"); }, 1600);
  }

  /* ---------- drawing the map ---------- */
  var world = el("g", { class: "im-world" }, svg);
  var land = towns.map(function (t) { return "M" + t.x + " " + t.y + "l0 0"; }).join("") +
    D.tracks.map(function (e) {
      var a = towns[e[0]], b = towns[e[1]];
      return "M" + a.x + " " + a.y + "L" + b.x + " " + b.y;
    }).join("");
  [["shallow", 52], ["sand", 34], ["grass", 20]].forEach(function (l) {
    el("path", { class: "im-land " + l[0], d: land, "stroke-width": l[1] }, world);
  });
  var tracks = el("path", { class: "im-tracks", d: D.tracks.map(function (e) {
    var a = towns[e[0]], b = towns[e[1]];
    return "M" + a.x + " " + a.y + "L" + b.x + " " + b.y;
  }).join("") }, world);
  var gRoute = el("g", { class: "im-route" }, world);
  var gTowns = el("g", { class: "im-towns" }, world);
  var gLabels = el("g", { class: "im-labels" }, world);
  var gIsles = el("g", { class: "im-isles" }, world);
  var gVehicle = el("g", { class: "im-vehicle" }, world);

  towns.forEach(function (t) {
    t.dot = el("circle", { class: "dot", cx: t.x, cy: t.y, "data-i": t.i }, gTowns);
    t.hit = el("circle", { class: "hit", cx: t.x, cy: t.y, "data-i": t.i }, gTowns);
    // which zoom a name needs before it shows: big towns first, the islets once there is room
    var tier = t.comp >= 2 ? 1 : t.comp === 1 ? 2 : t.i < 3 ? 0 : t.in >= 15 ? 2 : t.in >= 5 ? 3 : 4;
    t.label = el("text", { class: "im-label t" + tier, x: t.x, y: t.y, dx: "0.75em", dy: "0.35em" }, gLabels);
    t.label.textContent = t.name;
  });
  D.islands.forEach(function (isl) {
    var t = el("text", { class: "im-isle", x: isl.x, y: isl.y, "text-anchor": "middle" }, gIsles);
    t.textContent = isl.name.toUpperCase() + " · " + isl.towns;
  });

  /* ---------- view: pan and zoom ---------- */
  var k = 1, tx = 0, ty = 0, anim = 0;
  function screenScale() { var m = svg.getScreenCTM(); return m && m.a ? m.a : 1; }
  function applyWorld() {
    world.setAttribute("transform", "translate(" + tx.toFixed(2) + " " + ty.toFixed(2) + ") scale(" + k.toFixed(4) + ")");
  }
  function layout() {
    var s = screenScale() * k, grow = Math.sqrt(k);
    world.style.setProperty("--u", (1 / s).toFixed(5));
    gLabels.style.fontSize = (11 / s).toFixed(3) + "px";
    gLabels.style.strokeWidth = (3 / s).toFixed(3) + "px";
    gIsles.style.fontSize = (11.5 / s).toFixed(3) + "px";
    gIsles.style.strokeWidth = (4 / s).toFixed(3) + "px";
    towns.forEach(function (t) {
      var r = (2.1 + 0.32 * Math.sqrt(t.in)) * grow / s;
      t.dot.setAttribute("r", r.toFixed(3));
      t.hit.setAttribute("r", Math.max(r, 8 / s).toFixed(3));
    });
    // more names the closer you are
    svg.setAttribute("data-zoom", s >= 3.6 ? 4 : s >= 2.4 ? 3 : s >= 1.5 ? 2 : s >= 0.85 ? 1 : 0);
    if (vehicle) placeVehicle();
  }
  function setView(nk, ntx, nty) {
    k = nk; tx = ntx; ty = nty;
    applyWorld();
    layout();
    map.classList.toggle("is-zoomed", k > 1.02);
  }
  function toUser(sx, sy) {
    var p = svg.createSVGPoint();
    p.x = sx; p.y = sy;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function zoomedAbout(nk, sx, sy) {
    nk = clamp(nk, KMIN, KMAX);
    var u = toUser(sx, sy);
    return [nk, u.x - (nk / k) * (u.x - tx), u.y - (nk / k) * (u.y - ty)];
  }
  function animateView(target, ms, then) {
    cancelAnimationFrame(anim);
    if (reduce || !ms) { setView(target[0], target[1], target[2]); if (then) then(); return; }
    var k0 = k, x0 = tx, y0 = ty, t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / ms), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setView(k0 * Math.pow(target[0] / k0, e), x0 + (target[1] - x0) * e, y0 + (target[2] - y0) * e);
      if (p < 1) anim = requestAnimationFrame(step);
      else if (then) then();
    })(t0);
  }
  // the part of the viewBox actually on screen, in viewBox units
  function visibleBox() {
    var r = svg.getBoundingClientRect(), a = toUser(r.left, r.top), b = toUser(r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }
  // the view that fits world box (x0,y0)-(x1,y1) with a margin
  function fitView(x0, y0, x1, y1, pad) {
    var v = visibleBox();
    var nk = clamp(Math.min(v.w / (x1 - x0 + 2 * pad), v.h / (y1 - y0 + 2 * pad)), KMIN, 6);
    return [nk, v.x + v.w / 2 - nk * (x0 + x1) / 2, v.y + v.h / 2 - nk * (y0 + y1) / 2];
  }
  function fitTowns(list, pad, ms, then) {
    var xs = list.map(function (t) { return t.x; }), ys = list.map(function (t) { return t.y; });
    animateView(fitView(Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys), pad), ms, then);
  }

  zoomBox.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-zoom]");
    if (!b) return;
    var z = b.getAttribute("data-zoom"), r = svg.getBoundingClientRect();
    if (z === "reset") resetAll();
    else animateView(zoomedAbout(k * (z === "in" ? 1.6 : 1 / 1.6), r.left + r.width / 2, r.top + r.height / 2), 220);
  });
  svg.addEventListener("wheel", function (e) {
    if (!(e.ctrlKey || e.metaKey)) { showHint("Hold " + (mac ? "⌘" : "Ctrl") + " and scroll to zoom"); return; }
    e.preventDefault();
    cancelAnimationFrame(anim);
    var t = zoomedAbout(k * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX, e.clientY);
    setView(t[0], t[1], t[2]);
  }, { passive: false });
  svg.addEventListener("dblclick", function (e) {
    if (e.target.closest && e.target.closest(".hit")) return;
    animateView(zoomedAbout(k * 1.8, e.clientX, e.clientY), 240);
  });

  var pointers = {}, drag = null, pinch = null, swallowClick = false, touchHinted = false;
  function count() { return Object.keys(pointers).length; }
  svg.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (count() === 1) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: tx, ty: ty, moved: false, touch: e.pointerType === "touch" };
      if (drag.touch && k <= 1.02 && !touchHinted) { touchHinted = true; showHint("Two fingers to move and zoom"); }
    } else if (count() === 2) {
      drag = null;
      var p = Object.keys(pointers).map(function (id) { return pointers[id]; });
      var u = toUser((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
      pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, k: k, wx: (u.x - tx) / k, wy: (u.y - ty) / k };
    }
  });
  svg.addEventListener("pointermove", function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch && count() === 2) {
      var p = Object.keys(pointers).map(function (id) { return pointers[id]; });
      var nk = clamp(pinch.k * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / pinch.d, KMIN, KMAX);
      var u = toUser((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
      cancelAnimationFrame(anim);
      setView(nk, u.x - nk * pinch.wx, u.y - nk * pinch.wy);
      swallowClick = true;
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      if (drag.touch && k <= 1.02) { drag = null; return; }   // one finger at the full view scrolls the page
      drag.moved = true;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      map.classList.add("is-panning");
    }
    cancelAnimationFrame(anim);
    var sc = screenScale();
    setView(k, drag.tx + dx / sc, drag.ty + dy / sc);
  });
  function pointerEnd(e) {
    delete pointers[e.pointerId];
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) swallowClick = true;
      drag = null;
      map.classList.remove("is-panning");
    }
    if (count() < 2) pinch = null;
  }
  svg.addEventListener("pointerup", pointerEnd);
  svg.addEventListener("pointercancel", pointerEnd);

  /* ---------- routes ---------- */
  function route(a, b) {                                   // breadth-first: fewest stops
    var prev = new Array(towns.length).fill(-1), seen = new Array(towns.length).fill(false), q = [a], h = 0;
    seen[a] = true;
    while (h < q.length) {
      var v = q[h++];
      if (v === b) break;
      for (var j = 0; j < adj[v].length; j++) {
        var w = adj[v][j];
        if (!seen[w]) { seen[w] = true; prev[w] = v; q.push(w); }
      }
    }
    if (!seen[b]) return null;
    var path = [b];
    while (path[0] !== a) path.unshift(prev[path[0]]);
    return path;
  }

  var from = null, to = null, vehicle = null, run = 0;

  function clearTrip() {
    run++;
    vehicle = null;
    gRoute.innerHTML = "";
    gVehicle.innerHTML = "";
    svg.classList.remove("has-route");
    towns.forEach(function (t) { t.label.classList.remove("is-on"); t.dot.classList.remove("is-end", "is-stop", "is-arrived"); });
  }
  function markEnds() {
    [from, to].forEach(function (i) {
      if (i === null) return;
      towns[i].dot.classList.add("is-end");
      towns[i].label.classList.add("is-on");
    });
  }

  function choose(i) {                                     // a click on a town
    if (from === null || to !== null) {
      from = i; to = null;
      fromIn.value = towns[i].name; toIn.value = "";
      clearTrip(); markEnds();
      say("From " + towns[i].name + " on " + islandName(towns[i].comp) + ". Now pick where you’re going.");
    } else if (i === from) {
      say("You’re already in " + towns[i].name + ". Pick somewhere else.");
    } else {
      to = i; toIn.value = towns[i].name;
      travel();
    }
  }

  function say(html) {
    ticket.innerHTML = '<p class="im-tk-note">' + html + "</p>";
  }

  function travel() {
    clearTrip();
    markEnds();
    var A = towns[from], B = towns[to], myRun = run;
    if (from === to) { say("You’re already there."); return; }
    svg.classList.add("has-route");                        // only the stops keep their names, until you zoom right in
    var path = route(from, to);
    if (path) {
      var hops = path.length - 1;
      ticket.innerHTML =
        '<div class="im-tk-head"><span class="im-ico train" aria-hidden="true"></span><strong>Train · ' + hops +
        (hops === 1 ? " stop" : " stops") + "</strong><span>" + (hops === 1 ? "a direct link, " : "") + "on " +
        islandName(A.comp) + "</span></div>" +
        '<ol class="im-stations">' + path.map(function (i) {
          return '<li><button type="button" data-i="' + i + '">' + esc(towns[i].name) + "</button></li>";
        }).join("") + "</ol>";
      drawRail(path);
      fitTowns(path.map(function (i) { return towns[i]; }), 60, 650, function () {
        if (myRun === run) runTrain(path, myRun);
      });
    } else {
      ticket.innerHTML =
        '<div class="im-tk-head"><span class="im-ico plane" aria-hidden="true"></span><strong>Flight</strong><span>no track between them</span></div>' +
        '<p class="im-tk-note">' + esc(A.name) + " is on " + esc(islandName(A.comp)) + " and " + esc(B.name) + " on " +
        esc(islandName(B.comp)) + ". No article on either island links to one on the other, so there is no railway to take.</p>";
      drawFlight(A, B);
      fitTowns([A, B], 70, 650, function () { if (myRun === run) runPlane(A, B, myRun); });
    }
  }

  function drawRail(path) {
    var d = path.map(function (i, j) { return (j ? "L" : "M") + towns[i].x + " " + towns[i].y; }).join("");
    el("path", { class: "im-rail-bed", d: d }, gRoute);
    el("path", { class: "im-rail", d: d, pathLength: "1" }, gRoute);
    el("path", { class: "im-rail-ties", d: d }, gRoute);
    path.forEach(function (i, j) {
      towns[i].label.classList.add("is-on");
      if (j && j < path.length - 1) towns[i].dot.classList.add("is-stop");
    });
  }

  function arcPoint(A, B, t) {                            // a quadratic arc, bowed upwards
    var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, d = Math.hypot(B.x - A.x, B.y - A.y);
    var cx = mx, cy = my - Math.max(40, d * 0.32);
    var u = 1 - t;
    return {
      x: u * u * A.x + 2 * u * t * cx + t * t * B.x,
      y: u * u * A.y + 2 * u * t * cy + t * t * B.y,
      a: Math.atan2(2 * u * (cy - A.y) + 2 * t * (B.y - cy), 2 * u * (cx - A.x) + 2 * t * (B.x - cx))
    };
  }
  function drawFlight(A, B) {
    var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, d = Math.hypot(B.x - A.x, B.y - A.y);
    el("path", { class: "im-flight", d: "M" + A.x + " " + A.y + "Q" + mx + " " + (my - Math.max(40, d * 0.32)) + " " + B.x + " " + B.y }, gRoute);
  }

  // the vehicle is drawn at a constant size on screen, wherever the view is
  var GLYPH = {
    train: '<rect x="-11" y="-5" width="22" height="10" rx="4" class="im-v-body"/>' +
           '<rect x="-7" y="-2.4" width="11" height="4.8" rx="1.4" class="im-v-window"/>' +
           '<circle cx="8" cy="0" r="1.6" class="im-v-lamp"/>',
    plane: '<path class="im-v-body" d="M12 0 L4 -1.6 L-2 -9 L-5 -9 L-1.5 -1.6 L-8 -1.2 L-10.5 -4.5 L-12.5 -4.5 L-11 0 L-12.5 4.5 L-10.5 4.5 L-8 1.2 L-1.5 1.6 L-5 9 L-2 9 L4 1.6 Z"/>'
  };
  function makeVehicle(kind) {
    gVehicle.innerHTML = "";
    var g = el("g", { class: "im-v " + kind }, gVehicle);
    g.innerHTML = GLYPH[kind];
    vehicle = { g: g, x: 0, y: 0, a: 0 };
    return vehicle;
  }
  function placeVehicle() {
    var s = screenScale() * k;
    vehicle.g.setAttribute("transform", "translate(" + vehicle.x.toFixed(2) + " " + vehicle.y.toFixed(2) +
      ") rotate(" + (vehicle.a * 180 / Math.PI).toFixed(1) + ") scale(" + (1 / s).toFixed(4) + ")");
  }

  function runTrain(path, myRun) {
    var v = makeVehicle("train");
    var rail = gRoute.querySelector(".im-rail");
    if (reduce) {
      var last = towns[path[path.length - 1]], prevT = towns[path[path.length - 2]];
      v.x = last.x; v.y = last.y; v.a = Math.atan2(last.y - prevT.y, last.x - prevT.x);
      placeVehicle();
      return;
    }
    rail.classList.add("is-drawing");
    var seg = 0, t0 = performance.now(), HOP = 700, DWELL = 260;
    (function step(now) {
      if (myRun !== run) return;
      var A = towns[path[seg]], B = towns[path[seg + 1]];
      var p = Math.min(1, (now - t0) / HOP), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      v.x = A.x + (B.x - A.x) * e; v.y = A.y + (B.y - A.y) * e; v.a = Math.atan2(B.y - A.y, B.x - A.x);
      placeVehicle();
      rail.style.strokeDashoffset = (1 - (seg + e) / (path.length - 1)).toFixed(4);
      if (p < 1) { requestAnimationFrame(step); return; }
      towns[path[seg + 1]].dot.classList.add("is-arrived");
      seg++;
      if (seg >= path.length - 1) return;
      setTimeout(function () { t0 = performance.now(); requestAnimationFrame(step); }, DWELL);
    })(t0);
  }

  function runPlane(A, B, myRun) {
    var v = makeVehicle("plane");
    var p0 = arcPoint(A, B, reduce ? 1 : 0);
    v.x = p0.x; v.y = p0.y; v.a = p0.a;
    placeVehicle();
    if (reduce) return;
    var t0 = performance.now(), MS = 1700;
    (function step(now) {
      if (myRun !== run) return;
      var p = Math.min(1, (now - t0) / MS), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      var q = arcPoint(A, B, e);
      v.x = q.x; v.y = q.y; v.a = q.a;
      placeVehicle();
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- the controls ---------- */
  function resolve(text) {
    var q = text.trim().toLowerCase();
    if (!q) return null;
    if (q in byName) return byName[q];
    var hits = towns.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; });
    return hits.length === 1 ? hits[0].i : null;
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    closeMenus();
    var a = resolve(fromIn.value), b = resolve(toIn.value);
    if (a === null || b === null) {
      var bad = a === null ? fromIn : toIn;
      say("There’s no single character called “" + esc(bad.value || "…") + "” — pick one from the list.");
      bad.focus();
      return;
    }
    from = a; to = b;
    fromIn.value = towns[a].name; toIn.value = towns[b].name;
    travel();
  });
  root.querySelector("[data-trip=random]").addEventListener("click", function () {
    var a = Math.floor(Math.random() * towns.length), b;
    // now and then, send the trip off the mainland so the plane gets used
    var abroad = Math.random() < 0.35;
    do { b = Math.floor(Math.random() * towns.length); }
    while (b === a || (abroad && towns[b].comp === towns[a].comp));
    from = a; to = b;
    fromIn.value = towns[a].name; toIn.value = towns[b].name;
    travel();
  });
  root.querySelector("[data-trip=longest]").addEventListener("click", function () {
    from = D.trips.longest_from; to = D.trips.longest_to;
    fromIn.value = towns[from].name; toIn.value = towns[to].name;
    travel();
  });
  ticket.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    var t = towns[Number(b.getAttribute("data-i"))];
    var nk = Math.max(k, 3);
    var v = visibleBox();
    animateView([nk, v.x + v.w / 2 - nk * t.x, v.y + v.h / 2 - nk * t.y], 450);
  });
  places.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-place]");
    if (!b) return;
    var p = b.getAttribute("data-place");
    if (p === "all") { animateView([1, 0, 0], 500); return; }
    fitTowns(towns.filter(function (t) { return p === "islets" ? t.comp >= 2 : t.comp === Number(p); }), p === "0" ? 30 : 50, 550);
  });
  svg.addEventListener("click", function (e) {
    if (swallowClick) { swallowClick = false; return; }
    var hit = e.target.closest && e.target.closest(".hit");
    if (hit) choose(Number(hit.getAttribute("data-i")));
  });
  svg.addEventListener("pointerover", function (e) {
    var hit = e.target.closest && e.target.closest(".hit");
    if (hit) towns[Number(hit.getAttribute("data-i"))].label.classList.add("is-hover");
  });
  svg.addEventListener("pointerout", function (e) {
    var hit = e.target.closest && e.target.closest(".hit");
    if (hit) towns[Number(hit.getAttribute("data-i"))].label.classList.remove("is-hover");
  });

  if (window.ResizeObserver) new ResizeObserver(layout).observe(map);
  else window.addEventListener("resize", layout);

  /* ---------- go ---------- */
  applyWorld();
  layout();
  function startNote() {
    say("Where to? Type two names above, pick them island by island from the \u25be menus, or click a town " +
        "to start from and another to go to. A train runs when a track connects them; otherwise you fly.");
  }
  // the \u27f2 button: back to the map exactly as it was when the page loaded
  function resetAll() {
    from = to = null;
    fromIn.value = toIn.value = "";
    closeMenus();
    clearTrip();
    startNote();
    animateView([1, 0, 0], 300);
  }

  /* ---------- the From / To pickers: type to search, or \u25be to go island by island ---------- */
  var ISLES = [
    { label: "The mainland", test: function (t) { return t.comp === 0; } },
    { label: "Morituri Island", test: function (t) { return t.comp === 1; } },
    { label: "Islets of one", test: function (t) { return t.comp >= 2; } }
  ];
  var alpha = towns.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var shortIsle = function (t) { return t.comp === 0 ? "mainland" : t.comp === 1 ? "Morituri" : "islet"; };
  function closeMenus(except) {
    [].forEach.call(root.querySelectorAll(".im-pick"), function (p) {
      if (p === except) return;
      p.querySelector(".im-menu").hidden = true;
      p.querySelector(".im-drop").setAttribute("aria-expanded", "false");
      p.querySelector("input").setAttribute("aria-expanded", "false");
    });
  }
  function openMenu(pick, html) {
    closeMenus(pick);
    var m = pick.querySelector(".im-menu");
    m.innerHTML = html;
    m.hidden = false;
    m.scrollTop = 0;
    pick.querySelector(".im-drop").setAttribute("aria-expanded", "true");
    pick.querySelector("input").setAttribute("aria-expanded", "true");
  }
  function islesHTML() {
    return '<p class="im-menu-head">Choose an island</p>' + ISLES.map(function (isl, j) {
      return '<button type="button" class="im-opt isle" data-isle="' + j + '"><span>' + isl.label +
        '</span><small>' + towns.filter(isl.test).length + ' \u203a</small></button>';
    }).join("");
  }
  function townsHTML(list, head, back) {
    return (back ? '<button type="button" class="im-opt back" data-back="1">\u2039 All islands</button>' : "") +
      '<p class="im-menu-head">' + head + "</p>" +
      (list.length ? list.map(function (t) {
        return '<button type="button" class="im-opt" data-i="' + t.i + '"><span>' + esc(t.name) + "</span>" +
          (back ? "" : "<small>" + shortIsle(t) + "</small>") + "</button>";
      }).join("") : '<p class="im-menu-none">No character by that name.</p>');
  }
  function choosePick(pick, i) {
    var input = pick.querySelector("input");
    input.value = towns[i].name;
    closeMenus();
    input.focus();
    var a = resolve(fromIn.value), b = resolve(toIn.value);
    if (a !== null && b !== null) { from = a; to = b; travel(); }
    else if (input === fromIn) {
      from = i; to = null; clearTrip(); markEnds();
      say("From " + esc(towns[i].name) + " on " + islandName(towns[i].comp) + ". Now pick where you\u2019re going.");
    }
  }
  [].forEach.call(root.querySelectorAll(".im-pick"), function (pick) {
    var input = pick.querySelector("input"), menu = pick.querySelector(".im-menu");
    pick.querySelector(".im-drop").addEventListener("click", function () {
      if (!menu.hidden) { closeMenus(); return; }
      openMenu(pick, islesHTML());
      var f = menu.querySelector(".im-opt"); if (f) f.focus();
    });
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      if (!q) { closeMenus(); return; }
      var hits = alpha.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 60);
      openMenu(pick, townsHTML(hits, hits.length + (hits.length === 60 ? "+" : "") + " matching", false));
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (menu.hidden) openMenu(pick, input.value.trim() ? menu.innerHTML : islesHTML());
        var f = menu.querySelector(".im-opt"); if (f) f.focus();
      } else if (e.key === "Escape") closeMenus();
    });
    menu.addEventListener("click", function (e) {
      e.stopPropagation();                                  // the menu redraws itself, so the outside-click check would misfire
      var b = e.target.closest(".im-opt");
      if (!b) return;
      if (b.hasAttribute("data-back")) { menu.innerHTML = islesHTML(); menu.querySelector(".im-opt").focus(); return; }
      if (b.hasAttribute("data-isle")) {
        var isl = ISLES[Number(b.getAttribute("data-isle"))];
        menu.innerHTML = townsHTML(alpha.filter(isl.test), isl.label, true);
        menu.scrollTop = 0;
        var f = menu.querySelector(".im-opt:not(.back)"); if (f) f.focus();
        return;
      }
      choosePick(pick, Number(b.getAttribute("data-i")));
    });
    menu.addEventListener("keydown", function (e) {
      var opts = [].slice.call(menu.querySelectorAll(".im-opt")), k = opts.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (opts[k + 1] || opts[k]).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (k <= 0) input.focus(); else opts[k - 1].focus(); }
      else if (e.key === "Escape") { closeMenus(); input.focus(); }
      else if (e.key === "ArrowLeft" && menu.querySelector("[data-back]")) menu.querySelector("[data-back]").click();
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".im-pick")) closeMenus();
  });

  startNote();
})();
