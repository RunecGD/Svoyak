import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleGame} from '../server/game.mjs';
import {testDatabase} from './helpers.mjs';
import {migrate} from '../server/migrate.mjs';
test('PostgreSQL migrations, atomic buzzer, authorization, scoring and recovery',async()=>{
 const db=await testDatabase();
 try{
  await migrate(db.pool); // second start must preserve schema/data
  async function call(b,owner=false){const r=await handleGame(new Request('http://quiz.test/api/game',{method:'POST',body:JSON.stringify(b)}),db,owner?'admin':null);return {status:r.status,...await r.json()}}
  assert.equal((await call({action:'create',categories:[]})).status,401);
  let s=await call({action:'create',categories:[{name:'Тест',questions:[{value:100,text:'Вопрос',answer:'Секретный ответ'},{value:200,text:'Ещё',answer:'Ответ'}]}]},true);assert.equal(s.status,200);const room=s.id,invite=s.invite;
  const players=[];for(let i=0;i<24;i++){const p=await call({action:'join',room,invite,name:'Игрок '+i});assert(p.token);players.push(p)}
  assert.equal((await call({action:'join',room,invite,name:'Лишний'})).status,400);
  assert.equal((await call({action:'join',room,invite:'wrong',name:'Чужой'})).status,403);
  assert.equal((await call({action:'start',room,token:players[0].token})).status,403);
  async function host(action,extra={}){s=await call({action:'state',room},true);s=await call({action,room,version:s.version,...extra},true);assert.equal(s.status,200,JSON.stringify(s));return s}
  await host('start');await host('open',{question:s.categories[0].questions[0].id});await host('arm');const epoch=s.epoch;
  const result=await Promise.all(players.map(p=>call({action:'buzz',room,token:p.token,epoch})));assert.equal(result.filter(r=>r.status===200).length,1);
  s=await call({action:'state',room},true);assert(s.winner);assert(!s.players[0].token);const first=players.find(p=>p.me===s.winner);await host('judge',{correct:false});
  assert.equal((await call({action:'buzz',room,token:first.token,epoch:s.epoch})).status,400);
  const other=players.find(p=>p.me!==first.me);
  assert.equal((await call({action:'buzz',room,token:other.token,epoch})).status,400);
  assert.equal((await call({action:'buzz',room,token:other.token,epoch:s.epoch})).status,200);
  await host('judge',{correct:true});assert.equal(s.active,null);assert.equal(s.categories[0].questions[0].used,true);assert.equal(s.players.reduce((n,p)=>n+p.score,0),0);
  assert.equal((await call({action:'judge',room,version:s.version,correct:true},true)).status,400);
  assert.equal((await call({action:'score',room,version:s.version-1,player:other.me,delta:100},true)).status,409);
  const guest=await call({action:'state',room,token:first.token});assert(!JSON.stringify(guest).includes('Секретный'));assert.equal(guest.invite,undefined);
  await migrate(db.pool);const restored=await call({action:'state',room},true);assert.equal(restored.version,s.version);assert.equal(restored.players.length,24);
  await host('finish');assert.equal((await call({action:'start',room,version:s.version},true)).status,400);
 }finally{await db.close()}
});
