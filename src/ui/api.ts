import { createWatchtowerClient } from "../client.js";

export type { Response as ApiResponse } from "../client.js";

export const SIGNED_OUT = "watchtower:signed-out";

export const api = createWatchtowerClient({
  baseUrl: "",
  onUnauthorized: () => window.dispatchEvent(new Event(SIGNED_OUT)),
});
