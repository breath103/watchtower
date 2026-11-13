import { AdtcapsConnection } from "../src/connectors/vendors/adtcaps/connection.js";
import type { Logger } from "../src/core/logger.js";
import { connectorContract } from "./contract.js";
import { FakeConnection } from "./fake-connector.js";

const day = Date.UTC(2026, 10, 12);
const cameras = [{ id: "nvr-a", metadata: { slot: 0 } }];
const logger: Logger = { log: () => undefined, with: () => logger };

connectorContract(
  "fake",
  () =>
    new FakeConnection({ logger, cameras }, [
      { cameraId: "nvr-a", start: day - 3_600_000, end: day + 600_000 },
      { cameraId: "nvr-a", start: day + 1_200_000, end: day + 1_800_000 },
    ]),
  { camera: "nvr-a", from: day, to: day + 3_600_000 }
);

// Never reaches the network: unknown cameras are refused before any socket opens.
connectorContract(
  "adtcaps (offline)",
  () =>
    new AdtcapsConnection({
      endpoint: { host: "192.0.2.1", port: 1, username: "u", password: "p", timezone: "Asia/Seoul" },
      cameras: [{ id: "nvr-0", metadata: { channel: 0 } }],
      logger,
    }),
  { offline: true }
);
