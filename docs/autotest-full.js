/**
 * Sunland – Autotest: Full Farm Automation  (infinite loop edition)
 *
 * Paste this script into the browser console while on the farm page.
 * It will continuously harvest crops, flowers, trees and minerals,
 * replant where possible, and manage seeds/fertiliser – forever, until
 * you stop it.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   1. Open the Sunland game in your browser and navigate to your farm.
 *   2. Edit the CONFIG block below to match your preferences.
 *   3. Open the browser developer console (F12 → Console tab).
 *   4. Paste the entire script and press Enter.
 *   5. To stop at any time, run:  stopAutotest()
 *
 * ─── Anti-detection measures ─────────────────────────────────────────────────
 *   • Every action uses a random delay (CONFIG.delay.minMs … maxMs).
 *   • Click coordinates carry ±coordNoisePixels random jitter.
 *   • The poll interval itself is randomised per cycle (checkIntervalMin).
 *   • Web Worker timers are used throughout – browser tab-throttling cannot
 *     skew delays even when the tab is backgrounded.
 *   • No rapid-fire clicks: minimum inter-hit delay is respected.
 *   • Captcha/reward dialogs pause automation for the affected resource.
 */
(function () {
  // ══════════════════════════════════════════════════════════════════════════
  // ─── CONFIG  (edit this block) ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const CONFIG = {
    /** Turn entire feature families on / off */
    features: {
      crops: true,
      flowers: true,
      resources: {
        trees: true,
        stone: true,
        iron: true,
        gold: true,
        crimstone: true,
        sunstone: true,
        obsidian: true,
      },
    },

    /** Random delay between consecutive actions */
    delay: {
      minMs: 800,           // minimum ms between actions
      maxMs: 2000,          // maximum ms between actions
      coordNoisePixels: 8,  // ± pixel jitter on every click coordinate
    },

    /** Random poll interval (minutes) – a new value is drawn each cycle */
    checkIntervalMin: { min: 3, max: 5 },

    // ── Crop settings ────────────────────────────────────────────────────────
    crops: {
      /**
       * Map of weather condition → preferred seed name.
       * Keys should match whatever the game exposes as the current weather.
       * Falls back to `defaultSeed` when weather is unknown.
       */
      weatherSeedMap: {
        Sunny: "Sunflower Seed",
        Rainy: "Potato Seed",
        Windy: "Pumpkin Seed",
        Stormy: "Cabbage Seed",
        Snowy: "Parsnip Seed",
      },
      defaultSeed: "Sunflower Seed",

      /** Apply fertiliser to plots */
      useFertiliser: true,
      /**
       * Global fertiliser mode:
       *   "full"  – apply immediately after planting
       *   "50%"   – apply on the next poll when crop is ≥50 % grown
       *   "none"  – never apply
       */
      fertiliserMode: "full",
      /**
       * Per-crop overrides; key = seed name, value = mode string.
       * These take priority over the global fertiliserMode.
       */
      fertPerCrop: {
        "Barley Seed": "50%",
      },

      /** If the inventory is empty, try to buy seeds from the shop */
      buyMissingSeeds: true,
      /**
       * If buying fails because of insufficient SFL/gold, try the in-game
       * "Restock" mechanic (costs diamonds) before giving up.
       */
      restockIfMissingAndDiamonds: true,
    },

    // ── Flower settings ──────────────────────────────────────────────────────
    flowers: {
      /** Plant the flower type with the fewest seeds in inventory */
      plantLowestStock: true,
      /** Try to buy seeds from shop when inventory is empty */
      buyMissingSeeds: true,
      /** Log a warning (+ optional Telegram alert) when unable to plant */
      notifyIfCantPlant: true,
    },

    // ── Logging settings ─────────────────────────────────────────────────────
    logging: {
      /** Print structured lines to the browser console */
      toConsole: true,
      /**
       * Buffer log lines and trigger a file download when stopAutotest() is
       * called.  The file is named  sunland-autotest-<date>.log
       */
      toFile: false,
      telegram: {
        /** Send log lines / error summaries to a Telegram bot */
        enabled: false,
        botToken: "",   // "123456:ABC-DEF…"
        chatId: "",     // "-1001234567890" or your personal chat ID
        /** Flush buffered messages every N seconds (0 = immediate) */
        flushIntervalSec: 30,
      },
    },

    /**
     * Halt all automation and send an error report once the total error
     * count reaches this threshold.
     */
    errorThreshold: 10,
  };
  // ══════════════════════════════════════════════════════════════════════════
  // End of CONFIG
  // ══════════════════════════════════════════════════════════════════════════

  // ─── Capture native timers BEFORE any game code can override them ─────────
  const _nativeSetTimeout  = window.setTimeout.bind(window);
  const _nativeClearTimeout = window.clearTimeout.bind(window);

  // ─── Stop control ─────────────────────────────────────────────────────────
  let stopped = false;

  // ─── Web Worker for background-safe sleep ─────────────────────────────────
  const _workerCode = `
    self.onmessage = function(e) {
      var id = e.data.id, ms = e.data.ms;
      setTimeout(function() { self.postMessage(id); }, ms);
    };
  `;
  const _workerBlob = new Blob([_workerCode], { type: "application/javascript" });
  const _workerUrl  = URL.createObjectURL(_workerBlob);
  const _worker     = new Worker(_workerUrl);

  let _sleepCounter   = 0;
  const _sleepCbs     = {};

  _worker.onmessage = function (e) {
    const id = e.data;
    if (_sleepCbs[id]) { _sleepCbs[id](); delete _sleepCbs[id]; }
  };

  function sleep(ms) {
    return new Promise(function (resolve) {
      if (stopped) { resolve(); return; }
      const id = ++_sleepCounter;
      _sleepCbs[id] = resolve;
      _worker.postMessage({ id: id, ms: ms });
    });
  }

  // ─── Random helpers ───────────────────────────────────────────────────────
  /** Integer in [min, max] inclusive */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Resolves after a random delay drawn from CONFIG.delay */
  function randomDelay() {
    return sleep(randInt(CONFIG.delay.minMs, CONFIG.delay.maxMs));
  }

  /** Resolves after a random check-interval drawn from CONFIG.checkIntervalMin */
  function randomCheckInterval() {
    return randInt(CONFIG.checkIntervalMin.min, CONFIG.checkIntervalMin.max) * 60_000;
  }

  /**
   * Returns {x, y} – the element centre ± coordNoisePixels of random jitter.
   * Clamped to remain inside the element's bounding box.
   */
  function jitterCoord(rect) {
    const noise = CONFIG.delay.coordNoisePixels;
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const x  = Math.max(rect.left,  Math.min(rect.right,  cx + randInt(-noise, noise)));
    const y  = Math.max(rect.top,   Math.min(rect.bottom, cy + randInt(-noise, noise)));
    return { x, y };
  }

  /** Dispatches a realistic mousedown → mouseup → click sequence. */
  function simulateClick(element) {
    const rect = element.getBoundingClientRect();
    const { x, y } = jitterCoord(rect);
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    element.dispatchEvent(new MouseEvent("mousedown", opts));
    element.dispatchEvent(new MouseEvent("mouseup",   opts));
    element.dispatchEvent(new MouseEvent("click",     opts));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Logger ───────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const _logBuffer      = [];
  const _tgBuffer       = [];
  let   _tgFlushTimer   = null;

  /** Return current time as HH:MM:SS */
  function _timestamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  const LEVEL_ICON = { info: "ℹ️", ok: "✅", warn: "⚠️", error: "❌" };

  /**
   * log(feature, level, message)
   *   feature – e.g. "CROPS", "FLOWERS", "RESOURCES", "SYSTEM"
   *   level   – "info" | "ok" | "warn" | "error"
   *   message – string
   */
  function log(feature, level, message) {
    const icon = LEVEL_ICON[level] || "•";
    const line = `[${_timestamp()}] [${feature}] ${icon} ${message}`;

    if (CONFIG.logging.toConsole) {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }

    if (CONFIG.logging.toFile) {
      _logBuffer.push(line);
    }

    if (CONFIG.logging.telegram.enabled) {
      _tgBuffer.push(line);
      _scheduleTgFlush();
    }
  }

  /** Send buffered Telegram messages (batched into one sendMessage call). */
  async function _flushTelegram(force) {
    if (!CONFIG.logging.telegram.enabled) return;
    if (_tgBuffer.length === 0) return;

    const { botToken, chatId } = CONFIG.logging.telegram;
    if (!botToken || !chatId) return;

    const text = _tgBuffer.splice(0, _tgBuffer.length).join("\n");
    try {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" }),
        }
      );
    } catch (err) {
      // Only log to console to avoid infinite recursion
      console.error("[SYSTEM] ❌ Telegram flush failed:", err);
    }
  }

  function _scheduleTgFlush() {
    if (_tgFlushTimer) return;
    const intervalMs = (CONFIG.logging.telegram.flushIntervalSec || 30) * 1000;
    if (intervalMs === 0) {
      // Immediate
      _flushTelegram();
      return;
    }
    _tgFlushTimer = _nativeSetTimeout(async function () {
      _tgFlushTimer = null;
      await _flushTelegram();
    }, intervalMs);
  }

  /** Download the in-memory log buffer as a .log file. */
  function _downloadLog() {
    if (_logBuffer.length === 0) return;
    const content = _logBuffer.join("\n");
    const blob     = new Blob([content], { type: "text/plain" });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    a.href         = url;
    a.download     = `sunland-autotest-${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Error budget ─────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const _errorCounts = { CROPS: 0, FLOWERS: 0, RESOURCES: 0, SYSTEM: 0 };
  let   _totalErrors = 0;

  function recordError(feature, message) {
    _errorCounts[feature] = (_errorCounts[feature] || 0) + 1;
    _totalErrors++;
    log(feature, "error", message);
  }

  async function _reportAndStop(reason) {
    const summary = [
      `🚨 Autotest halted: ${reason}`,
      `Total errors: ${_totalErrors} / threshold: ${CONFIG.errorThreshold}`,
      Object.entries(_errorCounts)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n"),
      "Last 20 log lines:",
      ..._logBuffer.slice(-20),
    ].join("\n");

    console.error(summary);

    if (CONFIG.logging.telegram.enabled) {
      _tgBuffer.push(summary);
      await _flushTelegram(true);
    }

    if (CONFIG.logging.toFile) _downloadLog();

    stopped = true;
    _cleanup();
  }

  function _checkErrorBudget() {
    if (_totalErrors >= CONFIG.errorThreshold) {
      _reportAndStop(`error threshold (${CONFIG.errorThreshold}) reached`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Captcha / dialog detection ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Returns true when any modal / captcha overlay is visible.
   * We look for common Cloudflare / reCAPTCHA / reward-dialog selectors.
   */
  function isCaptchaVisible() {
    return !!(
      document.querySelector("[id*='captcha']")          ||
      document.querySelector("[class*='captcha']")       ||
      document.querySelector("iframe[src*='recaptcha']") ||
      document.querySelector("iframe[src*='challenges.cloudflare']") ||
      // Game-specific: a modal that isn't the shop/HUD
      document.querySelector("[data-html2canvas-ignore]") // common overlay pattern
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Game-state helpers ───────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Attempts to read the exposed game-state object.
   * Returns null when unavailable (graceful degradation).
   */
  function getGameState() {
    try {
      // Various common patterns used by React / XState game clients
      if (window.__GAME_STATE__)       return window.__GAME_STATE__;
      if (window.__SFL_GAME_STATE__)   return window.__SFL_GAME_STATE__;
      // XState inspector sometimes exposes services
      if (window.__xstate__ && window.__xstate__.services) {
        for (const svc of Object.values(window.__xstate__.services)) {
          const ctx = svc?.state?.context;
          if (ctx && (ctx.state || ctx.inventory)) return ctx;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Returns the current weather string from the game state, or null.
   * Typical values: "Sunny", "Rainy", "Windy", "Stormy", "Snowy"
   */
  function getCurrentWeather() {
    try {
      const gs = getGameState();
      if (!gs) return null;
      // Try several common locations in the state shape
      return (
        gs.state?.weather?.event ||
        gs.weather?.event       ||
        gs.state?.season?.weather ||
        null
      );
    } catch (_) { return null; }
  }

  /**
   * Returns a map of { itemName: quantity } from the current inventory,
   * or an empty object when unavailable.
   */
  function getInventory() {
    try {
      const gs = getGameState();
      if (!gs) return {};
      const inv = gs.state?.inventory || gs.inventory || {};
      // Decimal.js values – convert to plain numbers
      const result = {};
      for (const [k, v] of Object.entries(inv)) {
        result[k] = typeof v === "object" && v !== null
          ? (parseFloat(v.toString()) || 0)
          : (Number(v) || 0);
      }
      return result;
    } catch (_) { return {}; }
  }

  /** Returns diamond count (0 if unavailable). */
  function getDiamonds() {
    const inv = getInventory();
    return inv["Diamond"] || inv["Diamonds"] || 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── FEATURE MODULE: CROPS ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * DOM patterns for crop plots.
   *
   * The game renders plots as divs containing one of:
   *   • A "ready" crop image    → harvest
   *   • A "growing" crop image  → fertilise at 50 % if configured
   *   • An empty / soil image   → plant
   *
   * We use broad img[src] patterns and walk up the DOM to the clickable div.
   */

  function _findCropPlots() {
    // Plots generally contain images with "crop" or "soil" in their path
    const candidates = Array.from(
      document.querySelectorAll(
        "img[src*='/crops/'], img[src*='soil'], img[src*='plot']"
      )
    );

    return candidates
      .map(function (img) {
        // Walk up until we find the interactive wrapper (has an onClick)
        let el = img.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          if (
            el.getAttribute("role") === "button" ||
            el.style.cursor === "pointer"        ||
            el.classList.contains("cursor-pointer")
          ) return el;
          el = el.parentElement;
        }
        // Fall back to 3 levels up
        return img.parentElement?.parentElement?.parentElement || null;
      })
      .filter(Boolean);
  }

  /** True when a plot's crop image suggests it is harvestable (not growing, not empty). */
  function _isCropReady(plotEl) {
    const img = plotEl.querySelector("img[src]");
    if (!img) return false;
    const src = img.src || "";
    // Ready crops typically have "ready", "harvest", or a specific suffix
    return (
      src.includes("ready")    ||
      src.includes("harvest")  ||
      // If the image does NOT look like a growing stage or empty soil it may be ready
      (!src.includes("stage")  &&
       !src.includes("soil")   &&
       !src.includes("empty")  &&
        src.includes("/crops/"))
    );
  }

  function _isCropGrowing(plotEl) {
    const img = plotEl.querySelector("img[src]");
    if (!img) return false;
    const src = img.src || "";
    return src.includes("stage") || src.includes("growing");
  }

  function _isCropEmpty(plotEl) {
    const img = plotEl.querySelector("img[src]");
    if (!img) return true;
    const src = img.src || "";
    return src.includes("soil") || src.includes("empty") || !src.includes("/crops/");
  }

  /** Returns the seed name to plant, factoring in weather. */
  function _chooseSeed() {
    const weather = getCurrentWeather();
    if (weather && CONFIG.crops.weatherSeedMap[weather]) {
      return CONFIG.crops.weatherSeedMap[weather];
    }
    return CONFIG.crops.defaultSeed;
  }

  /** Determines the fertiliser mode for a given seed name. */
  function _getFertMode(seedName) {
    if (!CONFIG.crops.useFertiliser) return "none";
    const override = CONFIG.crops.fertPerCrop[seedName];
    return override || CONFIG.fertiliserMode || CONFIG.crops.fertiliserMode || "full";
  }

  /**
   * Attempt to open the shop and buy the given seed.
   * This is a best-effort click simulation; the actual shop DOM varies.
   */
  async function _buySeeds(seedName) {
    log("CROPS", "info", `Attempting to buy ${seedName} from shop…`);
    // Look for a shop / market button in the HUD
    const shopBtn = document.querySelector(
      "[aria-label*='Shop'], [aria-label*='Market'], [class*='shop'], [class*='market']"
    );
    if (!shopBtn) {
      log("CROPS", "warn", "Could not find shop button to buy seeds.");
      return false;
    }
    simulateClick(shopBtn);
    await randomDelay();

    // Within the opened shop, look for the seed
    const seedItem = Array.from(document.querySelectorAll("[class*='shop'] *"))
      .find(el => el.textContent && el.textContent.includes(seedName));

    if (!seedItem) {
      log("CROPS", "warn", `${seedName} not found in shop.`);
      return false;
    }

    simulateClick(seedItem);
    await randomDelay();

    // Confirm buy
    const confirmBtn = document.querySelector(
      "button[class*='confirm'], button[class*='buy'], [aria-label*='Confirm']"
    );
    if (confirmBtn) {
      simulateClick(confirmBtn);
      await randomDelay();
      log("CROPS", "ok", `Bought ${seedName}.`);
      return true;
    }
    return false;
  }

  /** Attempt the in-game restock mechanic (costs diamonds). */
  async function _restockSeeds(seedName) {
    const diamonds = getDiamonds();
    if (diamonds <= 0) {
      log("CROPS", "warn", "No diamonds available for restock.");
      return false;
    }
    log("CROPS", "info", `Attempting restock for ${seedName} (${diamonds} diamonds available)…`);
    const restockBtn = document.querySelector(
      "[aria-label*='Restock'], [class*='restock']"
    );
    if (!restockBtn) {
      log("CROPS", "warn", "Could not find restock button.");
      return false;
    }
    simulateClick(restockBtn);
    await randomDelay();
    const confirmBtn = document.querySelector(
      "button[class*='confirm'], [aria-label*='Confirm']"
    );
    if (confirmBtn) {
      simulateClick(confirmBtn);
      await randomDelay();
      log("CROPS", "ok", "Restock confirmed.");
      return true;
    }
    return false;
  }

  async function runCropsRound() {
    if (isCaptchaVisible()) {
      log("CROPS", "warn", "Captcha detected – skipping crops round.");
      return;
    }

    log("CROPS", "info", "Starting crops round…");
    const plots = _findCropPlots();
    if (plots.length === 0) {
      log("CROPS", "info", "No crop plots found on this page.");
      return;
    }

    let harvested = 0, planted = 0, fertilised = 0;

    for (const plot of plots) {
      if (stopped) return;

      try {
        // ── Harvest ───────────────────────────────────────────────────────
        if (_isCropReady(plot)) {
          simulateClick(plot);
          await randomDelay();
          harvested++;
          log("CROPS", "ok", "Harvested a plot.");
        }

        if (stopped) return;

        // ── Plant ─────────────────────────────────────────────────────────
        if (_isCropEmpty(plot)) {
          const seed     = _chooseSeed();
          const inv      = getInventory();
          let   hasSeeds = (inv[seed] || 0) >= 1;

          if (!hasSeeds && CONFIG.crops.buyMissingSeeds) {
            hasSeeds = await _buySeeds(seed);
          }

          if (!hasSeeds && CONFIG.crops.restockIfMissingAndDiamonds) {
            hasSeeds = await _restockSeeds(seed);
            if (hasSeeds) hasSeeds = await _buySeeds(seed);
          }

          if (!hasSeeds) {
            log("CROPS", "warn", `No ${seed} available – skipping plot.`);
            continue;
          }

          // Click plot to open seed selector, then click the seed
          simulateClick(plot);
          await randomDelay();

          const seedBtn = Array.from(document.querySelectorAll("[class*='seed'], [class*='plant']"))
            .find(el => el.textContent && el.textContent.includes(seed.replace(" Seed", "")));

          if (seedBtn) {
            simulateClick(seedBtn);
            await randomDelay();
            planted++;
            log("CROPS", "ok", `Planted ${seed}.`);

            // ── Fertilise ─────────────────────────────────────────────────
            const fertMode = _getFertMode(seed);
            if (fertMode === "full") {
              const fertBtn = document.querySelector(
                "[aria-label*='Fertilise'], [class*='fertilise'], [class*='fertilizer']"
              );
              if (fertBtn) {
                simulateClick(fertBtn);
                await randomDelay();
                fertilised++;
                log("CROPS", "ok", `Fertilised plot (mode: full).`);
              }
            }
            // "50%" mode is handled passively on the next poll when crop is ~50 % grown
          }
        }

        // ── Fertilise at 50 % growth ──────────────────────────────────────
        if (_isCropGrowing(plot)) {
          const img  = plot.querySelector("img[src]");
          const src  = img ? img.src : "";
          // Heuristic: stage 2/4 or 3/6 images indicate ~50 % growth
          const is50 = src.includes("stage_2") || src.includes("stage_3");

          if (is50) {
            // Find which seed this plot holds by inspecting nearby text / tooltip
            const plotText  = plot.textContent || "";
            const matchedSeed = Object.keys(CONFIG.crops.fertPerCrop).find(s =>
              plotText.includes(s.replace(" Seed", ""))
            ) || "";
            const fertMode = _getFertMode(matchedSeed || CONFIG.crops.defaultSeed);

            if (fertMode === "50%") {
              const fertBtn = document.querySelector(
                "[aria-label*='Fertilise'], [class*='fertilise'], [class*='fertilizer']"
              );
              if (fertBtn) {
                simulateClick(fertBtn);
                await randomDelay();
                fertilised++;
                log("CROPS", "ok", `Fertilised growing plot at ~50 % (mode: 50%).`);
              }
            }
          }
        }
      } catch (err) {
        recordError("CROPS", `Plot action failed: ${err.message || err}`);
      }
    }

    log("CROPS", "info", `Round done – harvested: ${harvested}, planted: ${planted}, fertilised: ${fertilised}.`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── FEATURE MODULE: FLOWERS ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /** Known flower seed names – extend as new flowers are added to the game. */
  const FLOWER_SEEDS = [
    "Red Pansy Seed",
    "Yellow Pansy Seed",
    "Purple Pansy Seed",
    "White Pansy Seed",
    "Blue Pansy Seed",
    "Red Cosmos Seed",
    "Yellow Cosmos Seed",
    "Purple Cosmos Seed",
    "White Cosmos Seed",
    "Blue Cosmos Seed",
    "Red Balloon Flower Seed",
    "Yellow Balloon Flower Seed",
    "Purple Balloon Flower Seed",
    "White Balloon Flower Seed",
    "Blue Balloon Flower Seed",
    "Red Daffodil Seed",
    "Yellow Daffodil Seed",
    "Purple Daffodil Seed",
    "White Daffodil Seed",
    "Blue Daffodil Seed",
    "Red Lotus Seed",
    "Yellow Lotus Seed",
    "Purple Lotus Seed",
    "White Lotus Seed",
    "Blue Lotus Seed",
  ];

  function _findFlowerBeds() {
    return Array.from(
      document.querySelectorAll(
        "img[src*='/flowers/'], img[src*='flower_bed'], img[src*='flowerbed']"
      )
    ).map(function (img) {
      let el = img.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        if (
          el.getAttribute("role") === "button"  ||
          el.classList.contains("cursor-pointer")
        ) return el;
        el = el.parentElement;
      }
      return img.parentElement?.parentElement?.parentElement || null;
    }).filter(Boolean);
  }

  function _isFlowerReady(bedEl) {
    const img = bedEl.querySelector("img[src]");
    if (!img) return false;
    const src = img.src;
    return src.includes("ready") || src.includes("harvest") || src.includes("bloom");
  }

  function _isFlowerEmpty(bedEl) {
    const img = bedEl.querySelector("img[src]");
    if (!img) return true;
    const src = img.src;
    return src.includes("empty") || src.includes("soil") || !src.includes("/flowers/");
  }

  /** Returns the flower seed name with the lowest non-zero inventory count. */
  function _chooseFlowerSeed() {
    const inv = getInventory();
    let   best = null, bestCount = Infinity;
    for (const seed of FLOWER_SEEDS) {
      const count = inv[seed] || 0;
      if (count < bestCount) { bestCount = count; best = seed; }
    }
    return best;
  }

  async function _buyFlowerSeeds(seedName) {
    log("FLOWERS", "info", `Attempting to buy ${seedName} from shop…`);
    const shopBtn = document.querySelector(
      "[aria-label*='Shop'], [aria-label*='Market'], [class*='shop'], [class*='market']"
    );
    if (!shopBtn) {
      log("FLOWERS", "warn", "Could not find shop button.");
      return false;
    }
    simulateClick(shopBtn);
    await randomDelay();

    const seedItem = Array.from(document.querySelectorAll("[class*='shop'] *"))
      .find(el => el.textContent && el.textContent.includes(seedName));

    if (!seedItem) {
      log("FLOWERS", "warn", `${seedName} not found in shop.`);
      return false;
    }
    simulateClick(seedItem);
    await randomDelay();

    const confirmBtn = document.querySelector(
      "button[class*='confirm'], button[class*='buy'], [aria-label*='Confirm']"
    );
    if (confirmBtn) {
      simulateClick(confirmBtn);
      await randomDelay();
      log("FLOWERS", "ok", `Bought ${seedName}.`);
      return true;
    }
    return false;
  }

  async function runFlowersRound() {
    if (isCaptchaVisible()) {
      log("FLOWERS", "warn", "Captcha detected – skipping flowers round.");
      return;
    }

    log("FLOWERS", "info", "Starting flowers round…");
    const beds = _findFlowerBeds();
    if (beds.length === 0) {
      log("FLOWERS", "info", "No flower beds found on this page.");
      return;
    }

    let harvested = 0, planted = 0;

    for (const bed of beds) {
      if (stopped) return;

      try {
        if (_isFlowerReady(bed)) {
          simulateClick(bed);
          await randomDelay();
          harvested++;
          log("FLOWERS", "ok", "Harvested a flower bed.");
        }

        if (_isFlowerEmpty(bed)) {
          const seed    = _chooseFlowerSeed();
          if (!seed) {
            if (CONFIG.flowers.notifyIfCantPlant) {
              const msg = "No flower seeds identified – cannot plant.";
              log("FLOWERS", "warn", msg);
              if (CONFIG.logging.telegram.enabled) {
                _tgBuffer.push(`⚠️ FLOWERS: ${msg}`);
                _scheduleTgFlush();
              }
            }
            continue;
          }

          const inv  = getInventory();
          let hasSeeds = (inv[seed] || 0) >= 1;

          if (!hasSeeds && CONFIG.flowers.buyMissingSeeds) {
            hasSeeds = await _buyFlowerSeeds(seed);
          }

          if (!hasSeeds) {
            if (CONFIG.flowers.notifyIfCantPlant) {
              const msg = `Not enough ${seed} to plant – cannot proceed.`;
              log("FLOWERS", "warn", msg);
              if (CONFIG.logging.telegram.enabled) {
                _tgBuffer.push(`⚠️ FLOWERS: ${msg}`);
                _scheduleTgFlush();
              }
            }
            continue;
          }

          simulateClick(bed);
          await randomDelay();

          const seedBtn = Array.from(document.querySelectorAll("[class*='seed'], [class*='plant']"))
            .find(el => el.textContent && el.textContent.includes(seed.replace(" Seed", "")));
          if (seedBtn) {
            simulateClick(seedBtn);
            await randomDelay();
            planted++;
            log("FLOWERS", "ok", `Planted ${seed}.`);
          }
        }
      } catch (err) {
        recordError("FLOWERS", `Flower bed action failed: ${err.message || err}`);
      }
    }

    log("FLOWERS", "info", `Round done – harvested: ${harvested}, planted: ${planted}.`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── FEATURE MODULE: RESOURCES ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resource definition table.
   * Each entry describes how to find and deplete one resource type.
   *
   * imgPattern   – substring matched against img.src
   * excludePattern – substring that, if present, means the resource is depleted
   * hits         – number of clicks needed to fully deplete
   * recoveryMs   – milliseconds until the resource regenerates
   * domWalkUp    – levels to walk up from the img to the clickable element
   */
  const RESOURCE_DEFS = {
    trees: {
      imgPattern:     "/resources/tree/",
      excludePattern: "stump",
      extraExclude:   "shake_sheet",
      imgRegex:       /\/resources\/tree\/[^/]+\/[^/]+\.(webp|png)$/,
      hits:           3,
      recoveryMs:     2 * 60 * 60 * 1000,  // 2 hours
      domWalkUp:      3,
    },
    stone: {
      imgPattern:     "/resources/stone",
      excludePattern: "depleted",
      hits:           3,
      recoveryMs:     4 * 60 * 60 * 1000,  // 4 hours
      domWalkUp:      3,
    },
    iron: {
      imgPattern:     "/resources/iron",
      excludePattern: "depleted",
      hits:           3,
      recoveryMs:     8 * 60 * 60 * 1000,  // 8 hours
      domWalkUp:      3,
    },
    gold: {
      imgPattern:     "/resources/gold",
      excludePattern: "depleted",
      hits:           3,
      recoveryMs:     8 * 60 * 60 * 1000,
      domWalkUp:      3,
    },
    crimstone: {
      imgPattern:     "/resources/crimstone",
      excludePattern: "depleted",
      hits:           5,
      recoveryMs:     24 * 60 * 60 * 1000, // 24 hours
      domWalkUp:      3,
    },
    sunstone: {
      imgPattern:     "/resources/sunstone",
      excludePattern: "depleted",
      hits:           5,
      recoveryMs:     24 * 60 * 60 * 1000,
      domWalkUp:      3,
    },
    obsidian: {
      imgPattern:     "/resources/obsidian",
      excludePattern: "depleted",
      hits:           5,
      recoveryMs:     24 * 60 * 60 * 1000,
      domWalkUp:      3,
    },
  };

  /**
   * Returns the list of clickable elements for non-depleted resources of `type`.
   */
  function findAvailableResources(type) {
    const def = RESOURCE_DEFS[type];
    if (!def) return [];

    const imgs = Array.from(
      document.querySelectorAll(`img[src*='${def.imgPattern}']`)
    ).filter(function (img) {
      try {
        const src = img.src || "";
        if (def.excludePattern && src.includes(def.excludePattern)) return false;
        if (def.extraExclude   && src.includes(def.extraExclude))   return false;
        if (def.imgRegex       && !def.imgRegex.test(new URL(src).pathname)) return false;
        return true;
      } catch (_) { return false; }
    });

    const clickTargets = imgs.map(function (img) {
      let el = img;
      for (let i = 0; i < def.domWalkUp; i++) {
        el = el && el.parentElement;
      }
      return el && el.tagName === "DIV" ? el : null;
    }).filter(Boolean);

    return Array.from(new Set(clickTargets));
  }

  /**
   * Depletes all available resources of `type` with random delays.
   * Returns the count of resources hit.
   */
  async function harvestResource(type, round) {
    const def       = RESOURCE_DEFS[type];
    const resources = findAvailableResources(type);
    if (resources.length === 0) return 0;

    log("RESOURCES", "info", `[${type}] Found ${resources.length} available.`);

    let count = 0;
    for (let i = 0; i < resources.length; i++) {
      if (stopped) break;
      if (isCaptchaVisible()) {
        log("RESOURCES", "warn", `[${type}] Captcha detected – pausing.`);
        break;
      }

      const target = resources[i];
      log("RESOURCES", "info", `[${type}] ${i + 1}/${resources.length} – depleting…`);

      try {
        for (let hit = 0; hit < def.hits; hit++) {
          if (stopped) break;
          simulateClick(target);
          if (hit < def.hits - 1) await sleep(randInt(200, 500));
        }
        count++;
        log("RESOURCES", "ok", `[${type}] Depleted #${i + 1}.`);
      } catch (err) {
        recordError("RESOURCES", `[${type}] Hit failed: ${err.message || err}`);
      }

      if (i < resources.length - 1) await randomDelay();
    }

    log("RESOURCES", "info", `[${type}] Done – depleted ${count}/${resources.length}.`);
    return count;
  }

  async function runResourcesRound(round) {
    if (isCaptchaVisible()) {
      log("RESOURCES", "warn", "Captcha detected – skipping resources round.");
      return;
    }

    log("RESOURCES", "info", "Starting resources round…");

    const featureFlags = CONFIG.features.resources;

    for (const type of Object.keys(RESOURCE_DEFS)) {
      if (stopped) return;
      if (!featureFlags[type]) continue;
      try {
        await harvestResource(type, round);
        if (!stopped) await randomDelay();
      } catch (err) {
        recordError("RESOURCES", `[${type}] Round error: ${err.message || err}`);
      }
    }

    log("RESOURCES", "info", "Resources round complete.");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Yield summary ────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  function logYieldSummary() {
    const lines = ["── Yield summary ──────────────────────────────"];

    if (CONFIG.features.crops) {
      const ready = _findCropPlots().filter(_isCropReady).length;
      lines.push(`  Crops ready:   ${ready}`);
    }
    if (CONFIG.features.flowers) {
      const ready = _findFlowerBeds().filter(_isFlowerReady).length;
      lines.push(`  Flowers ready: ${ready}`);
    }
    for (const type of Object.keys(RESOURCE_DEFS)) {
      if (CONFIG.features.resources[type]) {
        lines.push(`  ${type.padEnd(10)} ready: ${findAvailableResources(type).length}`);
      }
    }
    lines.push(`  Errors so far: ${_totalErrors} / ${CONFIG.errorThreshold}`);
    lines.push("────────────────────────────────────────────────");

    log("SYSTEM", "info", lines.join("\n"));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Stop / cleanup ───────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  function _cleanup() {
    if (_tgFlushTimer) { _nativeClearTimeout(_tgFlushTimer); _tgFlushTimer = null; }
    try { _worker.terminate(); }       catch (_) {}
    try { URL.revokeObjectURL(_workerUrl); } catch (_) {}
  }

  window.stopAutotest = async function () {
    if (stopped) return;
    stopped = true;

    // Resolve all pending sleep callbacks so async loops can unwind.
    for (const id in _sleepCbs) {
      try { _sleepCbs[id](); } catch (_) {}
    }
    for (const id in _sleepCbs) delete _sleepCbs[id];

    log("SYSTEM", "ok", "Autotest stopped by user.");

    if (CONFIG.logging.toFile)              _downloadLog();
    if (CONFIG.logging.telegram.enabled)    await _flushTelegram(true);

    _cleanup();
    console.log("🛑 Autotest fully stopped.  Run the script again to restart.");
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Main loop ────────────────────────────────════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════

  async function runAutotest() {
    log("SYSTEM", "info",
      "🌻 Sunland Full Autotest started.\n" +
      "   Enabled features:\n" +
      `     crops:     ${CONFIG.features.crops}\n` +
      `     flowers:   ${CONFIG.features.flowers}\n` +
      `     resources: ${JSON.stringify(CONFIG.features.resources)}\n` +
      "   Run  stopAutotest()  to stop at any time."
    );

    let round = 0;

    while (!stopped) {
      round++;

      // ── Pre-check summary ────────────────────────────────────────────────
      logYieldSummary();

      // ── Run enabled modules ──────────────────────────────────────────────
      if (!stopped && CONFIG.features.crops)     await runCropsRound();
      if (!stopped && CONFIG.features.flowers)   await runFlowersRound();
      if (!stopped)                               await runResourcesRound(round);

      // ── Error budget check ───────────────────────────────────────────────
      _checkErrorBudget();
      if (stopped) break;

      // ── Wait for next cycle ──────────────────────────────────────────────
      const waitMs  = randomCheckInterval();
      const waitMin = (waitMs / 60_000).toFixed(1);
      log("SYSTEM", "info", `Round ${round} complete.  Next check in ~${waitMin} min…`);

      let elapsed = 0;
      const POLL  = 30_000; // log remaining time every 30 s
      while (elapsed < waitMs && !stopped) {
        const chunk = Math.min(POLL, waitMs - elapsed);
        await sleep(chunk);
        elapsed += chunk;
        if (!stopped && elapsed < waitMs) {
          const remaining = ((waitMs - elapsed) / 60_000).toFixed(1);
          log("SYSTEM", "info", `⏳ ~${remaining} min until next round.`);
        }
      }
    }
  }

  runAutotest();
})();
