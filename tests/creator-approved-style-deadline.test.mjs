import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
const source = readFileSync(new URL('../pages/creator-approved-style.js', import.meta.url), 'utf8');
const id = n => String(n).padStart(8,'0') + '-1111-4111-8111-' + String(n).padStart(12,'0');
const pump = async () => { for(let i=0;i<20;i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };
function value() { return { version:'story-author-approved-style-v1',sourceScope:'latest_private_manuscript_completed_analysis',locale:'ko',manuscriptVersion:1,analysisVersion:2,profileVersion:3,reviewRevision:4,
  section:{key:'writing_style',decision:'accepted',value:{summary:'FULL\n\t'+'S'.repeat(500),observations:[{title:'DUP',detail:'FIRST TAIL'},{title:'DUP',detail:'SECOND TAIL'}],customUnknown:[false,null,0,'PAD  ']},evidence:[{sourceType:'manuscript',sourceRef:'SYNTHETIC_REFERENCE',summary:'SYNTHETIC_EVIDENCE'}]},readOnly:true,providerCalls:0,operatingWrites:0,bodySourceAligned:false,semanticQualityVerified:false }; }
function response(data=value(), mode='normal', status=200) {
  const bytes = new TextEncoder().encode(JSON.stringify(data)); let read=0;
  const stats={cancel:0,released:0}; const cancel=()=>{stats.cancel++;return mode==='cancel-hang'?new Promise(()=>{}):mode==='cancel-reject'?Promise.reject(new Error('SYNTHETIC_PRIVATE_CLEANUP')):Promise.resolve();};
  return {status,stats,headers:{get:()=>null},body:{cancel,getReader:()=>({read:()=>mode==='body-hang'?new Promise(()=>{}):Promise.resolve(read++===0?{done:false,value:bytes}:{done:true}),cancel,releaseLock:()=>{stats.released++;}})}};
}
function fixture(handler=()=>response(), onChange=()=>{}) {
  let owner={ownerId:id(8),epoch:1},work=id(1),locale='ko',language='ko',shown=true,sequence=0;
  const jobs=new Map(),records=[],calls=[];
  const vm=createContext({window:{},TextEncoder,TextDecoder,Uint8Array,AbortController,
    setTimeout(fn,delay){assert.equal(delay,30000);const key=++sequence;jobs.set(key,fn);records.push({key,fn,delay});return key;},clearTimeout(key){jobs.delete(key);}});
  runInContext(source,vm);
  const api=vm.window.LuminaCreatorApprovedStyle;
  const controller=api.createController({fetch:(url,options)=>{calls.push({url,options});return handler(calls.length);},identity:()=>owner,isCurrent:v=>owner?.ownerId===v.ownerId&&owner?.epoch===v.epoch,
    context:()=>({workId:work,locale}),locale:()=>language,visible:()=>shown,onChange});
  return {...controller,calls,jobs,records,set:{owner:()=>{owner={ownerId:id(9),epoch:2};},epoch:()=>{owner={...owner,epoch:2};},work:()=>{work=id(2);},source:()=>{locale='en';},language:()=>{language='en';},hidden:()=>{shown=false;}},expire(){for(const[key,fn]of [...jobs]){jobs.delete(key);fn();}}};
}
test('STYLE-DEADLINE: normal read preserves FULL values whitespace duplicates unknown keys and evidence',async()=>{
  const original=value(),before=JSON.stringify(original),v=fixture(()=>response(original)); assert.equal(await v.load(),true);assert.equal(JSON.stringify(v.snapshot().data),before);assert.equal(JSON.stringify(original),before);assert.equal(v.jobs.size,0);assert.equal(v.records.length,1);
  assert.equal(v.calls.length,1);assert.equal(v.calls[0].url,'/api/v1/me/creator-studio/stories/'+id(1)+'/generation-profile/approved-style');assert.equal(v.calls[0].options.method,'GET');assert.equal(v.calls[0].options._retried,true);
});
test('STYLE-DEADLINE: never arriving headers settle false and allow only manual retry',async()=>{
  const v=fixture(()=>new Promise(()=>{})),pending=v.load();await pump();v.expire();assert.equal(await pending,false);assert.equal(v.snapshot().phase,'error');assert.equal(v.snapshot().messageKey,'transport');assert.equal(v.snapshot().data,null);assert.equal(v.snapshot().canLoad,true);assert.equal(v.calls.length,1);assert.equal(v.jobs.size,0);
});
test('STYLE-DEADLINE: stalled body is canceled once and cannot keep the caller waiting',async()=>{
  const r=response(value(),'body-hang'),v=fixture(()=>r),pending=v.load();await pump();v.expire();assert.equal(await pending,false);assert.equal(r.stats.cancel,1);assert.equal(v.snapshot().data,null);assert.equal(v.jobs.size,0);
});
test('STYLE-DEADLINE: unsupported status does not await a permanently stuck cleanup',async()=>{
  const r=response(value(),'cancel-hang',503),v=fixture(()=>r);assert.equal(await v.load(),false);assert.equal(v.snapshot().messageKey,'unavailable');assert.equal(v.jobs.size,0);assert.equal(r.stats.cancel,1);
});
test('STYLE-DEADLINE: rejected cleanup is consumed without private failure text',async()=>{
  const r=response(value(),'cancel-reject',401),v=fixture(()=>r);assert.equal(await v.load(),false);await pump();assert.equal(v.snapshot().messageKey,'unauthenticated');assert.equal(JSON.stringify(v.snapshot()).includes('PRIVATE'),false);assert.equal(v.jobs.size,0);
});
for(const field of ['owner','epoch','work','source','language','hidden']) test('STYLE-DEADLINE: '+field+' change settles an abort-ignoring old request and clears private data',async()=>{
  const v=fixture(()=>new Promise(()=>{})),pending=v.load();await pump();v.set[field]();v.syncContext();assert.equal(await pending,false);assert.equal(v.snapshot().data,null);assert.equal(v.calls[0].options.signal.aborted,true);assert.equal(v.jobs.size,0);assert.equal(v.calls.length,1);
});
test('STYLE-DEADLINE: retired old timer cannot clear a newer successful read',async()=>{
  const d=deferred(),v=fixture(n=>n===1?d.promise:response());const old=v.load();await pump();const oldTimer=v.records[0].fn;v.invalidate();assert.equal(await old,false);assert.equal(await v.load(),true);const stored=JSON.stringify(v.snapshot().data);oldTimer();await pump();assert.equal(JSON.stringify(v.snapshot().data),stored);assert.equal(v.calls.length,2);assert.equal(v.jobs.size,0);
});
test('STYLE-DEADLINE: late headers after expiry cannot restore rows or dispatch again',async()=>{
  const d=deferred(),v=fixture(()=>d.promise),pending=v.load();await pump();v.expire();assert.equal(await pending,false);const r=response();d.resolve(r);await pump();assert.equal(v.snapshot().data,null);assert.equal(v.snapshot().phase,'error');assert.equal(r.stats.cancel,1);assert.equal(v.calls.length,1);
});
test('STYLE-DEADLINE: header arrival and body wait share one total timer',async()=>{
  const d=deferred(),r=response(value(),'body-hang'),v=fixture(()=>d.promise),pending=v.load();await pump();const key=v.records[0].key;d.resolve(r);await pump();assert.equal(v.records.length,1);assert.equal(v.jobs.has(key),true);v.expire();assert.equal(await pending,false);assert.equal(v.jobs.size,0);
});
test('STYLE-DEADLINE: duplicate and old ticket requests do not create another timer or fetch',async()=>{
  const d=deferred(),v=fixture(()=>d.promise);const ticket=v.snapshot().ticket,pending=v.load(ticket);await pump();assert.equal(await v.load(ticket),false);assert.equal(v.calls.length,1);assert.equal(v.records.length,1);v.expire();assert.equal(await pending,false);
});
test('STYLE-DEADLINE: timeout callback reentry cannot retire the new request timer',async()=>{
  let v,newRequest;v=fixture(()=>new Promise(()=>{}),state=>{if(state.messageKey==='transport'&&!newRequest)newRequest=v.load();});const pending=v.load();await pump();v.expire();assert.equal(await pending,false);await pump();assert.equal(v.calls.length,2);assert.equal(v.jobs.size,1);assert.equal(v.snapshot().phase,'loading');v.invalidate();assert.equal(await newRequest,false);assert.equal(v.jobs.size,0);
});
