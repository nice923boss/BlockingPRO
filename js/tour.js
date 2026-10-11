// First-run tour: five steps (actor, walk path, camera, cut, export). Each step highlights a panel and moves on
// by itself once the project shows the step was done; the card never blocks the editor.
import { h } from "./ui.js";

const DONE_KEY = "blockingpro.tour.done";
const pathKeys = (p) => p.actors.reduce((n, a) => n + a.path.keys.length, 0);

const STEPS = [
  { title: "加入角色", target: "#library", tab: "cast",
    text: "左側素材庫「角色」分頁，點一下「成年男性」或其他體型，角色會出現在 3D 視窗中央。",
    done: (p, b) => p.actors.length > b.actors },
  { title: "畫走位", target: "#view",
    text: "選取角色，把時間軸播放頭拖到 3 秒左右，再按住 Shift 點地面：角色會在這個時間走到那裡。可以多點幾個點。",
    done: (p, b) => pathKeys(p) > b.keys && p.actors.some((a) => a.path.keys.length >= 2) },
  { title: "加入攝影機", target: "#library", tab: "camera",
    text: "素材庫「攝影機」分頁按「固定機位」，或在 3D 視窗轉到想要的角度後加一台。右側屬性可以改焦距與對準的角色。",
    done: (p, b) => p.cameras.length > b.cameras },
  { title: "剪接", target: "#timeline",
    text: "把播放頭移到要換鏡頭的時間，按數字鍵 1 到 9 切到第 N 台攝影機，時間軸「剪接」列會多一段。右上導演台顯示剪接後的畫面。",
    done: (p, b) => p.cuts.length > b.cuts && p.cuts.length >= 2 },
  { title: "輸出", target: "#topbar .primary",
    text: "按「下載 MP4」輸出參考影片，「儲存」下載專案檔備份。說明（?）裡有全部快捷鍵，這份導覽也可以從那裡重新開啟。",
    done: () => false },
];

export const tourSeen = () => { try { return !!localStorage.getItem(DONE_KEY); } catch { return true; } };

let active = null;

/** Start (or restart) the tour. library: the Library panel, to switch it to the right tab. */
export function startTour(store, library) {
  active?.end(false);
  const card = h("div", { class: "tour", role: "dialog", "aria-label": "新手導覽" });
  let i = 0, hl = null, base = null;
  const counts = () => ({ actors: store.project.actors.length, cameras: store.project.cameras.length, cuts: store.project.cuts.length, keys: pathKeys(store.project) });

  const highlight = (sel) => {
    hl?.classList.remove("tour-hl");
    hl = document.querySelector(sel);
    hl?.classList.add("tour-hl");
  };
  const show = (n) => {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const st = STEPS[i];
    base = counts();
    if (st.tab) library.show(st.tab);
    highlight(st.target);
    const last = i === STEPS.length - 1;
    card.replaceChildren(
      h("div", { class: "tour-step" }, `新手導覽　${i + 1}／${STEPS.length}`),
      h("b", {}, st.title),
      h("p", {}, st.text),
      h("div", { class: "tour-dots" }, STEPS.map((_, k) => h("span", { class: k < i ? "ok" : k === i ? "on" : null }))),
      h("div", { class: "tour-btns" },
        h("button", { onclick: () => end(true), title: "之後可以從「說明」重新開啟" }, "結束導覽"),
        h("span", { class: "grow" }),
        i ? h("button", { onclick: () => show(i - 1) }, "上一步") : null,
        h("button", { class: "primary", onclick: () => (last ? end(true) : show(i + 1)) }, last ? "完成" : "略過這步")),
    );
  };
  const unsub = store.subscribe((what) => {
    if (what !== "project") return;
    const st = STEPS[i];
    if (st.done(store.project, base)) {
      card.classList.add("passed");
      setTimeout(() => { card.classList.remove("passed"); if (active === api && STEPS[i] === st) show(i + 1); }, 700);
    }
  });
  const end = (remember) => {
    hl?.classList.remove("tour-hl");
    card.remove();
    unsub?.();
    if (active === api) active = null;
    if (remember) try { localStorage.setItem(DONE_KEY, "1"); } catch { /* storage off: the tour shows again next time */ }
  };
  const api = { end };
  active = api;
  document.body.append(card);
  show(0);
}
