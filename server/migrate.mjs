import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createDatabase} from './db.mjs';
export async function migrate(pool){
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(724108203)");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort()){
   const sql=await fs.readFile(new URL(name,dir),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
   const {rows}=await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
   if(rows.length){if(rows[0].checksum!==checksum)throw Error('Applied migration changed: '+name);continue;}
   await client.query(sql);
   await client.query('INSERT INTO schema_migrations (name,checksum) VALUES ($1,$2)',[name,checksum]);
   console.log('Migration applied:',name);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const db=createDatabase(process.env.DATABASE_URL);try{await migrate(db.pool)}finally{await db.pool.end()}
}
