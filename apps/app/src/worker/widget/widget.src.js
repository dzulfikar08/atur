// Atur feedback + support widget, served verbatim at /widget.js (routes/widget.ts
// imports this file as a raw string).
//
// Framework-free vanilla JS + Shadow DOM: one <script> tag on any site, no build
// step, no style bleed. See docs/feedback-portal.md for the embed snippet and the
// Atur.identify() / data-attribute reference.
(function () {
  "use strict";
  if (window.__aturWidget) return;
  window.__aturWidget = true;

  const script = document.currentScript || document.querySelector("script[data-atur-token]");
  if (!script) return;
  const token = script.getAttribute("data-atur-token");
  if (!token) {
    console.error("[atur] widget: missing data-atur-token");
    return;
  }
  let origin = "https://app.diatur.com";
  try {
    origin = new URL(script.src).origin;
  } catch {
    /* inline/odd script src: keep the default */
  }
  const apiBase = origin + "/api/feedback/" + encodeURIComponent(token);
  const appVersion = script.getAttribute("data-app-version") || "";
  const captureContext = script.getAttribute("data-atur-context") !== "off";

  // ── Automatic context: last 20 console errors + failed fetch/XHR requests ──

  const MAX_BUFFER = 20;
  const consoleErrors = [];
  const failedRequests = [];
  const push = (buf, entry) => {
    buf.push(entry);
    if (buf.length > MAX_BUFFER) buf.shift();
  };
  const nowIso = () => new Date().toISOString();
  const SECRET_PARAM = /token|key|secret|pass|auth|sig|session|code|jwt|credential|bearer|otp/i;

  function cleanUrl(raw, keepQuery) {
    try {
      const u = new URL(raw, location.href);
      u.username = "";
      u.password = "";
      u.hash = "";
      if (!keepQuery) {
        u.search = "";
      } else {
        for (const k of Array.from(u.searchParams.keys())) {
          if (SECRET_PARAM.test(k)) u.searchParams.set(k, "REDACTED");
        }
      }
      return u.toString().slice(0, keepQuery ? 1000 : 500);
    } catch {
      return String(raw).split(/[?#]/)[0].slice(0, 500);
    }
  }

  const isOwnApi = (url) => /\/(api|public)\/feedback\//.test(String(url));

  function recordFailure(method, url, status) {
    if (isOwnApi(url)) return;
    push(failedRequests, {
      method: String(method || "GET")
        .toUpperCase()
        .slice(0, 10),
      url: cleanUrl(url, false),
      status: status,
      at: nowIso(),
    });
  }

  function stringifyArg(a) {
    if (a instanceof Error) return a.message || String(a);
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }

  if (captureContext) {
    window.addEventListener("error", (e) => {
      push(consoleErrors, {
        message: String(e.message || "Script error").slice(0, 1000),
        stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 4000) : undefined,
        at: nowIso(),
      });
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason;
      push(consoleErrors, {
        message: ("Unhandled rejection: " + stringifyArg(r)).slice(0, 1000),
        stack: r && r.stack ? String(r.stack).slice(0, 4000) : undefined,
        at: nowIso(),
      });
    });
    const origConsoleError = console.error;
    console.error = function () {
      try {
        push(consoleErrors, {
          message: Array.prototype.map.call(arguments, stringifyArg).join(" ").slice(0, 1000),
          at: nowIso(),
        });
      } catch {
        /* never break the host's logging */
      }
      return origConsoleError.apply(this, arguments);
    };

    if (typeof window.fetch === "function") {
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        const method = (init && init.method) || (input && input.method) || "GET";
        const url = typeof input === "string" ? input : (input && input.url) || String(input);
        return origFetch.apply(this, arguments).then(
          (res) => {
            if (!res.ok) recordFailure(method, url, res.status);
            return res;
          },
          (err) => {
            if (!(err && err.name === "AbortError")) recordFailure(method, url, 0);
            throw err;
          },
        );
      };
    }
    if (window.XMLHttpRequest) {
      const proto = XMLHttpRequest.prototype;
      const origOpen = proto.open;
      const origSend = proto.send;
      proto.open = function (method, url) {
        this.__aturReq = { method: method, url: url };
        return origOpen.apply(this, arguments);
      };
      proto.send = function () {
        const xhr = this;
        xhr.addEventListener("loadend", () => {
          const req = xhr.__aturReq;
          if (req && (xhr.status >= 400 || xhr.status === 0) && !xhr.__aturAborted) {
            recordFailure(req.method, req.url, xhr.status);
          }
        });
        xhr.addEventListener("abort", () => {
          xhr.__aturAborted = true;
        });
        return origSend.apply(this, arguments);
      };
    }
  }

  function buildContext() {
    if (!captureContext) return undefined;
    const ctx = {
      url: cleanUrl(location.href, true),
      user_agent: navigator.userAgent.slice(0, 500),
      viewport: window.innerWidth + "x" + window.innerHeight,
      platform: "web",
      os: (navigator.platform || "").slice(0, 64),
      extra: {
        language: navigator.language || "",
        screen: screen.width + "x" + screen.height,
        pixel_ratio: window.devicePixelRatio || 1,
      },
    };
    if (appVersion) ctx.app_version = appVersion.slice(0, 64);
    if (consoleErrors.length) ctx.console_errors = consoleErrors.slice();
    if (failedRequests.length) ctx.failed_requests = failedRequests.slice();
    return ctx;
  }

  // ── Public API ──

  let identity = null;
  // identify({ id, email, name, signature }): `signature` must be computed on the
  // host app's SERVER as hex(HMAC-SHA256(identifySecret, `${id}:${email.toLowerCase()}`)).
  // Atur trusts the email only when the signature matches that exact id+email pair;
  // otherwise the report is stored "submitted without verification".
  const api = {
    identify: function (user) {
      if (!user || user.id == null) {
        identity = null;
        return;
      }
      identity = {
        id: String(user.id),
        email: user.email ? String(user.email) : undefined,
        name: user.name ? String(user.name) : undefined,
        signature: user.signature ? String(user.signature) : undefined,
      };
      if (ui) ui.syncIdentity();
    },
    open: function (mode) {
      if (ui) ui.open(mode);
      else pendingOpen = mode || true;
    },
    close: function () {
      if (ui) ui.close();
    },
  };
  let ui = null;
  let pendingOpen = null;

  // Drain calls queued by the async embed snippet: window.Atur = { q: [] }.
  const queued = window.Atur && Array.isArray(window.Atur.q) ? window.Atur.q : [];
  window.Atur = api;
  queued.forEach((call) => {
    try {
      const name = call[0];
      if (api[name]) api[name].apply(api, [].concat(call[1]));
    } catch (e) {
      console.error("[atur] queued call failed", e);
    }
  });

  // ── Screenshot: render the viewport client-side ──
  // Primary: serialize the visible DOM (computed styles inlined) into an SVG
  // <foreignObject> and rasterize it — no dependencies, no permission prompt.
  // Fallback: getDisplayMedia single frame (the browser's own consent prompt).

  const VISUAL_PROPS = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "float",
    "clear",
    "z-index",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "box-sizing",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "box-shadow",
    "opacity",
    "overflow-x",
    "overflow-y",
    "transform",
    "transform-origin",
    "visibility",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "align-items",
    "align-self",
    "align-content",
    "justify-content",
    "justify-items",
    "justify-self",
    "order",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "grid-column-start",
    "grid-column-end",
    "grid-row-start",
    "grid-row-end",
    "grid-auto-flow",
    "vertical-align",
    "object-fit",
    "object-position",
    "outline-style",
    "outline-width",
    "outline-color",
    "fill",
    "stroke",
    "stroke-width",
    "clip-path",
    "filter",
    "mix-blend-mode",
    "text-overflow",
    "list-style-type",
    "table-layout",
    "border-collapse",
    "border-spacing",
    "content",
  ];
  const INHERITED_PROPS = [
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "font-variant",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-align",
    "text-transform",
    "text-decoration",
    "text-indent",
    "text-shadow",
    "white-space",
    "word-break",
    "overflow-wrap",
    "direction",
    "writing-mode",
    "tab-size",
  ];
  const MAX_ELEMENTS = 3000;
  const TRANSPARENT_PX =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const withTimeout = (p, ms) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  const resourceCache = new Map();
  function inlineResource(url) {
    if (url.startsWith("data:")) return Promise.resolve(url);
    if (!resourceCache.has(url)) {
      resourceCache.set(
        url,
        withTimeout(
          fetch(url, { credentials: "omit", mode: "cors" })
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("http " + r.status))))
            .then(blobToDataUrl),
          4000,
        ).catch(() => null),
      );
    }
    return resourceCache.get(url);
  }

  function rectIntersectsViewport(el) {
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0
      ? true
      : r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }

  function applyStyles(src, dst, parentStyle, tasks, pseudoRules, counter) {
    const cs = getComputedStyle(src);
    let css = "";
    for (const p of VISUAL_PROPS) css += p + ":" + cs.getPropertyValue(p) + ";";
    for (const p of INHERITED_PROPS) {
      const v = cs.getPropertyValue(p);
      if (!parentStyle || parentStyle.getPropertyValue(p) !== v) css += p + ":" + v + ";";
    }
    // Resource-bearing backgrounds are inlined asynchronously below.
    const bg = cs.getPropertyValue("background-image");
    if (bg && bg !== "none" && /url\(/.test(bg)) {
      css = css.replace(/background-image:[^;]*;/, "");
      tasks.push(
        Promise.all(
          bg.split(/,(?![^(]*\))/).map((layer) => {
            const m = layer.match(/url\(["']?(.*?)["']?\)/);
            if (!m) return Promise.resolve(layer.trim());
            return inlineResource(new URL(m[1], location.href).href).then((d) =>
              d ? 'url("' + d + '")' : "none",
            );
          }),
        ).then((layers) => {
          dst.style.setProperty("background-image", layers.join(","));
        }),
      );
    }
    dst.setAttribute("style", css);

    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(src, pseudo);
      const content = ps.getPropertyValue("content");
      if (!content || content === "none" || content === "normal" || /url\(/.test(content)) continue;
      if (ps.getPropertyValue("display") === "none") continue;
      let id = dst.getAttribute("data-atur-i");
      if (!id) {
        id = String(counter.n++);
        dst.setAttribute("data-atur-i", id);
      }
      let rule = "";
      for (const p of VISUAL_PROPS.concat(INHERITED_PROPS)) {
        rule += p + ":" + ps.getPropertyValue(p) + ";";
      }
      pseudoRules.push('[data-atur-i="' + id + '"]' + pseudo + "{" + rule + "}");
    }
    return cs;
  }

  function cloneTree(src, parentStyle, state) {
    if (src.nodeType === 3) return src.cloneNode(false);
    if (src.nodeType !== 1 || state.count >= MAX_ELEMENTS) return null;
    const tag = src.tagName.toLowerCase();
    if (src === host || src.hasAttribute("data-atur-ignore")) return null;
    if (tag === "script" || tag === "noscript" || tag === "link" || tag === "style") return null;
    const cs = getComputedStyle(src);
    if (cs.display === "none") return null;
    if (cs.display !== "contents" && !rectIntersectsViewport(src)) return null;
    state.count++;

    let dst;
    if (tag === "canvas") {
      dst = document.createElement("img");
      try {
        dst.setAttribute("src", src.toDataURL());
      } catch {
        dst.setAttribute("src", TRANSPARENT_PX);
      }
    } else if (tag === "iframe" || tag === "video" || tag === "object" || tag === "embed") {
      dst = document.createElement("div");
    } else if (tag === "body") {
      dst = document.createElement("div");
    } else {
      dst = src.cloneNode(false);
    }
    // Drop attributes that trigger loads or behavior inside the snapshot, and any
    // whose name isn't a valid XML name (framework attrs like "@click") — those
    // would make the serialized SVG ill-formed and fail to rasterize.
    for (const a of Array.from(dst.attributes || [])) {
      if (
        /^on/i.test(a.name) ||
        a.name === "srcset" ||
        a.name === "sizes" ||
        !/^[A-Za-z_][\w.:-]*$/.test(a.name)
      ) {
        dst.removeAttribute(a.name);
      }
    }
    applyStyles(src, dst, parentStyle, state.tasks, state.pseudoRules, state.counter);

    if (tag === "img") {
      const url = src.currentSrc || src.src;
      dst.setAttribute("src", TRANSPARENT_PX);
      if (url) {
        state.tasks.push(
          inlineResource(url).then((d) => {
            if (d) dst.setAttribute("src", d);
          }),
        );
      }
    } else if (tag === "input") {
      dst.setAttribute("value", src.value);
      if (src.checked) dst.setAttribute("checked", "");
      if (src.type === "password") dst.setAttribute("value", "\u2022".repeat(src.value.length));
    } else if (tag === "textarea") {
      dst.textContent = src.value;
    } else if (tag === "select") {
      Array.from(dst.options || []).forEach((o, i) => {
        if (src.options[i] && src.options[i].selected) o.setAttribute("selected", "");
        else o.removeAttribute("selected");
      });
    }

    if (
      tag !== "canvas" &&
      tag !== "iframe" &&
      tag !== "video" &&
      tag !== "object" &&
      tag !== "embed"
    ) {
      for (const child of Array.from(src.childNodes)) {
        const c = cloneTree(child, cs, state);
        if (c) dst.appendChild(c);
      }
    }
    return dst;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function finishCanvas(canvas) {
    let blob = await canvasToBlob(canvas, "image/png");
    if (blob.size > 8 * 1024 * 1024) blob = await canvasToBlob(canvas, "image/jpeg", 0.8);
    return blob;
  }

  async function captureViaDom() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const root = document.documentElement;
    const body = document.body;
    const state = { count: 0, tasks: [], pseudoRules: [], counter: { n: 0 } };
    const rootStyle = getComputedStyle(root);
    const bodyClone = cloneTree(body, rootStyle, state);
    if (!bodyClone) throw new Error("nothing to render");
    await Promise.all(state.tasks);

    // The page background lives on <html> (or <body>) and propagates to the canvas.
    let pageBg = rootStyle.backgroundColor;
    if (pageBg === "rgba(0, 0, 0, 0)") pageBg = getComputedStyle(body).backgroundColor;
    if (pageBg === "rgba(0, 0, 0, 0)") pageBg = "#ffffff";

    const docW = Math.max(root.scrollWidth, w);
    const docH = Math.max(root.scrollHeight, h);
    const wrapper = document.createElement("div");
    wrapper.setAttribute(
      "style",
      "position:absolute;left:" +
        -window.scrollX +
        "px;top:" +
        -window.scrollY +
        "px;width:" +
        docW +
        "px;height:" +
        docH +
        "px;",
    );
    wrapper.appendChild(bodyClone);
    const stage = document.createElement("div");
    stage.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    stage.setAttribute(
      "style",
      "position:relative;overflow:hidden;width:" +
        w +
        "px;height:" +
        h +
        "px;background:" +
        pageBg +
        ";",
    );
    if (state.pseudoRules.length) {
      const st = document.createElement("style");
      st.textContent = state.pseudoRules.join("\n");
      stage.appendChild(st);
    }
    stage.appendChild(wrapper);

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      w +
      '" height="' +
      h +
      '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      new XMLSerializer().serializeToString(stage) +
      "</foreignObject></svg>";
    const img = new Image();
    img.decoding = "sync";
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("render failed"));
    });
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await withTimeout(loaded, 10000);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext("2d");
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, w, h);
    return finishCanvas(canvas); // throws SecurityError on a tainted canvas → fallback
  }

  async function captureViaDisplayMedia() {
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) throw new Error("Screen capture is not supported here");
    const stream = await md.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    });
    try {
      host.style.visibility = "hidden";
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 350));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      return await finishCanvas(canvas);
    } finally {
      host.style.visibility = "";
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  // ── UI ──

  const POS = {
    "bottom-right": { bottom: "20px", right: "20px" },
    "bottom-left": { bottom: "20px", left: "20px" },
    "top-right": { top: "20px", right: "20px" },
    "top-left": { top: "20px", left: "20px" },
  };
  const MODES = [
    {
      id: "idea",
      kind: "idea",
      label: "Feedback",
      title: "Share an idea or feedback",
      ph: "What would you like to see?",
    },
    {
      id: "bug",
      kind: "bug",
      label: "Report a bug",
      title: "Report a bug",
      ph: "What went wrong?",
    },
    {
      id: "help",
      kind: "question",
      label: "Get help",
      title: "Get help",
      ph: "What do you need help with?",
    },
  ];
  const MAX_FILES = 5;

  const host = document.createElement("div");
  host.setAttribute("data-atur-widget", "");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483000;";
  const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  let brand = "#6366f1";
  let boardCfg = { allow_submit: true, workspace_slug: null };
  let pos = script.getAttribute("data-atur-position") || "bottom-right";

  const css = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    .bubble{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
      box-shadow:0 8px 24px rgba(0,0,0,.25);transition:transform .15s ease;background:var(--brand)}
    .bubble:hover{transform:scale(1.06)}
    .bubble:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
    .bubble svg{width:26px;height:26px}
    .panel{position:absolute;display:none;width:min(380px,calc(100vw - 24px));max-height:min(640px,calc(100vh - 100px));overflow:auto;
      background:#fff;color:#18181b;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-size:14px}
    .panel.open{display:block}
    .head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--brand);color:#fff}
    .head h2{margin:0;font-size:15px;font-weight:600;color:#fff}
    .x{background:transparent;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
    .tabs{display:flex;gap:4px;padding:10px 12px 0}
    .tab{flex:1;border:1px solid #e4e4e7;background:#fafafa;border-radius:8px;padding:7px 4px;font-size:12px;cursor:pointer;color:#3f3f46}
    .tab[aria-selected=true]{background:var(--brand);border-color:var(--brand);color:#fff}
    form{padding:12px 16px 16px;display:flex;flex-direction:column;gap:10px}
    label{font-size:12px;font-weight:600;color:#52525b;display:flex;flex-direction:column;gap:4px}
    input[type=text],input[type=email],textarea{width:100%;border:1px solid #d4d4d8;border-radius:8px;padding:8px 10px;font-size:14px;color:#18181b;background:#fff}
    textarea{min-height:90px;resize:vertical}
    .row{display:flex;gap:8px;flex-wrap:wrap}
    .btn{border:1px solid #d4d4d8;background:#fff;color:#27272a;border-radius:8px;padding:7px 10px;font-size:12px;cursor:pointer}
    .btn:hover{background:#f4f4f5}
    .btn:disabled{opacity:.5;cursor:default}
    .submit{background:var(--brand);border-color:var(--brand);color:#fff;font-size:14px;padding:10px;font-weight:600}
    .submit:hover{background:var(--brand);opacity:.92}
    .files{display:flex;gap:8px;flex-wrap:wrap}
    .file{position:relative;border:1px solid #e4e4e7;border-radius:8px;padding:4px;font-size:11px;max-width:100%;display:flex;align-items:center;gap:6px;background:#fafafa}
    .file img{width:44px;height:44px;object-fit:cover;border-radius:5px;display:block}
    .file button{border:none;background:#27272a;color:#fff;border-radius:50%;width:18px;height:18px;line-height:16px;font-size:12px;cursor:pointer;padding:0}
    .note{font-size:12px;color:#71717a;margin:0}
    .err{font-size:12px;color:#b91c1c;margin:0}
    .ok{padding:28px 20px;text-align:center}
    .ok h3{margin:0 0 6px;font-size:16px}
    .ok a{color:var(--brand)}
    .links{display:flex;justify-content:space-between;padding:0 16px 14px;font-size:12px}
    .links a{color:#52525b}
    .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  `;

  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);

  const bubble = document.createElement("button");
  bubble.className = "bubble";
  bubble.setAttribute("aria-label", "Open feedback and support");
  bubble.setAttribute("aria-expanded", "false");
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  shadow.appendChild(bubble);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Feedback and support");
  shadow.appendChild(panel);

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => c && n.appendChild(c));
    return n;
  }

  let mode = MODES[0];
  let files = []; // { id, name, mime, previewUrl, uploading, error }
  let busy = false;
  let view = "form"; // form | done
  let doneInfo = null;
  let formState = { title: "", description: "", email: "" };
  let statusMsg = "";
  let errorMsg = "";

  function applyPosition() {
    const p = POS[pos] || POS["bottom-right"];
    host.style.bottom = p.bottom || "auto";
    host.style.top = p.top || "auto";
    host.style.right = p.right || "auto";
    host.style.left = p.left || "auto";
    panel.style.bottom = p.bottom ? "68px" : "auto";
    panel.style.top = p.top ? "68px" : "auto";
    panel.style.right = p.right ? "0" : "auto";
    panel.style.left = p.left ? "0" : "auto";
    host.style.setProperty("--brand", brand);
  }

  function portalUrl(tab) {
    const slug = boardCfg.workspace_slug;
    if (!slug) return null;
    return (
      origin +
      "/portal/" +
      encodeURIComponent(slug) +
      "/" +
      tab +
      (tab === "ideas" ? "?board=" + encodeURIComponent(token) : "")
    );
  }

  function uploadFile(file) {
    if (files.length >= MAX_FILES) {
      errorMsg = "You can attach up to " + MAX_FILES + " files.";
      return render();
    }
    const entry = {
      id: null,
      name: file.name || "attachment",
      mime: file.type,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      uploading: true,
    };
    files.push(entry);
    errorMsg = "";
    render();
    const fd = new FormData();
    fd.append("file", file, entry.name);
    fetch(apiBase + "/attachments", { method: "POST", body: fd })
      .then((r) =>
        r.json().then(
          (j) => ({ ok: r.ok, j: j }),
          () => ({ ok: r.ok, j: {} }),
        ),
      )
      .then((res) => {
        entry.uploading = false;
        if (res.ok && res.j.id) {
          entry.id = res.j.id;
        } else {
          files = files.filter((f) => f !== entry);
          errorMsg = res.j.message || "Could not upload " + entry.name;
        }
        render();
      })
      .catch(() => {
        entry.uploading = false;
        files = files.filter((f) => f !== entry);
        errorMsg = "Could not upload " + entry.name;
        render();
      });
  }

  function captureScreenshot() {
    statusMsg = "Capturing screenshot…";
    errorMsg = "";
    render();
    return captureViaDom()
      .catch(() => {
        statusMsg =
          "Couldn't render the page automatically. Your browser will ask to share this tab for a single frame.";
        render();
        return captureViaDisplayMedia();
      })
      .then((blob) => {
        statusMsg = "";
        const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
        uploadFile(
          new File([blob], type === "image/jpeg" ? "screenshot.jpg" : "screenshot.png", {
            type: type,
          }),
        );
      })
      .catch((e) => {
        statusMsg = "";
        errorMsg =
          e && e.name === "NotAllowedError"
            ? "Screenshot cancelled."
            : "Couldn't capture a screenshot. You can attach a file instead.";
        render();
      });
  }

  function submit() {
    const title = formState.title.trim();
    if (title.length < 3) {
      errorMsg = "Please add a short summary (3+ characters).";
      return render();
    }
    busy = true;
    errorMsg = "";
    render();
    const body = {
      title: title.slice(0, 120),
      description: formState.description.trim() || undefined,
      kind: mode.kind,
      source: "widget",
      context: buildContext(),
      attachment_ids: files.filter((f) => f.id).map((f) => f.id),
    };
    if (identity) {
      body.external_user = identity;
    } else if (formState.email.trim()) {
      body.email = formState.email.trim();
    }
    fetch(apiBase + "/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) =>
        r.json().then(
          (j) => ({ ok: r.ok, j: j }),
          () => ({ ok: r.ok, j: {} }),
        ),
      )
      .then((res) => {
        busy = false;
        if (res.ok) {
          doneInfo = res.j;
          view = "done";
          formState = { title: "", description: "", email: formState.email };
          files.forEach((f) => {
            if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
          });
          files = [];
        } else {
          errorMsg = res.j.message || "Something went wrong. Please try again.";
        }
        render();
      })
      .catch(() => {
        busy = false;
        errorMsg = "Network error. Please try again.";
        render();
      });
  }

  function renderForm() {
    const showEmail = !(identity && identity.email);
    const uploading = files.some((f) => f.uploading);
    const title = el("input", {
      type: "text",
      maxlength: "120",
      placeholder: mode.ph,
      id: "t",
      autocomplete: "off",
      oninput: (e) => (formState.title = e.target.value),
    });
    title.value = formState.title;
    const desc = el("textarea", {
      maxlength: "4000",
      placeholder: "Add details (optional)",
      id: "d",
      oninput: (e) => (formState.description = e.target.value),
    });
    desc.value = formState.description;
    const email = el("input", {
      type: "email",
      placeholder: "you@example.com",
      id: "e",
      autocomplete: "email",
      oninput: (e) => (formState.email = e.target.value),
    });
    email.value = formState.email;

    const picker = el("input", {
      type: "file",
      multiple: "",
      class: "sr",
      accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain",
      "aria-label": "Attach files",
    });
    picker.addEventListener("change", () => {
      Array.from(picker.files || []).forEach(uploadFile);
      picker.value = "";
    });

    const fileList = el(
      "div",
      { class: "files" },
      files.map((f) =>
        el("div", { class: "file" }, [
          f.previewUrl ? el("img", { src: f.previewUrl, alt: f.name }) : null,
          el("span", { text: f.uploading ? f.name + " …" : f.name }),
          el("button", {
            type: "button",
            "aria-label": "Remove " + f.name,
            text: "×",
            onclick: () => {
              files = files.filter((x) => x !== f);
              if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
              render();
            },
          }),
        ]),
      ),
    );

    const form = el("form", { novalidate: "" }, [
      el("label", {}, [el("span", { text: "Summary" }), title]),
      el("label", {}, [el("span", { text: "Details" }), desc]),
      showEmail ? el("label", {}, [el("span", { text: "Email (so we can reply)" }), email]) : null,
      el("div", { class: "row" }, [
        el("button", {
          type: "button",
          class: "btn",
          id: "shot",
          text: "Capture screenshot",
          onclick: captureScreenshot,
        }),
        el("button", {
          type: "button",
          class: "btn",
          text: "Attach file",
          onclick: () => picker.click(),
        }),
        picker,
      ]),
      files.length ? fileList : null,
      statusMsg ? el("p", { class: "note", role: "status", text: statusMsg }) : null,
      captureContext
        ? el("p", {
            class: "note",
            text: "Page URL, browser details and recent errors are sent with your report.",
          })
        : null,
      errorMsg ? el("p", { class: "err", role: "alert", text: errorMsg }) : null,
      el("button", {
        type: "submit",
        class: "btn submit",
        id: "send",
        text: busy ? "Sending…" : uploading ? "Uploading…" : "Send",
        ...(busy || uploading ? { disabled: "" } : {}),
      }),
    ]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    return form;
  }

  function renderDone() {
    const link = doneInfo && doneInfo.url;
    return el("div", { class: "ok" }, [
      el("h3", { text: "Thank you!" }),
      el("p", {
        class: "note",
        text:
          "We received your report" +
          (doneInfo && doneInfo.sequence_id ? " (#" + doneInfo.sequence_id + ")" : "") +
          ".",
      }),
      link
        ? el("p", {}, [
            el("a", {
              href: link,
              target: "_blank",
              rel: "noopener",
              text: "Track it in the portal",
            }),
          ])
        : null,
      el("p", {}, [
        el("button", {
          type: "button",
          class: "btn",
          text: "Send another",
          onclick: () => {
            view = "form";
            render();
          },
        }),
      ]),
    ]);
  }

  function render() {
    const active = shadow.activeElement && shadow.activeElement.id;
    const scroll = panel.scrollTop;
    panel.textContent = "";
    panel.appendChild(
      el("div", { class: "head" }, [
        el("h2", { text: view === "done" ? "Sent" : mode.title }),
        el("button", { class: "x", "aria-label": "Close", text: "×", onclick: () => api.close() }),
      ]),
    );
    if (!boardCfg.allow_submit) {
      panel.appendChild(
        el("div", { class: "ok" }, [
          el("p", { class: "note", text: "Submissions are currently closed." }),
        ]),
      );
    } else if (view === "done") {
      panel.appendChild(renderDone());
    } else {
      panel.appendChild(
        el(
          "div",
          { class: "tabs", role: "tablist" },
          MODES.map((m) =>
            el("button", {
              type: "button",
              class: "tab",
              role: "tab",
              "aria-selected": String(m.id === mode.id),
              text: m.label,
              onclick: () => {
                mode = m;
                errorMsg = "";
                render();
              },
            }),
          ),
        ),
      );
      panel.appendChild(renderForm());
    }
    const ideas = portalUrl("ideas");
    const mine = portalUrl("tickets");
    if (ideas) {
      panel.appendChild(
        el("div", { class: "links" }, [
          el("a", {
            href: ideas,
            target: "_blank",
            rel: "noopener",
            text: "Browse ideas & roadmap",
          }),
          el("a", { href: mine, target: "_blank", rel: "noopener", text: "My requests" }),
        ]),
      );
    }
    if (active) {
      const again = shadow.getElementById ? shadow.getElementById(active) : null;
      if (again && again.focus) again.focus();
    }
    panel.scrollTop = scroll;
  }

  function syncIdentity() {
    if (identity && identity.email) formState.email = identity.email;
    if (panel.classList.contains("open")) render();
  }

  function open(m) {
    if (typeof m === "string") {
      const found = MODES.filter((x) => x.id === m || x.kind === m)[0];
      if (found) mode = found;
    }
    view = "form";
    panel.classList.add("open");
    bubble.setAttribute("aria-expanded", "true");
    render();
    const t = shadow.getElementById ? shadow.getElementById("t") : null;
    if (t && t.focus) t.focus();
  }

  function close() {
    panel.classList.remove("open");
    bubble.setAttribute("aria-expanded", "false");
  }

  bubble.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.classList.contains("open")) close();
    else open();
  });
  document.addEventListener("click", (e) => {
    if (panel.classList.contains("open") && !host.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  ui = { open: open, close: close, syncIdentity: syncIdentity };

  function mount() {
    document.body.appendChild(host);
    applyPosition();
    if (pendingOpen) open(typeof pendingOpen === "string" ? pendingOpen : undefined);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  // Brand color / position / submit switch from the board (best effort).
  fetch(apiBase + "/config", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      if (data.brand_color) brand = data.brand_color;
      if (!script.getAttribute("data-atur-position") && data.position) pos = data.position;
      boardCfg = {
        allow_submit: data.allow_submit !== false,
        workspace_slug: data.workspace_slug || null,
      };
      applyPosition();
      if (panel.classList.contains("open")) render();
    })
    .catch(() => {});
})();
