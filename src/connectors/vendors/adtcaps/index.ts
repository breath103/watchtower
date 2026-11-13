import { defineConnector } from "../../../core/connector.js";
import { AdtcapsConnection, adtcapsConnectionConfig } from "./connection.js";

// The connector for STL NVA-series NVRs ("ADTCaps" protocol): one persistent
// socket for control/live/thumbnails with per-channel refcounted stops
// (0x0A020008), plus short-lived VOD sockets for playback. All protocol
// knowledge lives in this folder; everything above raw frames is generic.
export const AdtcapsConnector = defineConnector({
  id: "adtcaps",
  title: "ADTCaps (STL NVA series)",
  description:
    "Reverse-engineered protocol of STL NVA-xxxx NVRs: persistent control socket, refcounted live channels, VOD playback, per-minute recording timeline.",
  connectionConfigSchema: adtcapsConnectionConfig,
  capabilities: { live: true, playback: true, recordings: true },
  streams: [
    { id: "main", label: "Main stream" },
    { id: "sub", label: "Sub stream" },
  ],
  create: (config, ctx) => new AdtcapsConnection({ endpoint: config, cameras: ctx.cameras, logger: ctx.logger }),
});
