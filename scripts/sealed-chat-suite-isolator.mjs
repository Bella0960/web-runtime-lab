// Minimal private-suite triage: never emit or persist private stdout, file paths,
// assertion text, source files, environment values or user data.
import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync, realpathSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root = realpathSync(resolve(process.env.GITHUB_WORKSPACE || '.', 'candidate'));
const script = JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).scripts['test:chat:contract'];
const files = process.argv[2] === 'persona'
  ? readdirSync(resolve(root,'tests'))
    .filter(x => /^(chat-|group-)/.test(x) && /(persona|protocol|role-live|source-delivery|scheduled)/.test(x) && x.endsWith('.test.mjs'))
    .sort().map(x => 'tests/' + x)
  : String(script || '').split(/\s+/).filter(x => /^tests\/[A-Za-z0-9._\/-]+\.mjs$/.test(x));
if (!files.length || files.length > 40) throw Error('No approved test files');
const failures=[];
for(let i=0;i<files.length;i++){
  const p=resolve(root,files[i]);
  if(!p.startsWith(root+'/')||!existsSync(p)) throw Error('Invalid private file');
  const run=spawnSync(process.execPath,['--test',p],{
    cwd:root,env:process.env,encoding:'utf8',stdio:'pipe',timeout:120000,maxBuffer:8*1024*1024
  });
  if(run.status!==0||run.error){
    const raw=String(run.stdout||'')+'\n'+String(run.stderr||'');
    const indices=[...raw.matchAll(/^\s*not ok\s+(\d+)\s+-/gm)]
      .map(x=>Number(x[1])).filter(x=>Number.isInteger(x)&&x>0).slice(0,12);
    failures.push({fileOrdinal:i+1,caseOrdinals:indices,timeout:!!run.error});
  }
}
process.stdout.write(JSON.stringify({fileCount:files.length,failedFiles:failures})+'\n');
if(failures.length)process.exitCode=1;
