import type { Socket } from "node:net";

import { connectTcp, FrameReader, login, openVod } from "./protocol.js";

interface AdtcapsEndpoint {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface VodSession {
  socket: Socket;
  reader: FrameReader;
  close: () => void;
}

async function connect(endpoint: AdtcapsEndpoint): Promise<{ socket: Socket; reader: FrameReader }> {
  const socket = await connectTcp(endpoint.host, endpoint.port, 8_000);
  socket.setNoDelay(true);
  const reader = new FrameReader(socket);
  try {
    await login(socket, reader, { username: endpoint.username, password: endpoint.password });
    return { socket, reader };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

// Short-lived VOD session for playback/clip fetches. Live view and thumbnails
// ride the persistent connection, so only VOD opens a socket that closes when
// the fetch is done.
export async function openVodSession(opts: {
  endpoint: AdtcapsEndpoint;
  channel: number;
  date: number;
  time: number;
  substream?: boolean;
}): Promise<VodSession> {
  const { socket, reader } = await connect(opts.endpoint);
  try {
    const response = await openVod(socket, reader, {
      channel: opts.channel,
      date: opts.date,
      time: opts.time,
      substream: opts.substream,
    });
    if (response.status !== 1) throw new Error(`open VOD channel ${opts.channel} rejected (status ${response.status})`);
    return { socket, reader, close: () => socket.destroy() };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
