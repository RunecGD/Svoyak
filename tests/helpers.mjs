import {PGlite} from '@electric-sql/pglite';
import {createDatabase,databaseForPool} from '../server/db.mjs';
import {migrate} from '../server/migrate.mjs';
export async function testDatabase(){
 if(process.env.TEST_DATABASE_URL){
  const db=createDatabase(process.env.TEST_DATABASE_URL);await migrate(db.pool);await db.pool.query('TRUNCATE rooms');return {...db,close:()=>db.pool.end()};
 }
 const pg=new PGlite();await pg.waitReady;
 const query=async(sql,params=[])=>{
  if(sql.split(';').filter(x=>x.trim()).length>1){const r=await pg.exec(sql);return {...r.at(-1),rowCount:r.at(-1).affectedRows}}
  const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 await migrate(pool);return {...databaseForPool(pool),close:()=>pg.close()};
}
