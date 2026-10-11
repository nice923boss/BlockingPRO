// Small DOM helpers shared by the editor panels: element builder, inputs, toasts, modals, menus, splitters.

/** h("div", { class: "x", onclick }, child, ...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  // select needs its options before the value can stick
  if (value !== undefined) el.value = value;
  return el;
}

export const fmt = (x, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toString();
export const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function timecode(t, fps = 30) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), f = Math.floor((s - Math.floor(s)) * fps + 1e-6);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

/** Set by main.js so one drag on a number field becomes a single undo step */
export const scrubHooks = { begin: null, end: null };

/**
 * Number input that commits on change (Enter or blur).
 * Dragging left / right on an unfocused field changes the value live (Shift x10, Ctrl x0.1); a plain click edits the text.
 */
export function num(value, onCommit, { step = 0.1, min = null, max = null, digits = 3, width = null } = {}) {
  const clamp = (v) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const el = h("input", {
    type: "number", step, min, max, value: value == null ? "" : round(value, digits), style: width ? { width } : null,
    title: "可左右拖曳調整（Shift 加快、Ctrl 微調），點一下輸入數字",
    onchange: (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) onCommit(clamp(v));
    },
  });
  // also started from the row label (see row())
  el._scrub = (e) => {
    e.preventDefault();
    document.activeElement?.blur?.();
    const x0 = e.clientX, v0 = parseFloat(el.value) || 0, st = parseFloat(step) || 0.1;
    let dragging = false, last = v0;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!dragging) {
        if (Math.abs(dx) < 3) return;
        dragging = true;
        scrubHooks.begin?.();
        document.body.classList.add("scrubbing");
      }
      const k = ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1;
      const v = clamp(round(v0 + Math.round(dx / 4) * st * k, digits));
      if (v === last) return;
      last = v;
      el.value = v;
      onCommit(v);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (dragging) { scrubHooks.end?.(); document.body.classList.remove("scrubbing"); }
      else { el.focus(); el.select(); }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  el.addEventListener("pointerdown", (e) => {
    // leave the spin buttons and an already focused field to the browser
    if (e.button !== 0 || document.activeElement === el || e.offsetX > el.clientWidth - 18) return;
    el._scrub(e);
  });
  return el;
}

export function select(options, value, onChange) {
  // options: [[value, label], ...] or { value: label }
  const list = Array.isArray(options) ? options : Object.entries(options);
  return h("select", { value: value ?? "", onchange: (e) => onChange(e.target.value) }, list.map(([v, l]) => h("option", { value: v }, l)));
}

export function checkbox(checked, onChange, title = null) {
  return h("input", { type: "checkbox", checked, title, onchange: (e) => onChange(e.target.checked) });
}

/** Label plus controls. With a single number field, dragging the label scrubs the value. */
export function row(label, ...controls) {
  const c = controls.length === 1 && controls[0]?._scrub ? controls[0] : null;
  const lab = h("label", c ? { class: "scrub", title: "左右拖曳調整數值", onpointerdown: (e) => { if (e.button === 0) c._scrub(e); } } : {}, label);
  return h("div", { class: "row" }, lab, controls.length > 1 ? h("div", { class: "inline" }, controls) : controls[0]);
}

export function vec3Row(label, v, onCommit, step = 0.1) {
  // the panel does not re-render while a number field has focus, so keep the latest of all three here
  const cur = [...v];
  return h("div", { class: "row" }, h("label", {}, label), h("div", { class: "vec" }, [0, 1, 2].map((i) => num(v[i], (x) => { cur[i] = x; onCommit([...cur]); }, { step }))));
}

