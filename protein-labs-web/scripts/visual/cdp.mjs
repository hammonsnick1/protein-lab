// Minimal Chrome DevTools Protocol driver for the visual checks.
//
// Electron segfaults in the agent sandbox, so the desktop bundle is driven in
// headless Chromium instead:
//
//   chromium --headless=new --remote-debugging-port=$CDP_PORT \
//            --user-data-dir=$(mktemp -d) about:blank
//
// Usage: import { open } from "./cdp.mjs"; const page = await open(port);
import { writeFileSync } from "node:fs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function open(port, url) {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch (cause) {
    throw new Error(`No Chromium listening on CDP port ${port} (${cause.message}).`);
  }
  let target = targets.find((entry) => entry.type === "page");
  if (!target) target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else if (message.method) for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const errors = [];
  listeners.push((message) => {
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  const page = {
    send,
    errors,
    async eval(expression) {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async size(width, height, scale = 1) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    },
    async goto(target) {
      await send("Page.navigate", { url: target });
      await page.waitFor("document.readyState === 'complete'");
    },
    async waitFor(expression, timeout = 10000) {
      const start = Date.now();
      for (;;) {
        try { if (await page.eval(`!!(${expression})`)) return; } catch { /* page still loading */ }
        if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${expression}`);
        await sleep(100);
      }
    },
    async shot(path, clip) {
      const result = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(result.data, "base64"));
      return path;
    },
    /**
     * Scroll a list/panel *without* moving the page.
     *
     * Prefer this over `scrollIntoView`: that scrolls the nearest scrollable
     * ancestor chain, including the page, which silently invalidates any clip
     * rect captured before it (the 2x close-up then frames the wrong region).
     * Pass a `target` to bring one row into view inside its own container.
     */
    async scrollBox(selector, { top, target, offset = 120 } = {}) {
      return page.eval(`(() => {
        const box = document.querySelector(${JSON.stringify(selector)});
        if (!box) return null;
        ${target ? `const row = box.querySelector(${JSON.stringify(target)}); if (!row) return null; box.scrollTop = row.offsetTop - box.offsetTop - ${offset};` : `box.scrollTop = ${Number(top) || 0};`}
        return box.scrollTop;
      })()`);
    },
    /** Viewport-relative box of an element, padded, ready to pass to `shot`. */
    async box(selector, pad = 8) {
      return page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}), width: Math.min(r.width + ${pad} * 2, innerWidth), height: Math.min(r.height + ${pad} * 2, innerHeight - Math.max(0, r.top - ${pad})) };
      })()`);
    },
    async center(selector) {
      // Note: this scrolls, by design, so a click lands. Capture clip rects
      // *after* calling it, or use `scrollBox` when the page must stay put.
      return page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    },
    async mouse(type, x, y, options = {}) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: options.button ?? "left", buttons: options.button === "right" ? 2 : 1, clickCount: options.clickCount ?? 1, modifiers: options.modifiers ?? 0 });
    },
    async click(selector, options = {}) {
      const point = await page.center(selector);
      if (!point) throw new Error(`No element ${selector}`);
      await page.mouse("mouseMoved", point.x, point.y, options);
      await page.mouse("mousePressed", point.x, point.y, options);
      await page.mouse("mouseReleased", point.x, point.y, options);
      await sleep(options.wait ?? 150);
      return point;
    },
    async hover(selector) {
      const point = await page.center(selector);
      await page.mouse("mouseMoved", point.x, point.y);
      await sleep(120);
    },
    async key(key, options = {}) {
      const codes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, " ": 32, Delete: 46, Backspace: 8, F2: 113, Home: 36, End: 35, Tab: 9, "/": 191 };
      const vk = codes[key] ?? key.toUpperCase().charCodeAt(0);
      const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
      const base = { key, code: key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key === " " ? "Space" : "Slash") : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: options.modifiers ?? 0 };
      await send("Input.dispatchKeyEvent", { type: text && !options.modifiers ? "keyDown" : "rawKeyDown", ...base, ...(text && !options.modifiers ? { text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(options.wait ?? 150);
    },
    async type(text) {
      await send("Input.insertText", { text });
      await sleep(150);
    },
    close() { ws.close(); },
  };
  if (url) await page.goto(url);
  return page;
}
