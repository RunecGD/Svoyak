import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {testDatabase} from './helpers.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=','base64');
test('Photo upload, deduplication, protected download, question persistence, remove and invalid images',async()=>{
 const db=await testDatabase(),app=createApp({db,password:'test-password-long-enough',secret:'x'.repeat(64),production:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password-long-enough'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  async function upload(bytes,type='image/png',auth=cookie){return fetch(base+'/api/images',{method:'POST',headers:{cookie:auth,'Content-Type':type},body:bytes})}
  assert.equal((await upload(png,'image/png','')).status,401);
  assert.equal((await upload(Buffer.from('<svg></svg>'),'image/svg+xml')).status,415);
  assert.equal((await upload(Buffer.alloc(1048577))).status,413);
  const r=await upload(png);assert.equal(r.status,200);const {imageId}=await r.json();assert.match(imageId,/^[a-f0-9]{64}$/);
  assert.equal((await (await upload(png)).json()).imageId,imageId);
  const photo=await fetch(base+'/api/images/'+imageId,{headers:{cookie}});assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await photo.arrayBuffer()),png);
  assert.equal((await fetch(base+'/api/images/'+imageId)).status,401);
  async function game(b){const r=await fetch(base+'/api/game',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,...await r.json()}}
  const categories=[{name:'Фотография',questions:[{text:'Что на фото?',answer:'Пиксель',value:100,imageId}]}];
  const room=await game({action:'create',categories});assert.equal(room.status,200);assert.equal(room.categories[0].questions[0].imageId,imageId);
  const restored=await game({action:'state',room:room.id});assert.equal(restored.categories[0].questions[0].imageId,imageId);
  const removed=await game({action:'save',room:room.id,version:room.version,categories:[{name:'Тема',questions:[{text:'Вопрос',answer:'Ответ',value:100,imageId:null}]}]});assert.equal(removed.status,200);assert.equal(removed.categories[0].questions[0].imageId,null);
  categories[0].questions[0].imageId='0'.repeat(64);assert.equal((await game({action:'create',categories})).status,400);
 }finally{await app.close();await db.close()}
});
