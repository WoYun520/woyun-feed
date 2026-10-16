import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {parseDotCandidates} from '../frontend/src/dotCandidates.js';
import {canonicalDotPayload} from '../dot-inbox-service.js';

// Reuses the existing private sender/receiver configuration. It cannot select
// featured items, publish content, read user collections, or expand access.
const endpoint='https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/inbox';
const input=process.argv[2];
if (!input) throw Error('请提供 candidate-envelope.json 的路径。');
const path=resolve(input),raw=await readFile(path,'utf8');
const parsed=parseDotCandidates(raw),payload=JSON.parse(raw);
if (parsed.collector!=='feedgrab' || parsed.total<1 || parsed.total>30) throw Error('本入口仅投递 1–30 条 feedgrab 真实采集素材。');
const privateDir=resolve(homedir(),'Library/Application Support/WoYun Feed/dot-inbox');
const sender=(await readFile(resolve(privateDir,'delivery-token.txt'),'utf8')).trim();
const receiver=(await readFile(resolve(privateDir,'review-code.txt'),'utf8')).trim();
if (![sender,receiver].every(v=>/^[\x21-\x7e]{16,1024}$/.test(v)) || sender===receiver) throw Error('本机接入配置不可用。');
const expected=createHash('sha256').update(canonicalDotPayload(payload)).digest('hex');
const posted=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Authorization':`Bearer ${sender}`,'Content-Type':'application/json'},body:raw,signal:AbortSignal.timeout(20000)});
const receipt=await posted.json();
if (![200,201].includes(posted.status) || receipt.id!==expected || receipt.item_count!==parsed.total) throw Error(`投递未通过（HTTP ${posted.status}）；未算作成功。`);
const result={checked_at:new Date().toISOString(),endpoint,post_status:posted.status,read_status:null,id:receipt.id,item_count:receipt.item_count,received_at:receipt.received_at,existing:receipt.existing,payload_equal:false,collector:parsed.collector,state:'received_readback_pending',read_attempts:0};
const reportPath=resolve(dirname(path),'delivery-verification.json');
await writeFile(reportPath,JSON.stringify(result,null,2)+'\n');
for (let attempt=0;attempt<3;attempt++) {
  if (attempt) await new Promise(resolve=>setTimeout(resolve,attempt*1500));
  result.read_attempts++;
  try {
    const readBack=await fetch(`${endpoint}/${expected}`,{redirect:'error',headers:{'Authorization':`Bearer ${receiver}`},signal:AbortSignal.timeout(20000)});
    result.read_status=readBack.status;
    if (readBack.ok) {
      const stored=await readBack.json();
      if (canonicalDotPayload(stored.payload)===canonicalDotPayload(payload)) {result.payload_equal=true;result.state='received_readback_verified';}
      else result.state='received_readback_mismatch';
      break;
    }
    if (![404,429,503].includes(readBack.status)) break;
  } catch {result.read_status=null;}
}
result.checked_at=new Date().toISOString();
await writeFile(reportPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if (!result.payload_equal) process.exitCode=2;
