import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const data=path.join(path.dirname(fileURLToPath(import.meta.url)),'data');
const cloud=Boolean(process.env.VERCEL);
export const maxFileSize=(cloud?3:25)*1024*1024;
export const storageReady=!cloud||Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const requireStorage=()=>{if(!storageReady)throw Object.assign(new Error('자료 저장소 연결이 필요합니다. Vercel에서 Private Blob 저장소를 연결한 후 다시 배포해 주세요.'),{status:503})};
const sdk=()=>import('@vercel/blob');
const options={access:'private'};
async function readBlob(name){const {get}=await sdk();const result=await get(name,{...options,useCache:false});return result?new Response(result.stream):null}
let records,queue=Promise.resolve();
async function localRecords(){if(!records){records=JSON.parse(await readFile(path.join(data,'materials.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return '[]';throw e}))}return records}
export async function listMaterials(){
 if(!storageReady)return [];
 if(!cloud)return localRecords();
 const {list}=await sdk();let cursor,items=[];
 do{const page=await list({prefix:'materials/meta/',cursor,limit:1000});items.push(...page.blobs);cursor=page.hasMore?page.cursor:undefined}while(cursor);
 const results=[];
 for(let i=0;i<items.length;i+=10){const batch=await Promise.all(items.slice(i,i+10).map(async item=>{const result=await readBlob(item.pathname);return result?result.json():null}));results.push(...batch.filter(Boolean))}
 return results;
}
export async function saveMaterial(record,bytes){
 requireStorage();
 if(cloud){const {put,del}=await sdk();const file=await put('materials/files/'+record.storage,bytes,{...options,addRandomSuffix:false});try{await put('materials/meta/'+record.id+'.json',JSON.stringify(record),{...options,addRandomSuffix:false,contentType:'application/json'})}catch(e){await del(file.url).catch(()=>{});throw e}return}
 const task=queue.then(async()=>{await mkdir(path.join(data,'files'),{recursive:true});const current=await localRecords();await writeFile(path.join(data,'files',record.storage),bytes);const next=[record,...current];try{await writeFile(path.join(data,'materials.json.tmp'),JSON.stringify(next,null,2));await rename(path.join(data,'materials.json.tmp'),path.join(data,'materials.json'));records=next}catch(e){await unlink(path.join(data,'files',record.storage)).catch(()=>{});throw e}});
 queue=task.catch(()=>{});await task;
}
export async function downloadMaterial(id){
 requireStorage();
 const item=cloud?await (await readBlob('materials/meta/'+id+'.json'))?.json():(await localRecords()).find(r=>r.id===id);
 if(!item)return null;
 const bytes=cloud?Buffer.from(await (await readBlob('materials/files/'+item.storage)).arrayBuffer()):await readFile(path.join(data,'files',item.storage));
 return {item,bytes};
}
