import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT } from "@devot/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";

const port = Number(process.env.PORT ?? SERVER_PORT);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

gameServer.define(ROOM_NAME, WorldRoom);

void gameServer.listen(port).then(() => {
  console.log(`[devot] serveur monde sur ws://localhost:${port}`);
});
