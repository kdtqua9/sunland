/**
 * Sunland – Mini resource click tester
 *
 * Paste this into the browser console while on your farm to test whether
 * tree (or any resource) clicks are being received by the game.
 *
 * It locates tree <img> elements by src pattern, walks up to the nearest
 * cursor-pointer ancestor (where React's onClick lives), and fires a
 * realistic noisy MouseEvent directly on that element.
 *
 * Usage:
 *   testResourceClick()           – test trees (default)
 *   testResourceClick("/resources/stone")  – test stone
 *   testResourceClick("/resources/iron")   – test iron
 *
 * It logs:
 *   • how many matching imgs it found
 *   • the tag name + class list of the resolved click target for each img
 *   • the jittered click coordinates actually dispatched
 *   • whether a click listener exists on the target (via getEventListeners if
 *     available in devtools, skipped otherwise)
 */
(function () {
  const HITS_PER_NODE   = 3;       // same as game default
  const HIT_DELAY_MS    = { min: 600, max: 1200 };
  const SWITCH_DELAY_MS = { min: 1200, max: 2500 };
  const NOISE_FACTOR    = 0.35;    // ± fraction of half-dimension

  const rand  = (min, max) => Math.random() * (max - min) + min;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Walk up from el and return the nearest cursor-pointer ancestor (or el). */
  function findClickableAncestor(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      if (node.classList && node.classList.contains("cursor-pointer")) return node;
      node = node.parentElement;
      depth++;
    }
    return el;
  }

  /**
   * Dispatch one realistic MouseEvent directly on `target` using coordinates
   * jittered within ±NOISE_FACTOR of the img's centre, based on `imgRect`.
   * Returns the {x, y} actually used.
   */
  function dispatchClick(target, imgRect) {
    const cx = imgRect.left + imgRect.width  / 2;
    const cy = imgRect.top  + imgRect.height / 2;
    const nx = rand(-imgRect.width  * NOISE_FACTOR, imgRect.width  * NOISE_FACTOR);
    const ny = rand(-imgRect.height * NOISE_FACTOR, imgRect.height * NOISE_FACTOR);
    const x  = cx + nx;
    const y  = cy + ny;
    target.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
    }));
    return { x: Math.round(x), y: Math.round(y), nx: Math.round(nx), ny: Math.round(ny) };
  }

  window.testResourceClick = async function testResourceClick(imgPattern) {
    imgPattern = imgPattern || "/resources/tree/";
    console.log(`%c[Test] pattern: "${imgPattern}"`, "color:#f5a623;font-weight:bold");

    const imgs = Array.from(
      document.querySelectorAll(`img[src*='${imgPattern}']`)
    ).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    if (imgs.length === 0) {
      console.warn("[Test] No visible imgs found for pattern:", imgPattern);
      return;
    }

    console.log(`[Test] Found ${imgs.length} visible img(s). Testing clicks…`);

    for (let i = 0; i < imgs.length; i++) {
      const img    = imgs[i];
      const target = findClickableAncestor(img);

      console.log(
        `[Test] Node ${i + 1}/${imgs.length}` +
        `\n  img.src    : ${img.src.replace(location.origin, "")}` +
        `\n  clickTarget: <${target.tagName.toLowerCase()}> classes="${target.className}"`
      );

      // Optional: report whether devtools getEventListeners is available
      if (typeof getEventListeners === "function") {
        const listeners = getEventListeners(target);
        console.log("  listeners  :", Object.keys(listeners).length ? listeners : "(none on target – might be on a React root above)");
      }

      for (let hit = 1; hit <= HITS_PER_NODE; hit++) {
        const delay = rand(HIT_DELAY_MS.min, HIT_DELAY_MS.max);
        await sleep(delay);
        const rect  = img.getBoundingClientRect(); // re-read each hit
        const coord = dispatchClick(target, rect);
        console.log(
          `  Hit ${hit}/${HITS_PER_NODE} → click(${coord.x}, ${coord.y})` +
          ` noise(${coord.nx >= 0 ? "+" : ""}${coord.nx}, ${coord.ny >= 0 ? "+" : ""}${coord.ny})` +
          ` after ${Math.round(delay)} ms`
        );
      }

      if (i < imgs.length - 1) {
        const sw = rand(SWITCH_DELAY_MS.min, SWITCH_DELAY_MS.max);
        console.log(`  → next node in ${Math.round(sw)} ms`);
        await sleep(sw);
      }
    }

    console.log("%c[Test] Done.", "color:#7ed321;font-weight:bold");
  };

  // Auto-run immediately on paste
  window.testResourceClick();
})();
