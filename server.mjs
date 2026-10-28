import http from 'node:http';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)), data=path.join(root,'data');
await mkdir(path.join(data,'files'),{recursive:true});
const index=path.join(data,'materials.json');
let records=JSON.parse(await readFile(index,'utf8').catch(e=>{if(e.code==='ENOENT')return '[]';throw e}));
let queue=Promise.resolve();
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj))};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/materials')return send(res,200,records.map(({storage,...r})=>r));
  if(req.method==='POST'&&url.pathname==='/api/materials'){
   let body='',size=0;
   for await(const chunk of req){size+=chunk.length;if(size>36*1024*1024)return send(res,413,{error:'파일은 25MB까지 업로드할 수 있습니다.'});body+=chunk;}
   let input;try{input=JSON.parse(body)}catch{return send(res,400,{error:'잘못된 요청입니다.'})}
   const {title,category,grade,description='',filename,base64}=input;
   if(typeof title!=='string'||!title.trim()||title.length>120||!['기출문제','독해','어법','어휘','듣기','모의고사'].includes(category)||!['공통','고1','고2','고3'].includes(grade)||typeof description!=='string'||description.length>2000||typeof filename!=='string'||filename.length>200||typeof base64!=='string')return send(res,400,{error:'제목, 분류, 학년과 파일을 확인해 주세요.'});
   const ext=path.extname(filename).toLowerCase();
   if(!['.pdf','.hwp','.hwpx','.docx','.xlsx','.pptx','.txt','.zip','.mp3'].includes(ext))return send(res,400,{error:'지원하지 않는 파일 형식입니다.'});
   const bytes=Buffer.from(base64,'base64');
   if(!bytes.length||bytes.length>25*1024*1024)return send(res,400,{error:'빈 파일이거나 25MB를 초과했습니다.'});
   const id=randomUUID(),storage=id+ext;
   const record={id,title:title.trim(),category,grade,description:description.trim(),filename:path.basename(filename),size:bytes.length,createdAt:new Date().toISOString(),storage};
   const task=queue.then(async()=>{await writeFile(path.join(data,'files',storage),bytes);const next=[record,...records];try{await writeFile(index+'.tmp',JSON.stringify(next,null,2));await rename(index+'.tmp',index);records=next}catch(e){await unlink(path.join(data,'files',storage)).catch(()=>{});throw e}});
   queue=task.catch(()=>{});await task;return send(res,201,{id});
  }
  const match=url.pathname.match(/^\/api\/materials\/([a-f0-9-]+)\/download$/);
  if(req.method==='GET'&&match){const item=records.find(r=>r.id===match[1]);if(!item)return send(res,404,{error:'자료를 찾을 수 없습니다.'});const bytes=await readFile(path.join(data,'files',item.storage));res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,'X-Content-Type-Options':'nosniff'});return res.end(bytes)}
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff'});return res.end(await readFile(path.join(root,'public',file)))}
  send(res,404,{error:'페이지를 찾을 수 없습니다.'});
 }catch(e){console.error(e);if(!res.headersSent)send(res,500,{error:'처리 중 오류가 발생했습니다. 다시 시도해 주세요.'});else res.end()}
}).listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log('English Tutor: http://127.0.0.1:'+(process.env.PORT||3000)));
