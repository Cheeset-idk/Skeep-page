(() => {
  "use strict";

  /* ------------------------------------------------------------------
     Playlist. Tracks play in this order, then start over from the top.
     Each track is cut into parts (to stay under GitHub's 25 MB upload
     limit); the player joins them back into one continuous track.
     "duration" is each part's length in seconds. To add a track, list
     its parts in order. Parts of a few minutes work well.
  ------------------------------------------------------------------ */
  const TRACKS = [
    {
      title: "Meow That Will Actually Let You Focus",
      artist: "",
      parts: [
        { src: "01-meow-focus-part1.mp3", duration: 900.02 },
        { src: "01-meow-focus-part2.mp3", duration: 900.0 },
        { src: "01-meow-focus-part3.mp3", duration: 900.0 },
        { src: "01-meow-focus-part4.mp3", duration: 900.0 },
        { src: "01-meow-focus-part5.mp3", duration: 23.46 },
      ],
    },
    {
      title: "Snowfall",
      artist: "øneheart × Reidenshi",
      parts: [
        { src: "02-snowfall-part1.mp3", duration: 900.02 },
        { src: "02-snowfall-part2.mp3", duration: 900.0 },
        { src: "02-snowfall-part3.mp3", duration: 900.0 },
        { src: "02-snowfall-part4.mp3", duration: 900.0 },
        { src: "02-snowfall-part5.mp3", duration: 43.7 },
      ],
    },
    {
      title: "Best of Antent: Ambient Mix",
      artist: "",
      parts: [
        { src: "03-antent-ambient-part1.mp3", duration: 1500.0 },
        { src: "03-antent-ambient-part2.mp3", duration: 1344.16 },
      ],
    },
  ];

  const VIDEO_PARTS = [
    "night-city-part1.mp4",
    "night-city-part2.mp4",
  ];

  const IDLE_MS = 4000;
  const STORE_KEY = "quiet-hours:v1";

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const audio = $("audio");
  const videos = [$("bg"), $("bg2")];
  const els = {
    clock: $("clock"), now: $("now"), title: $("title"), artist: $("artist"), times: $("times"),
    seek: $("seek"), volume: $("volume"), dim: $("dim"), dock: $("dock"), stage: $("stage"),
    play: $("play"), prev: $("prev"), next: $("next"), mute: $("mute"), fs: $("fs"),
    settingsBtn: $("settingsBtn"), settings: $("settings"), sleepDot: $("sleepDot"),
    sleepHint: $("sleepHint"), clockToggle: $("clockToggle"), videoToggle: $("videoToggle"),
    begin: $("begin"), toast: $("toast"),
  };

  /* ---------- Saved settings ---------- */

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { volume: 0.6, muted: false, dim: 0.2, clock: true, video: !reducedMotion };

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    Object.assign(state, saved);
  } catch (_) { /* storage unavailable: use defaults */ }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        volume: state.volume, muted: state.muted, dim: state.dim, clock: state.clock, video: state.video,
      }));
    } catch (_) { /* ignore */ }
  }

  /* ---------- Small helpers ---------- */

  const fmt = (s) => {
    if (!isFinite(s)) return "0:00";
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
             : `${m}:${String(sec).padStart(2, "0")}`;
  };

  const setFill = (input) => {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--p", pct + "%");
  };

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }

  /* ---------- Volume and fading ---------- */
  // Real volume = chosen volume x fade level. Fades use a timer (not
  // requestAnimationFrame) so they still finish in a background tab.

  let fade = 1, fadeToken = 0;

  function applyVolume() {
    audio.volume = Math.min(1, Math.max(0, state.volume * fade));
    audio.muted = state.muted;
  }

  function fadeTo(target, ms) {
    const token = ++fadeToken, from = fade, t0 = performance.now();
    return new Promise((resolve) => {
      const id = setInterval(() => {
        if (token !== fadeToken) { clearInterval(id); return resolve(false); }
        const p = Math.min(1, (performance.now() - t0) / ms);
        fade = from + (target - from) * (p * p * (3 - 2 * p));
        applyVolume();
        if (p >= 1) { clearInterval(id); resolve(true); }
      }, 50);
    });
  }

  /* ---------- Playback ---------- */

  let index = 0;     // current track
  let part = 0;      // current part of that track
  let failures = 0;

  const total = (t = TRACKS[index]) => t.parts.reduce((n, p) => n + p.duration, 0);
  const partStart = (p) => TRACKS[index].parts.slice(0, p).reduce((n, x) => n + x.duration, 0);
  const elapsed = () => partStart(part) + (audio.currentTime || 0);

  function showTrack() {
    const t = TRACKS[index];
    els.title.textContent = t.title;
    els.artist.textContent = t.artist;
    els.now.textContent = t.title;
    document.title = `${t.title} · Quiet hours`;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || "Quiet hours",
        artwork: [{ src: "poster.jpg", sizes: "1280x720", type: "image/jpeg" }],
      });
    }
  }

  function loadTrack(i) {
    index = (i + TRACKS.length) % TRACKS.length;
    part = 0;
    audio.src = TRACKS[index].parts[0].src;
    els.seek.value = 0; setFill(els.seek);
    els.times.textContent = `0:00 / ${fmt(total())}`;
    showTrack();
  }

  // Jump to a point (in seconds) anywhere in the current track, switching parts if needed
  function seekTo(t, keepPlaying = !audio.paused) {
    t = Math.min(Math.max(0, t), total() - 1);
    let p = 0;
    while (p < TRACKS[index].parts.length - 1 && t >= partStart(p + 1)) p++;
    const offset = t - partStart(p);
    if (p === part) { audio.currentTime = offset; return; }
    part = p;
    audio.src = TRACKS[index].parts[p].src;
    audio.addEventListener("loadedmetadata", () => { audio.currentTime = offset; }, { once: true });
    if (keepPlaying) audio.play().catch(() => {});
  }

  async function startPlayback(fadeMs = 2500) {
    fadeToken++;
    fade = 0;
    applyVolume();
    try {
      await audio.play();
      fadeTo(1, fadeMs);
      return true;
    } catch (_) {
      fade = 1; applyVolume();
      return false;
    }
  }

  function pausePlayback() {
    fadeTo(0, 350).then((done) => { if (done) audio.pause(); });
    setPlaying(false);
  }

  function setPlaying(on) {
    body.classList.toggle("is-playing", on);
    els.play.setAttribute("aria-label", on ? "Pause" : "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = on ? "playing" : "paused";
  }

  function togglePlay() {
    if (body.classList.contains("intro-open")) return begin();
    if (audio.paused || !body.classList.contains("is-playing")) {
      if (audio.paused) startPlayback(1200); else fadeTo(1, 800);
      setPlaying(true);
    } else {
      pausePlayback();
    }
  }

  async function goTo(i) {
    loadTrack(i);
    setPlaying(true);
    const ok = await startPlayback(2000);
    if (!ok) setPlaying(false);
  }

  const next = () => goTo(index + 1);
  const prev = () => (elapsed() > 5 ? seekTo(0) : goTo(index - 1));

  audio.addEventListener("play", () => setPlaying(true));
  audio.addEventListener("pause", () => { if (!audio.ended) setPlaying(false); });
  audio.addEventListener("playing", () => { failures = 0; });

  // Next part of the same track, or the next track. After the last, back to the first.
  audio.addEventListener("ended", () => {
    if (part < TRACKS[index].parts.length - 1) {
      part++;
      audio.src = TRACKS[index].parts[part].src;
      audio.play().catch(() => {});
    } else {
      goTo(index + 1);
    }
  });

  audio.addEventListener("error", () => {
    failures++;
    if (failures >= TRACKS.length) {
      setPlaying(false);
      toast("Couldn't load the music. Check the file names in audio.");
      return;
    }
    toast("Skipping a track that wouldn't load.");
    setTimeout(() => goTo(index + 1), 800);
  });

  /* ---------- Progress bar ---------- */

  let seeking = false;

  function updateProgress() {
    const d = total();
    els.times.textContent = `${fmt(elapsed())} / ${fmt(d)}`;
    if (!seeking) {
      els.seek.value = Math.round((elapsed() / d) * 1000);
      setFill(els.seek);
    }
  }

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);

  els.seek.addEventListener("input", () => {
    seeking = true;
    setFill(els.seek);
    els.times.textContent = `${fmt((els.seek.value / 1000) * total())} / ${fmt(total())}`;
  });
  els.seek.addEventListener("change", () => {
    seekTo((els.seek.value / 1000) * total());
    seeking = false;
  });

  function skip(seconds) { seekTo(elapsed() + seconds); }

  /* ---------- Volume, mute, dim ---------- */

  function syncVolumeUI() {
    els.volume.value = Math.round(state.volume * 100);
    setFill(els.volume);
    body.classList.toggle("is-muted", state.muted || state.volume === 0);
    els.mute.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
    applyVolume();
  }

  function setVolume(v) {
    state.volume = Math.min(1, Math.max(0, v));
    if (state.volume > 0) state.muted = false;
    syncVolumeUI(); save();
  }

  els.volume.addEventListener("input", () => setVolume(els.volume.value / 100));
  els.mute.addEventListener("click", () => { state.muted = !state.muted; syncVolumeUI(); save(); });

  function syncDim() {
    document.documentElement.style.setProperty("--dim", state.dim);
    els.dim.value = Math.round(state.dim * 100);
    setFill(els.dim);
  }
  els.dim.addEventListener("input", () => { state.dim = els.dim.value / 100; syncDim(); save(); });

  /* ---------- Clock, video, toggles ---------- */

  const timeFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
  // Hours and minutes only; the AM/PM marker is left out to keep the clock quiet
  const updateClock = () => {
    els.clock.textContent = timeFmt.formatToParts(new Date())
      .filter((p) => p.type !== "dayPeriod")
      .map((p) => p.value).join("").trim();
  };

  function syncClock() {
    body.classList.toggle("no-clock", !state.clock);
    els.clockToggle.checked = state.clock;
  }
  els.clockToggle.addEventListener("change", () => { state.clock = els.clockToggle.checked; syncClock(); save(); });

  // Two stacked video elements take turns: while one plays, the other
  // preloads the next part, so the join between parts is hardly noticeable.
  let vi = 0, vp = 0;
  const activeVideo = () => videos[vi];
  const playVideo = () => activeVideo().play().catch(() => {});
  const pauseVideo = () => activeVideo().pause();

  function setupVideo() {
    videos.forEach((v) => { v.muted = true; });
    videos[0].src = VIDEO_PARTS[0];
    videos[1].src = VIDEO_PARTS[1 % VIDEO_PARTS.length];
    videos[1].load();
    videos.forEach((v, n) => v.addEventListener("ended", () => {
      if (n !== vi) return;
      const cur = videos[vi], nxt = videos[1 - vi];
      vi = 1 - vi;
      vp = (vp + 1) % VIDEO_PARTS.length;
      nxt.currentTime = 0;
      nxt.play().catch(() => {});
      nxt.classList.add("on");
      cur.classList.remove("on");
      setTimeout(() => {              // line up the part after next
        cur.src = VIDEO_PARTS[(vp + 1) % VIDEO_PARTS.length];
        cur.load();
      }, 1500);
    }));
  }

  function syncVideo() {
    els.videoToggle.checked = state.video;
    if (state.video) playVideo(); else pauseVideo();
  }
  els.videoToggle.addEventListener("change", () => { state.video = els.videoToggle.checked; syncVideo(); save(); });

  /* ---------- Sleep timer ---------- */

  let sleepEnd = 0;

  function setSleep(minutes) {
    sleepEnd = minutes ? Date.now() + minutes * 60000 : 0;
    document.querySelectorAll(".seg").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.sleep) === minutes)));
    els.sleepDot.hidden = !sleepEnd;
    updateSleepHint();
    if (minutes) toast(`Music will fade out in ${minutes === 60 ? "1 hour" : minutes + " minutes"}`);
  }

  function updateSleepHint() {
    if (!sleepEnd) { els.sleepHint.textContent = "Music fades out gently when time is up."; return; }
    const left = Math.max(1, Math.ceil((sleepEnd - Date.now()) / 60000));
    els.sleepHint.textContent = `About ${left} min left, then the music fades out.`;
  }

  document.querySelectorAll(".seg").forEach((b) =>
    b.addEventListener("click", () => setSleep(Number(b.dataset.sleep))));

  function checkSleep() {
    if (!sleepEnd) return;
    if (Date.now() >= sleepEnd) {
      sleepEnd = 0;
      els.sleepDot.hidden = true;
      setSleep(0);
      setPlaying(false);
      fadeTo(0, 15000).then((done) => {
        if (done) { audio.pause(); toast("Sleep timer finished. Goodnight."); }
      });
    } else {
      updateSleepHint();
    }
  }

  setInterval(() => { updateClock(); checkSleep(); }, 1000);

  /* ---------- Settings panel ---------- */

  function setSettings(open) {
    els.settings.hidden = !open;
    els.settingsBtn.setAttribute("aria-expanded", String(open));
    wake();
  }
  els.settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); setSettings(els.settings.hidden); });
  document.addEventListener("pointerdown", (e) => {
    if (!els.settings.hidden && !els.dock.contains(e.target)) setSettings(false);
  });

  /* ---------- Full screen ---------- */

  const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (!fsEnabled) els.fs.hidden = true;

  function toggleFullscreen() {
    if (!fsEnabled) return;
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
  }
  const onFs = () => {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    body.classList.toggle("is-fullscreen", on);
    els.fs.setAttribute("aria-label", on ? "Exit full screen" : "Enter full screen");
  };
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);
  els.fs.addEventListener("click", toggleFullscreen);

  /* ---------- Controls that fade when idle ---------- */

  let idleTimer;

  function wake() {
    body.classList.remove("idle");
    clearTimeout(idleTimer);
    if (body.classList.contains("intro-open")) return;
    idleTimer = setTimeout(() => {
      const busy = !els.settings.hidden || els.dock.matches(":hover") || els.dock.contains(document.activeElement);
      if (busy) return wake();
      body.classList.add("idle");
    }, IDLE_MS);
  }

  document.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") wake(); });
  document.addEventListener("keydown", wake);
  els.dock.addEventListener("focusin", wake);
  els.dock.addEventListener("pointerdown", wake);

  // Tap the scene to hide or show the controls
  els.stage.addEventListener("click", () => {
    if (body.classList.contains("idle")) wake();
    else { clearTimeout(idleTimer); body.classList.add("idle"); }
  });

  /* ---------- Keyboard shortcuts ---------- */

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (body.classList.contains("intro-open")) return;           // the Begin button handles Enter and Space
    const tag = e.target.tagName;
    const onButton = tag === "BUTTON";
    if (e.key === " " && (onButton || e.target.type === "checkbox")) return;  // let focused controls handle Space
    if (tag === "INPUT" && e.target.type !== "range" && e.target.type !== "checkbox") return;
    const onSlider = tag === "INPUT" && e.target.type === "range";

    switch (e.key.toLowerCase()) {
      case " ": e.preventDefault(); togglePlay(); break;
      case "n": next(); break;
      case "p": prev(); break;
      case "m": state.muted = !state.muted; syncVolumeUI(); save(); break;
      case "f": toggleFullscreen(); break;
      case "arrowright": if (!onSlider) { e.preventDefault(); skip(10); } break;
      case "arrowleft": if (!onSlider) { e.preventDefault(); skip(-10); } break;
      case "arrowup": if (!onSlider) { e.preventDefault(); setVolume(state.volume + 0.05); } break;
      case "arrowdown": if (!onSlider) { e.preventDefault(); setVolume(state.volume - 0.05); } break;
      case "escape": if (!els.settings.hidden) setSettings(false); break;
    }
  });

  /* ---------- Lock screen / headphone controls ---------- */

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", togglePlay);
    ms.setActionHandler("pause", togglePlay);
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("previoustrack", prev);
  }

  /* ---------- Start ---------- */

  async function begin() {
    body.classList.remove("intro-open");
    if (state.video) playVideo();
    wake();
    if (audio.paused) {
      setPlaying(true);
      const ok = await startPlayback(3000);
      if (!ok) setPlaying(false);
    }
    els.play.focus({ preventScroll: true });
  }

  els.begin.addEventListener("click", begin);

  // Pause the video when the tab is hidden to save battery; music keeps going
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseVideo(); else if (state.video) playVideo();
  });

  // Browsers sometimes refuse silent autoplay; retry on first touch
  document.addEventListener("pointerdown", () => { if (state.video && activeVideo().paused) playVideo(); }, { once: true });

  els.prev.addEventListener("click", prev);
  els.next.addEventListener("click", next);
  els.play.addEventListener("click", togglePlay);

  setupVideo();
  syncVolumeUI(); syncDim(); syncClock(); syncVideo(); updateClock();
  loadTrack(0);
  setPlaying(false);

  // If the browser allows sound without a click (some do for returning visitors), skip the entry screen
  audio.volume = 0;
  audio.play().then(() => {
    audio.pause(); audio.currentTime = 0;
    begin();
  }).catch(() => { fade = 1; applyVolume(); els.begin.focus({ preventScroll: true }); });
})();
