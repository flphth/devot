import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT, VOXEL_ROOM_NAME } from "@devot/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { VoxelWorldRoom } from "./voxel/VoxelWorldRoom.js";

const port = Number(process.env.PORT ?? SERVER_PORT);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

// Le monde commun voxel (P5.3) : une seule instance, qui tourne en continu.
gameServer.define(VOXEL_ROOM_NAME, VoxelWorldRoom);
// L'ancien jeu LLM (P0→P4), conservé — le tag v0.4-devot-llm en garde la trace.
gameServer.define(ROOM_NAME, WorldRoom);

void gameServer.listen(port).then(() => {
  console.log(`[devot] serveur monde sur ws://localhost:${port}`);
});
