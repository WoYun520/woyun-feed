import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchFeed, checkServer, runLaunchCli } from './launch.mjs';
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

test('the review admin launcher opens only the local review path',async t=>{
  const f=await fixture(t),opened=[];
  const result=await launchFeed({...f,openPath:'/review-admin',openPage:async url=>opened.push(url)});
  f.pids.push(result.pid);
  assert.deepEqual(opened,[`http://127.0.0.1:${f.port}/review-admin`]);
  opened.length=0;
  const home=await launchFeed({...f,openPath:'https://evil.example/review-admin',openPage:async url=>opened.push(url)});
  assert.equal(home.reused,true);
  assert.deepEqual(opened,[`http://127.0.0.1:${f.port}/`]);
});

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

test('cli forwards LEVI_OPEN_PATH once and still opens the home page without it',async t=>{
  const source=await fs.readFile(new URL('./launch.mjs',import.meta.url),'utf8');
  assert.equal([...source.matchAll(/launchOpenPath\(/g)].length,1);
  const f=await fixture(t),opened=[];
  const review=await runLaunchCli({
    env:{LEVI_OPEN_PATH:'/review-admin'},
    launch:options=>launchFeed({...f,...options,openPage:async url=>opened.push(url)}),
    log(){},errorLog(){},
  });
  f.pids.push(review.result.pid);
  assert.equal(review.ok,true);
  assert.deepEqual(opened,[`http://127.0.0.1:${f.port}/review-admin`]);
  opened.length=0;
  const home=await runLaunchCli({
    env:{},
    launch:options=>launchFeed({...f,...options,openPage:async url=>opened.push(url)}),
    log(){},errorLog(){},
  });
  assert.equal(home.ok,true);
  assert.equal(home.result.reused,true);
  assert.deepEqual(opened,[`http://127.0.0.1:${f.port}/`]);
  let logged='';
  const failed=await runLaunchCli({
    env:{LEVI_OPEN_PATH:'/review-admin'},
    launch:async ({openPath})=>{
      assert.equal(openPath,'/review-admin');
      throw Error('端口 3000 正在被其他服务或另一份信息流占用。请先关闭它，再重新打开；不会切换网址或修改已有收藏。');
    },
    log(){},errorLog(message){logged+=message;},
  });
  assert.equal(failed.ok,false);
  assert.match(logged,/端口 3000 正在被其他服务或另一份信息流占用/);
});

function runZshPty(file,zshBin){
  const helper=`
import os, pty, select, sys, json, time
cmd, zsh = sys.argv[1], sys.argv[2]
pid, fd = pty.fork()
if pid == 0:
    os.execv(zsh, [zsh, cmd])
else:
    output = b''
    deadline = time.time() + 4
    paused = False
    code = None
    while time.time() < deadline and code is None:
        early, status = os.waitpid(pid, os.WNOHANG)
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b''
            output += chunk
        if early != 0:
            code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1
            break
        if '按任意键'.encode() in output:
            paused = True
            os.write(fd, b'x')
            _, status = os.waitpid(pid, 0)
            code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1
            break
    if code is None:
        os.kill(pid, 15)
        code = 124
    sys.stdout.buffer.write(json.dumps({'paused': paused, 'code': code, 'output': output.decode('utf-8', 'replace')}, ensure_ascii=False).encode())
`;
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',['-c',helper,file,zshBin],{stdio:['ignore','pipe','pipe']});
    let out='',err='';
    child.stdout.on('data',chunk=>{out+=chunk;});
    child.stderr.on('data',chunk=>{err+=chunk;});
    child.on('error',reject);
    child.on('exit',status=>{
      if(status!==0) reject(Error(err||out||`pty helper ${status}`));
      else resolve(JSON.parse(out));
    });
  });
}

test('review command pauses on launch failure and flow command still exits on its own',async t=>{
  let resolved='';
  for (const candidate of ['/bin/zsh','/usr/bin/zsh']) {
    try { await fs.access(candidate); resolved=candidate; break; } catch {}
  }
  if(!resolved) return t.skip();
  const reviewSource=await fs.readFile(path.resolve(here,'../打开过审.command'),'utf8');
  const flowSource=await fs.readFile(path.resolve(here,'../打开 Levi flow.command'),'utf8');
  assert.match(reviewSource,/export LEVI_OPEN_PATH=\/review-admin/);
  assert.match(reviewSource,/read -k/);
  assert.doesNotMatch(reviewSource,/(^|\n)\s*exec\s/);
  assert.match(flowSource,/(^|\n)exec\s/);
  assert.doesNotMatch(flowSource,/read -k/);
  assert.doesNotMatch(flowSource,/LEVI_OPEN_PATH/);
  const f=await fixture(t);
  const output=path.join(f.root,'seen.json');
  const writeLaunch=(exitCode,message)=>fs.writeFile(path.join(f.directory,'launch.mjs'),`import fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({openPath:process.env.LEVI_OPEN_PATH||''}));
    if(${JSON.stringify(message)}) console.error(${JSON.stringify(message)});
    process.exit(${exitCode});
  `);
  await fs.copyFile(path.resolve(here,'../打开过审.command'),path.join(f.root,'打开过审.command'));
  await writeLaunch(1,'端口 3000 正在被其他服务或另一份信息流占用。请先关闭它，再重新打开；不会切换网址或修改已有收藏。');
  const failed=await runZshPty(path.join(f.root,'打开过审.command'),resolved);
  assert.equal(failed.paused,true,failed.output);
  assert.notEqual(failed.code,0);
  assert.match(failed.output,/端口 3000 正在被其他服务或另一份信息流占用/);
  assert.match(failed.output,/按任意键关闭这个窗口/);
  assert.equal(JSON.parse(await fs.readFile(output,'utf8')).openPath,'/review-admin');
  await writeLaunch(0,'');
  const opened=await runZshPty(path.join(f.root,'打开过审.command'),resolved);
  assert.equal(opened.paused,false,opened.output);
  assert.equal(opened.code,0);
  assert.equal(JSON.parse(await fs.readFile(output,'utf8')).openPath,'/review-admin');
  await fs.copyFile(path.resolve(here,'../打开 Levi flow.command'),path.join(f.root,'打开 Levi flow.command'));
  await writeLaunch(0,'');
  const flow=await runZshPty(path.join(f.root,'打开 Levi flow.command'),resolved);
  assert.equal(flow.paused,false,flow.output);
  assert.equal(flow.code,0);
  assert.equal(JSON.parse(await fs.readFile(output,'utf8')).openPath,'');
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
