export type SoundState = "off" | "loading" | "on" | "error";
export const FOYER_SOUND_PREFERENCE = "continental:foyer-sound";

export function isFoyerPath(path: string | null) {
  return path === "/" || path === "/foyer";
}

/** One foyer session. No autoplay or audio download before a user gesture. */
export function connectFoyerAudio(
  audio: HTMLAudioElement,
  button: HTMLButtonElement,
  onState: (state: SoundState) => void,
) {
  let enabled = true;
  let activated = false;
  let disposed = false;
  let pending = false;
  let failed = false;
  let attempt = 0;
  try {
    enabled = localStorage.getItem(FOYER_SOUND_PREFERENCE) !== "off";
  } catch { /* Storage may be unavailable in private/restricted browsers. */ }
  audio.volume = 0.25;

  const allowed = () => !disposed && enabled && !document.hidden;
  const pause = () => {
    attempt += 1;
    pending = false;
    audio.pause();
    if (!disposed) onState("off");
  };
  const start = async () => {
    if (!allowed() || pending || !audio.paused) return;
    const current = ++attempt;
    activated = true;
    pending = true;
    failed = false;
    onState("loading");
    try {
      await audio.play();
      // A route change, mute or hidden tab may occur while play() is pending.
      if (!allowed()) audio.pause();
      else if (current === attempt) onState("on");
    } catch (error) {
      if (disposed || current !== attempt) return;
      const name = error instanceof Error ? error.name : "";
      failed = name !== "NotAllowedError" && name !== "AbortError";
      onState(failed ? "error" : "off");
    } finally {
      if (current === attempt) pending = false;
    }
  };
  const savePreference = () => {
    try { localStorage.setItem(FOYER_SOUND_PREFERENCE, enabled ? "on" : "off"); }
    catch { /* Audio controls still work without persistence. */ }
  };
  const toggle = () => {
    if (pending || !audio.paused) {
      enabled = false;
      pause();
    } else {
      enabled = true;
      if (failed) audio.load();
      void start();
    }
    savePreference();
  };
  const interact = (event: Event) => {
    // The control's click owns its toggle; don't also start audio on pointerup.
    if (event.target instanceof Node && button.contains(event.target)) return;
    if (event instanceof KeyboardEvent &&
        (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
         !["Enter", " "].includes(event.key))) return;
    if (enabled && !failed) void start();
  };
  const visibility = () => {
    if (document.hidden) pause();
    else if (activated && enabled && !failed) void start();
  };
  const pageHide = () => pause();
  const pageShow = () => {
    if (activated && enabled && !failed) void start();
  };
  const mediaError = () => {
    attempt += 1;
    pending = false;
    failed = true;
    audio.pause();
    if (!disposed) onState("error");
  };
  button.addEventListener("click", toggle);
  document.addEventListener("pointerup", interact);
  document.addEventListener("keydown", interact);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pageHide);
  window.addEventListener("pageshow", pageShow);
  audio.addEventListener("error", mediaError);

  return () => {
    disposed = true;
    pause();
    button.removeEventListener("click", toggle);
    document.removeEventListener("pointerup", interact);
    document.removeEventListener("keydown", interact);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pageHide);
    window.removeEventListener("pageshow", pageShow);
    audio.removeEventListener("error", mediaError);
  };
}
