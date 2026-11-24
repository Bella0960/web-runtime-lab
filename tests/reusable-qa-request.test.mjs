import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const yaml=readFileSync(new URL('../.github/workflows/reusable-qa-request.yml',import.meta.url),'utf8');
const script=yaml.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS\n/)[1].split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
const sha='a'.repeat(40);
function invoke(request, event='push'){
  const root=mkdtempSync(join(tmpdir(),'qa-contract-'));
  try{
    mkdirSync(join(root,'.github'));
    writeFileSync(join(root,'.github/qa-release-request.json'),JSON.stringify(request));
    const out=join(root,'output');
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:5000,env:{EVENT:event,OPERATION:request.operation||'',CANDIDATE:request.candidate||'',CONFIRMATION:request.confirmation||'',GITHUB_OUTPUT:out}});
    return {status:result.status,output:existsSync(out)?readFileSync(out,'utf8'):''};
  }finally{rmSync(root,{recursive:true,force:true});}
}
test('valid verify and QA release request produce only expected outputs',()=>{
  for(const event of ['push','workflow_dispatch']){
    for(const operation of ['verify','release']){
      const r=invoke({operation,candidate:sha,confirmation:operation==='release'?'qa-only':''},event);
      assert.equal(r.status,0);
      assert.equal(r.output,'operation='+operation+'\nsha='+sha+'\n');
    }
  }
});
test('invalid input cannot produce a release output',()=>{
  for(const request of [
    {operation:'release',candidate:sha},
    {operation:'release',candidate:sha,confirmation:'wrong'},
    {operation:'verify',candidate:'main'},
    {operation:'verify',candidate:sha+'\nextra=value'},
    {operation:'verify',candidate:[sha]},
    {operation:'verify',candidate:sha,extra:true},
    {operation:'other',candidate:sha},
  ]){
    const r=invoke(request);
    assert.notEqual(r.status,0);
    assert.equal(r.output,'');
  }
});
test('PR validation cannot reach the existing release job',()=>{
  assert.match(yaml,/request-contract:\n\s+if: github.event_name == 'pull_request'/);
  assert.match(yaml,/request:\n\s+if: github.event_name != 'pull_request' && github.ref == 'refs\/heads\/main' && github.actor == github.repository_owner/);
  const safeJob=yaml.split('  request-contract:')[1].split('\n  request:')[0];
  assert.doesNotMatch(safeJob,/secrets\.|run-candidate|path: candidate/);
});

test('both operations require the adaptive gate and verification has no deploy credentials',()=>{
  const verify=yaml.split('      - name: Verify once without deployment credentials')[1].split('      - name: Automatically select scope')[0];
  assert.match(verify,/QA_ADAPTIVE_RELEASE: '1'/);
  assert.doesNotMatch(verify,/CLOUDFLARE_|CANDIDATE_RELEASE_ACK|secrets\./);
  assert.match(yaml,/if \(!source\.includes\("process\.env\.QA_ADAPTIVE_RELEASE === '1'"\)\) fail\(\);/);
  assert.doesNotMatch(yaml,/adaptive \? refs\[0\] : legacy/);
});
