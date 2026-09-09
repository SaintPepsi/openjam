// Envelope tags shared by the MAIN-world producers (rrweb recorder, page probe)
// and the isolated-world relay. One definition, so a typo cannot silently
// disconnect a channel.
export const TO_RELAY = "oj-rec-to-relay"; // MAIN world -> relay
export const FROM_RELAY = "oj-relay-to-rec"; // relay -> MAIN world
export const FLUSH_INTERVAL_MS = 500;
// The pagehide hop: a postMessage is a queued task and dies with the unloading
// document, a DOM event reaches every world's listeners synchronously. detail is
// the batch as a JSON string: primitives cross the world boundary, objects don't.
export const RECORDER_FLUSH_EVENT = "oj-recorder-flush";
export const PROBE_FLUSH_EVENT = "oj-probe-flush";
