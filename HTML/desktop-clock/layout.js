(function () {
  "use strict";

  var layout = document.querySelector("[data-scale-layout]");
  if (!layout) return;

  var mode = layout.dataset.scaleLayout;
  var baseWidth = Number(layout.dataset.baseWidth);
  var baseHeight = Number(layout.dataset.baseHeight || 0);

  function resizeLayout() {
    var scale;
    if (mode === "fit") {
      scale = Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight, 1.35);
    } else {
      scale = Math.min(window.innerWidth / baseWidth, 1.35);
    }

    scale = Math.max(scale, 0.1);
    layout.style.setProperty("--page-scale", scale);

    if (mode === "width") {
      document.body.style.height = Math.max(window.innerHeight, layout.scrollHeight * scale) + "px";
    }
  }

  window.addEventListener("resize", resizeLayout);
  if (window.ResizeObserver && mode === "width") {
    new ResizeObserver(resizeLayout).observe(layout);
  }
  resizeLayout();
}());
