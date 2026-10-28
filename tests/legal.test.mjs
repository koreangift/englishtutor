import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,cp,readFile,access,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scenario=process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1];
if(!scenario){
 for(const mode of ['ready','unconfigured','cloud'])test(mode,()=>{execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--scenario='+mode],{stdio:'pipe',env:{...process.env,ADMIN_TOKEN:'a'.repeat(48),OPERATOR_NAME:'테스트 운영자',CONTACT_EMAIL:'operator@example.test',PRIVACY_OFFICER:'테스트 담당자',PRIVACY_INFRA_DETAILS:'테스트 전용 인프라 처리 내역',PRIVACY_INQUIRY_DETAILS:'테스트 전용 문의 처리 내역',VERCEL:mode==='cloud'?'1':'',BLOB_READ_WRITE_TOKEN:''}})});
}else{
 if(scenario==='unconfigured')delete process.env.OPERATOR_NAME;
 const runs=path.join(root,'.test-runs');await mkdir(runs,{recursive:true});const dir=await mkdtemp(path.join(runs,'case-'));
 try{
 for(const file of ['server.mjs','storage.mjs','policy.mjs','public'])await cp(path.join(root,file),path.join(dir,file),{recursive:true});
 const {default:handler}=await import(pathToFileURL(path.join(dir,'server.mjs')));
 async function request(method,url,body,token,stream=false){const req=Readable.from(stream?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url,headers:{host:'localhost',...(token?{authorization:'Bearer '+token}:{})}});if(body!==undefined&&!stream)req.body=body;let status,content;const headers={};const res={setHeader(k,v){headers[k]=v},writeHead(s,h){status=s;Object.assign(headers,h)},end(v){content=v},headersSent:false};await handler(req,res);return {status,content,headers}}
 const config=JSON.parse((await request('GET','/api/config')).content);assert.equal(config.legalReady,scenario!=='unconfigured');assert.equal(config.uploadsEnabled,scenario==='ready');assert.ok(!JSON.stringify(config).includes(process.env.ADMIN_TOKEN));
 for(const page of ['/','/privacy','/terms','/copyright']){const r=await request('GET',page);assert.equal(r.status,200);assert.match(r.headers['Content-Security-Policy'],/frame-ancestors 'none'/)}
 assert.equal((await request('POST','/api/materials',{})).status,401);
 assert.equal((await request('GET','/api/admin/materials')).status,401);
 assert.equal((await request('DELETE','/api/materials/abc')).status,401);
 const token=process.env.ADMIN_TOKEN;
 const payload={title:'권리 확인 자료',category:'어휘',grade:'고3',filename:'test.txt',base64:Buffer.from('exact original').toString('base64'),source:'직접 제작',credit:'테스트 운영자',usage:'개인 학습용 열람만 허락',rightsBasis:'self',rightsEvidence:'private-evidence-marker',rightsConfirmed:true,privacyConfirmed:true,policyVersion:'2026-10-28'};
 if(scenario==='ready'){
 assert.equal((await request('POST','/api/materials',{...payload,rightsConfirmed:false},token)).status,400);
 assert.equal((await request('POST','/api/materials',{...payload,privacyConfirmed:false},token)).status,400);
 assert.equal((await request('POST','/api/materials',{...payload,policyVersion:'old'},token)).status,400);
 const a=await request('POST','/api/materials',payload,token,true);assert.equal(a.status,201);const {id}=JSON.parse(a.content);
 const list=await request('GET','/api/materials');assert.equal(JSON.parse(list.content).length,1);assert.ok(!list.content.includes('private-evidence-marker'));assert.ok(!list.content.includes('storage'));
 assert.equal((await request('GET',`/api/materials/${id}/download`)).content.toString(),'exact original');
 assert.equal((await request('DELETE',`/api/materials/${id}`,undefined,'wrong')).status,401);
 assert.equal((await request('DELETE',`/api/materials/${id}`,undefined,token)).status,200);
 assert.equal((await request('GET',`/api/materials/${id}/download`)).status,404);
 assert.deepEqual(JSON.parse((await request('GET','/api/materials')).content),[]);
 await assert.rejects(access(path.join(dir,'data/files',id+'.txt')));
 const legacy={...payload,id:'legacy',storage:'legacy.txt'};delete legacy.policyVersion;
 const {saveMaterial}=await import(pathToFileURL(path.join(dir,'storage.mjs')));await saveMaterial(legacy,Buffer.from('old'));
 assert.deepEqual(JSON.parse((await request('GET','/api/materials')).content),[]);assert.equal((await request('GET','/api/materials/legacy/download')).status,404);
 assert.equal(JSON.parse((await request('GET','/api/admin/materials',undefined,token)).content).length,1);
 }else{assert.equal((await request('POST','/api/materials',payload,token)).status,503);assert.deepEqual(JSON.parse((await request('GET','/api/materials')).content),[]);await assert.rejects(access(path.join(dir,'data')))}
 const css=await readFile(path.join(dir,'public/style.css'),'utf8');assert.ok(!css.includes('fonts.googleapis.com'));console.log('PASS '+scenario);
 }finally{await rm(dir,{recursive:true,force:true})}
}
