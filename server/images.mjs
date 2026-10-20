import {createHash} from 'node:crypto';
const MAX_IMAGE_BYTES=1048576,MAX_STORAGE_BYTES=100*1048576;
export function imageType(bytes){
 if(bytes.length>12&&bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(bytes.length>24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
export async function imageRoute(req,res,pathname,db,owner,json){
 if(!owner){json(res,401,{error:'Фотографии доступны только ведущему'});return}
 if(pathname==='/api/images'&&req.method==='POST'){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_IMAGE_BYTES){json(res,413,{error:'После сжатия фото должно быть не больше 1 МБ'});req.resume();return}chunks.push(chunk)}
  const bytes=Buffer.concat(chunks),type=imageType(bytes);
  if(!type||req.headers['content-type']?.split(';')[0]!==type){json(res,415,{error:'Поддерживаются только JPG, PNG и WebP'});return}
  const id=createHash('sha256').update(bytes).digest('hex');
  const client=await db.pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(724108204)');
   const existing=await client.query('SELECT id FROM question_images WHERE id=$1 AND owner=$2',[id,owner]);
   if(!existing.rows.length){
    // Remove only old uploads that no saved room references. Never removes an attached photo.
    await client.query("DELETE FROM question_images i WHERE i.owner=$1 AND i.created_at < now() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.owner=i.owner AND r.data LIKE '%' || i.id || '%')",[owner]);
    const usage=await client.query('SELECT COALESCE(SUM(octet_length(bytes)),0) AS total FROM question_images WHERE owner=$1',[owner]);
    if(Number(usage.rows[0].total)+size>MAX_STORAGE_BYTES){await client.query('ROLLBACK');json(res,413,{error:'Лимит фотографий 100 МБ исчерпан'});return}
    await client.query('INSERT INTO question_images (id,owner,content_type,bytes) VALUES ($1,$2,$3,$4)',[id,owner,type,bytes]);
   }else{await client.query('UPDATE question_images SET created_at=now() WHERE id=$1 AND owner=$2',[id,owner])}
   await client.query('COMMIT');json(res,200,{imageId:id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  return;
 }
 const id=pathname.slice('/api/images/'.length);
 if(req.method!=='GET'||!/^\w{64}$/.test(id)){json(res,404,{error:'Фото не найдено'});return}
 const result=await db.pool.query('SELECT content_type,bytes FROM question_images WHERE id=$1 AND owner=$2',[id,owner]);
 if(!result.rows.length){json(res,404,{error:'Фото не найдено'});return}
 const row=result.rows[0];res.writeHead(200,{'Content-Type':row.content_type,'Cache-Control':'private, no-store','Content-Disposition':'inline','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(row.bytes));
}
export async function validateImages(db,categories,owner){
 const ids=[...new Set(categories.flatMap(c=>c.questions).map(q=>q.imageId).filter(Boolean))];
 if(!ids.length)return;
 const result=await db.pool.query('SELECT id FROM question_images WHERE owner=$1 AND id=ANY($2::text[])',[owner,ids]);
 if(result.rows.length!==ids.length)throw Error('Одна из фотографий недоступна. Прикрепите её заново.');
}
