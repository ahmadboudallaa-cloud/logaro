// =============================================================
// MINUTEUR SYNCHRONISÉ
// On ne stocke pas « le temps restant » qui change chaque seconde,
// mais l'instant de fin (endsAt). Chaque appareil calcule lui-même
// le temps restant : aucune écriture n'est nécessaire à chaque seconde.
// =============================================================

export function createTimer(seconds, now, label = "") {
  return { duration: seconds, endsAt: now + seconds * 1000, paused: false, label, expired: false };
}

export function remainingMs(timer, now) {
  if (!timer) return 0;
  if (timer.paused) return Math.max(0, timer.remaining || 0);
  return Math.max(0, timer.endsAt - now);
}

export function isExpired(timer, now) {
  return Boolean(timer) && !timer.paused && now >= timer.endsAt;
}

export function pauseTimer(timer, now) {
  return { ...timer, paused: true, remaining: remainingMs(timer, now) };
}

export function resumeTimer(timer, now) {
  const { remaining, ...rest } = timer;
  return { ...rest, paused: false, expired: false, endsAt: now + (remaining || 0) };
}

export function addTime(timer, seconds, now) {
  if (timer.paused) return { ...timer, remaining: (timer.remaining || 0) + seconds * 1000 };
  return { ...timer, expired: false, endsAt: Math.max(timer.endsAt, now) + seconds * 1000 };
}

/** 83 000 ms → « 01:23 » */
export function formatDuration(ms) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
