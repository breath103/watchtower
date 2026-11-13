// Raw-wire probe documenting the per-channel STOP semantics verified on a live NVR
// — the finding that let the persistent connection become a single socket.
//
// Safe by default: opens two live channels on one authenticated socket and exercises only
// non-destructive frames. Destructive confirmations (the session killer) run only with
// --danger, and even then everything is hard-timeout bounded and closes the socket at exit.
//
// Usage (bounded ~2 min, one socket):
//   npx tsx scripts/probe-stop-channel.ts --cameras <cameras.json> [--channel-a 1] [--channel-b 2] [--danger]
//
// What it proves (the documented findings):
//   1. 0x0A020008 body [channel, 0] stops ONE channel's stream; response 0xAA020008
//      status=1 echoes the channel, and the socket stays authenticated and usable
//      (proved by reopening).
//   2. A stop for a never-opened channel is answered with an ERROR status:
//      0xAA020008 status=0xF00F20FF body=[03] (an earlier note had it
//      as silence — connection tolerates either by swallowing the stop timeout).
//   3. An unknown opcode is answered with status=0xF00F0001.
//   4. (--danger) 0x0A000001 with a zero-length body kills the session (device FINs).
//      NOT run unless asked; also: malformed bodies can FIN the socket outright.
//   5. 0x0AA00002 is NOT a close — it's a device-info query; the belief that it was
//      is what made the original design fear there was no per-channel stop.

import {
  connectTcp,
  type Frame,
  FrameReader,
  login,
  OPEN_CHANNEL,
  openChannelBody,
  STOP_CHANNEL,
  STREAM_PACKET,
  sendCommand,
  stopChannelBody,
} from "../src/connectors/vendors/adtcaps/protocol.js";
import { readSeedNvrs, type SeedNvr } from "./cameras.js";

const args = process.argv.slice(2);
const danger = args.includes("--danger");
const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index >= 0 ? (args.at(index + 1) ?? fallback) : fallback;
};

// Hard watchdog: this probe must never hang a terminal.
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: probe exceeded 120s, exiting");
  process.exit(2);
}, 120_000);
watchdog.unref();

const camerasFile = flag("--cameras", "cameras.json");
const seeds = await readSeedNvrs(camerasFile, null);
const seed = seeds.at(0);
if (!seed) {
  console.error("no NVR in cameras file (pass --cameras)");
  process.exit(1);
}
const channelA = Number(flag("--channel-a", "1"));
const channelB = Number(flag("--channel-b", "2"));

const sock = await connectTcp(seed.connection.host, seed.connection.port, 8000);
const reader = new FrameReader(sock);
let deliberateClose = false;
sock.on("close", () => {
  if (!deliberateClose) console.log("!! socket FINned by device");
});

const pass = (label: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

async function readUntil(stopAfter: number): Promise<Frame[]> {
  const out: Frame[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < stopAfter) {
    const frame = await reader.readFrame(4000).catch(() => null);
    if (!frame) break;
    out.push(frame);
  }
  return out;
}

async function main(seed: SeedNvr): Promise<void> {
  await login(sock, reader, { username: seed.connection.username, password: seed.connection.password });
  console.log(`logged in to ${seed.id} (${seed.connection.host}:${seed.connection.port})`);

  // Open both live channels.
  sendCommand(sock, OPEN_CHANNEL, openChannelBody({ channel: channelA }));
  const openA = await reader.readResponse(OPEN_CHANNEL);
  sendCommand(sock, OPEN_CHANNEL, openChannelBody({ channel: channelB }));
  const openB = await reader.readResponse(OPEN_CHANNEL);
  pass("both channels open", openA.status === 1 && openB.status === 1);

  // Both stream?
  const frames = await readUntil(2500);
  const aFrames = frames.filter(f => f.cmd === STREAM_PACKET && f.body[0] === channelA).length;
  const bFrames = frames.filter(f => f.cmd === STREAM_PACKET && f.body[0] === channelB).length;
  pass(
    "two streams fan out over ONE socket",
    aFrames > 0 && bFrames > 0,
    `ch${channelA}=${aFrames} ch${channelB}=${bFrames}`
  );

  // Finding 1: stop one channel, socket survives.
  sendCommand(sock, STOP_CHANNEL, stopChannelBody(channelA));
  const stop = await reader.readResponse(STOP_CHANNEL, 5000);
  pass("stop replies status=1 echoing channel", stop.status === 1 && stop.body[0] === channelA);
  const after = await readUntil(2500);
  const aAfter = after.filter(f => f.cmd === STREAM_PACKET && f.body[0] === channelA).length;
  const bAfter = after.filter(f => f.cmd === STREAM_PACKET && f.body[0] === channelB).length;
  pass("sibling channel untouched", aAfter === 0 && bAfter > 0, `ch${channelA}=${aAfter} ch${channelB}=${bAfter}`);

  // Socket still authenticated: reopen channel A.
  sendCommand(sock, OPEN_CHANNEL, openChannelBody({ channel: channelA }));
  const reopen = await reader.readResponse(OPEN_CHANNEL, 5000);
  pass("socket stays authenticated after stop (reopen works)", reopen.status === 1);
  sendCommand(sock, STOP_CHANNEL, stopChannelBody(channelA));
  await reader.readResponse(STOP_CHANNEL, 5000).catch(() => undefined);

  // Finding 2: a stop for a never-opened channel — characterize the reply.
  let idleReply: Frame | null = null;
  try {
    sendCommand(sock, STOP_CHANNEL, stopChannelBody(7));
    idleReply = await reader.readResponse(STOP_CHANNEL, 2500);
  } catch {
    idleReply = null;
  }
  console.log(
    `INFO  idle-channel stop reply: ${
      idleReply
        ? `cmd=0x${idleReply.cmd.toString(16)} status=0x${idleReply.status.toString(16)} body=${idleReply.body.subarray(0, 4).toString("hex")}`
        : "none (silent)"
    }`
  );

  // Finding 3: unknown opcode — match the reply BY CMD so device events don't
  // masquerade as the answer.
  let unknownStatus = 0;
  sendCommand(sock, 0x0a123456, Buffer.alloc(0));
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const frame = await reader.readFrame(1000).catch(() => null);
    if (!frame) break;
    if (frame.cmd === 0xaa123456) {
      unknownStatus = frame.status;
      break;
    }
  }
  pass("unknown opcode answers status=0xF00F0001", unknownStatus === 0xf00f0001, `got 0x${unknownStatus.toString(16)}`);

  // Finding 4: session killer — ONLY with --danger, do this last (it FINs the socket).
  if (danger) {
    console.log("--danger: confirming 0x0A000001 with empty body kills the session…");
    sendCommand(sock, 0x0a000001, Buffer.alloc(0));
    const dead = await new Promise<boolean>(resolve => {
      sock.once("close", () => resolve(true));
      setTimeout(() => resolve(!sock.writable), 4000).unref();
    });
    pass("0x0A000001 zero body killed the session", dead);
  }

  deliberateClose = true;
  sock.destroy();
}

await main(seed).catch((error: unknown) => {
  console.error("probe failed:", String(error));
  deliberateClose = true;
  sock.destroy();
  process.exit(1);
});
