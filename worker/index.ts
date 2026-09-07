import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { db } from "../lib/db";
import { schedule, scanNext } from "../lib/scanner";
const id = randomUUID();
let stopping = false, lastHeartbeat = 0;
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
createServer((_req,res)=>{const healthy=Date.now()-lastHeartbeat<60000;res.writeHead(healthy?200:503,{"Content-Type":"application/json"});res.end(JSON.stringify({service:"replyradar-worker",healthy}));}).listen(Number(process.env.PORT||3001),"0.0.0.0");
async function heartbeat(){while(!stopping){try{await db().query("insert into worker_heartbeats(id) values($1) on conflict(id) do update set last_seen_at=now()",[id]);lastHeartbeat=Date.now();}catch{console.error(JSON.stringify({event:"heartbeat_failed"}));}await sleep(15000);}}
async function scans(){while(!stopping){try{await schedule();for(let n=0;n<25&&!stopping;n++)if(!(await scanNext()))break;}catch{console.error(JSON.stringify({event:"scan_loop_failed"}));}await sleep(1000);}}
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{stopping=true;setTimeout(()=>process.exit(0),25000).unref();});
if(!process.env.DATABASE_URL)throw new Error("Set DATABASE_URL before starting the worker.");
await Promise.all([heartbeat(),scans()]);
await db().end();
process.exit(0);
