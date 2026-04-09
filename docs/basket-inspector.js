/**
 * Sunland – Basket / Inventory Inspector
 *
 * Paste this into the browser console while on your farm to see which
 * autotest-relevant items (seeds, tools, fertilisers) are currently in
 * your basket, and in what quantities.
 *
 * Button detection uses the same 3-strategy fallback chain as
 * `_findInventoryButton()` in autotest-full.js so it works regardless of
 * whether SFL exposes an aria-label, a keyword in the img src, or only
 * text content on the HUD element.
 *
 * Usage (auto-runs on paste):
 *   inspectBasket()        – print tracked items
 */
(function () {
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ── Items the autotest tracks ──────────────────────────────────────────────
  // Source: CONFIG.crops.weatherSeedMap, defaultSeed, CONFIG.resources.tools,
  //         FLOWER_SEEDS list, fertPerCrop in autotest-full.js.
  const TRACKED = new Set([
    // Crop seeds
    "Sunflower Seed", "Potato Seed", "Pumpkin Seed", "Cabbage Seed",
    "Parsnip Seed", "Barley Seed", "Wheat Seed", "Radish Seed", "Kale Seed",
    "Corn Seed", "Beetroot Seed", "Carrot Seed", "Cauliflower Seed",
    "Onion Seed", "Soybean Seed", "Pepper Seed", "Turnip Seed",
    "Zucchini Seed", "Eggplant Seed", "Artichoke Seed",
    // Resource tools
    "Axe", "Pickaxe", "Stone Pickaxe", "Iron Pickaxe", "Gold Pickaxe",
    "Crimstone Pickaxe", "Obsidian Pickaxe",
    // Flower seeds
    "Red Pansy Seed", "Yellow Pansy Seed", "Purple Pansy Seed",
    "White Pansy Seed", "Blue Pansy Seed",
    "Red Cosmos Seed", "Yellow Cosmos Seed", "Purple Cosmos Seed",
    "White Cosmos Seed", "Blue Cosmos Seed",
    "Red Balloon Flower Seed", "Yellow Balloon Flower Seed",
    "Purple Balloon Flower Seed", "White Balloon Flower Seed",
    "Blue Balloon Flower Seed",
    "Red Daffodil Seed", "Yellow Daffodil Seed", "Purple Daffodil Seed",
    "White Daffodil Seed", "Blue Daffodil Seed",
    // Fertilisers
    "Sprout Mix", "Rapid Root",
  ]);

  // ── Button detection: mirrors _findInventoryButton() in autotest-full.js ───
  function findBasketBtn() {
    // Strategy 1: aria-label / title attributes
    var byAttr = document.querySelector(
      "[aria-label='Inventory'],[aria-label='inventory']," +
      "[title='Inventory'],[title='inventory']," +
      "[aria-label='Basket'],[aria-label='basket']," +
      "[aria-label='Backpack'],[aria-label='backpack']"
    );
    if (byAttr && byAttr.getBoundingClientRect().width > 0) return byAttr;

    // Strategy 2: img[src] keyword match → walk up to nearest clickable parent
    var invImg = Array.from(document.querySelectorAll("img")).find(function (i) {
      var s = (i.getAttribute("src") || "").toLowerCase();
      return s.includes("basket") || s.includes("backpack") ||
             s.includes("inventory") || s.includes("bag") || s.includes("satchel");
    });
    if (invImg) {
      var el = invImg;
      for (var n = 0; n < 6 && el; n++) {
        if (el.tagName === "BUTTON" || el.tagName === "A" ||
            el.getAttribute("role") === "button" ||
            el.classList.contains("cursor-pointer")) return el;
        el = el.parentElement;
      }
      return invImg.parentElement || invImg;
    }

    // Strategy 3: text-content / aria-label scan over HUD / interactive elements
    return Array.from(document.querySelectorAll(
      "button,[role='button'],[class*='cursor-pointer'],nav *,[class*='hud'] *"
    )).find(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var t = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.textContent || ""
      ).trim().toLowerCase();
      return t === "inventory" || t === "basket" || t === "backpack" ||
             t.includes("inventory") || t.includes("basket");
    }) || null;
  }

  // ── Scrape visible item quantities (mirrors _scrapeOpenInventoryPanel) ──────
  function scrapePanel() {
    var result = {};

    // Primary: game-assets img src → derive name from URL path
    Array.from(document.querySelectorAll(
      "img[src*='game-assets'],img[src*='sunflower-land.com']"
    )).filter(function (img) {
      var r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).forEach(function (img) {
      var src    = img.getAttribute("src") || "";
      var parts  = src.split("?")[0].split("/");
      var file   = (parts[parts.length - 1] || "").replace(/\.\w+$/, "");
      var folder = parts[parts.length - 2] || "";

      var raw = (file === "seed" ? folder + " seed" : folder + " " + file)
        .replace(/[-_]/g, " ").trim();
      if (!raw || raw.length < 2) return;

      var name = raw.split(/\s+/).map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(" ");

      if (!TRACKED.has(name)) return;

      var qty    = 0;
      var parent = img.parentElement;
      if (parent) {
        var candidates = Array.from(parent.querySelectorAll("[class*='z-']"))
          .concat(Array.from(parent.children));
        for (var i = 0; i < candidates.length; i++) {
          var txt = (candidates[i].textContent || "").trim();
          if (/^\d[\d,]*(\.\d+)?$/.test(txt)) {
            qty = parseFloat(txt.replace(/,/g, ""));
            break;
          }
        }
      }
      if (!result[name] || qty > result[name]) result[name] = qty || 1;
    });

    // Fallback: alt-text scan for any remaining tracked items
    Array.from(document.querySelectorAll("img[alt]"))
      .filter(function (img) {
        var alt = img.getAttribute("alt") || "";
        return TRACKED.has(alt) && img.getBoundingClientRect().width > 0;
      })
      .forEach(function (img) {
        var name = img.getAttribute("alt");
        if (result[name]) return;
        var qty    = 0;
        var parent = img.parentElement;
        if (parent) {
          var candidates = Array.from(parent.querySelectorAll("[class*='z-']"))
            .concat(Array.from(parent.children));
          for (var i = 0; i < candidates.length; i++) {
            var txt = (candidates[i].textContent || "").trim();
            if (/^\d[\d,]*(\.\d+)?$/.test(txt)) {
              qty = parseFloat(txt.replace(/,/g, ""));
              break;
            }
          }
        }
        result[name] = qty || 1;
      });

    return result;
  }

  // ── Main entry point ───────────────────────────────────────────────────────
  window.inspectBasket = async function inspectBasket() {
    var btn = findBasketBtn();
    if (!btn) {
      console.warn("[basket-inspector] ❌ Could not find basket button.");
      console.log(
        "[basket-inspector] Visible img srcs (first 40):",
        Array.from(document.querySelectorAll("img"))
          .map(function (i) { return i.getAttribute("src"); })
          .filter(Boolean)
          .slice(0, 40)
      );
      return;
    }

    btn.click();
    await sleep(900);

    var found = scrapePanel();

    // Close the basket
    await sleep(200);
    var closeBtn =
      document.querySelector("[aria-label='Close'],[aria-label='close']") ||
      (document.querySelector("button svg") &&
       document.querySelector("button svg").closest("button"));
    if (closeBtn) closeBtn.click();

    if (!Object.keys(found).length) {
      console.warn(
        "[basket-inspector] ⚠️  No tracked items found. " +
        "Basket may not have opened, or img srcs differ from expected patterns."
      );
      return;
    }

    console.log("%c🧺 Basket – Autotest items", "font-weight:bold;font-size:14px");
    var table = Object.entries(found)
      .sort(function (a, b) { return a[0].localeCompare(b[0]); })
      .reduce(function (acc, entry) { acc[entry[0]] = { qty: entry[1] }; return acc; }, {});
    console.table(table);
  };

  // Auto-run immediately on paste
  window.inspectBasket();
})();
