import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../server/app.mjs';
import {testDatabase} from './helpers.mjs';

test('HTTP login, forged identity rejection, CSRF, WebSocket updates, reconnect and logout',async()=>{
 const db=await testDatabase();const app=createApp({db,password:'test-password-long-enough',secret:'a'.repeat(64),production:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port,url='http://127.0.0.1:'+port;const sockets=[];
 try{
  async function post(route,body,cookie='',headers={}){const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',cookie,...headers},body:JSON.stringify(body)});return {status:r.status,cookie:r.headers.get('set-cookie'),...await r.json()}}
  assert.equal((await fetch(url+'/healthz')).status,200);
  assert.equal((await post('/api/game',{action:'create' },'',{'oai-authenticated-user-id':'admin'})).status,401);
  assert.equal((await post('/api/login',{password:'wrong'})).status,401);
  assert.equal((await post('/api/login',{password:'test-password-long-enough'},'',{Origin:'https://evil.test'})).status,403);
  const login=await post('/api/login',{password:'test-password-long-enough'});assert.equal(login.status,200);assert(login.cookie.includes('HttpOnly'));const cookie=login.cookie.split(';')[0];
  let s=await post('/api/game',{action:'create',categories:[{name:'Тема',questions:[{text:'Вопрос',answer:'Секрет',value:100}]}]},cookie);
  const room=s.id;assert(room);
  const p=await post('/api/game',{action:'join',room,invite:s.invite,name:'Игрок'});
  async function socket(token){const ws=new WebSocket('ws://127.0.0.1:'+port+'/ws',{origin:url});sockets.push(ws);await once(ws,'open');const first=once(ws,'message');ws.send(JSON.stringify({type:'subscribe',room,token}));const [data]=await first;return {ws,data:JSON.parse(data)}}
  const {ws,data}=await socket(p.token);assert.equal(data.type,'state');assert(!JSON.stringify(data).includes('Секрет'));assert(!data.data.categories);
  s=await post('/api/game',{action:'state',room},cookie);const changed=once(ws,'message');
  s=await post('/api/game',{action:'start',room,version:s.version},cookie);const [event]=await changed;assert.equal(JSON.parse(event).data.phase,'playing');
  ws.close();const resumed=await socket(p.token);assert.equal(resumed.data.data.phase,'playing');
  const rejected=await socket('invalid-token');assert.equal(rejected.data.type,'error');
  const out=await post('/api/logout',{},cookie);assert(out.cookie.includes('Max-Age=0'));
  assert.equal((await post('/api/game',{action:'state',room})).status,403);
  assert.equal((await fetch(url+'/')).status,200);
 }finally{for(const s of sockets)s.terminate();await app.close();await db.close()}
});
