/**
 * Sunland – Basket / Inventory Inspector
 *
 * Paste this into the browser console while on your farm to see every item
 * and its real quantity, identical to what autotest-full.js sees.
 *
 * Strategy order (mirrors autotest-full.js exactly):
 *   1. React fiber walk → reads XState machine context.inventory directly.
 *      No panel open needed; quantities are exact Decimal values.
 *   2. localStorage → SFL persists farm state; parse obj.state.inventory.
 *   3. Panel DOM scrape (last resort) → opens the basket with a proper
 *      MouseEvent (clientX/Y from bounding rect, same as simulateClick),
 *      waits for it to render, then scrapes quantity text from siblings.
 *
 * Usage (auto-runs on paste):
 *   inspectBasket()        – print all items with quantities
 *   inspectBasket(true)    – force DOM scrape (skip fiber/localStorage)
 */
(function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ── 1. React fiber walk ────────────────────────────────────────────────────
  // Mirrors _walkFiberForGameState + _getGameStateFromFiber in autotest-full.js
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
    try {
      var c = walkFiber(node.child,   depth - 1); if (c) return c;
      var s = walkFiber(node.sibling, depth - 1); if (s) return s;
    } catch (_) {}
    return null;
  }

  function getInventoryFromFiber() {
    try {
      var root = document.getElementById("root") || document.body;
      var fiberKey = Object.keys(root).find(function (k) {
        return k.startsWith("__reactFiber$") || k.startsWith("_reactFiber");
      });
      if (!fiberKey) return null;
      var ctx = walkFiber(root[fiberKey], 40);
      return (ctx && ctx.inventory) ? ctx.inventory : null;
    } catch (_) { return null; }
  }

  // ── 2. localStorage fallback ───────────────────────────────────────────────
  // Mirrors _getGameStateFromLocalStorage in autotest-full.js
  function getInventoryFromLocalStorage() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        var kl = key.toLowerCase();
        if (!kl.includes("sunflower") && !kl.includes("farm") &&
            !kl.includes("game") && !kl.includes("sfl")) continue;
        try {
          var obj = JSON.parse(localStorage.getItem(key) || "null");
          if (!obj) continue;
          var inv = (obj.state && obj.state.inventory) ||
                    (obj.context && obj.context.inventory) ||
                    obj.inventory;
          if (inv && typeof inv === "object" && Object.keys(inv).length > 0) return inv;
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  // ── Normalise raw inventory (Decimal objects → plain numbers) ─────────────
  function normaliseInventory(raw) {
    var result = {};
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      result[k] = (typeof v === "object" && v !== null)
        ? (parseFloat(v.toString()) || 0)
        : (Number(v) || 0);
    });
    return result;
  }

  // ── 3. DOM scrape (last resort) ────────────────────────────────────────────

  // Mirrors _findInventoryButton in autotest-full.js
  function findBasketBtn() {
    var byAttr = document.querySelector(
      "[aria-label='Inventory'],[aria-label='inventory']," +
      "[title='Inventory'],[title='inventory']," +
      "[aria-label='Basket'],[aria-label='basket']," +
      "[aria-label='Backpack'],[aria-label='backpack']"
    );
    if (byAttr && byAttr.getBoundingClientRect().width > 0) return byAttr;

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

    return Array.from(document.querySelectorAll(
      "button,[role='button'],[class*='cursor-pointer'],nav *,[class*='hud'] *"
    )).find(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var t = (el.getAttribute("aria-label") || el.getAttribute("title") ||
               el.textContent || "").trim().toLowerCase();
      return t === "inventory" || t === "basket" || t === "backpack" ||
             t.includes("inventory") || t.includes("basket");
    }) || null;
  }

  // Mirrors simulateClick in autotest-full.js: dispatch MouseEvent with real coords
  function simulateClick(el) {
    var r  = el.getBoundingClientRect();
    var cx = r.left + r.width  * (0.4 + Math.random() * 0.2);
    var cy = r.top  + r.height * (0.4 + Math.random() * 0.2);
    el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy,
      screenX: cx + (window.screenX || 0),
      screenY: cy + (window.screenY || 0),
    }));
  }

  // Mirrors _scrapeOpenInventoryPanel in autotest-full.js
  function scrapeOpenPanel() {
    var result = {};

    // Primary: game-assets img src → derive name + quantity from sibling text
    Array.from(document.querySelectorAll(
      "img[src*='game-assets'],img[src*='sunflower-land.com']"
    )).filter(function (img) {
      var r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).forEach(function (img) {
      var src   = img.getAttribute("src") || "";
      var parts = src.split("?")[0].split("#")[0].split("/");
      var file  = (parts[parts.length - 1] || "").replace(/\.\w+$/, "");
      var fold  = parts[parts.length - 2] || "";
      var fold2 = parts[parts.length - 3] || "";

      var raw = (
        file === "seed"     ? fold + " seed" :
        file === "seedling" ? fold + " seedling" :
        file === "crop"     ? fold :
        fold === fold2      ? file :
        fold + " " + file
      ).replace(/[-_]/g, " ").trim();
      if (!raw || raw.length < 2) return;

      var name = raw.split(/\s+/).map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(" ");

      if (/^(Left|Right|Up|Down|Close|Back|Forward|Arrow|Icon|Button|Bg|Background|Land|Bumpkin|Fader|Item|Crab)/.test(name)) return;

      var qty    = 0;
      var parent = img.parentElement;
      if (parent) {
        // Search z-class siblings, all children, and direct text nodes
        var candidates = Array.from(parent.querySelectorAll("[class*='z-']"))
          .concat(Array.from(parent.children));
        for (var i = 0; i < candidates.length; i++) {
          var txt = (candidates[i].textContent || "").trim();
          if (/^\d[\d,]*(\.\d+)?$/.test(txt)) {
            qty = parseFloat(txt.replace(/,/g, "")); break;
          }
        }
        if (qty === 0) {
          Array.from(parent.childNodes).forEach(function (n) {
            if (qty || n.nodeType !== 3) return;
            var t = (n.textContent || "").trim();
            if (/^\d[\d,]*(\.\d+)?$/.test(t)) qty = parseFloat(t.replace(/,/g, ""));
          });
        }
      }
      if (qty === 0) qty = 1;
      if (!result[name] || qty > result[name]) result[name] = qty;
    });

    // Fallback: alt-text scan
    if (Object.keys(result).length <= 3) {
      Array.from(document.querySelectorAll("img[alt]"))
        .filter(function (img) { return img.getBoundingClientRect().width > 0; })
        .forEach(function (img) {
          var name = (img.getAttribute("alt") || "").trim();
          if (!name || name.length < 2) return;
          if (result[name]) return;
          var qty = 0;
          var p   = img.parentElement;
          if (p) {
            var els = [p].concat(Array.from(p.querySelectorAll("span,div,b,strong")));
            for (var i = 0; i < els.length; i++) {
              var t = (els[i].textContent || "").trim();
              if (/^\d[\d,]*(\.\d+)?$/.test(t)) { qty = parseFloat(t.replace(/,/g, "")); break; }
            }
          }
          result[name] = qty || 1;
        });
    }

    return result;
  }

  async function scrapeViaPanel() {
    var btn = findBasketBtn();
    if (!btn) {
      console.warn("[basket-inspector] ❌ Could not find basket button.");
      console.log("[basket-inspector] Visible img srcs (first 40):",
        Array.from(document.querySelectorAll("img"))
          .map(function (i) { return i.getAttribute("src"); }).filter(Boolean).slice(0, 40));
      return null;
    }

    simulateClick(btn);          // proper MouseEvent with coords – SFL will respond
    await sleep(900);            // wait for panel animation (~300-500 ms)

    var found = scrapeOpenPanel();

    // Close the panel
    await sleep(200);
    var closeBtn = document.querySelector(
      "button[aria-label='Close'],button[aria-label='close']," +
      "[class*='close'],[class*='modal-close'],[class*='panel-close']"
    );
    if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
      simulateClick(closeBtn);
    } else {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", bubbles: true }));
    }
    await sleep(400);

    return Object.keys(found).length > 0 ? found : null;
  }

  // ── Main entry point ───────────────────────────────────────────────────────
  window.inspectBasket = async function inspectBasket(forceDOM) {
    var inv = null;
    var source = "";

    if (!forceDOM) {
      // Strategy 1: React fiber (instant, no UI interaction needed)
      var raw = getInventoryFromFiber();
      if (raw && Object.keys(raw).length > 0) {
        inv    = normaliseInventory(raw);
        source = "React fiber (XState context)";
      }

      // Strategy 2: localStorage
      if (!inv) {
        raw = getInventoryFromLocalStorage();
        if (raw && Object.keys(raw).length > 0) {
          inv    = normaliseInventory(raw);
          source = "localStorage";
        }
      }
    }

    // Strategy 3: DOM scrape
    if (!inv) {
      console.log("[basket-inspector] Opening basket panel for DOM scrape…");
      var scraped = await scrapeViaPanel();
      if (scraped) {
        inv    = scraped;
        source = "DOM scrape (panel)";
      }
    }

    if (!inv || Object.keys(inv).length === 0) {
      console.warn("[basket-inspector] ⚠️  Could not read inventory via any strategy.");
      return;
    }

    console.log(
      "%c🧺 Inventory  [" + source + "]",
      "font-weight:bold;font-size:14px"
    );
    var table = Object.entries(inv)
      .filter(function (e) { return e[1] > 0; })
      .sort(function (a, b) { return a[0].localeCompare(b[0]); })
      .reduce(function (acc, e) { acc[e[0]] = { qty: e[1] }; return acc; }, {});
    console.table(table);
  };

  // Auto-run immediately on paste
  window.inspectBasket();
})();
