/**
 * autoHarvest.js
 *
 * Paste the IIFE below into the browser DevTools console while the Sunland
 * game is open.  It finds all visible, ready-to-harvest resource nodes
 * (trees, stone/iron/gold rocks, crimstone, sunstone …), then simulates
 * a human player clicking on each one three times with slightly randomised
 * click coordinates.
 *
 * HOW TO USE
 * ----------
 * 1. Open the game in your browser and navigate to your farm.
 * 2. Open DevTools (F12) → Console tab.
 * 3. Paste the entire script and press Enter.
 * 4. Optionally call it again with custom config:
 *
 *    sunlandAutoHarvest({
 *      hitsPerResource   : 3,                          // clicks needed to harvest
 *      clickDelayMs      : { min: 600,  max: 1800 },   // delay between hits on same node
 *      switchDelayMs     : { min: 1200, max: 3500 },   // delay before next node
 *      rounds            : 1,                          // how many full passes to run
 *    });
 *
 * WHAT IT DOES
 * ------------
 * • Queries the DOM for elements with class `hover:img-highlight cursor-pointer`
 *   — this is the class applied by the game only to resources that are ready
 *   to be harvested (RecoveredTree, RecoveredStone, RecoveredIron, etc.).
 * • Each matching element must be inside a MapPlacement ancestor
 *   (identified by `style.top` containing "calc(50%") to exclude any
 *   unrelated UI buttons that happen to share those classes.
 * • Reads the MapPlacement's CSS `width` to classify the resource:
 *     84 px  (2 × GRID_WIDTH_PX=42) → Tree-family
 *     42 px  (1 × GRID_WIDTH_PX=42) → Rock-family (Stone / Iron / Gold)
 *     other  → Large resource (Crimstone 88 px, Sunstone 84 px, etc.)
 * • For every resource it fires `hitsPerResource` MouseEvents, each with
 *   a random click coordinate that stays within the element's bounding box
 *   (±35 % of half-dimensions from the element's centre).
 * • Every click is logged to the console with resource type, hit number,
 *   viewport coordinates, and the noise offset applied.
 *
 * SECURITY NOTE
 * -------------
 * This script only dispatches synthetic MouseEvent clicks on elements that
 * the player can already interact with manually.  It does not forge network
 * requests, bypass server-side validation, or suppress the game's existing
 * bot-detection logic.  All game state changes still flow through the normal
 * XState game machine exactly as if the player had clicked.
 */

/* global window, document, MouseEvent, setTimeout, Promise, console */

