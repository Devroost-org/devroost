import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {restoreServiceFromFileWithDependencies} from '../packages/runtime-podman/dist/backup.js';
import {ensureRouteProxy} from '../packages/network/dist/index.js';
import {listProjectContainers} from '../packages/runtime-podman/dist/containers.js';

// Run after pnpm typecheck. Uses only disposable containers, no published ports.
const exec=promisify(execFile);
const podman=async(...args)=>(await exec('podman',args,{timeout:180000})).stdout.trim();
const prefix=`loom-review-${process.pid}`;
const redis=`${prefix}-redis`, pg=`${prefix}-pg`, foreign=`${prefix}-extra-web`, volume=`${prefix}-data`;
const root=await mkdtemp(join(tmpdir(),'loom-review-live-'));
try {
 await podman('volume','create',volume);
 await podman('run','-d','--name',redis,'--label',`loom.project=${prefix}`,'--network','none','-v',`${volume}:/data`,'docker.io/library/redis:7','redis-server','--appendonly','yes');
 await podman('create','--name',foreign,'--label',`loom.project=${prefix}-extra`,'--network','none','docker.io/library/alpine:3','true');
 assert.deepEqual((await listProjectContainers(prefix)).map(({name})=>name),[redis]);
 console.log('PASS ownership: overlapping project names are excluded');
 for(let i=0;i<50;i++){try{await podman('exec',redis,'redis-cli','ping');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await podman('exec',redis,'redis-cli','set','review-key','snapshot-value');
 await podman('exec',redis,'redis-cli','save');
 const snapshot=join(root,'dump.rdb');
 await podman('cp',`${redis}:/data/dump.rdb`,snapshot);
 await podman('exec',redis,'redis-cli','set','review-key','newer-aof-value');
 await podman('stop',redis);
 await restoreServiceFromFileWithDependencies(prefix,'redis',{type:'redis',image:'redis:7'},snapshot);
 await podman('start',redis);
 for(let i=0;i<50;i++){try{await podman('exec',redis,'redis-cli','ping');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.equal(await podman('exec',redis,'redis-cli','get','review-key'),'snapshot-value');
 console.log('PASS Redis: restored RDB supersedes existing newer AOF after restart');
 await podman('run','-d','--name',pg,'--network','none','-e','POSTGRES_PASSWORD=isolated-test-password','docker.io/library/postgres:16');
 for(let i=0;i<100;i++){try{await podman('exec',pg,'pg_isready','-U','postgres');break;}catch{await new Promise(r=>setTimeout(r,200));}}
 const sql=join(root,'invalid.sql');await writeFile(sql,'SELECT definitely_not_a_real_function();\n');
 await assert.rejects(restoreServiceFromFileWithDependencies(prefix,'pg',{type:'postgres',image:'postgres:16'},sql),/does not exist/);
 console.log('PASS PostgreSQL: invalid SQL causes restore rejection');
 const state=join(root,'proxy');const cert=join(root,'cert');const key=join(root,'key');
 await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=review.test','-keyout',key,'-out',cert]);
 const mock=async(args)=>({ok:args[0]!=='container',stdout:'',stderr:'',code:0});
 await ensureRouteProxy({name:'review'},[{host:'review.test',service:'web',targetPort:3000,https:true}],{certPath:cert,keyPath:key},'review-net',8080,8443,{stateDir:state,runPodmanCommand:mock});
 await podman('run','--rm','--network','none','-v',`${state}:/etc/caddy/sites:ro`,'-v',`${state}/certs:/certs:ro`,'docker.io/library/caddy:2-alpine','caddy','adapt','--config','/etc/caddy/sites/Caddyfile','--adapter','caddyfile','--validate');
 console.log('PASS Caddy: generated config adapts and validates');
}finally{
 for(const name of [redis,pg,foreign]){try{await podman('rm','-f','-v',name);}catch{}}
 try{await podman('volume','rm',volume);}catch{}
 await rm(root,{recursive:true,force:true});
}