export function toast(msg, type = "info", ms = 3200) {
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts" }); document.body.append(box); }
  const el = h("div", { class: `toast ${type}` }, msg);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * Modal dialog. buttons: [{ label, primary, danger, onClick(close) }]. Returns close().
 * opts.wide for editors, opts.sticky keeps it open on a backdrop click, opts.onClose runs once when it closes.
 * Esc presses the first button, so buttons[0] must be the cancel / safe choice.
 */
export function modal(title, body, buttons = [{ label: "關閉" }], { wide = false, sticky = false, onClose = null } = {}) {
  let open = true;
  const close = () => { if (!open) return; open = false; back.remove(); removeEventListener("keydown", onKey, true); onClose?.(); };
  const press = (b) => (b.onClick ? b.onClick(close) : close());
  // Only the topmost dialog reacts. In a sticky dialog the first Esc just leaves the text field,
  // so a stray Esc while typing does not throw away edits.
  const onKey = (e) => {
    if (e.key !== "Escape" || e.isComposing || [...document.querySelectorAll(".modal-back")].pop() !== back) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.activeElement;
    if (sticky && back.contains(el) && el.matches("input, textarea")) el.blur();
    else press(buttons[0]);
  };
  const back = h("div", { class: "modal-back", onmousedown: (e) => { if (e.target === back && !sticky) close(); } },
    h("div", { class: `modal${wide ? " wide" : ""}` }, h("h2", {}, title), body,
      h("div", { class: "foot" }, buttons.map((b) => h("button", { class: b.primary ? "primary" : b.danger ? "danger" : null, onclick: () => press(b) }, b.label)))));
  document.body.append(back);
  addEventListener("keydown", onKey, true);
  return close;
}

export function confirmBox(title, text, okLabel = "確定") {
  return new Promise((ok) => {
    modal(title, h("p", {}, text), [
      { label: "取消", onClick: (c) => { c(); ok(false); } },
      { label: okLabel, primary: true, onClick: (c) => { c(); ok(true); } },
    ]);
  });
}

/** Context menu at screen position. items: [{ label, onClick } | null for a gap] */
export function menu(x, y, items) {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  const el = h("div", { class: "menu" }, items.filter(Boolean).map((it) => h("button", { onclick: () => { el.remove(); it.onClick(); } }, it.label)));
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 4) + "px";
  el.style.top = Math.min(y, innerHeight - r.height - 4) + "px";
  const done = () => { el.remove(); removeEventListener("mousedown", off, true); removeEventListener("keydown", esc, true); };
  const off = (e) => { if (!el.contains(e.target)) done(); };
  // a menu closed by an item click or by a newer menu just unhooks here and lets the key through
  const esc = (e) => {
    if (!el.isConnected) return done();
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); }
  };
  setTimeout(() => { addEventListener("mousedown", off, true); addEventListener("keydown", esc, true); });
}

/**
 * Drag a splitter to resize a panel through a CSS variable.
 * axis "x" or "y"; sign +1 when dragging right/down grows the panel, -1 otherwise.
 */
export function splitter(el, host, cssVar, { axis = "x", sign = 1, min = 120, max = 900, storeKey = null } = {}) {
  if (storeKey) {
    try { const v = localStorage.getItem(storeKey); if (v) host.style.setProperty(cssVar, v); } catch { /* storage off: keep default */ }
  }
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY;
    const target = host.querySelector(`[data-size="${cssVar}"]`);
    const size0 = axis === "x" ? target.getBoundingClientRect().width : target.getBoundingClientRect().height;
    el.classList.add("drag");
    const move = (ev) => {
      const d = ((axis === "x" ? ev.clientX : ev.clientY) - start) * sign;
      host.style.setProperty(cssVar, Math.max(min, Math.min(max, size0 + d)) + "px");
    };
    const up = () => {
      el.classList.remove("drag");
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (storeKey) try { localStorage.setItem(storeKey, host.style.getPropertyValue(cssVar)); } catch { /* ignore */ }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
}

/** Run cb on the next animation frame, or after 100 ms when frames are paused (background tab, hidden window) */
export function nextFrame(cb) {
  let done = false;
  const run = () => { if (!done) { done = true; cb(); } };
  requestAnimationFrame(run);
  setTimeout(run, 100);
}

export function downloadBlob(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** "12.3 MB" / "85 KB" for toasts */
export const fileSize = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

export const safeName = (s) => (s || "blockingpro").replace(/[\\/:*?"<>|]+/g, "_").trim() || "blockingpro";

export const isTyping = (e) => {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};
