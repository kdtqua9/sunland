/**
 * Sunflower Land – Autotest: Full Farm Automation  (infinite loop edition)
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
      crops:     true,
      flowers:   true,
      fruits:    true,
      pet:       true,    // wake sleeping pet each round
      honey:     true,    // collect full beehives each round
      animals:   true,    // use toys on animals that want to play
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

    // ── Fruit settings ──────────────────────────────────────────────────────
    fruits: {
      /**
       * Which fruit tree / bush types to manage.
       * Each name is matched against img src paths (case-insensitive).
       * Common SFL fruits: "Apple", "Orange", "Blueberry", "Banana",
       *   "Lemon", "Tomato", "Eggplant", "Corn", "Radish", "Wheat", "Kale"
       * (Keep only the types your farm actually has.)
       */
      types: ["Apple", "Orange", "Blueberry", "Banana"],
      /** Apply fertiliser to fruit patches when planting */
      useFertiliser: true,
      /**
       * "full"  – fertilise immediately after planting
       * "none"  – never fertilise
       */
      fertiliserMode: "full",
      /** Try to buy fruit seeds / saplings from the shop when the slot is empty */
      buyMissingSeeds: false,
    },

    // ── Pet settings ────────────────────────────────────────────────────────
    pet: {
      /**
       * IMG src substrings that indicate the pet is sleeping.
       * Checked case-insensitively.  Extend if the game uses other names.
       */
      sleepPatterns: ["sleeping", "asleep", "zzz", "_sleep"],
      /** Notify via Telegram when the pet is found sleeping and woken. */
      notifyOnWake: false,
    },

    // ── Honey settings ───────────────────────────────────────────────────────
    honey: {
      /**
       * IMG src substrings that indicate a beehive is full / ready to collect.
       * The script also matches beehive elements whose tooltip/aria text
       * contains "full" or "collect".
       */
      fullPatterns: ["beehive_full", "honey_full", "beehive-full", "hive_full"],
      /**
       * Fallback: any <img> whose src contains a beehive pattern is
       * considered ready when none of the fullPatterns match.
       * Set false to only collect when a specific "full" sprite is visible.
       */
      collectIfAnyBeehive: true,
    },

    // ── Animal settings ──────────────────────────────────────────────────────
    animals: {
      /**
       * IMG src substrings that appear as a floating speech-bubble / badge
       * above a barn or coop when an animal wants to play.
       * These are rendered directly on the farm DOM without opening the building.
       * Extend with actual asset paths if you find others in the game.
       */
      playIndicatorPatterns: [
        "want_to_play", "play_request", "play_icon",
        "heart_bubble", "love_icon", "animal_heart",
      ],
      /**
       * Names of toy items in your inventory (used to confirm you can play).
       * If the inventory check is unavailable, the script still tries to click.
       */
      toyItems: ["Toy", "Ball", "Chicken Toy", "Cow Toy"],
    },

    // ── Resource settings ────────────────────────────────────────────────────
    resources: {
      /**
       * Delay between consecutive hits on the same resource node.
       * Moved here from harvestResource() so you can tune without touching code.
       */
      hitDelayMs: { min: 600, max: 1200 },

      /**
       * Tool requirements per resource type.
       * Before harvesting, the script checks inventory for the required tool.
       * If missing it opens the configured shop and buys a random quantity
       * between buyMin and buyMax.
       * If the purchase fails (not enough coins / shop not found) a Telegram
       * alert is sent and that resource type is skipped for this round.
       *
       * Set  enabled: false  to skip the tool check for a specific type
       * (useful if you already have a stockpile and don't need auto-buy).
       *
       * shop values: "Market" for basic tools, "Blacksmith" for advanced ones.
       */
      tools: {
        trees:     { tool: "Axe",               shop: "Market",      buyMin: 3, buyMax: 5, enabled: true },
        stone:     { tool: "Pickaxe",           shop: "Market",      buyMin: 3, buyMax: 5, enabled: true },
        iron:      { tool: "Stone Pickaxe",     shop: "Blacksmith",  buyMin: 2, buyMax: 3, enabled: true },
        gold:      { tool: "Iron Pickaxe",      shop: "Blacksmith",  buyMin: 2, buyMax: 3, enabled: true },
        crimstone: { tool: "Gold Pickaxe",      shop: "Blacksmith",  buyMin: 1, buyMax: 2, enabled: true },
        sunstone:  { tool: "Crimstone Pickaxe", shop: "Blacksmith",  buyMin: 1, buyMax: 2, enabled: true },
        obsidian:  { tool: "Obsidian Pickaxe",  shop: "Blacksmith",  buyMin: 1, buyMax: 2, enabled: true },
      },
    },

    // ── Dialog / popup settings ──────────────────────────────────────────────
    dialog: {
      /**
       * Automatically detect and click through any game popup that appears
       * before or during a round (goblin swarm, event dialogs, reward screens,
       * season notifications, etc.).
       * The script clicks "Next / Continue / Accept / OK / Close" buttons in
       * sequence until the dialog disappears or the attempt limit is reached.
       */
      handleDialogs: true,
      /** Maximum dismiss-button clicks per pass before giving up. */
      maxDismissAttempts: 15,
      /** Random delay (ms) between each dismiss click. */
      dismissDelayMs: { min: 600, max: 1200 },
      /**
       * Extra wait (ms) applied when a countdown timer is detected inside
       * the dialog (e.g. a goblin-swarm "wait X minutes" screen).
       * The script waits this long before trying to dismiss again.
       */
      timerWaitMs: 8000,
      /**
       * When a dialog is still visible after maxDismissAttempts:
       *   pauseOnBlock   – set the script to paused state (resume via Telegram
       *                    "start" command or by calling startAutotest()).
       *   alertOnBlock   – capture a screenshot and send a Telegram alert so
       *                    you know human intervention is needed.
       * Both default to true; set false to revert to the old "continue anyway"
       * behaviour.
       */
      pauseOnBlock: true,
      alertOnBlock: true,
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
        /**
         * Send log lines / error summaries to a Telegram bot.
         * NOTE: if you fill in botToken + chatId below, this is auto-set to
         * true at startup – you do NOT need to change `enabled` manually.
         */
        enabled: false,
        botToken: "",   // "123456:ABC-DEF…"
        chatId: "",     // "-1001234567890" or your personal chat ID
        /** Flush buffered log messages every N seconds (0 = immediate). */
        flushIntervalSec: 30,
        /**
         * When true, the script polls Telegram for incoming commands every
         * commandPollIntervalSec seconds.  Accepted commands (from chatId only):
         *   "stop"  / "/stop"  → pause the autotest; sends a confirmation.
         *   "start" / "/start" → resume after a pause; sends a confirmation.
         * A hard stop is still available via stopAutotest() in the console.
         */
        listenForCommands: true,
        /**
         * How often (seconds) the script polls Telegram for stop/start
         * commands.  Also controls how frequently the inter-round countdown
         * log line is printed.  Default: 30 s.
         */
        commandPollIntervalSec: 30,
        /**
         * Send one formatted round-summary message to Telegram at the end of
         * each round, grouping all actions / results / warnings by category.
         * Set false to disable Telegram messages from the automation entirely
         * (only startup/stop system messages will be sent).
         */
        summaryPerRound: true,
        /**
         * Capture a JPEG screenshot of the farm page and attach it to the
         * round summary message.  Uses html2canvas, which is loaded
         * automatically from CDN on first use.
         * Set to false if CDN access is blocked or you prefer text-only.
         */
        sendScreenshot: false,
      },
      /**
       * IANA timezone for log timestamps.
       * Examples: "Asia/Bangkok" (UTC+7), "Asia/Ho_Chi_Minh" (UTC+7),
       *           "America/New_York", "Europe/London", "UTC"
       * Set to "" or null to use the browser's local timezone.
       */
      timezone: "Asia/Bangkok",   // UTC+7
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

  // Auto-enable Telegram when credentials are provided but the flag was left
  // as the default `false`.  This way users only need to fill in botToken and
  // chatId – no separate `enabled: true` step required.
  (function () {
    const tg = CONFIG.logging.telegram;
    if (tg.botToken && tg.chatId && !tg.enabled) {
      tg.enabled = true;
      console.log("[SYSTEM] ℹ️  Telegram credentials detected – logging enabled automatically.");
    }
  })();

  // ─── Capture native timers BEFORE any game code can override them ─────────
  const _nativeSetTimeout  = window.setTimeout.bind(window);
  const _nativeClearTimeout = window.clearTimeout.bind(window);

  // ─── Stop / pause control ─────────────────────────────────────────────────
  let stopped = false;  // hard stop (console stopAutotest())
  let paused  = false;  // soft pause via Telegram "stop" command; "start" resumes
  let _currentRound = 0; // updated each iteration – used by stopAutotest summary

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

  /**
   * Dispatch a full pointer + mouse click sequence at the exact viewport
   * coordinate (x, y).  Uses document.elementFromPoint so the events always
   * land on whatever element is actually rendered at that position – no DOM
   * walking or React-props inspection required.
   *
   * Fires: pointerover → pointerenter → mouseover → pointerdown → mousedown
   *        → pointerup → mouseup → click
   *
   * Returns the {x, y} pair actually used (useful for logging).
   */
  function simulateClickAt(x, y) {
    const target = document.elementFromPoint(x, y) || document.body;
    const base = {
      bubbles: true, cancelable: true,
      clientX: x, clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
      view: window,
    };
    const ptrBase = Object.assign(
      { pointerId: 1, isPrimary: true, pointerType: "mouse", pressure: 0.5 },
      base
    );
    target.dispatchEvent(new PointerEvent("pointerover",  ptrBase));
    target.dispatchEvent(new PointerEvent("pointerenter", Object.assign({}, ptrBase, { bubbles: false })));
    target.dispatchEvent(new MouseEvent("mouseover",  base));
    target.dispatchEvent(new PointerEvent("pointerdown", ptrBase));
    target.dispatchEvent(new MouseEvent("mousedown",  base));
    target.dispatchEvent(new PointerEvent("pointerup",   ptrBase));
    target.dispatchEvent(new MouseEvent("mouseup",    base));
    target.dispatchEvent(new MouseEvent("click",      base));
    return { x, y };
  }

  /** Convenience wrapper: click the centre (± jitter) of a DOM element.
   *  Events are dispatched DIRECTLY to `element` so they are guaranteed to
   *  reach the correct React handler – no elementFromPoint detour that can
   *  silently resolve to a wrong / overlapping element.
   */
  function simulateClick(element) {
    const rect = element.getBoundingClientRect();
    const { x, y } = jitterCoord(rect);
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true,
      view: window,
      clientX: x, clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
    }));
    return { x, y };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Logger ───────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const _logBuffer      = [];
  const _tgBuffer       = [];
  let   _tgFlushTimer   = null;
  // Tracks the next update_id offset for getUpdates polling (stop-command listener).
  let   _tgUpdateOffset = 0;
  // Per-round structured events – cleared at the start of each round and
  // formatted into a single Telegram summary message at the end.
  const _roundEvents    = [];

  /** Return current time as HH:MM:SS in the configured timezone (default UTC+7) */
  function _timestamp() {
    const tz = CONFIG.logging.timezone;
    if (tz) {
      try {
        return new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour12: false });
      } catch (_) { /* fall through to local time on invalid tz */ }
    }
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

    // Collect into the per-round event accumulator for the end-of-round
    // Telegram summary.  Immediate / system messages use sendTelegramImmediate.
    if (CONFIG.logging.telegram.enabled && CONFIG.logging.telegram.summaryPerRound) {
      _roundEvents.push({ ts: _timestamp(), feature, level, message });
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
      const resp = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" }),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(function () { return "(unreadable)"; });
        console.error("[SYSTEM] ❌ Telegram API error:", resp.status, body);
      }
    } catch (err) {
      // Only log to console to avoid infinite recursion
      console.error("[SYSTEM] ❌ Telegram flush failed:", err);
    }
  }

  /**
   * Send a single message to Telegram immediately, bypassing the batch buffer.
   * Used for time-sensitive messages such as click-coordinate reports.
   * Respects the `enabled` flag; no-ops silently when Telegram is disabled.
   */
  async function sendTelegramImmediate(text) {
    const tg = CONFIG.logging.telegram;
    if (!tg.enabled) return;
    if (!tg.botToken || !tg.chatId) return;
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tg.chatId, text: text }),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(function () { return "(unreadable)"; });
        console.error("[SYSTEM] ❌ Telegram sendMessage error:", resp.status, body);
      }
    } catch (err) {
      console.error("[SYSTEM] ❌ Telegram sendMessage failed:", err);
    }
  }

  /**
   * Poll Telegram getUpdates for incoming command messages.
   * Accepted commands (only from the configured chatId):
   *   "stop"  / "/stop"  → pause the autotest (sets paused=true) and confirms.
   *   "start" / "/start" → resume after a pause (clears paused) and confirms.
   * A hard stop is only available via stopAutotest() in the console.
   * No-op when Telegram is disabled or listenForCommands is false.
   */
  async function _pollTelegramCommands() {
    const tg = CONFIG.logging.telegram;
    if (!tg.enabled || !tg.listenForCommands || !tg.botToken || !tg.chatId) return;
    try {
      const url =
        `https://api.telegram.org/bot${tg.botToken}/getUpdates` +
        `?offset=${_tgUpdateOffset}&limit=20&timeout=0` +
        `&allowed_updates=%5B%22message%22%5D`;  // ["message"] URL-encoded
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.ok || !Array.isArray(data.result)) return;

      for (const upd of data.result) {
        // Always advance the offset so we never re-process the same update.
        _tgUpdateOffset = upd.update_id + 1;

        const msg = upd.message || upd.channel_post;
        if (!msg) continue;

        // Only accept commands from the exact configured chatId.
        const fromId = String(msg.chat && msg.chat.id);
        if (fromId !== String(tg.chatId)) continue;

        const text = (msg.text || "").trim().toLowerCase();

        if ((text === "stop" || text === "/stop") && !paused) {
          paused = true;
          log("SYSTEM", "info", "⏸️ Received 'stop' from Telegram – autotest paused.");
          await sendTelegramImmediate(
            "⏸️ Autotest paused.\n" +
            "Send 'start' or '/start' to resume, or run stopAutotest() in the console for a full stop."
          );
        } else if ((text === "start" || text === "/start") && paused) {
          paused = false;
          log("SYSTEM", "info", "▶️ Received 'start' from Telegram – autotest resuming.");
          await sendTelegramImmediate("▶️ Autotest resumed!");
        }
      }
    } catch (_) {
      // Network errors are silently ignored to avoid polluting the log.
    }
  }

  function _scheduleTgFlush() {
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
    a.download     = `sfl-autotest-${new Date().toISOString().slice(0, 10)}.log`;
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
      await sendTelegramImmediate(summary.slice(0, 4096));
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
    // NOTE: do NOT check [data-html2canvas-ignore] – the game attaches that
    // attribute to its own permanent HUD elements (balance bar, nav, etc.)
    // which are always in the DOM, causing every round to be skipped.
    return !!(
      document.querySelector("[id*='captcha']")          ||
      document.querySelector("[class*='captcha']")       ||
      document.querySelector("iframe[src*='recaptcha']") ||
      document.querySelector("iframe[src*='challenges.cloudflare']")
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Dialog / popup detection & dismissal ────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Returns true when any non-captcha game dialog or popup overlay is visible.
   * Covers: React modal components, event popups, goblin-swarm overlays,
   * season / reward dialogs and similar screen-blocking panels.
   */
  function isGameDialogVisible() {
    return !!(
      document.querySelector("[role='dialog']")                            ||
      document.querySelector("[aria-modal='true']")                        ||
      document.querySelector("[class*='modal']:not([class*='captcha'])")   ||
      document.querySelector("[class*='dialog']:not([class*='captcha'])")  ||
      document.querySelector("[class*='popup']:not([class*='captcha'])")   ||
      document.querySelector("[class*='goblin']")                          ||
      document.querySelector("[class*='swarm']")                           ||
      document.querySelector("[class*='event-modal']")                     ||
      document.querySelector("[class*='reward-modal']")                    ||
      document.querySelector("[class*='notification-modal']")              ||
      document.querySelector("[class*='overlay'][class*='panel']")
    );
  }

  /**
   * Returns true if a countdown timer element is visible inside `el` (or
   * anywhere on the page if no element is given).
   */
  function _elementHasTimer(el) {
    const scope = el || document;
    const timerEl = scope.querySelector(
      "[class*='timer'], [class*='countdown'], [class*='clock']"
    );
    if (timerEl) {
      const t = timerEl.textContent || "";
      if (/\d+:\d+/.test(t)) return true;
    }
    return false;
  }

  /**
   * Dismiss-text candidates in priority order.
   * The script scans all visible buttons and clicks the first match.
   */
  const _DISMISS_LABELS = [
    "Let's go", "Collect", "Claim", "Continue", "Next",
    "Accept", "Confirm", "OK", "Okay", "Got it", "Acknowledge",
    "Dismiss", "Done", "Skip", "Close",
    // Shop quantity / purchase confirmation buttons – prevent shop panels
    // from blocking _dismissDialogs when they remain open after a buy attempt.
    "Buy 1", "Buy 10", "Buy 5", "Max", "Purchase",
  ];

  /**
   * Collect all distinct dialog/popup root elements that are currently visible
   * in the DOM (excluding captcha overlays).  Returns them sorted so that
   * popups WITHOUT a countdown timer come first – those can be dismissed
   * immediately.  Timer-based popups (e.g. goblin swarm) are handled last so
   * we can collect rewards / close other alerts while the timer expires.
   */
  function _collectVisibleDialogs() {
    const roots = Array.from(document.querySelectorAll(
      "[role='dialog'], [aria-modal='true'], " +
      "[class*='modal']:not([class*='captcha']), " +
      "[class*='dialog']:not([class*='captcha']), " +
      "[class*='popup']:not([class*='captcha']), " +
      "[class*='goblin'], [class*='swarm'], " +
      "[class*='event-modal'], [class*='reward-modal'], " +
      "[class*='notification-modal'], " +
      "[class*='overlay'][class*='panel']"
    )).filter(function (el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    // Deduplicate: remove any element that is a descendant of another element
    // in the list (keep only the outermost containers).
    const unique = roots.filter(function (el) {
      return !roots.some(function (other) {
        return other !== el && other.contains(el);
      });
    });

    // Sort: dialogs WITHOUT a visible timer come first so they can be dismissed
    // before we wait for goblin-swarm timers.
    unique.sort(function (a, b) {
      return (_elementHasTimer(a) ? 1 : 0) - (_elementHasTimer(b) ? 1 : 0);
    });

    return unique;
  }

  /**
   * Try to dismiss a single dialog element `dlg` by clicking the first
   * recognisable action button found inside it (falling back to global scope).
   * Returns true when a button was clicked, false when none was found.
   */
  async function _dismissOneDialog(dlg) {
    // Gather buttons scoped to this dialog first, then any globally visible ones.
    const inDialog = Array.from(dlg.querySelectorAll(
      "button, [role='button'], [class*='btn'], a[class*='action']"
    )).filter(function (el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const outside = Array.from(document.querySelectorAll(
      "button, [role='button'], [class*='btn'], a[class*='action']"
    )).filter(function (el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !dlg.contains(el);
    });

    // In-dialog buttons take priority so we target the right popup.
    const buttons = inDialog.concat(outside);

    // 1. Labelled dismiss button.
    for (const label of _DISMISS_LABELS) {
      const btn = buttons.find(function (el) {
        const t = (el.textContent || el.value || el.getAttribute("aria-label") || "")
          .trim().toLowerCase();
        return t === label.toLowerCase() || t.startsWith(label.toLowerCase());
      });
      if (btn) {
        log("DIALOG", "ok",
          `Dismissed popup – clicked "${(btn.textContent || "").trim().slice(0, 40)}"`);
        simulateClick(btn);
        await _sleepMs(randInt(CONFIG.dialog.dismissDelayMs.min, CONFIG.dialog.dismissDelayMs.max));
        return true;
      }
    }

    // 2. Close-icon / X button.
    const closeSelectors =
      "button[aria-label='Close'], button[aria-label='close'], " +
      "[class*='close-btn'], [class*='modal-close'], [class*='dialog-close']";
    const closeBtn =
      dlg.querySelector(closeSelectors) ||
      document.querySelector(closeSelectors);
    if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
      log("DIALOG", "ok", "Dismissed popup – clicked close/X button.");
      simulateClick(closeBtn);
      await _sleepMs(randInt(CONFIG.dialog.dismissDelayMs.min, CONFIG.dialog.dismissDelayMs.max));
      return true;
    }

    return false;
  }

  /**
   * Attempt to dismiss ALL currently visible game dialogs/popups.
   *
   * Multiple simultaneous overlays (goblin swarm + chest reward + bot-detect)
   * are handled in priority order each pass:
   *
   *   1. If ONLY a captcha is visible → return immediately (human must solve it).
   *   2. Non-timer dialogs (rewards, event notifications) → dismissed first.
   *   3. Timer-based dialogs (goblin swarm countdown) → wait, then dismiss.
   *
   * The outer loop repeats until no dismissable dialog remains or the attempt
   * limit is reached, so ALL stacked popups are cleared in one call.
   */
  async function _dismissDialogs() {
    if (!CONFIG.dialog.handleDialogs) return;

    let attempts = 0;

    while (attempts < CONFIG.dialog.maxDismissAttempts && !stopped) {
      // If a captcha is the ONLY thing visible, we cannot auto-dismiss it.
      if (isCaptchaVisible() && !isGameDialogVisible()) {
        log("SYSTEM", "warn", "Captcha / bot-detection visible – waiting for human action.");
        return;
      }

      if (!isGameDialogVisible()) break;

      const dialogs = _collectVisibleDialogs();
      if (dialogs.length === 0) break;

      let anyClicked = false;

      for (const dlg of dialogs) {
        if (stopped) return;

        // If this dialog has a live timer, wait for it before dismissing.
        if (_elementHasTimer(dlg)) {
          log("SYSTEM", "info",
            `Dialog has timer – waiting ${CONFIG.dialog.timerWaitMs / 1000} s…`);
          await _sleepMs(CONFIG.dialog.timerWaitMs);
        }

        const clicked = await _dismissOneDialog(dlg);
        if (clicked) anyClicked = true;
      }

      if (!anyClicked) {
        // No button found in any visible dialog – wait a moment before retrying.
        log("SYSTEM", "warn", "Dialog(s) visible but no dismiss button found – waiting…");
        await _sleepMs(CONFIG.dialog.timerWaitMs);
      }

      attempts++;
    }

    if (isGameDialogVisible()) {
      log("SYSTEM", "warn",
        `⚠️ Dialog still visible after ${attempts} attempt(s) – automation blocked.`);

      if (CONFIG.dialog.alertOnBlock && CONFIG.logging.telegram.enabled) {
        const dataUrl = await _captureScreenshot();
        const caption =
          `⚠️ <b>Blocked dialog</b> – could not dismiss after ${attempts} attempt(s).\n` +
          `Round #${_currentRound} · ${_timestamp()}\n` +
          (CONFIG.dialog.pauseOnBlock
            ? "Script <b>paused</b>. Send /start to resume after closing the dialog."
            : "Script continues without dismissing.");
        if (dataUrl) {
          await _sendTelegramPhoto(dataUrl, caption);
        } else {
          await sendTelegramImmediate(caption);
        }
      }

      if (CONFIG.dialog.pauseOnBlock) {
        log("SYSTEM", "warn",
          "Script paused – dialog still visible. Close it manually then send /start via Telegram (or call startAutotest()).");
        paused = true;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Screenshot helpers ───────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  let _html2canvasReady = false;

  /**
   * Attempts to capture the current viewport as a JPEG data-URL.
   * Loads html2canvas from CDN on first call; returns null on any error.
   */
  async function _captureScreenshot() {
    try {
      if (!window.html2canvas) {
        if (_html2canvasReady === false) {
          // Load html2canvas from CDN (≈ 340 kB minified).
          await new Promise(function (resolve, reject) {
            const s  = document.createElement("script");
            s.src    = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            s.onload  = function () { _html2canvasReady = true; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
      } else {
        _html2canvasReady = true;
      }

      if (!window.html2canvas) return null;

      const canvas = await window.html2canvas(document.body, {
        useCORS:        true,
        allowTaint:     true,
        scale:          0.5,          // half resolution – keeps file size small
        ignoreElements: function (el) { return el.tagName === "IFRAME"; },
      });
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch (err) {
      console.warn("[SYSTEM] Screenshot failed:", err.message || err);
      return null;
    }
  }

  /**
   * Send a data-URL image to Telegram as a photo with the given caption.
   * Falls back to a plain text message if the photo upload fails.
   * Caption is truncated at 1 024 chars (Telegram API limit).
   */
  async function _sendTelegramPhoto(dataUrl, caption) {
    const tg = CONFIG.logging.telegram;
    if (!tg.enabled || !tg.botToken || !tg.chatId) return;
    try {
      const blobResp = await fetch(dataUrl);
      const blob     = await blobResp.blob();
      const form     = new FormData();
      form.append("chat_id",    tg.chatId);
      form.append("photo",      blob, "farm-screenshot.jpg");
      form.append("caption",    caption.slice(0, 1024));
      form.append("parse_mode", "HTML");
      const resp = await fetch(
        `https://api.telegram.org/bot${tg.botToken}/sendPhoto`,
        { method: "POST", body: form }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(function () { return "(unreadable)"; });
        console.error("[SYSTEM] ❌ Telegram sendPhoto error:", resp.status, body);
        // Fall back to text.
        await sendTelegramImmediate(caption.slice(0, 4096));
      }
    } catch (err) {
      console.error("[SYSTEM] ❌ Telegram sendPhoto failed:", err);
      await sendTelegramImmediate(caption.slice(0, 4096));
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Round summary (Telegram) ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  const _FEATURE_EMOJI = { CROPS: "🌾", FLOWERS: "🌸", FRUITS: "🍎", RESOURCES: "⛏️", PET: "🐾", HONEY: "🍯", ANIMALS: "🐄", DIALOG: "💬", SYSTEM: "⚙️" };

  /**
   * Format _roundEvents into a human-readable summary string grouped by
   * feature category.  Consecutive duplicate messages are counted and
   * collapsed into one line (e.g. "Harvested a plot ×5").
   */
  function _formatRoundSummary(roundNum) {
    const byFeature = {};
    for (const ev of _roundEvents) {
      if (!byFeature[ev.feature]) byFeature[ev.feature] = [];
      byFeature[ev.feature].push(ev);
    }

    const lines = [
      `🌻 <b>Round #${roundNum}</b> · ${_timestamp()}`,
      "──────────────────────────────",
    ];

    const SKIP_PATTERNS = [
      "⏳", "Next check", "Autotest started", "Enabled features",
      "Starting crops round", "Starting flowers round",
      "Starting resources round", "Resources round complete",
      "Round done", "Yield summary", "─", "Errors so far",
    ];

    for (const [feature, events] of Object.entries(byFeature)) {
      // Filter out routine timing / bookkeeping noise.
      const meaningful = events.filter(function (ev) {
        return SKIP_PATTERNS.every(function (p) { return !ev.message.includes(p); });
      });
      if (meaningful.length === 0) continue;

      lines.push(`${_FEATURE_EMOJI[feature] || "•"} <b>${feature}</b>`);

      // Collapse runs of identical messages.
      const collapsed = [];
      for (const ev of meaningful) {
        const prev = collapsed[collapsed.length - 1];
        if (prev && prev.message === ev.message && prev.level === ev.level) {
          prev.count++;
        } else {
          collapsed.push({ ...ev, count: 1 });
        }
      }

      // Separate coordinate-detail lines (resource hits) from other events.
      const coordLines = [];
      for (const ev of collapsed) {
        if (ev.feature === "RESOURCES" && ev.message.includes("clicks:")) {
          coordLines.push(ev.message);
          continue;
        }
        const icon   = LEVEL_ICON[ev.level] || "•";
        const suffix = ev.count > 1 ? ` ×${ev.count}` : "";
        // Strip the leading "[HH:MM:SS] [FEATURE] icon " prefix already in message
        lines.push(`  ${icon} ${ev.message}${suffix}`);
      }

      // Summarise coordinate lines compactly (first 3 then ellipsis).
      if (coordLines.length > 0) {
        lines.push(`  ✅ ${coordLines.length} node(s) depleted`);
        for (const cl of coordLines.slice(0, 3)) {
          const coords = cl.replace(/.*clicks:\s*/, "");
          lines.push(`    📍 ${coords}`);
        }
        if (coordLines.length > 3) {
          lines.push(`    … +${coordLines.length - 3} more`);
        }
      }
    }

    lines.push("──────────────────────────────");
    const errs = _roundEvents.filter(function (e) { return e.level === "error"; }).length;
    const warns = _roundEvents.filter(function (e) { return e.level === "warn"; }).length;
    lines.push(
      `📊 ${errs > 0 ? `❌ ${errs} error(s)` : "✅ No errors"} · ` +
      `${warns > 0 ? `⚠️ ${warns} warning(s)` : "no warnings"} · ` +
      `total errors ${_totalErrors}/${CONFIG.errorThreshold}`
    );

    return lines.join("\n");
  }

  /**
   * Build the round summary, optionally capture a screenshot, and send
   * everything to Telegram as either a photo+caption or a text message.
   * Clears _roundEvents afterwards.
   */
  async function _sendRoundSummaryToTelegram(roundNum) {
    const tg = CONFIG.logging.telegram;
    if (!tg.enabled || !tg.summaryPerRound || !tg.botToken || !tg.chatId) return;
    if (_roundEvents.length === 0) return;

    const text = _formatRoundSummary(roundNum);

    if (tg.sendScreenshot) {
      const dataUrl = await _captureScreenshot();
      if (dataUrl) {
        await _sendTelegramPhoto(dataUrl, text);
        _roundEvents.length = 0;
        return;
      }
    }

    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ chat_id: tg.chatId, text: text.slice(0, 4096), parse_mode: "HTML" }),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(function () { return "(unreadable)"; });
        console.error("[SYSTEM] ❌ Telegram summary error:", resp.status, body);
      }
    } catch (err) {
      console.error("[SYSTEM] ❌ Telegram summary failed:", err);
    } finally {
      _roundEvents.length = 0;
    }
  }
  /**
   * Attempts to read the exposed game-state object.
   * Returns null when unavailable (graceful degradation).
   */
  /**
   * Walk a React fiber tree rooted at `node`, depth-first, up to `maxDepth`
   * levels, looking for an XState machine context that contains an inventory.
   * Returns the context object or null.
   */
  function _walkFiberForGameState(node, maxDepth) {
    if (!node || maxDepth <= 0) return null;
    try {
      // memoizedState is a linked list of hook states for function components.
      // XState's useMachine hook stores { machine, state, service } or the
      // machine context on one of the hook nodes.
      let hook = node.memoizedState;
      while (hook) {
        const val = hook.memoizedState;
        // XState service-like objects have a getSnapshot / state property
        if (val && typeof val === "object") {
          // Direct context with inventory
          const ctx = val.context || val.state?.context || val;
          if (ctx && typeof ctx === "object" && ctx.inventory &&
              typeof ctx.inventory === "object") {
            return ctx;
          }
          // XState service: { machine, state: { context } }
          if (val.state && val.state.context &&
              typeof val.state.context.inventory === "object") {
            return val.state.context;
          }
        }
        hook = hook.next;
      }
    } catch (_) {}

    // Recurse into children and siblings (breadth of recursion limited by maxDepth)
    try {
      const child  = _walkFiberForGameState(node.child,   maxDepth - 1);
      if (child) return child;
      const sib    = _walkFiberForGameState(node.sibling, maxDepth - 1);
      if (sib) return sib;
    } catch (_) {}
    return null;
  }

  /** Cache for the React fiber key prefix (avoids repeated key scanning). */
  let _fiberKeyPrefix = null;

  /**
   * Try to obtain the game state from the React fiber tree.
   * Sunflower Land uses XState + React; the machine context lives in a hook
   * node's memoizedState chain somewhere near the root component.
   */
  function _getGameStateFromFiber() {
    try {
      const root = document.getElementById("root") || document.body;
      // Discover the React internal key (e.g. "__reactFiber$abc123")
      if (!_fiberKeyPrefix) {
        _fiberKeyPrefix = Object.keys(root).find(function (k) {
          return k.startsWith("__reactFiber$") || k.startsWith("_reactFiber");
        }) || null;
      }
      if (!_fiberKeyPrefix) return null;
      const fiberNode = root[_fiberKeyPrefix];
      return _walkFiberForGameState(fiberNode, 40);
    } catch (_) { return null; }
  }

  /**
   * Try to obtain the game state from localStorage.
   * SFL persists portions of the state under keys that contain "sunflower",
   * "farm", or "game".  We look for an object with an `inventory` field.
   */
  function _getGameStateFromLocalStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const kl = key.toLowerCase();
        if (!kl.includes("sunflower") && !kl.includes("farm") &&
            !kl.includes("game") && !kl.includes("sfl")) continue;
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          // Accept if it has an inventory map at any common location
          const inv =
            obj?.state?.inventory ||
            obj?.context?.inventory ||
            obj?.inventory;
          if (inv && typeof inv === "object" && Object.keys(inv).length > 0) {
            return obj?.state || obj?.context || obj;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  function getGameState() {
    try {
      // Strategy 1 – well-known global shortcuts (set by some SFL forks / dev builds)
      if (window.__GAME_STATE__)     return window.__GAME_STATE__;
      if (window.__SFL_GAME_STATE__) return window.__SFL_GAME_STATE__;

      // Strategy 2 – XState inspector global (present in development mode)
      if (window.__xstate__ && window.__xstate__.services) {
        for (const svc of Object.values(window.__xstate__.services)) {
          const ctx = svc?.state?.context;
          if (ctx && (ctx.state || ctx.inventory)) return ctx;
        }
      }

      // Strategy 3 – React fiber walk (works in production SFL)
      const fromFiber = _getGameStateFromFiber();
      if (fromFiber) return fromFiber;

      // Strategy 4 – localStorage (SFL persists farm state)
      const fromLS = _getGameStateFromLocalStorage();
      if (fromLS) return fromLS;
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

  // ── Inventory cache ───────────────────────────────────────────────────────
  // Populated by _refreshInventoryCache(); valid for up to 60 seconds.
  let _inventoryCache = { data: {}, ts: 0 };
  const _INVENTORY_CACHE_TTL_MS = 60_000;

  /**
   * Scrape item names + quantities from whatever is currently visible in the
   * DOM (assumes the inventory panel is already open).
   *
   * SFL renders each item as a container with an <img alt="Item Name"> and a
   * nearby text node / <span> showing the numeric count.  We cast a wide net
   * of selectors and pick up every visible item we can identify.
   *
   * Returns a { name: count } map (may be empty if nothing is found).
   */
  function _scrapeOpenInventoryPanel() {
    const result = {};
    try {
      // Gather every element that could be an inventory slot/item.
      // We intentionally use broad selectors so this works across SFL updates.
      const candidates = Array.from(document.querySelectorAll(
        "[class*='inventory'] [class*='item'], " +
        "[class*='inventory'] [class*='slot'], " +
        "[class*='inventory'] [class*='card'], " +
        "[class*='chest']     [class*='item'], " +
        "[class*='chest']     [class*='slot'], " +
        "[class*='modal']     [class*='item'], " +
        "[class*='panel']     [class*='item'], " +
        "[class*='bag']       [class*='item'], " +
        "[class*='backpack']  [class*='item'], " +
        // Fallback: any element with an img[alt] that has a sibling number span
        "img[alt]"
      ));

      for (const el of candidates) {
        // For bare <img> hits, use the img itself as the anchor element
        const anchor = el.tagName === "IMG" ? el.parentElement || el : el;
        const rect   = anchor.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Item name: prefer img alt, then aria-label / title on the container
        const img  = el.tagName === "IMG" ? el : el.querySelector("img[alt]");
        const name = (
          img?.getAttribute("alt") ||
          anchor.getAttribute("aria-label") ||
          anchor.getAttribute("title") ||
          ""
        ).trim();
        if (!name || name.length < 2) continue;
        // Skip decorative / UI images (arrows, icons, etc.)
        if (/^(left|right|up|down|close|back|forward|arrow|icon|button|bg|background)$/i.test(name)) continue;

        // Quantity: the first visible text node that is purely numeric,
        // searching the anchor and its immediate children.
        let qty = 0;
        const textCandidates = [anchor, ...Array.from(anchor.querySelectorAll("span, p, div, strong, b"))];
        for (const tc of textCandidates) {
          // Only look at direct text (childNodes), not deep descendant text
          for (const node of Array.from(tc.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const txt = (node.textContent || "").trim();
            if (/^\d[\d,]*(\.\d+)?$/.test(txt)) {
              qty = parseFloat(txt.replace(/,/g, ""));
              break;
            }
          }
          if (qty > 0) break;
          // Also accept a span whose *only* text content is a number
          const txt = (tc.textContent || "").trim();
          if (/^\d[\d,]*(\.\d+)?$/.test(txt)) {
            qty = parseFloat(txt.replace(/,/g, ""));
            break;
          }
        }

        // If no explicit count found, assume 1 (item is present)
        if (qty === 0) qty = 1;

        // Accumulate (same item may appear in multiple visible containers)
        if (!result[name] || qty > result[name]) {
          result[name] = qty;
        }
      }
    } catch (_) {}
    return result;
  }

  /**
   * Find the inventory basket / backpack button in the HUD.
   *
   * SFL renders a pixel-art basket icon at the bottom of the screen.
   * We try several identification strategies in order.
   */
  function _findInventoryButton() {
    // Strategy 1 – accessible attributes
    const byAttr = document.querySelector(
      "[aria-label='Inventory'], [aria-label='inventory'], " +
      "[title='Inventory'],     [title='inventory'], " +
      "[aria-label='Basket'],   [aria-label='basket'], " +
      "[aria-label='Backpack'], [aria-label='backpack']"
    );
    if (byAttr && byAttr.getBoundingClientRect().width > 0) return byAttr;

    // Strategy 2 – img src contains inventory-related keyword
    const invImg = Array.from(document.querySelectorAll("img")).find(function (i) {
      const src = (i.getAttribute("src") || "").toLowerCase();
      return (
        src.includes("basket") ||
        src.includes("backpack") ||
        src.includes("inventory") ||
        src.includes("bag") ||
        src.includes("satchel")
      );
    });
    if (invImg) {
      // Walk up to find the clickable ancestor
      let el = invImg;
      for (let i = 0; i < 6 && el; i++) {
        if (
          el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.getAttribute("role") === "button" ||
          el.classList.contains("cursor-pointer")
        ) return el;
        el = el.parentElement;
      }
      return invImg.parentElement || invImg;
    }

    // Strategy 3 – text content containing "inventory" / "basket"
    return Array.from(document.querySelectorAll(
      "button, [role='button'], [class*='cursor-pointer'], nav *, [class*='hud'] *"
    )).find(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const t = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.textContent ||
        ""
      ).trim().toLowerCase();
      return t === "inventory" || t === "basket" || t === "backpack" ||
             t.includes("inventory") || t.includes("basket");
    }) || null;
  }

  /**
   * Open the inventory basket panel, scrape all item quantities from the DOM,
   * then close the panel.  Stores the result in _inventoryCache.
   *
   * Call this once at the start of any round that needs to check inventory
   * (crops, resources) so that subsequent synchronous getInventory() calls
   * return accurate data.
   *
   * Safe to call when the game state is already readable – it will use that
   * fast path and skip the panel open/close entirely.
   */
  async function _refreshInventoryCache() {
    // Fast path: game state is readable – no need to open the UI.
    try {
      const gs = getGameState();
      if (gs) {
        const inv = gs.state?.inventory || gs.inventory || {};
        if (Object.keys(inv).length > 0) {
          const result = {};
          for (const [k, v] of Object.entries(inv)) {
            result[k] = typeof v === "object" && v !== null
              ? (parseFloat(v.toString()) || 0)
              : (Number(v) || 0);
          }
          _inventoryCache = { data: result, ts: Date.now() };
          return;
        }
      }
    } catch (_) {}

    // Slow path: open the basket, scrape, close.
    try {
      const btn = _findInventoryButton();
      if (!btn) {
        console.warn("[SYSTEM] _refreshInventoryCache: inventory button not found.");
        return;
      }

      simulateClick(btn);
      // Wait for the panel to render (SFL panels animate in ~300-500 ms)
      await _sleepMs(800);

      const scraped = _scrapeOpenInventoryPanel();

      // Close the panel: try a close/X button first, then Escape
      const closeBtn = document.querySelector(
        "button[aria-label='Close'], button[aria-label='close'], " +
        "[class*='close'], [class*='modal-close'], [class*='panel-close']"
      );
      if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
        simulateClick(closeBtn);
      } else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", bubbles: true }));
      }
      await _sleepMs(400);

      if (Object.keys(scraped).length > 0) {
        _inventoryCache = { data: scraped, ts: Date.now() };
        console.info("[SYSTEM] _refreshInventoryCache: cached", Object.keys(scraped).length, "items –", Object.entries(scraped).map(function([k,v]){return k+":"+v;}).join(", "));
      } else {
        console.warn("[SYSTEM] _refreshInventoryCache: panel opened but no items scraped.");
      }
    } catch (err) {
      console.warn("[SYSTEM] _refreshInventoryCache error:", err);
    }
  }

  /**
   * Returns a map of { itemName: quantity } from the current inventory.
   *
   * Resolution order:
   *   1. In-memory cache (populated by _refreshInventoryCache, valid 60 s)
   *   2. Live game state object (fast, works when globals/fiber are accessible)
   *   3. Live DOM scrape (works only if inventory panel is already open)
   */
  function getInventory() {
    // ── Strategy 1: fresh cache ───────────────────────────────────────────────
    if (
      _inventoryCache.ts > 0 &&
      Date.now() - _inventoryCache.ts < _INVENTORY_CACHE_TTL_MS &&
      Object.keys(_inventoryCache.data).length > 0
    ) {
      return _inventoryCache.data;
    }

    // ── Strategy 2: live game state ───────────────────────────────────────────
    try {
      const gs = getGameState();
      if (gs) {
        const inv = gs.state?.inventory || gs.inventory || {};
        if (Object.keys(inv).length > 0) {
          const result = {};
          for (const [k, v] of Object.entries(inv)) {
            result[k] = typeof v === "object" && v !== null
              ? (parseFloat(v.toString()) || 0)
              : (Number(v) || 0);
          }
          return result;
        }
      }
    } catch (_) {}

    // ── Strategy 3: live DOM scrape (panel must already be open) ─────────────
    try {
      const scraped = _scrapeOpenInventoryPanel();
      if (Object.keys(scraped).length > 0) {
        console.warn("[SYSTEM] getInventory: using live DOM scrape. Items:", Object.keys(scraped).join(", "));
        return scraped;
      }
    } catch (_) {}

    // Nothing worked.
    console.warn("[SYSTEM] getInventory: could not read inventory from game state or DOM.");
    return {};
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
    return override || CONFIG.crops.fertiliserMode || "full";
  }

  /**
   * Finds the in-page seed selector button whose label contains the given seed name
   * (with the " Seed" suffix stripped so it matches display labels like "Sunflower").
   */
  function _findSeedButton(seedName) {
    const label = seedName.replace(/ Seed$/i, "");
    return Array.from(document.querySelectorAll("[class*='seed'], [class*='plant']"))
      .find(function (el) { return el.textContent && el.textContent.includes(label); }) || null;
  }

  /**
   * Attempt to open the shop and buy the given seed.
   * This is a best-effort click simulation; the actual shop DOM varies.
   */
  async function _buySeeds(seedName) {
    log("CROPS", "info", `Attempting to buy ${seedName} from shop…`);
    const shopBtn = _findShopButton("Market");
    if (!shopBtn) {
      log("CROPS", "warn", "Could not find shop button to buy seeds.");
      return false;
    }
    simulateClick(shopBtn);
    await randomDelay();

    const seedItem = _findShopItem(seedName);
    if (!seedItem) {
      log("CROPS", "warn", `${seedName} not found in shop.`);
      await _closeShopPanel();
      return false;
    }

    simulateClick(seedItem);
    await randomDelay();

    // Confirm buy
    const confirmBtn = document.querySelector(
      "button[class*='confirm'], button[class*='buy'], [aria-label*='Confirm'], [aria-label*='Buy']"
    );
    if (confirmBtn) {
      simulateClick(confirmBtn);
      await randomDelay();
      log("CROPS", "ok", `Bought ${seedName}.`);
      await _closeShopPanel();
      _inventoryCache = { data: {}, ts: 0 }; // invalidate so next check re-reads
      return true;
    }
    await _closeShopPanel();
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

    // Refresh the inventory cache once so all per-plot seed checks below
    // see the real counts rather than an empty object.
    await _refreshInventoryCache();

    let harvested = 0, planted = 0, fertilised = 0;

    for (const plot of plots) {
      if (stopped) return;

      // Dismiss any popup that appeared between or before this click.
      if (isGameDialogVisible()) await _dismissDialogs();
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
          const seed = _chooseSeed();

          // Step 1: Try to select the seed from the basket (equips it to cursor).
          const beforeSnap    = _snapshotPlot(plot);
          const foundInBasket = await _selectItemFromBasket(seed);

          if (foundInBasket) {
            // Seed was in basket – click the plot to plant.
            simulateClick(plot);
            await randomDelay();

            const afterSnap = _snapshotPlot(plot);
            if (afterSnap !== beforeSnap) {
              // Plot changed → successfully planted.
              planted++;
              log("CROPS", "ok", `Planted ${seed} (basket-select method).`);

              // ── Fertilise ───────────────────────────────────────────────
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
            } else {
              // Plot did not change → seed was not actually in inventory.
              log("CROPS", "warn", `Plot unchanged after clicking with ${seed} – need to buy more.`);
              if (CONFIG.crops.buyMissingSeeds) {
                const bought = await _buySeeds(seed);
                if (bought) {
                  // Retry planting after purchase.
                  await _selectItemFromBasket(seed);
                  simulateClick(plot);
                  await randomDelay();
                  const retrySnap = _snapshotPlot(plot);
                  if (retrySnap !== beforeSnap) {
                    planted++;
                    log("CROPS", "ok", `Planted ${seed} after buying more.`);
                  } else {
                    log("CROPS", "warn", `Plot still unchanged after buying ${seed} – skipping.`);
                  }
                } else {
                  log("CROPS", "warn", `Could not buy ${seed} – skipping plot.`);
                }
              }
            }
          } else {
            // Seed not found in basket – go buy it, then plant.
            log("CROPS", "info", `${seed} not in basket – attempting to buy from shop.`);
            let bought = false;
            if (CONFIG.crops.buyMissingSeeds) {
              bought = await _buySeeds(seed);
            }
            if (!bought && CONFIG.crops.restockIfMissingAndDiamonds) {
              const restocked = await _restockSeeds(seed);
              if (restocked) bought = await _buySeeds(seed);
            }
            if (!bought) {
              log("CROPS", "warn", `No ${seed} available – skipping plot.`);
              continue;
            }

            // Now select and plant.
            await _selectItemFromBasket(seed);
            simulateClick(plot);
            await randomDelay();
            const afterSnap = _snapshotPlot(plot);
            if (afterSnap !== beforeSnap) {
              planted++;
              log("CROPS", "ok", `Planted ${seed} (bought + basket-select).`);

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
            } else {
              log("CROPS", "warn", `Plot still unchanged after buying and selecting ${seed}.`);
            }
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
    const shopBtn = _findShopButton("Market");
    if (!shopBtn) {
      log("FLOWERS", "warn", "Could not find shop button.");
      return false;
    }
    simulateClick(shopBtn);
    await randomDelay();

    const seedItem = _findShopItem(seedName);
    if (!seedItem) {
      log("FLOWERS", "warn", `${seedName} not found in shop.`);
      await _closeShopPanel();
      return false;
    }
    simulateClick(seedItem);
    await randomDelay();

    const confirmBtn = document.querySelector(
      "button[class*='confirm'], button[class*='buy'], [aria-label*='Confirm'], [aria-label*='Buy']"
    );
    if (confirmBtn) {
      simulateClick(confirmBtn);
      await randomDelay();
      log("FLOWERS", "ok", `Bought ${seedName}.`);
      await _closeShopPanel();
      _inventoryCache = { data: {}, ts: 0 }; // invalidate so next check re-reads
      return true;
    }
    await _closeShopPanel();
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

    await _refreshInventoryCache();

    let harvested = 0, planted = 0;

    for (const bed of beds) {
      if (stopped) return;

      // Dismiss any popup that appeared between or before this click.
      if (isGameDialogVisible()) await _dismissDialogs();
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
            }
            continue;
          }

          simulateClick(bed);
          await randomDelay();

          const seedBtn = _findSeedButton(seed);
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
  // ─── FEATURE MODULE: FRUITS ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Build the list of img-src substrings to match for each configured fruit
   * type.  E.g. "Apple" → "/fruit/apple", "/fruits/apple".
   * Both singular (/fruit/) and plural (/fruits/) paths are tried.
   */
  function _fruitPatterns() {
    return (CONFIG.fruits.types || []).flatMap(function (name) {
      const lc = name.toLowerCase();
      return ["/fruit/" + lc, "/fruits/" + lc];
    });
  }

  /**
   * Returns all visible fruit tree / bush elements that are currently on the
   * page.  Each entry is the clickable ancestor of the matching <img>.
   */
  function _findFruitTrees() {
    const patterns = _fruitPatterns();
    if (patterns.length === 0) return [];

    const imgs = Array.from(document.querySelectorAll("img[src]")).filter(function (img) {
      const src = (img.src || "").toLowerCase();
      if (!patterns.some(function (p) { return src.includes(p); })) return false;
      const rect = img.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    // Walk up to the clickable ancestor (React onClick target).
    return imgs.map(function (img) {
      let el = img.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        if (
          el.getAttribute("role") === "button" ||
          el.classList.contains("cursor-pointer")
        ) return el;
        el = el.parentElement;
      }
      return img.parentElement || img;
    }).filter(Boolean);
  }

  /** True when the fruit image suggests it is ready to harvest. */
  function _isFruitReady(el) {
    const img = el.querySelector ? el.querySelector("img[src]") : el;
    if (!img) return false;
    const src = (img.src || "").toLowerCase();
    return (
      src.includes("ready")   ||
      src.includes("harvest") ||
      src.includes("ripe")    ||
      src.includes("full")
    );
  }

  /** True when the fruit slot appears to be empty / waiting for a seed. */
  function _isFruitEmpty(el) {
    const img = el.querySelector ? el.querySelector("img[src]") : el;
    if (!img) return true;
    const src = (img.src || "").toLowerCase();
    return (
      src.includes("empty") ||
      src.includes("soil")  ||
      src.includes("bare")  ||
      // If none of the known fruit patterns are in the src, assume empty
      !_fruitPatterns().some(function (p) { return src.includes(p); })
    );
  }

  /**
   * Attempt to plant a fruit seed in an empty slot.
   * Strategy: click the slot, then look for a seed/plant button matching
   * one of the configured fruit type names.
   * Returns true when a seed button was found and clicked.
   */
  async function _plantFruit(slotEl) {
    simulateClick(slotEl);
    await randomDelay();

    const types = CONFIG.fruits.types || [];
    for (const typeName of types) {
      const lc = typeName.toLowerCase();
      const btn = Array.from(document.querySelectorAll(
        "button, [role='button'], [class*='seed'], [class*='plant'], [class*='sapling']"
      )).find(function (el) {
        const t = (el.textContent || el.getAttribute("aria-label") || "").toLowerCase();
        return t.includes(lc);
      });
      if (btn && btn.getBoundingClientRect().width > 0) {
        simulateClick(btn);
        await randomDelay();
        return typeName;
      }
    }
    return null; // no seed button found
  }

  /**
   * Harvest all ready fruit, then plant empty slots according to CONFIG.fruits.
   * Applies fertiliser immediately after planting when useFertiliser is true
   * and fertiliserMode is "full".
   */
  async function runFruitsRound() {
    if (isCaptchaVisible()) {
      log("FRUITS", "warn", "Captcha detected – skipping fruits round.");
      return;
    }

    const trees = _findFruitTrees();
    if (trees.length === 0) {
      log("FRUITS", "info", "No fruit trees / bushes found on this page.");
      return;
    }

    log("FRUITS", "info", `Starting fruits round – found ${trees.length} slot(s).`);

    let harvested = 0, planted = 0, fertilised = 0;

    for (const tree of trees) {
      if (stopped) return;

      if (isGameDialogVisible()) await _dismissDialogs();
      if (stopped) return;

      try {
        // ── Harvest ──────────────────────────────────────────────────────────
        if (_isFruitReady(tree)) {
          simulateClick(tree);
          await randomDelay();
          harvested++;
          log("FRUITS", "ok", "Harvested a fruit.");
        }

        if (stopped) return;

        // ── Plant ────────────────────────────────────────────────────────────
        if (_isFruitEmpty(tree)) {
          const plantedType = await _plantFruit(tree);
          if (plantedType) {
            planted++;
            log("FRUITS", "ok", `Planted ${plantedType}.`);

            // ── Fertilise ────────────────────────────────────────────────────
            if (CONFIG.fruits.useFertiliser && CONFIG.fruits.fertiliserMode === "full") {
              const fertBtn = document.querySelector(
                "[aria-label*='Fertilise'], [aria-label*='fertilise'], " +
                "[class*='fertilise'], [class*='fertilizer']"
              );
              if (fertBtn && fertBtn.getBoundingClientRect().width > 0) {
                simulateClick(fertBtn);
                await randomDelay();
                fertilised++;
                log("FRUITS", "ok", `Fertilised fruit slot (${plantedType}).`);
              }
            }
          } else {
            log("FRUITS", "info", "Empty fruit slot – no matching seed button found.");
          }
        }
      } catch (err) {
        recordError("FRUITS", `Fruit action failed: ${err.message || err}`);
      }
    }

    log("FRUITS", "info",
      `Round done – harvested: ${harvested}, planted: ${planted}, fertilised: ${fertilised}.`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── FEATURE MODULE: PET ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Find the pet element on the farm.
   * Returns the clickable ancestor of the first pet <img> found, or null.
   */
  function _findPetElement() {
    const candidates = Array.from(document.querySelectorAll("img[src]")).filter(function (img) {
      const src = (img.src || "").toLowerCase();
      const rect = img.getBoundingClientRect();
      return (
        rect.width > 0 && rect.height > 0 &&
        (src.includes("/pet/") || src.includes("/pets/") ||
         src.includes("_pet.") || src.includes("cat.") || src.includes("dog."))
      );
    });
    if (candidates.length === 0) return null;
    const img = candidates[0];
    let el = img.parentElement;
    for (let i = 0; i < 6 && el; i++) {
      if (el.getAttribute("role") === "button" || el.classList.contains("cursor-pointer")) return el;
      el = el.parentElement;
    }
    return img.parentElement || img;
  }

  /**
   * Returns true when the pet's current image src matches a sleeping pattern.
   * Also checks aria-label / title attributes as fallbacks.
   */
  function _isPetSleeping(petEl) {
    if (!petEl) return false;
    const img = petEl.querySelector ? petEl.querySelector("img[src]") : petEl;
    if (!img) return false;
    const src   = (img.src || "").toLowerCase();
    const label = (
      (petEl.getAttribute && petEl.getAttribute("aria-label")) ||
      (petEl.title) || ""
    ).toLowerCase();
    const patterns = CONFIG.pet.sleepPatterns || [];
    return patterns.some(function (p) {
      return src.includes(p.toLowerCase()) || label.includes(p.toLowerCase());
    });
  }

  /**
   * Wake the sleeping pet by clicking it, then wait for the animation
   * to resolve.  Sends a Telegram notification if configured.
   */
  async function runPetRound() {
    if (isCaptchaVisible()) {
      log("PET", "warn", "Captcha detected – skipping pet round.");
      return;
    }

    const petEl = _findPetElement();
    if (!petEl) {
      log("PET", "info", "No pet found on this page.");
      return;
    }

    if (_isPetSleeping(petEl)) {
      log("PET", "info", "Pet is sleeping – waking it up…");
      simulateClick(petEl);
      await randomDelay();

      // Dismiss any reward/animation dialog that may appear after waking.
      if (isGameDialogVisible()) await _dismissDialogs();

      log("PET", "ok", "Pet woken up.");
      if (CONFIG.pet.notifyOnWake && CONFIG.logging.telegram.enabled) {
        await sendTelegramImmediate("🐾 Pet was sleeping – woke it up.");
      }
    } else {
      log("PET", "info", "Pet is awake – nothing to do.");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── FEATURE MODULE: HONEY ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Find all beehive elements on the farm that appear ready to collect.
   *
   * Detection strategy (two passes):
   *   1. Look for imgs whose src matches one of CONFIG.honey.fullPatterns
   *      (specific "full/ready" sprite).
   *   2. If CONFIG.honey.collectIfAnyBeehive is true, also include any
   *      beehive img not already matched — the game may not change the sprite
   *      name but the honey bar tooltip/title will say "full".
   *
   * Returns an array of clickable ancestor elements.
   */
  function _findFullBeehives() {
    const fullPatterns = CONFIG.honey.fullPatterns || [];

    // Helper to walk up to clickable ancestor
    function _beehiveClickable(img) {
      let el = img.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        if (el.getAttribute("role") === "button" || el.classList.contains("cursor-pointer")) return el;
        el = el.parentElement;
      }
      return img.parentElement || img;
    }

    const all = Array.from(document.querySelectorAll("img[src]")).filter(function (img) {
      const src  = (img.src || "").toLowerCase();
      const rect = img.getBoundingClientRect();
      return (
        rect.width > 0 && rect.height > 0 &&
        (src.includes("beehive") || src.includes("bee_hive") || src.includes("honey_hive"))
      );
    });

    // Pass 1: confirmed "full" sprites
    const fullImgs = all.filter(function (img) {
      const src = (img.src || "").toLowerCase();
      return fullPatterns.some(function (p) { return src.includes(p.toLowerCase()); });
    });

    // Pass 2: fallback – any beehive if configured
    const fallbackImgs = CONFIG.honey.collectIfAnyBeehive
      ? all.filter(function (img) {
          return !fullImgs.includes(img);
        })
      : [];

    return [...fullImgs, ...fallbackImgs].map(_beehiveClickable).filter(Boolean);
  }

  /**
   * Collect all ready beehives.
   *
   * A beeswarm dialogue may appear after clicking — this is already handled
   * by `_dismissDialogs()` because the existing selector `[class*='swarm']`
   * matches it.  No special-case code is needed here.
   */
  async function runHoneyRound() {
    if (isCaptchaVisible()) {
      log("HONEY", "warn", "Captcha detected – skipping honey round.");
      return;
    }

    const hives = _findFullBeehives();
    if (hives.length === 0) {
      log("HONEY", "info", "No full beehives found.");
      return;
    }

    log("HONEY", "info", `Found ${hives.length} beehive(s) ready to collect.`);
    let collected = 0;

    for (const hive of hives) {
      if (stopped) return;

      if (isGameDialogVisible()) await _dismissDialogs();
      if (stopped) return;

      try {
        simulateClick(hive);
        await randomDelay();
        collected++;
        log("HONEY", "ok", "Clicked beehive to collect honey.");

        // Beeswarm / any post-click dialog is dismissed here.
        // The existing _dismissDialogs() already handles [class*='swarm'] and
        // "Collect" / "Continue" buttons, so this covers the beeswarm overlay.
        if (isGameDialogVisible()) await _dismissDialogs();
      } catch (err) {
        recordError("HONEY", `Beehive action failed: ${err.message || err}`);
      }
    }

    log("HONEY", "info", `Honey round done – collected from ${collected} hive(s).`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── FEATURE MODULE: ANIMALS (play) ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * ─── Why we do NOT open the barn/coop ────────────────────────────────────
   *
   * Opening a building to check every animal is slow, makes the bot highly
   * visible, and triggers game dialog state unnecessarily.
   *
   * Instead we detect the floating play-request indicators that the game
   * renders ABOVE barn / coop buildings on the main farm view.  In SFL these
   * are typically small heart / star / speech-bubble sprites that appear as
   * <img> elements at absolute positions near the building's bounding box.
   * No barn click is required — the badge is visible directly on the farm DOM.
   *
   * If the game updates its asset paths the patterns in
   * CONFIG.animals.playIndicatorPatterns can be extended without code changes.
   */

  /**
   * Returns all visible "play request" indicator elements currently rendered
   * on the farm for any animal building.
   */
  function _findAnimalPlayIndicators() {
    const patterns = CONFIG.animals.playIndicatorPatterns || [];
    if (patterns.length === 0) return [];

    return Array.from(document.querySelectorAll("img[src]")).filter(function (img) {
      const src  = (img.src || "").toLowerCase();
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return patterns.some(function (p) { return src.includes(p.toLowerCase()); });
    }).map(function (img) {
      // Walk up to the clickable ancestor for the indicator.
      let el = img.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        if (el.getAttribute("role") === "button" || el.classList.contains("cursor-pointer")) return el;
        el = el.parentElement;
      }
      return img.parentElement || img;
    }).filter(Boolean);
  }

  /**
   * Returns true if the player has at least one toy in their inventory.
   * Falls back to true when the inventory is unavailable (best-effort click).
   */
  function _hasToys() {
    const inv   = getInventory();
    const toys  = CONFIG.animals.toyItems || [];
    if (Object.keys(inv).length === 0) return true; // inventory not available – try anyway
    return toys.some(function (t) { return (inv[t] || 0) >= 1; });
  }

  /**
   * After clicking a play indicator the game typically opens a small "play"
   * dialog or action panel.  Try to find and click the toy/play action button.
   * Returns true when a button was clicked.
   */
  async function _clickToyButton() {
    await _sleepMs(500); // brief wait for panel to appear
    const toyKeywords = ["play", "toy", "throw", "give"];
    const btns = Array.from(document.querySelectorAll(
      "button, [role='button'], [class*='btn'], [class*='action']"
    )).filter(function (el) {
      const t    = (el.textContent || el.getAttribute("aria-label") || "").toLowerCase();
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && toyKeywords.some(function (kw) { return t.includes(kw); });
    });
    if (btns.length > 0) {
      simulateClick(btns[0]);
      await randomDelay();
      return true;
    }
    return false;
  }

  /**
   * Use toys on all animals that are currently showing a play-request badge.
   * No building is opened — the check is entirely based on the floating
   * indicator images visible on the farm.
   */
  async function runAnimalsRound() {
    if (isCaptchaVisible()) {
      log("ANIMALS", "warn", "Captcha detected – skipping animals round.");
      return;
    }

    const indicators = _findAnimalPlayIndicators();
    if (indicators.length === 0) {
      log("ANIMALS", "info", "No animals requesting play found.");
      return;
    }

    if (!_hasToys()) {
      log("ANIMALS", "warn", "Animals want to play but no toys in inventory – skipping.");
      return;
    }

    log("ANIMALS", "info", `Found ${indicators.length} animal(s) wanting to play.`);
    let played = 0;

    for (const indicator of indicators) {
      if (stopped) return;

      if (isGameDialogVisible()) await _dismissDialogs();
      if (stopped) return;

      try {
        simulateClick(indicator);
        await randomDelay();

        // Try to click the toy/play action that appears after the indicator click.
        const didPlay = await _clickToyButton();
        if (didPlay) {
          played++;
          log("ANIMALS", "ok", "Used toy on animal.");
        } else {
          // Dismiss any popup that opened (e.g. info panel without a play button).
          if (isGameDialogVisible()) await _dismissDialogs();
        }
      } catch (err) {
        recordError("ANIMALS", `Animal play action failed: ${err.message || err}`);
      }
    }

    log("ANIMALS", "info", `Animals round done – played with ${played} animal(s).`);
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
      // Exclude strike / drop animation sprite sheets – these match
      // imgPattern but their DOM depth differs, causing wrong click targets.
      extraExclude:   "_spark",
      extraExclude2:  "_drop",
      hits:           3,
      recoveryMs:     4 * 60 * 60 * 1000,  // 4 hours
      domWalkUp:      3,
    },
    iron: {
      imgPattern:     "/resources/iron",
      excludePattern: "depleted",
      extraExclude:   "_spark",
      extraExclude2:  "_drop",
      hits:           3,
      recoveryMs:     8 * 60 * 60 * 1000,  // 8 hours
      domWalkUp:      3,
    },
    gold: {
      imgPattern:     "/resources/gold",
      excludePattern: "depleted",
      extraExclude:   "_spark",
      extraExclude2:  "_drop",
      hits:           3,
      recoveryMs:     8 * 60 * 60 * 1000,
      domWalkUp:      3,
    },
    crimstone: {
      imgPattern:     "/resources/crimstone",
      excludePattern: "depleted",
      extraExclude:   "_spark",
      extraExclude2:  "_drop",
      hits:           5,
      recoveryMs:     24 * 60 * 60 * 1000, // 24 hours
      domWalkUp:      3,
    },
    sunstone: {
      imgPattern:     "/resources/sunstone",
      excludePattern: "depleted",
      extraExclude:   "_spark",
      extraExclude2:  "_drop",
      hits:           5,
      recoveryMs:     24 * 60 * 60 * 1000,
      domWalkUp:      3,
    },
    obsidian: {
      imgPattern:     "/resources/obsidian",
      excludePattern: "depleted",
      extraExclude:   "_spark",
      extraExclude2:  "_drop",
      hits:           5,
      recoveryMs:     24 * 60 * 60 * 1000,
      domWalkUp:      3,
    },
  };

  /**
   * Walk up from `el` and return the first ancestor (or `el` itself) that
   * carries the CSS class "cursor-pointer".  This is the element React has
   * attached its onClick handler to.  If none is found within 8 levels the
   * original element is returned as a fallback.
   */
  function findClickableAncestor(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      if (node.classList && node.classList.contains("cursor-pointer")) {
        return node;
      }
      node = node.parentElement;
      depth++;
    }
    return el; // fallback: dispatch on the img itself
  }

  /**
   * Returns the list of <img> elements for non-depleted, visible resources of
   * `type`.  Detection uses the reliable img src pattern (unchanged from the
   * original implementation that correctly counted resources).
   * Clicking is done by walking up from the img to find the nearest
   * cursor-pointer ancestor — the element React actually listens on.
   */
  function findAvailableResources(type) {
    const def = RESOURCE_DEFS[type];
    if (!def) return [];

    return Array.from(
      document.querySelectorAll(`img[src*='${def.imgPattern}']`)
    ).filter(function (img) {
      try {
        const src = img.src || "";
        if (def.excludePattern  && src.includes(def.excludePattern))  return false;
        if (def.extraExclude    && src.includes(def.extraExclude))    return false;
        if (def.extraExclude2   && src.includes(def.extraExclude2))   return false;
        if (def.imgRegex        && !def.imgRegex.test(new URL(src).pathname)) return false;
        // Must have a non-zero bounding box (i.e. be visible in the viewport)
        const rect = img.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return true;
      } catch (_) { return false; }
    });
  }

  /**
   * CSP-safe setTimeout sleep used exclusively inside harvestResource.
   * The global sleep() uses a Web Worker (blob: URL) that some game CSPs
   * silently block — making those Promises never resolve and stalling the
   * hit loop after the first click.  Plain setTimeout is never CSP-blocked.
   */
  function _sleepMs(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // ── Shop navigation helpers ───────────────────────────────────────────────

  /**
   * Find the HUD / map button that opens `shopType` ("Market", "Blacksmith",
   * "Shop", etc.).  Three strategies are tried in order:
   *
   * 1. aria-label or title attribute containing the keyword (fast, exact).
   * 2. Text-content scan of every visible clickable element.
   * 3. Walk up from the first <img> whose src path contains the keyword –
   *    most SFL HUD icons are rendered as PNG/WebP sprites without labels.
   *
   * Returns the clickable element, or null when nothing is found.
   */
  function _findShopButton(shopType) {
    const kw = shopType.toLowerCase();

    // Strategy 1 – attribute matching
    const byAttr = document.querySelector(
      `[aria-label*='${shopType}'], [title*='${shopType}'], ` +
      `[aria-label*='${kw}'],     [title*='${kw}']`
    );
    if (byAttr) return byAttr;

    // Strategy 2 – text content scan (covers labelled nav items)
    const byText = Array.from(document.querySelectorAll(
      "button, [role='button'], a, [class*='cursor-pointer'], nav *, [class*='hud'] *"
    )).find(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const t = (
        el.textContent             ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title")   ||
        ""
      ).trim().toLowerCase();
      return t === kw || t.includes(kw);
    });
    if (byText) return byText;

    // Strategy 3 – img src pattern (SFL renders buildings as sprite images)
    const img = Array.from(document.querySelectorAll("img")).find(function (i) {
      const src = (i.src || "").toLowerCase();
      return src.includes(kw);
    });
    if (img) {
      let el = img;
      for (let i = 0; i < 6 && el; i++) {
        if (
          el.tagName === "BUTTON" ||
          el.tagName === "A"      ||
          el.getAttribute("role") === "button" ||
          el.classList.contains("cursor-pointer")
        ) return el;
        el = el.parentElement;
      }
      return img.parentElement || null;
    }

    return null;
  }

  /**
   * After a shop panel has been opened (via simulateClick on shopBtn),
   * find the item entry whose text includes `itemName`.
   * Searches all visible elements – not limited to a specific class subtree –
   * because SFL's shop panel class names don't reliably contain "shop".
   */
  function _findShopItem(itemName) {
    const label  = itemName.toLowerCase();
    const label2 = itemName.replace(/ Seed$/i, "").toLowerCase(); // e.g. "Sunflower"
    return Array.from(document.querySelectorAll(
      "button, [role='button'], [class*='item'], [class*='slot'], [class*='card'], " +
      "[class*='entry'], [class*='row'], li, td, [class*='product']"
    )).find(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const t = (el.textContent || "").trim().toLowerCase();
      return t.includes(label) || t.includes(label2);
    }) || null;
  }

  // ── Tool buying helpers ───────────────────────────────────────────────────

  /**
   * Close any currently open shop / purchase panel.
   *
   * SFL shop panels typically have a close / X button OR can be dismissed with
   * the Escape key.  This helper tries both strategies so the panel does not
   * persist as a false-positive `isGameDialogVisible()` hit after a buy.
   *
   * Called at the end of every _buySeeds / _buyFlowerSeeds / _buyTool function
   * regardless of whether the purchase succeeded.
   */
  async function _closeShopPanel() {
    // Strategy 1 – click a visible close / X button.
    const closeSelectors =
      "button[aria-label='Close'], button[aria-label='close'], " +
      "[class*='close-btn'], [class*='modal-close'], [class*='dialog-close'], " +
      "[class*='panel-close'], [class*='shop-close']";
    const closeBtn = document.querySelector(closeSelectors);
    if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
      simulateClick(closeBtn);
      await _sleepMs(300);
      return;
    }

    // Strategy 2 – dispatch Escape on the document (closes most modal panels).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", bubbles: true }));
    await _sleepMs(300);
  }


  // ── Tool-availability helpers (click-first approach) ─────────────────────

  /**
   * After probing a resource by clicking it, check whether the game rendered
   * a "no tool" notification / toast.
   *
   * SFL shows a red/orange toast like:
   *   • "Craft 1 Pickaxe"  /  "You need a Pickaxe"
   *   • "Equip an Axe"
   * We look for any visible element whose text contains the tool name OR
   * common SFL error phrases, appearing within 900 ms of the probe click.
   *
   * Returns true when a "no tool" signal is detected.
   */
  function _detectNoToolNotification(toolName) {
    const lower = toolName.toLowerCase();
    // Broad selectors that typically carry toast / alert content in SFL.
    const candidates = Array.from(document.querySelectorAll(
      "[class*='toast'], [class*='notification'], [class*='alert'], " +
      "[class*='snack'], [class*='message'], [class*='error'], " +
      "[class*='popup'], [class*='modal'] p, [class*='dialog'] p, " +
      "[role='alert'], [role='status']"
    ));
    return candidates.some(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const txt = (el.textContent || "").toLowerCase();
      return (
        txt.includes(lower) ||
        txt.includes("craft") ||
        txt.includes("equip") ||
        txt.includes("need") ||
        txt.includes("missing") ||
        txt.includes("no tool")
      );
    });
  }

  /**
   * Check whether a health bar (resource HP indicator) is visible near or
   * inside the element that was just clicked.
   *
   * SFL renders health bars as a small bar with a background-color or a
   * progress element.  We search the clicked element and its nearby siblings /
   * ancestors up to 4 levels for any such element.
   */
  function _hasHealthBar(el) {
    // Walk up to the nearest scroll ancestor and search descendants.
    let root = el;
    for (let i = 0; i < 4 && root && root !== document.body; i++) {
      root = root.parentElement;
    }
    if (!root) return false;
    const hpEl = Array.from(root.querySelectorAll(
      "[class*='health'], [class*='hp'], [class*='progress'], " +
      "progress, [class*='bar'], [class*='life'], [class*='hitpoint']"
    )).find(function (e) {
      const rect = e.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.height < 20; // narrow bar
    });
    return !!hpEl;
  }

  /**
   * Open the basket, find the item matching `itemName` in the panel, click it
   * (selecting/equipping it), then close the panel.
   *
   * Returns true if the item was found and clicked; false otherwise.
   * This is used both for seeds (equip before planting) and as a secondary
   * way to confirm the item is in the inventory.
   */
  async function _selectItemFromBasket(itemName) {
    const btn = _findInventoryButton();
    if (!btn) {
      console.warn("[SYSTEM] _selectItemFromBasket: basket button not found.");
      return false;
    }

    simulateClick(btn);
    await _sleepMs(800);

    // Find the item in the open panel.
    const label  = itemName.toLowerCase();
    const label2 = itemName.replace(/ Seed$/i, "").toLowerCase();

    const itemEl = Array.from(document.querySelectorAll(
      "[class*='inventory'] [class*='item'], [class*='inventory'] [class*='slot'], " +
      "[class*='chest'] [class*='item'], [class*='modal'] [class*='item'], " +
      "[class*='panel'] [class*='slot'], img[alt]"
    )).find(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const img  = el.tagName === "IMG" ? el : el.querySelector("img[alt]");
      const name = (
        img?.getAttribute("alt") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.textContent ||
        ""
      ).trim().toLowerCase();
      return name === label || name.includes(label) || name.includes(label2);
    });

    if (!itemEl) {
      log("SYSTEM", "warn", `_selectItemFromBasket: "${itemName}" not found in basket.`);
      // Close the basket anyway.
      const closeBtn = document.querySelector(
        "button[aria-label='Close'], button[aria-label='close'], [class*='close'], [class*='modal-close']"
      );
      if (closeBtn && closeBtn.getBoundingClientRect().width > 0) simulateClick(closeBtn);
      else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", bubbles: true }));
      }
      await _sleepMs(400);
      return false;
    }

    simulateClick(itemEl);
    await _sleepMs(400);

    // Close panel
    const closeBtn = document.querySelector(
      "button[aria-label='Close'], button[aria-label='close'], [class*='close'], [class*='modal-close']"
    );
    if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
      simulateClick(closeBtn);
    } else {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", bubbles: true }));
    }
    await _sleepMs(400);
    return true;
  }

  /**
   * Take a lightweight snapshot of a plot's visual state so we can detect
   * whether it changed after a planting attempt.
   * We capture the src attributes of all <img> children.
   */
  function _snapshotPlot(plot) {
    return Array.from(plot.querySelectorAll("img[src]")).map(function (i) {
      return i.getAttribute("src") || "";
    }).join("|");
  }

  async function _buyTool(toolName, shopType, qty) {
    log("RESOURCES", "info", `Buying ${qty}× ${toolName} from ${shopType}…`);

    // Try to open the correct shop panel.
    const shopBtn = _findShopButton(shopType);
    if (!shopBtn) {
      log("RESOURCES", "warn", `Cannot find ${shopType} button in the HUD.`);
      return false;
    }
    simulateClick(shopBtn);
    await randomDelay();

    // Find the tool item inside the shop panel.
    const toolItem = _findShopItem(toolName);
    if (!toolItem) {
      log("RESOURCES", "warn", `${toolName} not found in ${shopType} panel.`);
      await _closeShopPanel();
      return false;
    }
    simulateClick(toolItem);
    await randomDelay();

    // SFL's purchase panel shows "Buy 1" and "Buy 10" buttons.
    // Calculate how many clicks of each we need to reach `qty`.
    // Fall back to the old "+" increment button when neither is found.
    const allBtns = Array.from(document.querySelectorAll(
      "button, [role='button'], [class*='btn']"
    )).filter(function (el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    function _findBuyQtyBtn(labelFragment) {
      return allBtns.find(function (el) {
        const t = (el.textContent || el.getAttribute("aria-label") || "").trim().toLowerCase();
        return t === labelFragment || t.includes(labelFragment);
      }) || null;
    }

    const buy10Btn = _findBuyQtyBtn("buy 10") || _findBuyQtyBtn("10");
    const buy1Btn  = _findBuyQtyBtn("buy 1")  || _findBuyQtyBtn("×1") || _findBuyQtyBtn("x1");

    if (buy10Btn || buy1Btn) {
      // Use discrete Buy-10 / Buy-1 buttons.
      const tens = Math.floor(qty / 10);
      const ones = qty % 10;
      for (let i = 0; i < tens; i++) {
        simulateClick(buy10Btn);
        await _sleepMs(200);
      }
      for (let i = 0; i < ones; i++) {
        simulateClick(buy1Btn || buy10Btn); // buy1Btn fallback to buy10 if only that exists
        await _sleepMs(200);
      }
      log("RESOURCES", "info",
        `Set quantity to ${qty} (${tens}×Buy10 + ${ones}×Buy1) for ${toolName}.`);
    } else if (qty > 1) {
      // Legacy: use the "+" increment button.
      const plusBtn = document.querySelector(
        "[aria-label*='increase'], [aria-label*='plus'], " +
        "button[class*='plus'], button[class*='increment']"
      );
      if (plusBtn) {
        for (let i = 1; i < qty; i++) {
          simulateClick(plusBtn);
          await _sleepMs(150);
        }
      }
    }

    // Confirm the purchase.
    const confirmBtn = document.querySelector(
      "button[class*='confirm'], button[class*='buy'], [aria-label*='Buy'], [aria-label*='Confirm']"
    );
    if (!confirmBtn) {
      log("RESOURCES", "warn", `Could not find confirm button when buying ${toolName}.`);
      await _closeShopPanel();
      return false;
    }
    simulateClick(confirmBtn);
    await randomDelay();
    log("RESOURCES", "ok", `Bought ${qty}× ${toolName} from ${shopType}.`);
    // Close the shop panel so it doesn't trigger isGameDialogVisible() falsely.
    await _closeShopPanel();
    return true;
  }

  /**
   * CLICK-FIRST tool check for a single resource node.
   *
   * Clicks `clickTarget` once (the probe hit), waits for the game to react,
   * then examines the DOM:
   *   • If a "no tool" notification is visible → attempt to buy the tool.
   *   • If a health bar appeared (or no negative signal at all) → tool is present.
   *
   * Returns:
   *   "ok"     – tool present (health bar appeared or no negative signal)
   *   "bought" – tool was missing but successfully purchased; caller should retry
   *   "failed" – tool missing and purchase failed
   */
  async function _probeResourceAndEnsureTool(type, clickTarget, x, y) {
    const toolCfg = CONFIG.resources.tools[type];
    if (!toolCfg || !toolCfg.enabled) return "ok";

    simulateClickAt(x, y);
    await _sleepMs(700); // wait for game feedback to render

    // Health bar appeared → we have the tool, this hit counted.
    if (_hasHealthBar(clickTarget)) return "ok";

    // No-tool notification → need to buy.
    if (_detectNoToolNotification(toolCfg.tool)) {
      log("RESOURCES", "info",
        `[${type}] No-tool notification detected after probe – attempting buy of ${toolCfg.tool}.`);
      const qty    = randInt(toolCfg.buyMin, toolCfg.buyMax);
      const bought = await _buyTool(toolCfg.tool, toolCfg.shop, qty);
      if (!bought) {
        const msg =
          `❌ [${type}] Cannot harvest: no ${toolCfg.tool} – purchase from ${toolCfg.shop} failed.`;
        log("RESOURCES", "warn", msg);
        await sendTelegramImmediate(msg);
        return "failed";
      }
      _inventoryCache = { data: {}, ts: 0 };
      return "bought"; // caller should do real first hit
    }

    // No health bar, no notification → ambiguous; treat as ok (tool probably present,
    // game just didn't render a health bar for this resource type).
    return "ok";
  }

  /**
   * Depletes all available resources of `type` with random delays.
   * Detection uses img src patterns (reliable count).
   * For each img:
   *   1. Walk up to the nearest cursor-pointer ancestor (React onClick target).
   *   2. Sleep 600–1200 ms before EACH hit (matches mini-snippet timing; lets
   *      any pending React state / CSS animation settle before the click).
   *   3. Dispatch a MouseEvent directly on the cursor-pointer ancestor.
   * Click coordinates are reported to Telegram immediately after each depletion.
   * Returns the count of resources fully depleted.
   */
  async function harvestResource(type, round) {
    const def  = RESOURCE_DEFS[type];
    const imgs = findAvailableResources(type);
    if (imgs.length === 0) return 0;

    log("RESOURCES", "info", `[${type}] Found ${imgs.length} available.`);

    // Tracks whether we already confirmed the tool is present (after first
    // successful probe or after a successful buy).
    let toolConfirmed = false;

    let count = 0;
    for (let i = 0; i < imgs.length; i++) {
      if (stopped) break;
      if (isCaptchaVisible()) {
        log("RESOURCES", "warn", `[${type}] Captcha detected – pausing.`);
        break;
      }

      const img = imgs[i];
      // Walk up from the <img> to find the element React's onClick lives on.
      const clickTarget = findClickableAncestor(img);
      log("RESOURCES", "info",
        `[${type}] ${i + 1}/${imgs.length} – depleting…` +
        ` (target: <${clickTarget.tagName.toLowerCase()}> "${clickTarget.className.slice(0, 60)}")`);

      try {
        const hitCoords = [];

        // ── Hit loop ───────────────────────────────────────────────────────
        for (let hit = 0; hit < def.hits; hit++) {
          if (stopped) break;

          // Check for a dialog that appeared mid-harvest and dismiss it.
          if (isGameDialogVisible()) {
            log("RESOURCES", "info", `[${type}] Dialog during harvest – dismissing…`);
            await _dismissDialogs();
            if (isGameDialogVisible()) {
              log("RESOURCES", "warn", `[${type}] Could not dismiss dialog – stopping this resource.`);
              break;
            }
          }

          const preDelay = hit === 0 ? 0 : randInt(CONFIG.resources.hitDelayMs.min, CONFIG.resources.hitDelayMs.max);
          if (preDelay > 0) await _sleepMs(preDelay);

          const rect = clickTarget.getBoundingClientRect();
          const cx   = rect.left + rect.width  / 2;
          const cy   = rect.top  + rect.height / 2;
          const cap  = CONFIG.delay.coordNoisePixels;
          const nx   = (Math.random() * 2 - 1) * cap;
          const ny   = (Math.random() * 2 - 1) * cap;
          const x    = cx + nx;
          const y    = cy + ny;

          if (hit === 0 && !toolConfirmed) {
            // ── PROBE HIT: click and check game feedback ───────────────────
            const probeResult = await _probeResourceAndEnsureTool(type, clickTarget, x, y);

            if (probeResult === "failed") {
              // No tool and purchase failed – skip the rest of all resources.
              log("RESOURCES", "info", `[${type}] Skipping – no tool available.`);
              return count;
            }
            if (probeResult === "bought") {
              // Just bought the tool; the probe click didn't count as a hit.
              // Do the real first hit now.
              await _sleepMs(randInt(CONFIG.resources.hitDelayMs.min, CONFIG.resources.hitDelayMs.max));
              simulateClickAt(x, y);
              toolConfirmed = true;
            } else {
              // "ok" – probe click counted as the first hit.
              toolConfirmed = true;
            }
            hitCoords.push(`(${Math.round(x)},${Math.round(y)})`);
          } else {
            // Normal hit after tool is confirmed.
            simulateClickAt(x, y);
            hitCoords.push(`(${Math.round(x)},${Math.round(y)})`);
          }
        }
        count++;
        const coordStr = hitCoords.join(" → ");
        log("RESOURCES", "ok", `[${type}] Depleted #${i + 1} – clicks: ${coordStr}`);
      } catch (err) {
        recordError("RESOURCES", `[${type}] Hit failed: ${err.message || err}`);
      }

      if (i < imgs.length - 1) await randomDelay();
    }

    log("RESOURCES", "info", `[${type}] Done – depleted ${count}/${imgs.length}.`);
    return count;
  }

  async function runResourcesRound(round) {
    if (isCaptchaVisible()) {
      log("RESOURCES", "warn", "Captcha detected – skipping resources round.");
      return;
    }

    log("RESOURCES", "info", "Starting resources round…");

    // Refresh the inventory cache once so all _ensureTool checks below
    // see the real tool counts rather than an empty object.
    await _refreshInventoryCache();

    const featureFlags = CONFIG.features.resources;

    // Shuffle resource types each round so the processing order is
    // unpredictable (anti-bot: avoids fixed deterministic click patterns).
    const _shuffledTypes = Object.keys(RESOURCE_DEFS).slice();
    for (let i = _shuffledTypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = _shuffledTypes[i]; _shuffledTypes[i] = _shuffledTypes[j]; _shuffledTypes[j] = tmp;
    }

    for (const type of _shuffledTypes) {
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
    if (CONFIG.features.fruits) {
      const ready = _findFruitTrees().filter(_isFruitReady).length;
      lines.push(`  Fruits ready:  ${ready}`);
    }
    if (CONFIG.features.honey) {
      lines.push(`  Beehives rdy:  ${_findFullBeehives().length}`);
    }
    if (CONFIG.features.pet) {
      const petEl = _findPetElement();
      lines.push(`  Pet sleeping:  ${petEl ? (_isPetSleeping(petEl) ? "yes" : "no") : "n/a"}`);
    }
    if (CONFIG.features.animals) {
      lines.push(`  Animals play:  ${_findAnimalPlayIndicators().length}`);
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

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Crash guard (Aw Snap / error code 9 = OOM) ──────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Check Chrome's (non-standard) performance.memory API.
   * If the used JS heap exceeds 90 % of the total limit, the tab is at severe
   * risk of running out of memory and triggering the "Aw, Snap!" crash
   * (error code 9 = STATUS_INSUFFICIENT_RESOURCES).
   *
   * When pressure is detected:
   *  1. Log + send a Telegram warning with a screenshot.
   *  2. Hard-stop the autotest so the tab can GC and recover.
   *
   * Safe to call in any browser – the check is a no-op when the API is absent.
   */
  async function _checkMemoryPressure() {
    const mem = window.performance && window.performance.memory;
    if (!mem) return; // API not available (non-Chrome or flag disabled)

    const pct = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
    if (pct < 0.85) return; // healthy

    const mb      = (n) => (n / 1_048_576).toFixed(1);
    const message =
      `🚨 Memory pressure detected – heap at ${(pct * 100).toFixed(1)}%
` +
      `Used: ${mb(mem.usedJSHeapSize)} MB / ${mb(mem.jsHeapSizeLimit)} MB
` +
      "Stopping autotest to prevent Aw-Snap crash (error code 9).";

    log("SYSTEM", "error", message);

    // Capture screenshot and send to Telegram before stopping.
    const shot = await _captureScreenshot().catch(() => null);
    if (shot) {
      await _sendTelegramPhoto(shot, message);
    } else if (CONFIG.logging.telegram.enabled) {
      await sendTelegramImmediate(message);
    }

    await _reportAndStop("memory pressure (heap ≥85 %)");
  }

  /**
   * Register a beforeunload listener that fires when the page is about to be
   * unloaded (navigation, tab close, or right before an Aw-Snap crash).
   * Sends a best-effort screenshot + alert to Telegram.
   * This runs synchronously in the event handler then schedules async work.
   */
  (function _registerCrashGuard() {
    window.addEventListener("beforeunload", function () {
      if (stopped) return; // already stopped cleanly
      // We can't await here (synchronous event), so fire-and-forget.
      const caption = "⚠️ Sunland autotest: page unloading unexpectedly – possible Aw-Snap crash.";
      _captureScreenshot().then(function (shot) {
        if (shot) return _sendTelegramPhoto(shot, caption);
        return sendTelegramImmediate(caption);
      }).catch(function () {});
    });

    // Also catch unhandled JS errors and Promise rejections that could be
    // precursors to the crash (e.g. React root unmount errors).
    window.addEventListener("error", function (e) {
      if (stopped) return;
      const msg = `🚨 Uncaught JS error: ${e.message || e} (${e.filename}:${e.lineno})`;
      log("SYSTEM", "error", msg);
      if (CONFIG.logging.telegram.enabled) sendTelegramImmediate(msg).catch(function () {});
    });

    window.addEventListener("unhandledrejection", function (e) {
      if (stopped) return;
      const reason = (e.reason && (e.reason.message || String(e.reason))) || "unknown";
      const msg = `🚨 Unhandled Promise rejection: ${reason}`;
      log("SYSTEM", "error", msg);
      if (CONFIG.logging.telegram.enabled) sendTelegramImmediate(msg).catch(function () {});
    });
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Anti-bot / human-like behaviour ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Dispatch a short burst of realistic mousemove events along a smooth
   * Bézier-like curve from the current mouse position toward a random target
   * on screen.  Fires 6–12 events with 30–80 ms gaps – similar to a human
   * casually moving the cursor between clicks.
   *
   * The last known pointer position is tracked in _lastPointerX / _lastPointerY.
   */
  let _lastPointerX = window.innerWidth  / 2;
  let _lastPointerY = window.innerHeight / 2;

  async function _humanMouseDrift() {
    const targetX = randInt(50, window.innerWidth  - 50);
    const targetY = randInt(50, window.innerHeight - 50);
    const steps   = randInt(6, 12);

    for (let i = 1; i <= steps; i++) {
      const t  = i / steps;
      // Quadratic easing so the movement accelerates then decelerates.
      const et = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x  = _lastPointerX + (_lastPointerX - targetX) * -et;
      const y  = _lastPointerY + (_lastPointerY - targetY) * -et;

      document.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, cancelable: false,
        clientX: Math.round(x), clientY: Math.round(y),
        screenX: Math.round(x + (window.screenX || 0)),
        screenY: Math.round(y + (window.screenY || 0)),
        movementX: Math.round(x - _lastPointerX),
        movementY: Math.round(y - _lastPointerY),
      }));

      _lastPointerX = x;
      _lastPointerY = y;
      await _sleepMs(randInt(30, 80));
    }
  }

  /**
   * Scroll the page by a small random delta (±20–80 px vertically, rarely
   * horizontal) to mimic a user casually scanning the farm.
   */
  async function _humanScroll() {
    const dy = (Math.random() > 0.5 ? 1 : -1) * randInt(20, 80);
    const dx = Math.random() > 0.85 ? (Math.random() > 0.5 ? 1 : -1) * randInt(5, 20) : 0;
    window.scrollBy({ left: dx, top: dy, behavior: "smooth" });
    await _sleepMs(randInt(300, 700));
    // Scroll back so we don't drift off the farm view.
    window.scrollBy({ left: -dx, top: -dy, behavior: "smooth" });
    await _sleepMs(randInt(200, 500));
  }

  /**
   * Occasionally insert a longer human-like idle pause (5–20 s) with mouse
   * drift and micro-scrolls to break the mechanical round rhythm.
   * Only fires ~12 % of the time so rounds don't drag.
   */
  async function _humanIdle() {
    if (Math.random() > 0.12) return; // skip most of the time

    const idleMs = randInt(5_000, 20_000);
    log("SYSTEM", "info", `[anti-bot] Taking a ${(idleMs / 1000).toFixed(1)} s human idle pause…`);

    const end = Date.now() + idleMs;
    while (Date.now() < end && !stopped) {
      await _humanMouseDrift();
      if (Math.random() > 0.6) await _humanScroll();
      await _sleepMs(randInt(800, 2500));
    }
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

    if (CONFIG.logging.toFile) _downloadLog();

    // Send whatever events have accumulated in the current (partial) round.
    if (CONFIG.logging.telegram.enabled && _roundEvents.length > 0) {
      await _sendRoundSummaryToTelegram(_currentRound);
    }

    _cleanup();
    console.log("🛑 Autotest fully stopped.  Run the script again to restart.");
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Main loop ────────────────────────────────════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════

  async function runAutotest() {
    log("SYSTEM", "info",
      "🌻 Sunflower Land Full Autotest started.\n" +
      "   Enabled features:\n" +
      `     crops:     ${CONFIG.features.crops}\n` +
      `     flowers:   ${CONFIG.features.flowers}\n` +
      `     fruits:    ${CONFIG.features.fruits}\n` +
      `     pet:       ${CONFIG.features.pet}\n` +
      `     honey:     ${CONFIG.features.honey}\n` +
      `     animals:   ${CONFIG.features.animals}\n` +
      `     resources: ${JSON.stringify(CONFIG.features.resources)}\n` +
      "   Run  stopAutotest()  to stop at any time."
    );

    // Send a startup ping so the user can confirm Telegram is working.
    if (CONFIG.logging.telegram.enabled) {
      sendTelegramImmediate(
        "🌻 Sunflower Land Autotest started.\n" +
        `Features: crops=${CONFIG.features.crops} flowers=${CONFIG.features.flowers} fruits=${CONFIG.features.fruits} pet=${CONFIG.features.pet} honey=${CONFIG.features.honey} animals=${CONFIG.features.animals}\n` +
        `Resources: ${Object.entries(CONFIG.features.resources).filter(([,v])=>v).map(([k])=>k).join(", ")}\n` +
        (CONFIG.logging.telegram.listenForCommands
          ? "Commands: send 'stop' to pause · 'start' to resume"
          : "")
      );
    } else {
      console.log("[SYSTEM] ℹ️  Telegram not configured – fill in botToken + chatId to enable.");
    }

    let round = 0;

    while (!stopped) {
      round++;
      _currentRound = round;
      _roundEvents.length = 0; // reset accumulator for this round

      // ── Pre-check summary ────────────────────────────────────────────────
      logYieldSummary();

      // ── Check for Telegram commands before starting modules ─────────────
      await _pollTelegramCommands();
      if (stopped) break;

      // If paused by Telegram "stop", wait here until "start" is received.
      while (paused && !stopped) {
        await _sleepMs(CONFIG.logging.telegram.commandPollIntervalSec * 1000);
        await _pollTelegramCommands();
      }
      if (stopped) break;

      // ── Dismiss any active dialogs / popups before farming ───────────────
      await _dismissDialogs();
      if (stopped) break;

      // ── Memory pressure check (crash guard) ─────────────────────────────
      await _checkMemoryPressure();
      if (stopped) break;

      // ── Human idle pause (anti-bot rhythm break) ─────────────────────────
      await _humanIdle();
      if (stopped) break;

      // ── Run enabled modules ──────────────────────────────────────────────
      if (!stopped && !paused && CONFIG.features.crops) {
        await _dismissDialogs();
        await runCropsRound();
        await _humanMouseDrift();
      }
      if (!stopped && !paused && CONFIG.features.flowers) {
        await _dismissDialogs();
        await runFlowersRound();
        await _humanMouseDrift();
      }
      if (!stopped && !paused && CONFIG.features.fruits) {
        await _dismissDialogs();
        await runFruitsRound();
        await _humanMouseDrift();
      }
      if (!stopped && !paused && CONFIG.features.pet) {
        await _dismissDialogs();
        await runPetRound();
      }
      if (!stopped && !paused && CONFIG.features.honey) {
        await _dismissDialogs();
        await runHoneyRound();
        await _humanMouseDrift();
      }
      if (!stopped && !paused && CONFIG.features.animals) {
        await _dismissDialogs();
        await runAnimalsRound();
        await _humanMouseDrift();
      }
      if (!stopped && !paused) {
        await _dismissDialogs();
        await runResourcesRound(round);
      }

      // ── Memory pressure check after heavy round ──────────────────────────
      await _checkMemoryPressure();

      // ── Error budget check ───────────────────────────────────────────────
      _checkErrorBudget();
      if (stopped) break;

      // ── Send round summary to Telegram ───────────────────────────────────
      await _sendRoundSummaryToTelegram(round);

      // ── Wait for next cycle ──────────────────────────────────────────────
      const waitMs  = randomCheckInterval();
      const waitMin = (waitMs / 60_000).toFixed(1);
      log("SYSTEM", "info", `Round ${round} complete.  Next check in ~${waitMin} min…`);

      let elapsed = 0;
      const POLL  = CONFIG.logging.telegram.commandPollIntervalSec * 1000;
      while (elapsed < waitMs && !stopped && !paused) {
        const chunk = Math.min(POLL, waitMs - elapsed);
        await sleep(chunk);
        elapsed += chunk;
        // Poll for Telegram commands during the inter-round wait.
        await _pollTelegramCommands();
        if (!stopped && !paused && elapsed < waitMs) {
          const remaining = ((waitMs - elapsed) / 60_000).toFixed(1);
          log("SYSTEM", "info", `⏳ ~${remaining} min until next round.`);
        }
      }
    }
  }

  runAutotest();
})();
