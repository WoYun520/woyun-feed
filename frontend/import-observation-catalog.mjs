import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read the public, static catalog as text. Never execute a supplied JavaScript file.
export function parseObservationCatalog(text) {
  if (typeof text!=='string' || Buffer.byteLength(text)>1_000_000) throw Error('观察仓库目录过大。');
  const entries=new Map();
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    const field=name=>{
      const found=match[1].match(new RegExp('\\b'+name+'"?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")'));
      return found ? JSON.parse(found[1]) : '';
    };
    const repository=field('fullName'),summary=field('capability');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !summary || summary.length>100) continue;
    entries.set(repository.toLowerCase(),{repository,summary,example:field('example').slice(0,300),audience:field('audience').slice(0,100),source_url:'https://github.com/'+repository});
  }
  if (!entries.size) throw Error('没有读到公开项目介绍，旧目录未改动。');
  return [...entries.values()];
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const input=process.argv[2];
  if (!input) throw Error('请提供观察仓库的 repository-data.js 路径。');
  const entries=parseObservationCatalog(await fs.readFile(input,'utf8'));
  const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
  await fs.mkdir(dir,{recursive:true});
  const target=path.join(dir,'observation-catalog.json'),tmp=target+'.tmp';
  await fs.writeFile(tmp,JSON.stringify({version:1,imported_at:new Date().toISOString(),origin:'观察仓库公开项目目录',entries},null,2),{mode:0o600});
  await fs.rename(tmp,target);
  console.log('已导入 '+entries.length+' 项公开介绍，不包含用户笔记、密钥或工作记录。');
}
