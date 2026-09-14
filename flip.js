/* Flip cards for the figure panels.
   Each panel is a <button aria-expanded>, so click, Enter and Space all work
   and the focus ring comes for free. The 3D flip itself is CSS; this only
   toggles the attribute the stylesheet keys off. */
document.querySelectorAll(".flip").forEach(function (card) {
  card.addEventListener("click", function () {
    var open = card.getAttribute("aria-expanded") === "true";
    card.setAttribute("aria-expanded", open ? "false" : "true");
  });
});
