const http = require("http");
const WebSocket = require("ws");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const users = {}; // id -> {ws, name}
const sockets = new Map();

function id(){
  return Math.random().toString(36).substring(2,10);
}

function time(){
  return new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

function broadcast(obj){
  const data = JSON.stringify(obj);
  for(const u of Object.values(users)){
    u.ws.send(data);
  }
}

wss.on("connection", ws => {
  const uid = id();
  sockets.set(ws, uid);

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    /* SIGNUP */
    if(data.type === "join"){
      users[uid] = {
        ws,
        name: data.name
      };

      ws.send(JSON.stringify({
        type:"joined",
        id: uid,
        users: Object.values(users).map(u=>u.name)
      }));

      broadcast({
        type:"system",
        msg:`${data.name} joined chat`
      });
    }

    /* GLOBAL MESSAGE */
    if(data.type === "msg"){
      const u = users[uid];
      if(!u) return;

      broadcast({
        type:"msg",
        from: u.name,
        time: time(),
        text: data.text
      });
    }

    /* DM */
    if(data.type === "dm"){
      const from = users[uid];
      const to = Object.values(users).find(u => u.name === data.to);
      if(!from || !to) return;

      to.ws.send(JSON.stringify({
        type:"dm",
        from: from.name,
        text: data.text,
        time: time()
      }));

      from.ws.send(JSON.stringify({
        type:"dmSent",
        to: data.to,
        text: data.text,
        time: time()
      }));
    }
  });

  ws.on("close", () => {
    const uid = sockets.get(ws);
    if(users[uid]){
      delete users[uid];
    }
    sockets.delete(ws);
  });
});

server.listen(process.env.PORT || 3000);
