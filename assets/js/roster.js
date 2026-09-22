/* Character roster — week 3.
   Each .hero is a <button>. Clicking it opens a dialog that grows out of the
   card's own position and flips to show the dossier held in
   <template id="hero-{slug}">. Colours come from --c1 / --c2 on the button.

   The animation is a FLIP: measure where the card is, measure where the
   dialog will end up, start the dialog transformed to sit exactly over the
   card, then let CSS transition it home. Both states use the same list of
   transform functions so the browser interpolates each one separately. */
(function () {
  "use strict";

  var roster = document.querySelector(".roster");
  if (!roster) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DURATION = 560;

  var overlay = null, card = null, trigger = null, start = "", busy = false;

  function transformFrom(rect, target) {
    var dx = (rect.left + rect.width / 2) - (target.left + target.width / 2);
    var dy = (rect.top + rect.height / 2) - (target.top + target.height / 2);
    var sx = rect.width / target.width;
    var sy = rect.height / target.height;
    return "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ") rotateY(0deg)";
  }

  var OPEN = "translate(0px,0px) scale(1,1) rotateY(180deg)";

  function focusables() {
    return card ? card.querySelectorAll(".hm-back a[href], .hm-back button") : [];
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(btn) {
    if (busy || overlay) return;
    var tpl = document.getElementById("hero-" + btn.getAttribute("data-hero"));
    if (!tpl) return;
    busy = true;
    trigger = btn;

    overlay = document.createElement("div");
    overlay.className = "hm-overlay";

    var stage = document.createElement("div");
    stage.className = "hm-stage";
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-modal", "true");
    stage.setAttribute("aria-label", btn.getAttribute("data-name") || "Character");
    stage.setAttribute("style", btn.getAttribute("style") || "");   // carries --c1 / --c2

    card = document.createElement("div");
    card.className = "hm-card";

    var front = document.createElement("div");
    front.className = "hm-face hm-front";
    front.setAttribute("aria-hidden", "true");
    front.appendChild(btn.querySelector(".hero-portrait").cloneNode(true));

    var back = document.createElement("div");
    back.className = "hm-face hm-back";
    back.appendChild(tpl.content.cloneNode(true));

    var x = document.createElement("button");
    x.className = "hm-close";
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.innerHTML = "&times;";
    back.insertBefore(x, back.firstChild);

    card.appendChild(front);
    card.appendChild(back);
    stage.appendChild(card);
    overlay.appendChild(stage);
    document.body.appendChild(overlay);
    document.body.classList.add("hm-lock");

    // measure the resting place, then jump to the card and animate home
    var target = card.getBoundingClientRect();
    start = transformFrom(btn.querySelector(".hero-portrait").getBoundingClientRect(), target);

    if (reduce) {
      card.style.transform = OPEN;
      overlay.classList.add("is-open");
      busy = false;
    } else {
      card.style.transform = start;
      card.getBoundingClientRect();                    // commit the start state
      requestAnimationFrame(function () {
        overlay.classList.add("is-open");
        card.style.transform = OPEN;
      });
      setTimeout(function () { busy = false; }, DURATION);
    }

    x.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target === stage) close();
    });
    document.addEventListener("keydown", onKey);
    setTimeout(function () { x.focus({ preventScroll: true }); }, reduce ? 0 : DURATION * 0.6);
  }

  function close() {
    if (busy || !overlay) return;
    busy = true;
    document.removeEventListener("keydown", onKey);

    var done = function () {
      if (overlay) overlay.remove();
      document.body.classList.remove("hm-lock");
      if (trigger) trigger.focus({ preventScroll: true });
      overlay = card = trigger = null;
      busy = false;
    };

    overlay.classList.remove("is-open");
    if (reduce) { done(); return; }
    card.style.transform = start;                      // fly back into the card
    setTimeout(done, DURATION);
  }

  roster.addEventListener("click", function (e) {
    var btn = e.target.closest(".hero");
    if (btn) open(btn);
  });
})();
