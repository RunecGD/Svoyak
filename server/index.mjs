import pg from 'pg';
import {createDatabase} from './db.mjs';
import {migrate} from './migrate.mjs';
import {createApp} from './app.mjs';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const db=createDatabase(process.env.DATABASE_URL);
await migrate(db.pool);
const listeners=new Set();let stopping=false,subscriber;
async function listen(){
 if(stopping)return;
 const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});subscriber=client;
 client.on('notification',m=>{if(m.channel==='svoyak_rooms')for(const fn of listeners)fn(m.payload)});
 let retry=false;const reconnect=()=>{if(retry||stopping)return;retry=true;client.end().catch(()=>{});setTimeout(listen,3000).unref()};
 client.on('error',reconnect);client.on('end',reconnect);
 try{await client.connect();await client.query('LISTEN svoyak_rooms')}catch{reconnect()}
}
await listen();
const app=createApp({db,password:process.env.ADMIN_PASSWORD,secret:process.env.SESSION_SECRET,production:process.env.NODE_ENV==='production',publish:room=>db.pool.query("SELECT pg_notify('svoyak_rooms',$1)",[room]),onSubscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}});
app.server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Свояк: server ready'));
async function shutdown(){if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),10000);timer.unref();await app.close();await subscriber?.end().catch(()=>{});await db.pool.end();clearTimeout(timer)}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
