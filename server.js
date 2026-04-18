const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3000 });

let rooms = {};

function makeId(){
  return Math.random().toString(36).substring(2,7);
}

wss.on("connection", (ws) => {
  ws.id = makeId();
  ws.room = null;

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if(data.type === "createRoom"){
      const code = makeId();
      rooms[code] = {
        code,
        public: data.public,
        players: {}
      };

      ws.room = code;
      rooms[code].players[ws.id] = {
        x: 500, y: 500,
        dir:{x:1,y:0},
        len:25,
        dead:false
      };

      ws.send(JSON.stringify({type:"roomCreated", code}));
    }

    if(data.type === "joinRoom"){
      const r = rooms[data.code];
      if(!r) return;

      ws.room = data.code;

      r.players[ws.id] = {
        x: 500, y: 500,
        dir:{x:1,y:0},
        len:25,
        dead:false
      };
    }

    if(data.type === "input"){
      const r = rooms[ws.room];
      if(!r) return;

      const p = r.players[ws.id];
      if(!p) return;

      p.dir = data.dir;
    }
  });

  ws.on("close", ()=>{
    if(ws.room && rooms[ws.room]){
      delete rooms[ws.room].players[ws.id];
    }
  });
});

setInterval(()=>{
  for(let code in rooms){
    let r = rooms[code];

    for(let id in r.players){
      let p = r.players[id];

      if(p.dead) continue;

      p.x += p.dir.x * 4;
      p.y += p.dir.y * 4;

      for(let id2 in r.players){
        if(id === id2) continue;

        let o = r.players[id2];

        let dx = p.x - o.x;
        let dy = p.y - o.y;

        if(Math.sqrt(dx*dx+dy*dy) < 15){
          // respawn
          p.x = 500;
          p.y = 500;
          p.len = 25;
        }
      }
    }

    for(let id in r.players){
      let wsClient = [...wss.clients].find(c=>c.id===id);
      if(wsClient){
        wsClient.send(JSON.stringify({
          type:"state",
          players:r.players
        }));
      }
    }
  }
}, 50);

console.log("Server running on 3000");
