// Client-side audio coordination only; never controls membership or DRM access.
const interruptions = new Set<symbol>();
const listeners = new Set<() => void>();

export const isMusicSuspended = () => interruptions.size > 0;
export function subscribeMusicFocus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Each player owns its release, including close, errors and route unmounts. */
export function suspendBackgroundMusic() {
  const interruption = Symbol("theatre-player");
  interruptions.add(interruption);
  listeners.forEach(listener => listener());
  return () => {
    if (interruptions.delete(interruption)) listeners.forEach(listener => listener());
  };
}
