import pg from 'pg';
export function createDatabase(connectionString) {
 const pool = new pg.Pool({connectionString,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000});
 pool.on('error',e=>console.error('Postgres pool error:',e.code || 'connection failed'));
 return databaseForPool(pool);
}
export function databaseForPool(pool){
 return {pool,prepare(sql){let index=0;const query=sql.replace(/\?/g,()=>'$'+(++index));return {bind(...params){return {
 async first(){return (await pool.query(query,params)).rows[0]||null},
 async all(){return {results:(await pool.query(query,params)).rows}},
 async run(){return {meta:{changes:(await pool.query(query,params)).rowCount}}}
 }}}}};
}
