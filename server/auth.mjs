import {createHmac,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
export function createAuth(password,secret,secure=true){
 if(!password||password.length<16)throw Error('ADMIN_PASSWORD must have at least 16 characters');
 if(!secret||secret.length<32)throw Error('SESSION_SECRET must have at least 32 characters');
 const salt=randomBytes(16),hash=scryptSync(password,salt,32);
 const sign=data=>createHmac('sha256',secret).update(data).digest('base64url');
 const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
 const cookie=value=>`sv_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value?86400:0}${secure?'; Secure':''}`;
 return {
  verifyPassword(value){if(typeof value!=='string'||value.length>1024)return false;return timingSafeEqual(hash,scryptSync(value,salt,32))},
  issue(){const data=Buffer.from(JSON.stringify({sub:'admin',exp:Date.now()+86400000,nonce:randomBytes(16).toString('hex')})).toString('base64url');return cookie(data+'.'+sign(data))},
  clear(){return cookie('')},
  user(headers){try{const value=(headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sv_session='))?.slice(11);if(!value)return null;const [data,sig]=value.split('.');if(!sig||!same(sign(data),sig))return null;const payload=JSON.parse(Buffer.from(data,'base64url').toString());return payload.sub==='admin'&&payload.exp>Date.now()?'admin':null}catch{return null}}
 };
}
