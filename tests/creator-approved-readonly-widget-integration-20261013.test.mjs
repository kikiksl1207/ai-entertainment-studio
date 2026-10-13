import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const transportSource=readFileSync(new URL('../pages/creator-approved-readonly-transport.js',import.meta.url),'utf8');
const widgetSource=readFileSync(new URL('../pages/creator-approved-section-bytes.js',import.meta.url),'utf8');
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function pump(){for(let n=0;n<20;n++)await Promise.resolve();}
function payload(){
  const keys=['branch_behavior','canon','narrative_devices','scene_scale','timeline','visual_cast','visual_direction','writing_style'];
  const rows=keys.map((key,n)=>({key,authorSectionBytes:100+n,authorValueBytes:50+n,approvalEvidenceEntryBytes:40+n}));
  const authorObjectFramingBytes=new TextEncoder().encode(JSON.stringify({schemaVersion:'creator-generation-profile-v1',kind:'story',sections:[]})).byteLength-2;
  const d={contract:'story-approved-profile-section-byte-metric-v1',byteCap:16384,
    wholeCandidateViewBytes:20000,authorDataBytes:rows.reduce((s,r)=>s+r.authorSectionBytes,0)+9+authorObjectFramingBytes,
    approvalEvidenceBytes:rows.reduce((s,r)=>s+r.approvalEvidenceEntryBytes,0)+9,
    serverInterpretationBytes:1,approvalPinBytes:259,framingBytes:114,sections:rows,
    sectionsArrayFramingBytes:9,authorObjectFramingBytes,approvalEvidenceArrayFramingBytes:9,
    writingStyleSectionBytes:rows[7].authorSectionBytes,writingStyleValueBytes:rows[7].authorValueBytes,
    modelInputFit:'unmeasured',semanticQualityVerified:false,dispatchAuthorized:false,providerCalls:0,operatingWrites:0};
  d.serverInterpretationBytes=d.wholeCandidateViewBytes-d.authorDataBytes-d.approvalEvidenceBytes-d.approvalPinBytes-d.framingBytes;
  return {contract:'story-author-approved-section-bytes-v1',sourceScope:'latest_owner_approved_profile_section_bytes_only',locale:'ko',
    manuscriptVersion:1,analysisVersion:2,profileVersion:3,reviewRevision:4,readOnly:true,providerCalls:0,operatingWrites:0,
    dispatchAuthorized:false,semanticQualityVerified:false,legalAuthorization:'not_evaluated',paidApproval:'not_evaluated',
    fixedInputTokenLimit:32768,fixedOutputTokenLimit:8192,diagnostic:d};
}
function response(status=200){
  let sent=false,cancelled=0;
  return {status,redirected:false,headers:{get:name=>({'content-type':'application/json','cache-control':'private, no-store',vary:'Authorization'})[name.toLowerCase()]??null},
    body:{cancel(){cancelled++;return Promise.resolve();},getReader(){return {read(){if(sent)return Promise.resolve({done:true});sent=true;return Promise.resolve({done:false,value:new TextEncoder().encode(JSON.stringify(payload()))});},cancel(){cancelled++;return Promise.resolve();},releaseLock(){}};}},
    get cancelled(){return cancelled;},json(){assert.fail('The actual bounded widget must consume the stream');}};
}
function harness(handler){
  let raw=JSON.stringify({accessToken:'synthetic-access-a',user:{id:id(8)}}),now=0,sequence=0;
  const calls=[],jobs=new Map(),listeners=new Map();
  const events={addEventListener(name,fn){const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);},removeEventListener(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(f=>f!==fn));}};
  const storage={getItem(key){assert.equal(key,'lumina_auth');return raw;},setItem(){assert.fail('No auth migration/write');},removeItem(){assert.fail('No auth deletion');}};
  const window={};
  runInNewContext(transportSource, {window,URL,AbortController});
  const facade=window.LuminaCreatorApprovedReadonlyTransport.create({storage,eventTarget:events,fetch:(url,options)=>{calls.push({url,options});return handler();}});
  runInNewContext(widgetSource,{window,TextEncoder,TextDecoder,Uint8Array,AbortController,
    setTimeout(fn,delay){const key=++sequence;jobs.set(key,{fn,at:now+delay});return key;},clearTimeout(key){jobs.delete(key);}});
  const controller=window.LuminaCreatorApprovedSectionBytes.createController({
    identity:()=>{const owner=facade.identity(),auth=facade.getAuth();return owner&&auth?{...owner,token:auth.accessToken}:null;},
    isCurrent:owner=>facade.isCurrent(owner)&&facade.getAuth()?.accessToken===owner.token,
    context:()=>({workId:id(1),locale:'ko',selectedChoiceId:''}),visible:()=>true,
    fetch:(url,options)=>facade.fetch(url,{...options,identity:{ownerId:options.identity.ownerId,epoch:options.identity.epoch},token:options.identity.token})
  });
  return {facade,controller,calls,jobs,
    auth(owner){raw=JSON.stringify({accessToken:'synthetic-access-'+owner,user:{id:owner==='a'?id(8):id(9)}});for(const fn of listeners.get('storage')||[])fn({key:'lumina_auth'});},
    async advance(ms){now+=ms;for(const[key,job]of [...jobs])if(job.at<=now){jobs.delete(key);job.fn();}await pump();}};
}
test('readonly transport joins the actual numeric controller with zero boot GET and one explicit GET',async()=>{
  const h=harness(()=>Promise.resolve(response()));assert.equal(h.calls.length,0);
  assert.equal(await h.controller.load(),true);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].options.method,'GET');assert.equal(h.calls[0].options.body,undefined);
  const data=h.controller.snapshot().data;assert.equal(data.diagnostic.wholeCandidateViewBytes,20000);
  assert.equal(data.diagnostic.modelInputFit,'unmeasured');assert.equal(data.dispatchAuthorized,false);assert.equal(data.semanticQualityVerified,false);
  h.facade.dispose();
});
test('readonly transport and numeric controller finish 401 with one GET and no refresh or auth write',async()=>{
  const h=harness(()=>Promise.resolve(response(401)));assert.equal(await h.controller.load(),false);
  assert.equal(h.calls.length,1);assert.equal(h.controller.snapshot().data,null);
  assert.equal(h.controller.snapshot().messageKey,'unauthenticated');h.facade.dispose();
});
test('readonly transport makes an A to B to A late numeric response stale in the actual controller',async()=>{
  const pending=deferred(),h=harness(()=>pending.promise),read=h.controller.load();await pump();assert.equal(h.calls.length,1);
  h.auth('b');h.auth('a');pending.resolve(response());assert.equal(await read,false);
  assert.equal(h.controller.snapshot().data,null);assert.equal(h.calls.length,1);h.facade.dispose();
});
test('readonly transport leaves never-header settlement to the actual bounded controller',async()=>{
  const pending=deferred(),h=harness(()=>pending.promise),read=h.controller.load();await pump();
  await h.advance(30000);assert.equal(await read,false);assert.equal(h.controller.snapshot().data,null);
  assert.equal(h.controller.snapshot().messageKey,'transport');assert.equal(h.calls.length,1);
  const late=response();pending.resolve(late);await pump();assert.equal(h.controller.snapshot().data,null);
  assert.equal(h.calls.length,1);h.facade.dispose();
});
