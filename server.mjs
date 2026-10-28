import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listMaterials,saveMaterial,downloadMaterial,deleteMaterial,maxFileSize,storageReady} from './storage.mjs';
import {operator,legalReady,adminReady,POLICY_VERSION,policyPage} from './policy.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj))};
const authenticated=req=>{const supplied=(req.headers?.authorization||'').replace(/^Bearer /,'');return adminReady&&timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(process.env.ADMIN_TOKEN).digest())};
const publicRecord=r=>Object.fromEntries(['id','title','category','grade','description','filename','size','createdAt','source','credit','usage'].map(k=>[k,r[k]]));
const reviewed=r=>r.policyVersion===POLICY_VERSION&&r.rightsConfirmed===true&&r.privacyConfirmed===true;
export default async function handler(req,res){
 try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&['/privacy','/terms','/copyright'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(policyPage(url.pathname.slice(1)))}
  if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{maxFileSize,storageReady,legalReady,adminReady,uploadsEnabled:storageReady&&legalReady&&adminReady,operator:{name:operator.name,email:operator.email},policyVersion:POLICY_VERSION});
  if(req.method==='GET'&&url.pathname==='/api/admin/materials'){if(!authenticated(req))return send(res,401,{error:'관리자 인증이 필요합니다.'});return send(res,200,(await listMaterials()).map(r=>({...publicRecord(r),reviewed:reviewed(r)})))}
  if(req.method==='GET'&&url.pathname==='/api/materials'){return send(res,200,legalReady?(await listMaterials()).filter(reviewed).map(publicRecord):[])}
  if(req.method==='POST'&&url.pathname==='/api/materials'){
   if(!authenticated(req))return send(res,401,{error:'자료 등록은 관리자만 할 수 있습니다.'});
   if(!legalReady)return send(res,503,{error:'운영자 및 개인정보 처리 내역 설정 후 자료를 등록할 수 있습니다.'});
   if(req.headers?.origin&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'허용되지 않은 요청 출처입니다.'});
   let body='',size=0;
   if(req.body!==undefined){body=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):JSON.stringify(req.body);size=Buffer.byteLength(body)}
   else for await(const chunk of req){size+=chunk.length;if(size>Math.ceil(maxFileSize*4/3)+65536)return send(res,413,{error:`파일은 ${maxFileSize/1024/1024}MB까지 업로드할 수 있습니다.`});body+=chunk;}
   if(size>Math.ceil(maxFileSize*4/3)+65536)return send(res,413,{error:`파일은 ${maxFileSize/1024/1024}MB까지 업로드할 수 있습니다.`});
   let input;try{input=JSON.parse(body)}catch{return send(res,400,{error:'잘못된 요청입니다.'})}
   if(!input||typeof input!=='object')return send(res,400,{error:'잘못된 요청입니다.'});
   const {title,category,grade,description='',filename,base64}=input;
   const {source,credit,usage,rightsBasis,rightsEvidence,rightsConfirmed,privacyConfirmed,policyVersion}=input;
   if(policyVersion!==POLICY_VERSION||rightsConfirmed!==true||privacyConfirmed!==true||!['self','permission','open-license'].includes(rightsBasis)||[source,credit,usage,rightsEvidence].some(v=>typeof v!=='string'||!v.trim()||v.length>1000))return send(res,400,{error:'출처·권리자·이용조건·권리 근거와 공개 권한 및 개인정보 비포함 확인이 필요합니다.'});
   if(typeof title!=='string'||!title.trim()||title.length>120||!['기출문제','독해','어법','어휘','듣기','모의고사'].includes(category)||!['공통','고1','고2','고3'].includes(grade)||typeof description!=='string'||description.length>2000||typeof filename!=='string'||filename.length>200||typeof base64!=='string')return send(res,400,{error:'제목, 분류, 학년과 파일을 확인해 주세요.'});
   const ext=path.extname(filename).toLowerCase();
   if(!['.pdf','.hwp','.hwpx','.docx','.xlsx','.pptx','.txt','.zip','.mp3'].includes(ext))return send(res,400,{error:'지원하지 않는 파일 형식입니다.'});
   const bytes=Buffer.from(base64,'base64');
   if(!bytes.length||bytes.length>maxFileSize)return send(res,400,{error:`빈 파일이거나 ${maxFileSize/1024/1024}MB를 초과했습니다.`});
   const id=randomUUID(),storage=id+ext;
   const record={id,title:title.trim(),category,grade,description:description.trim(),filename:path.basename(filename),size:bytes.length,createdAt:new Date().toISOString(),storage,source:source.trim(),credit:credit.trim(),usage:usage.trim(),rightsBasis,rightsEvidence:rightsEvidence.trim(),rightsConfirmed,privacyConfirmed,policyVersion};
   await saveMaterial(record,bytes);return send(res,201,{id});
  }
  const match=url.pathname.match(/^\/api\/materials\/([a-f0-9-]+)\/download$/);
  if(req.method==='GET'&&match){if(!legalReady)return send(res,503,{error:'자료 공개 준비 중입니다.'});const metadata=(await listMaterials()).find(r=>r.id===match[1]);if(!metadata||!reviewed(metadata))return send(res,404,{error:'공개 중인 자료를 찾을 수 없습니다.'});const result=await downloadMaterial(match[1]);if(!result)return send(res,404,{error:'자료를 찾을 수 없습니다.'});const {item,bytes}=result;res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,'X-Content-Type-Options':'nosniff'});return res.end(bytes)}
  const deletion=url.pathname.match(/^\/api\/materials\/([a-f0-9-]+)$/);
  if(req.method==='DELETE'&&deletion){if(!authenticated(req))return send(res,401,{error:'관리자 인증이 필요합니다.'});const removed=await deleteMaterial(deletion[1]);return send(res,removed?200:404,removed?{deleted:true}:{error:'자료를 찾을 수 없습니다.'})}
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff'});return res.end(await readFile(path.join(root,'public',file)))}
  send(res,404,{error:'페이지를 찾을 수 없습니다.'});
 }catch(e){console.error('Request failed:',e.code||e.status||'internal');if(!res.headersSent)send(res,e.status||500,{error:e.status===503?e.message:'처리 중 오류가 발생했습니다. 다시 시도해 주세요.'});else res.end()}
}
if(!process.env.VERCEL&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))http.createServer(handler).listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log('English Tutor: http://127.0.0.1:'+(process.env.PORT||3000)));
