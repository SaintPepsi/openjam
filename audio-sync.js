// Pure sync math for narration playback. No DOM — unit-tested in isolation.
// The whole timeline shares one wall clock (Date.now epoch ms); audio aligns to
// it via the report's audio.startWall, exactly like rrweb events.

// Wall-clock instant -> audio element currentTime (seconds), clamped to the track.
export function audioTimeFor(wallMs, startWall, durationMs) {
  if (startWall == null || durationMs == null) return 0;
  const offsetMs = Math.max(0, Math.min(wallMs - startWall, durationMs));
  return offsetMs / 1000;
}

// Inverse: the wall-clock instant an audio position corresponds to.
export function wallForAudioTime(currentTimeSec, startWall) {
  return startWall + currentTimeSec * 1000;
}