// Expose globally so the user can call it again from the console.
window.sunlandAutoHarvest = async function sunlandAutoHarvest(userConfig) {
  // ── Configuration ──────────────────────────────────────────────────────────
  const cfg = Object.assign(
    {
      /** Number of clicks required to harvest one resource node (game uses 3). */
      hitsPerResource: 3,
      /** Random delay (ms) between consecutive hits on the *same* node. */
      clickDelayMs: { min: 600, max: 1800 },
      /** Random delay (ms) before moving on to the *next* node. */
      switchDelayMs: { min: 1200, max: 3500 },
      /** How many full passes over all ready resources to perform. */
      rounds: 1,
    },
    userConfig,
  );

  // ── Helpers ─────────────────────────────────────────────────────────────────
  // GRID_WIDTH_PX mirrors the constant from features/game/lib/constants.ts
  const GRID_WIDTH_PX = 42;
  // Fraction of the element's half-dimension used as max click noise radius.
  const CLICK_NOISE_FACTOR = 0.35;

  const rand = (min, max) => Math.random() * (max - min) + min;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const roundPx = (n) => Math.round(n * 10) / 10; // 1 decimal place for logs

  /**
   * Walk up the DOM from `el` and return the first ancestor whose inline
   * `style.top` contains "calc(50%" — this is the MapPlacement wrapper that
   * the game uses to position every resource on the game grid.
   */
  function findMapPlacement(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.style && node.style.top && node.style.top.includes("calc(50%)")) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Classify the resource by the MapPlacement's declared CSS width.
   * GRID_WIDTH_PX = 42  →  1-cell rock = 42 px,  2-cell tree = 84 px.
   */
  function classifyByPlacement(placement) {
    const cssW = parseInt(placement.style.width, 10);
    const cssH = parseInt(placement.style.height, 10);
    if (!cssW || !cssH) return "Resource";
    const cells = Math.round(cssW / GRID_WIDTH_PX);
    if (cells >= 2) return "Tree / Large resource";
    return "Rock (Stone / Iron / Gold)";
  }

  /**
   * Return all DOM elements that represent a ready-to-harvest resource node.
   *
   * Selector rationale:
   *   "hover:img-highlight" — Tailwind utility applied by the game *only*
   *     when a resource node is ready (RecoveredTree, RecoveredStone, etc.).
   *     When the resource is depleted the component unmounts this element.
   *   "cursor-pointer"      — confirms the element is interactive.
   *
   * We then require a MapPlacement ancestor to exclude any unrelated UI
   * elements (shop buttons, collectibles) that share the same class combo.
   */
  function findReadyNodes() {
    const selector = ".hover\\:img-highlight.cursor-pointer";
    const candidates = Array.from(document.querySelectorAll(selector));

    return candidates.filter((el) => {
      // Must be visible on screen.
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.top > window.innerHeight) return false;
      if (r.right < 0 || r.left > window.innerWidth) return false;

      // Must be inside a MapPlacement grid cell.
      return findMapPlacement(el) !== null;
    });
  }

  /**
   * Dispatch one MouseEvent at a randomly offset position inside `el`.
   * The offset is bounded to ±35 % of the element's half-dimensions so the
   * simulated click always lands within the visible element — mimicking the
   * natural variance of a real user's pointer.
   *
   * Returns the absolute viewport coordinates and the noise applied.
   */
  function dispatchNoisyClick(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    const noiseX = rand(-r.width * CLICK_NOISE_FACTOR, r.width * CLICK_NOISE_FACTOR);
    const noiseY = rand(-r.height * CLICK_NOISE_FACTOR, r.height * CLICK_NOISE_FACTOR);

    const clickX = cx + noiseX;
    const clickY = cy + noiseY;

    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: clickX,
        clientY: clickY,
        screenX: clickX + window.screenX,
        screenY: clickY + window.screenY,
      }),
    );

    return {
      x: roundPx(clickX),
      y: roundPx(clickY),
      noiseX: roundPx(noiseX),
      noiseY: roundPx(noiseY),
    };
  }

  // ── Main loop ───────────────────────────────────────────────────────────────
  console.log(
    "%c[AutoHarvest] Starting session",
    "color:#f5a623;font-weight:bold",
    cfg,
  );

  for (let round = 1; round <= cfg.rounds; round++) {
    const nodes = findReadyNodes();

    console.log(
      `%c[AutoHarvest] ── Round ${round}/${cfg.rounds} ──  ${nodes.length} ready node(s) found`,
      "color:#7ed321;font-weight:bold",
    );

    if (nodes.length === 0) {
      console.log("[AutoHarvest] No ready resources visible. Try scrolling the map.");
    }

    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const placement = findMapPlacement(el);
      const resourceType = placement ? classifyByPlacement(placement) : "Resource";
      const nodeLabel = `${resourceType} #${i + 1}`;

      for (let hit = 1; hit <= cfg.hitsPerResource; hit++) {
        // Wait a human-like random delay before each click.
        const delay = rand(cfg.clickDelayMs.min, cfg.clickDelayMs.max);
        await sleep(delay);

        const coord = dispatchNoisyClick(el);

        console.log(
          `[AutoHarvest] Round ${round} | ${nodeLabel}` +
            ` | Hit ${hit}/${cfg.hitsPerResource}` +
            ` | click (${coord.x}, ${coord.y})` +
            ` | noise (${coord.noiseX >= 0 ? "+" : ""}${coord.noiseX},` +
            ` ${coord.noiseY >= 0 ? "+" : ""}${coord.noiseY})` +
            ` | after ${Math.round(delay)} ms`,
        );
      }

      // Pause before moving to the next resource node.
      if (i < nodes.length - 1) {
        const switchDelay = rand(cfg.switchDelayMs.min, cfg.switchDelayMs.max);
        console.log(
          `[AutoHarvest]   → moving to next node in ${Math.round(switchDelay)} ms`,
        );
        await sleep(switchDelay);
      }
    }

    console.log(`[AutoHarvest] Round ${round} complete.`);

    // If more rounds remain, wait long enough for resources to re-render
    // before querying the DOM again (the game re-evaluates after XState update).
    if (round < cfg.rounds) {
      await sleep(1500);
    }
  }

  console.log(
    "%c[AutoHarvest] Session complete.",
    "color:#f5a623;font-weight:bold",
  );
};

// Auto-run with defaults when the script is first pasted.
window.sunlandAutoHarvest();
