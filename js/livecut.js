// Live switching (m02): the take plays from the playhead, number keys or thumbnail clicks pick the program camera,
// and when playback stops the take replaces the cuts inside the recorded span (one undo step).
import { toast, round } from "./ui.js";
import { commitLiveCut } from "./ops-camera.js";

export class LiveCut {
  constructor(store, rt, onChange) {
    Object.assign(this, { store, rt, onChange });
    this.recording = false;
    this.current = null;
    store.subscribe((what) => {
      if (!this.recording) return;
      // at the end of the range playback stops first and then lands on the last frame: wait for that time
      if (what === "play" && !store.playing) queueMicrotask(() => this.stop(this.last));
      else if (what === "time") {
        // the loop wrapped or the playhead was dragged back: the take ends where it got to
        if (store.time < this.last - 1e-6) { this.stop(this.last); store.setPlaying(false); }
        else this.last = store.time;
      }
    });
  }

  toggle() {
    if (this.recording) this.store.setPlaying(false);
    else this.start();
  }

  start() {
    const s = this.store, P = s.project;
    if (!P.cameras.length) { toast("先新增攝影機才能導播錄製", "warn"); return; }
    if (s.posing) { toast("擺姿勢模式中不能錄製", "warn"); return; }
    const r = s.range, end = r ? r.b : P.settings.duration;
    if (s.time >= end - 0.05 || (r && s.time < r.a)) s.setTime(r ? r.a : 0);
    s.setPreview(null);
    this.t0 = round(s.time, 3);
    this.last = s.time;
    this.current = this.rt.liveCamera(s.time) || P.cameras[0].id;
    this.events = [{ t: this.t0, camera: this.current }];
    this.recording = true;
    this.onChange();
    if (!s.playing) s.setPlaying(true);
    toast("導播錄製中：按 1 到 9 或點縮圖切換攝影機，按空白鍵結束");
  }

  press(camId) {
    if (!this.recording || camId === this.current) return;
    this.events.push({ t: round(this.store.time, 3), camera: camId });
    this.current = camId;
    this.onChange();
  }

  stop(end) {
    if (!this.recording) return;
    this.recording = false;
    this.current = null;
    commitLiveCut(this.t0, round(end, 3), this.events);
    this.onChange();
  }
}
