import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {WebSocketServer,WebSocket} from 'ws';
import {handleGame} from './game.mjs';
import {createAuth} from './auth.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createApp({db,password,secret,production=true,dist=path.resolve('dist'),publish,onSubscribe}){
 const auth=createAuth(password,secret,production),wss=new WebSocketServer({noServer:true,maxPayload:4096}),limits=new Map();
 const limit=(key,max,ms)=>{const now=Date.now();let e=limits.get(key);if(!e||e.until<now){e={count:0,until:now+ms};limits.set(key,e)}return ++e.count<=max};
 const ip=req=>process.env.RENDER?(req.headers['x-forwarded-for']||'').split(',').at(-1).trim()||req.socket.remoteAddress:req.socket.remoteAddress;
 const origin=req=>`${production?'https':'http'}://${req.headers.host}`;
 const sameOrigin=req=>!req.headers.origin||req.headers.origin===origin(req);
 const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
 async function read(req){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>150000)throw Error('payload too large')}return JSON.parse(body||'{}')}
 const security={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};
 async function state(ws){if(ws.readyState!==WebSocket.OPEN||!ws.credentials)return;const r=await handleGame(new Request('http://internal/api/game',{method:'POST',body:JSON.stringify({action:'state',...ws.credentials})}),db,auth.user(ws.requestHeaders));const data=await r.json();if(r.ok){ws.send(JSON.stringify({type:'state',data}))}else{ws.send(JSON.stringify({type:'error',error:data.error}));ws.close(1008,'Unauthorized')}}
 async function broadcast(room){await Promise.allSettled([...wss.clients].filter(ws=>ws.credentials?.room===room).map(state))}
 const unsubscribe=onSubscribe?.(broadcast);
 const server=http.createServer(async(req,res)=>{
  for(const [name,value]of Object.entries(security))res.setHeader(name,value);
  try{
   const url=new URL(req.url,origin(req));
   if(url.pathname==='/healthz'){try{await db.pool.query('SELECT 1');return json(res,200,{ok:true})}catch{return json(res,503,{ok:false})}}
   if(url.pathname.startsWith('/api/')){
    if(!sameOrigin(req))return json(res,403,{error:'Недопустимый источник'});
    if(!limit('api:'+ip(req),6000,60000))return json(res,429,{error:'Слишком много запросов'});
    if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,{authenticated:!!auth.user(req.headers)});
    if(req.method!=='POST')return json(res,405,{error:'Метод не поддерживается'});
    if(url.pathname==='/api/login'){
     if(!limit('login:'+ip(req),10,600000))return json(res,429,{error:'Слишком много попыток. Подождите 10 минут.'});
     const b=await read(req);if(!auth.verifyPassword(b.password))return json(res,401,{error:'Неверный пароль'});
     return json(res,200,{ok:true},{'Set-Cookie':auth.issue()});
    }
    if(url.pathname==='/api/logout')return json(res,200,{ok:true},{'Set-Cookie':auth.clear()});
    if(url.pathname==='/api/game'){
     const b=await read(req);
     const result=await handleGame(new Request(origin(req)+'/api/game',{method:'POST',body:JSON.stringify(b)}),db,auth.user(req.headers));
     const data=await result.json();json(res,result.status,data);
     if(result.ok&&!['state','list'].includes(b.action)){
      const room=data.id;await broadcast(room);if(publish)await publish(room);
     }return;
    }
    return json(res,404,{error:'Не найдено'});
   }
   if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Метод не поддерживается'});
   const requested=path.resolve(dist,'.'+decodeURIComponent(url.pathname));
   if(requested!==dist&&!requested.startsWith(dist+path.sep))return json(res,403,{error:'Доступ запрещён'});
   let file=requested;
   try{if(!(await fs.stat(file)).isFile())file=path.join(dist,'index.html')}catch{if(path.extname(url.pathname))return json(res,404,{error:'Не найдено'});file=path.join(dist,'index.html')}
   const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':file.includes(path.sep+'assets'+path.sep)?'public, max-age=31536000, immutable':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){console.error('Request failed:',e.code||e.name);if(!res.headersSent)json(res,400,{error:'Не удалось обработать запрос'});else res.end()}
 });
 server.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws'||!sameOrigin(req)||!limit('ws:'+ip(req),120,60000)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return}
  wss.handleUpgrade(req,socket,head,ws=>{ws.requestHeaders=req.headers;ws.alive=true;const timeout=setTimeout(()=>ws.close(1008,'Authentication required'),5000);ws.on('pong',()=>{ws.alive=true});ws.on('close',()=>clearTimeout(timeout));ws.on('error',()=>{});
   ws.on('message',async raw=>{try{if(ws.credentials)return;const b=JSON.parse(raw);if(b.type!=='subscribe'||typeof b.room!=='string')return ws.close(1008);ws.credentials={room:b.room.toUpperCase(),token:typeof b.token==='string'?b.token:undefined};clearTimeout(timeout);await state(ws)}catch{ws.close(1008)}});
  });
 });
 const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue}ws.alive=false;ws.ping()}for(const [k,v]of limits)if(v.until<Date.now())limits.delete(k)},30000);heartbeat.unref();
 async function close(){clearInterval(heartbeat);unsubscribe?.();for(const ws of wss.clients)ws.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 return {server,close,broadcast};
}
