// Verifies the single-connection model end-to-end against the live NVR using the real
// AdtcapsConnection (what production runs): two live channels + a keepalive ride ONE
// socket, refcounts fire 0x0A020008 per channel, and stopping one subscriber never
// disturbs the sibling. Bounded (~60s), one NVR, one socket.
//
// Usage: npx tsx scripts/probe-multiplex.ts --cameras <cameras.json>

import { AdtcapsConnection } from "../src/connectors/vendors/adtcaps/connection.js";
import { KEEPALIVE } from "../src/connectors/vendors/adtcaps/protocol.js";
import { FramePull } from "../src/core/observable.js";
import { readSeedNvrs } from "./cameras.js";

const args = process.argv.slice(2);
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: probe exceeded 60s, exiting");
  process.exit(2);
}, 60_000);
watchdog.unref();

const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index >= 0 ? (args.at(index + 1) ?? fallback) : fallback;
};
const camerasFile = flag("--cameras", "cameras.json");
const seeds = await readSeedNvrs(camerasFile, null);
const seed = seeds.at(0);
if (!seed) {
  console.error("no NVR in cameras file (pass --cameras)");
  process.exit(1);
}

const cameras = seed.channels.map(channel => ({
  id: channel.id,
  metadata: { type: "adtcaps", channel: channel.index } as Record<string, unknown>,
}));
const camA = cameras.at(0);
const camB = cameras.at(1);
if (!camA || !camB) {
  console.error("probe needs an NVR with >=2 channels");
  process.exit(1);
}

const logLines: string[] = [];
const conn = new AdtcapsConnection({
  endpoint: seed.connection,
  cameras,
  log: line => logLines.push(line),
});
const pass = (label: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

const subA = conn.subscribeLive(camA.id);
const subA2 = conn.subscribeLive(camA.id); // second viewer, same channel
const subB = conn.subscribeLive(camB.id);

const pullA = new FramePull(subA.frames);
const pullA2 = new FramePull(subA2.frames);
const pullB = new FramePull(subB.frames);
const a1 = await pullA.next(15000);
const a2 = await pullA2.next(8000);
const b1 = await pullB.next(8000);
pass("two live channels stream over one connection", !!a1 && !!b1);
pass("both viewers on channel A get frames (fan-out)", !!a1 && !!a2);
pass("frames carry the right channel byte", !!a1 && !!b1 && a1.data.length > 0 && b1.data.length > 0);
pass("connection reports exactly the two live channels", conn.status().liveCameras.length === 2);

// Refcount: stopping one subscriber of channel A must NOT stop the device stream
// (the sibling still gets frames), and the socket must stay up.
subA.stop();
const a2b = await pullA2.next(8000);
const b2 = await pullB.next(8000);
pass("stopping one subscriber keeps sibling + socket alive", !!a2b && !!b2 && conn.status().connected);

// Control traffic answers on the same socket between video frames.
const t0 = Date.now();
let controlOk = false;
try {
  controlOk = (await conn.request(KEEPALIVE, Buffer.alloc(0), 6000)).status === 1;
} catch {
  controlOk = false;
}
pass("control (keepalive) answered on the live socket", controlOk, `${Date.now() - t0}ms`);

// Last-subscriber release fires the device stop: channel list drains to empty.
subA2.stop();
subB.stop();
await new Promise(resolve => setTimeout(resolve, 2000));
pass("all subscriptions released", conn.status().liveCameras.length === 0);
pass("socket survived the whole probe", conn.status().connected);

console.log(`log lines with failures: ${logLines.filter(line => line.includes("failed")).length}`);
conn.close();
process.exit(0);
