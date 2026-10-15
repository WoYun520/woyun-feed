import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchFeed, checkServer } from './launch.mjs';
import { installationId } from './installation.js';

const here=path.dirname(fileURLToPath(import.meta.url));
async function fixture(t,{broken=false}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'feed launch 测试-'));
  const directory=path.join(root,'frontend');await fs.mkdir(directory);
  await fs.copyFile(path.join(here,'installation.js'),path.join(directory,'installation.js'));
  await fs.writeFile(path.join(root,'package.json'),' {"type":"module"}');
  await fs.writeFile(path.join(directory,'serve.js'),broken ? 'process.exit(1);' : `
    import http from 'node:http';import {installationId} from './installation.js';import path from 'node:path';
    import {fileURLToPath} from 'node:url';
    const installation_id=installationId(path.dirname(fileURLToPath(import.meta.url)));
    const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'personal-feed',protocol:1,installation_id}));});
    server.on('error',()=>process.exit(1));server.listen(Number(process.env.PORT),'127.0.0.1');
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `);
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const pids=[];
  t.after(async()=>{for(const pid of pids) {try{process.kill(pid,'SIGTERM');}catch{}} await fs.rm(root,{recursive:true,force:true});});
  return {root,directory,port,pids};
}

test('cold launch detaches its own server and later launches reuse the same address',async t=>{
  const f=await fixture(t),opened=[];
  const result=await launchFeed({...f,openPage:async url=>opened.push(url)});f.pids.push(result.pid);
  assert.equal(result.reused,false);assert.equal(await checkServer(f.port,installationId(f.directory)),'ready');
  const again=await launchFeed({...f,openPage:async url=>opened.push(url)});
  assert.equal(again.reused,true);assert.equal(again.pid,undefined);assert.deepEqual(opened,[result.url,result.url]);
  assert.ok(result.logFile.startsWith(path.join(f.root,'.local')));
  assert.equal((await fs.stat(result.logFile)).mode & 0o777,0o600);
});

test('simultaneous launches leave one reachable instance, not a new port',async t=>{
  const f=await fixture(t),opened=[];
  const results=await Promise.all([launchFeed({...f,openPage:async url=>opened.push(url)}),launchFeed({...f,openPage:async url=>opened.push(url)})]);
  f.pids.push(...results.map(result=>result.pid).filter(Boolean));
  assert.equal(new Set(opened).size,1);assert.equal(await checkServer(f.port,installationId(f.directory)),'ready');
});

test('unrelated services or another installation are never opened or replaced',async t=>{
  const f=await fixture(t);let opens=0;
  const server=http.createServer((req,res)=>res.end(JSON.stringify({app:'personal-feed',protocol:1,installation_id:'different-copy'})));
  await new Promise(resolve=>server.listen(f.port,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  await assert.rejects(launchFeed({...f,openPage:async()=>opens++}),/其他服务或另一份/);
  assert.equal(opens,0);await assert.rejects(fs.stat(path.join(f.root,'.local')),/ENOENT/);
});

test('failed startup and browser-opening failure report failure without claiming success',async t=>{
  const f=await fixture(t,{broken:true});let opens=0;
  await assert.rejects(launchFeed({...f,timeoutMs:800,openPage:async()=>opens++}),/未能启动/);assert.equal(opens,0);
  const good=await fixture(t),result=await launchFeed({...good,openPage:async()=>{}});good.pids.push(result.pid);
  await assert.rejects(launchFeed({...good,openPage:async()=>{throw Error('browser failed');}}),/browser failed/);
  assert.equal(await checkServer(good.port,installationId(good.directory)),'ready');
});

test('Mac command resolves a desktop symlink and finds Node with a minimal Finder PATH',{skip:process.platform!=='darwin'},async t=>{
  const f=await fixture(t);
  await fs.copyFile(path.resolve(here,'../打开 Levi flow.command'),path.join(f.root,'打开 Levi flow.command'));
  const output=path.join(f.root,'resolved.json');
  await fs.writeFile(path.join(f.directory,'launch.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({script:process.argv[1],node:process.execPath}));`);
  const link=path.join(f.root,'桌面入口.command');await fs.symlink(path.join(f.root,'打开 Levi flow.command'),link);
  const result=await new Promise((resolve,reject)=>{const child=spawn('/bin/zsh',[link],{env:{PATH:'/usr/bin:/bin'},stdio:'pipe'});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>resolve({code,error}));});
  assert.equal(result.code,0,result.error);assert.equal(JSON.parse(await fs.readFile(output,'utf8')).script,await fs.realpath(path.join(f.directory,'launch.mjs')));
});
