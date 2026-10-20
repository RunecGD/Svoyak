export async function uploadImage(blob:Blob):Promise<string>{
 const r=await fetch('/api/images',{method:'POST',headers:{'Content-Type':blob.type},body:blob});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось загрузить фото');return data.imageId;
}
export async function preparePhoto(file:File):Promise<Blob>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Выберите JPG, PNG или WebP');
 if(file.size>12*1048576)throw Error('Исходная фотография должна быть не больше 12 МБ');
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width*bitmap.height>40000000)throw Error('Размер фото слишком большой: максимум 40 мегапикселей');
  const canvas=document.createElement('canvas');const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const context=canvas.getContext('2d');if(!context)throw Error('Не удалось обработать фото');context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [.85,.7,.5]){
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Ошибка обработки фото')),'image/webp',quality));
   if(blob.size<=1048576)return blob;
  }
  throw Error('Фото слишком большое после сжатия. Выберите меньший размер.');
 }finally{bitmap.close()}
}
export async function exportWithImages(title:string,categories:any[]){
 const images:Record<string,string>={};
 for(const id of new Set<string>(categories.flatMap(c=>c.questions).map(q=>q.imageId).filter(Boolean))){
  const r=await fetch('/api/images/'+id);if(!r.ok)throw Error('Не удалось получить фото для экспорта');
  const blob=await r.blob();images[id]=await new Promise<string>((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(String(f.result));f.onerror=()=>reject(Error('Ошибка чтения фото'));f.readAsDataURL(blob)});
 }
 return {formatVersion:2,title,categories,images};
}
export async function importWithImages(file:File){
 if(file.size>150*1048576)throw Error('Пакет слишком большой');
 const data=JSON.parse(await file.text());
 if(!Array.isArray(data.categories)||!data.categories.length||data.categories.length>12||data.categories.some((c:any)=>typeof c.name!=='string'||!Array.isArray(c.questions)||c.questions.length>8||c.questions.some((q:any)=>typeof q.text!=='string'||typeof q.answer!=='string'||!Number.isFinite(q.value))))throw Error('Некорректный JSON-пакет');
 const ids=new Set<string>(data.categories.flatMap((c:any)=>c.questions).map((q:any)=>q.imageId).filter(Boolean));
 const blobs=new Map<string,Blob>();
 for(const id of ids){
  const value=data.images?.[id];
  if(typeof value!=='string')throw Error('В пакете отсутствует фотография. Экспортируйте пакет заново с исходного сайта.');
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if(!match||match[2].length>1400000)throw Error('Некорректная фотография в пакете');
  const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));blobs.set(id,new Blob([bytes],{type:match[1]}));
 }
 const mapping=new Map<string,string>();for(const [id,blob]of blobs)mapping.set(id,await uploadImage(blob));
 for(const c of data.categories)for(const q of c.questions)q.imageId=q.imageId?mapping.get(q.imageId):null;
 return data;
}
