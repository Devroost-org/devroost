import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {backupServiceToFile,restoreServiceFromFileWithDependencies} from '../packages/runtime-podman/dist/backup.js';
import {ensureRouteProxy} from '../packages/network/dist/index.js';
import {containerName,listProjectContainers} from '../packages/runtime-podman/dist/containers.js';

// Run after pnpm typecheck. Uses only disposable containers, no published ports.
const exec=promisify(execFile);
const podman=async(...args)=>(await exec('podman',args,{timeout:180000})).stdout.trim();
const prefix=`loom-review-${process.pid}`;
const redis=containerName(prefix,"redis"), pg=containerName(prefix,"pg"), foreign=containerName(`${prefix}-extra`,"web"), volume=`${prefix}-data`;
const sqlite=containerName(prefix,"sqlite"), writer=containerName(prefix,"writer"), sqliteVolume=`${prefix}-sqlite`;
const root=await mkdtemp(join(tmpdir(),'loom-review-live-'));
try {
 await podman('volume','create',volume);
 await podman('run','-d','--name',redis,'--label',`devroost.project=${prefix}`,'--network','none','-v',`${volume}:/data`,'docker.io/library/redis:7','redis-server','--appendonly','yes');
 await podman('create','--name',foreign,'--label',`devroost.project=${prefix}-extra`,'--network','none','docker.io/library/alpine:3','true');
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
 await podman('volume','create',sqliteVolume);
 await podman('run','-d','--name',sqlite,'--label',`devroost.project=${prefix}`,'--network','none','-v',`${sqliteVolume}:/data`,'--entrypoint','sh','docker.io/keinos/sqlite3:3.46.1','-c','tail -f /dev/null');
 const python = 'import sqlite3,time; db=sqlite3.connect("/data/loom.db"); db.execute("PRAGMA journal_mode=WAL"); db.execute("CREATE TABLE important(value TEXT)"); db.execute("INSERT INTO important VALUES (42)"); db.commit(); open("/data/writer-ready","w").close(); time.sleep(120)';
 await podman('run','-d','--name',writer,'--network','none','--volumes-from',sqlite,'docker.io/library/python:3.13-slim-trixie','python','-c',python);
 let writerReady=false;
 for(let i=0;i<50;i++){try{await podman('exec',sqlite,'test','-f','/data/writer-ready');writerReady=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(writerReady,'SQLite WAL writer must become ready');
 const sqliteBackup=join(root,'backup.db');
 await backupServiceToFile(prefix,'sqlite',{type:'sqlite',image:'docker.io/keinos/sqlite3:3.46.1'},sqliteBackup);
 const recovered = await exec('python3',['-c','import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("SELECT value FROM important").fetchone()[0])',sqliteBackup]);
 assert.equal(recovered.stdout.trim(),'42');
 console.log('PASS SQLite: online backup includes committed WAL data');
 const state=join(root,'proxy');const cert=join(root,'cert');const key=join(root,'key');
 await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=review.test','-keyout',key,'-out',cert]);
 const mock=async(args)=>({ok:args[0]!=='container',stdout:'',stderr:'',code:0});
 await ensureRouteProxy({name:'review'},[{host:'review.test',service:'web',targetPort:3000,https:true}],{certPath:cert,keyPath:key},'review-net',8080,8443,{stateDir:state,runPodmanCommand:mock});
 await podman('run','--rm','--network','none','-v',`${state}:/etc/caddy/sites:ro`,'-v',`${state}/certs:/certs:ro`,'docker.io/library/caddy:2-alpine','caddy','adapt','--config','/etc/caddy/sites/Caddyfile','--adapter','caddyfile','--validate');
 console.log('PASS Caddy: generated config adapts and validates');
}finally{
 for(const name of [redis,pg,foreign,writer,sqlite]){try{await podman('rm','-f','-v',name);}catch{}}
 for(const name of [volume,sqliteVolume]){try{await podman('volume','rm',name);}catch{}}
 await rm(root,{recursive:true,force:true});
}
