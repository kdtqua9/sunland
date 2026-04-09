/**
 * Sunland – Basket Stock Checker
 *
 * Paste this into the browser console while on your farm.
 *
 * What it does:
 *   1. Reads the real inventory from the React fiber tree (no panel open needed;
 *      this is the approach confirmed to work 100% by the user).
 *   2. Filters the result to only the items listed in CONFIG:
 *        • Seeds  – everything in crops.weatherSeedMap + defaultSeed + flower seeds
 *        • Tools  – one per resource type (Axe, Pickaxe, Stone Pickaxe …)
 *   3. Prints a colour-coded table:
 *        ✅  OK        – qty ≥ minQty threshold
 *        ⚠️  BUY MORE  – qty < minQty threshold (or 0)
 *
 * Usage (auto-runs on paste):
 *   checkStock()   – print config-filtered stock report
 */
(function () {

  // ══════════════════════════════════════════════════════════════════════════
  // ─── CONFIG  (keep in sync with autotest-full.js) ────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  var CONFIG = {
    // Seeds: key = seed name, value = minimum qty you want to keep on hand.
    // Add / remove entries to match your farm.
    seeds: {
      "Sunflower Seed":  50,
      "Potato Seed":     30,
      "Pumpkin Seed":    20,
      "Cabbage Seed":    20,
      "Parsnip Seed":    10,
      // Flower seeds
      "Sunpetal Seed":   10,
      "Bloom Seed":      10,
      "Lily Seed":       10,
    },

    // Tools: key = tool name, value = minimum qty (usually 1–5 is enough).
    tools: {
      "Axe":               3,
      "Pickaxe":           3,
      "Stone Pickaxe":     2,
      "Iron Pickaxe":      2,
      "Gold Pickaxe":      1,
      "Crimstone Pickaxe": 1,
      "Obsidian Pickaxe":  1,
    },
  };
  // ══════════════════════════════════════════════════════════════════════════

  // ── React fiber walk (same approach as autotest-full.js) ─────────────────
  function walkFiber(node, depth) {
    if (!node || depth <= 0) return null;
    try {
      var hook = node.memoizedState;
      while (hook) {
        var val = hook.memoizedState;
        if (val && typeof val === "object") {
          var ctx = val.context || (val.state && val.state.context) || val;
          if (ctx && typeof ctx === "object" && ctx.inventory &&
              typeof ctx.inventory === "object") return ctx;
          if (val.state && val.state.context &&
              typeof val.state.context.inventory === "object") return val.state.context;
        }
        hook = hook.next;
      }
    } catch (_) {}

    // Also check memoizedProps (covers class-component patterns)
    try {
      var p = node.memoizedProps;
      if (p && p.state && p.state.inventory) return p.state;
      if (p && p.inventory) return p;
    } catch (_) {}

    try {
      var c = walkFiber(node.child,   depth - 1); if (c) return c;
      var s = walkFiber(node.sibling, depth - 1); if (s) return s;
    } catch (_) {}
    return null;
  }

  function readInventory() {
    try {
      var root = document.getElementById("root") || document.body;

      // Support both React 17 (__reactFiber$) and React 16 (__reactInternalInstance)
      // plus the __reactContainer key seen in some builds.
      var fiberKey = Object.keys(root).find(function (k) {
        return k.startsWith("__reactFiber$")       ||
               k.startsWith("_reactFiber")         ||
               k.startsWith("__reactContainer")    ||
               k.startsWith("__reactInternalInstance");
      });
      if (!fiberKey) return null;

      var ctx = walkFiber(root[fiberKey], 50);
      if (!ctx || !ctx.inventory) return null;

      // Normalise Decimal objects → plain numbers
      var inv = {};
      var raw = ctx.inventory;
      Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        inv[k] = (v && typeof v === "object")
          ? (parseFloat(v.toString()) || 0)
          : (Number(v) || 0);
      });
      return inv;
    } catch (_) { return null; }
  }

  // ── Main entry point ──────────────────────────────────────────────────────
  window.checkStock = function checkStock() {
    var inv = readInventory();

    if (!inv) {
      console.warn(
        "%c[stock-check] ❌ Could not read inventory from React fiber.\n" +
        "Make sure the game is fully loaded and try again.",
        "color:red;font-weight:bold"
      );
      return;
    }

    // Build a merged item list: seeds first, then tools
    var rows = {};
    var sections = [
      { label: "Seeds", items: CONFIG.seeds },
      { label: "Tools", items: CONFIG.tools },
    ];

    sections.forEach(function (sec) {
      Object.keys(sec.items).forEach(function (name) {
        var minQty = sec.items[name];
        var have   = inv[name] || 0;
        rows[name] = {
          section: sec.label,
          have:    have,
          min:     minQty,
          status:  have >= minQty ? "✅ OK" : "⚠️  BUY MORE",
        };
      });
    });

    // Summary counts
    var needBuy   = Object.values(rows).filter(function (r) { return r.status !== "✅ OK"; }).length;
    var totalRows = Object.keys(rows).length;

    console.log(
      "%c🧺 Stock Report  (%s/%s items OK)",
      "font-weight:bold;font-size:14px",
      totalRows - needBuy,
      totalRows
    );
    console.table(rows);

    if (needBuy > 0) {
      console.warn(
        "%c⚠️  " + needBuy + " item(s) below threshold — visit the shop!",
        "color:orange;font-weight:bold"
      );
    } else {
      console.log(
        "%c✅ All items fully stocked.",
        "color:green;font-weight:bold"
      );
    }
  };

  // Auto-run immediately on paste
  window.checkStock();
})();
