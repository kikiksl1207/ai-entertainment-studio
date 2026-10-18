'use strict';
const { restoreOwnedSocialLoginCurrentnessDelta } = require('./support/auth-login-failclosed-inverse-20261017.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),test=require('node:test'),{createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const [root,version]=process.argv.length===2 ? [path.resolve(__dirname,'..'),'candidate'] : process.argv.slice(2);
assert([2,4].includes(process.argv.length),'LANGUAGE_SPEC_CLI');
assert(['baseline','candidate'].includes(version),'LANGUAGE_SPEC_VARIANT');
const PINS={
 "baseline": {
  "bytes": 431019,
  "sha": "653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b",
  "start": 282165,
  "end": 286827,
  "span": "d32823877e570ec1cd2c653ca9121a16301be045974d23b0f15d85fe272381e2",
  "localeStart": 8651,
  "localeEnd": 146775,
  "localeSha": "fe6835c7c2dbd5a37ee7e78253131a194ef9e8430bf82452270675c592128b3a",
  "applyStart": 147788,
  "applyEnd": 148996
 },
 "candidate": {
  "bytes": 432976,
  "sha": "5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d",
  "start": 282293,
  "end": 288744,
  "span": "5d80f08edb970951d1692b63d5fd41434c2442149a588cd08ff8eeb7b6fff7d8",
  "localeStart": 8651,
  "localeEnd": 146903,
  "localeSha": "176760d95e40d892b5a22c2f84268be34071770347f44a5c6449071c6980e075",
  "applyStart": 147916,
  "applyEnd": 149124
 }
};
const input=path.resolve(root,'app.js'),real=fs.realpathSync.native(input);
const realRoot=fs.realpathSync.native(root);
assert.equal(real,path.join(realRoot,'app.js'),'LANGUAGE_INPUT_REALPATH');
const info=fs.statSync(real);assert(info.isFile()&&info.size>0&&info.size<=866000,'LANGUAGE_INPUT_SIZE');
const bytes=fs.readFileSync(real),decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
assert(!decoded.startsWith('\uFEFF')&&Buffer.from(decoded).equals(bytes),'LANGUAGE_INPUT_UTF8');
const delivered=decoded.replace(/\r\n/g,'\n');
assert(!delivered.includes('\r')&&(decoded===delivered||decoded===delivered.replace(/\n/g,'\r\n')),'LANGUAGE_INPUT_UNIFORM_EOL');
const full=restoreOwnedSocialLoginCurrentnessDelta(delivered),pin=PINS[version];
assert.equal(Buffer.byteLength(full),pin.bytes,'LANGUAGE_FULL_SOURCE_BYTES');
assert.equal(sha(full),pin.sha,'LANGUAGE_FULL_SOURCE_SHA');
const begin=full.indexOf('let _lightboxEl = null;'),end=full.indexOf('\n/* ',begin);
assert.equal(begin,pin.start,'LANGUAGE_SPAN_BEGIN');assert.equal(end,pin.end,'LANGUAGE_SPAN_END');
assert.equal(full.indexOf('let _lightboxEl = null;',begin+1),-1,'LANGUAGE_SPAN_UNIQUE');
const source=full.slice(begin,end);assert.equal(sha(source),pin.span,'LANGUAGE_ACTUAL_SPAN_SHA');
const localeBegin=full.indexOf('const I18N_LOCALES ='),localeEnd=full.indexOf('\nfunction detectLocale() {',localeBegin);
assert.equal(localeBegin,pin.localeStart);assert.equal(localeEnd,pin.localeEnd);
assert.equal(full.indexOf('const I18N_LOCALES =',localeBegin+1),-1);
const localeSource=full.slice(localeBegin,localeEnd);assert.equal(sha(localeSource),pin.localeSha,'LANGUAGE_ACTUAL_DICTIONARY_T_SHA');
const applyBegin=full.indexOf('function applyI18n(root) {'),applyEnd=full.indexOf('\nasync function setLocale(locale) {',applyBegin);
assert.equal(applyBegin,pin.applyStart);assert.equal(applyEnd,pin.applyEnd);
assert.equal(full.indexOf('function applyI18n(root) {',applyBegin+1),-1);
const applySource=full.slice(applyBegin,applyEnd);
assert.equal(sha(applySource),'25359e28408f6f391efea6afdf84653b8b1cd2d93fd84d4fc97240ef03ef68d0','LANGUAGE_ACTUAL_APPLY_SHA');
const BASELINE_RED_CASES=['entry','tab-ring','close-return','repeat-open','reentrant-close',
 'dictionary','first-open','live-apply','hidden-reopen','error-counter'];
let fixtureFaults=0,fixtures=[];
function fixture(ok,code){if(!ok){fixtureFaults++;throw new Error('FOCUS_FIXTURE_'+code)}}
function semantic(ok,code){assert.equal(Boolean(ok),true,code)}
function harness(overflow='clip'){
 const events=new Map(),all=[],document={activeElement:null};
 class Element{
  constructor(tag='div'){
   this.tagName=tag.toUpperCase();this.parentNode=null;this.children=[];this.style={};this.textContent='';this.hiddenWrites=0;this.srcWrites=0;this._src='';
   this.attributes=new Map();this.listeners=new Map();this.focusAttempts=0;this.focusOptions=[];this.onFocus=null;
   const attributeKey=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
   this.dataset=new Proxy({},{
    get:(_,key)=>typeof key==='string'?(this.attributes.get(attributeKey(key))??undefined):undefined,
    set:(_,key,value)=>{this.attributes.set(attributeKey(key),String(value));return true},
   });
   this.onDisplayNone=null;let display='';
   Object.defineProperty(this.style,'display',{get:()=>display,set:value=>{
    const changed=display!==value;display=value;
    if(changed&&value==='none')this.onDisplayNone?.();
   }});
   const classes=new Set();
   this.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),
    contains:x=>classes.has(x),toggle:(x,on)=>{const add=on===undefined?!classes.has(x):Boolean(on);if(add)classes.add(x);else classes.delete(x);return add}};
   Object.defineProperty(this,'className',{get:()=>[...classes].join(' '),set:v=>{classes.clear();String(v).split(/\s+/).filter(Boolean).forEach(x=>classes.add(x))}});
   all.push(this);
  }
  setAttribute(name,value){if(name==='class')this.className=value;else this.attributes.set(name,String(value));if(name==='hidden')this.hidden=true}
  removeAttribute(name){this.attributes.delete(name);if(name==='hidden')this.hidden=false}
  getAttribute(name){return this.attributes.get(name)??null}
  get hidden(){return this.attributes.has('hidden')}
  set hidden(value){this.hiddenWrites++;if(value)this.attributes.set('hidden','');else this.attributes.delete('hidden')}
  get src(){return this._src}
  set src(value){this.srcWrites++;this._src=String(value)}
  get disabled(){return this.attributes.has('disabled')}
  set disabled(value){if(value)this.attributes.set('disabled','');else this.attributes.delete('disabled')}
  get isConnected(){for(let node=this;node;node=node.parentNode)if(node===document.body)return true;return false}
  appendChild(node){node.remove();node.parentNode=this;this.children.push(node);return node}
  remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null}}
  contains(node){for(let cursor=node;cursor;cursor=cursor.parentNode)if(cursor===this)return true;return false}
  getClientRects(){
   if(!this.isConnected)return [];
   for(let node=this;node;node=node.parentNode)if(node.hidden||node.style.display==='none'||
    (node.classList.contains('lightbox-overlay')&&!node.classList.contains('is-open')))return [];
   return [{x:0,y:0,width:40,height:40}];
  }
  matches(selector){
   if(selector==='button:not([disabled])')return this.tagName==='BUTTON'&&!this.disabled;
   if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
   if(/^\[(?:[a-z-]+|data-i18n(?:-attr|-aria|-alt)?)\]$/.test(selector))return this.attributes.has(selector.slice(1,-1));
   fixture(false,'UNSUPPORTED_SELECTOR');
  }
  querySelectorAll(selector){
   const found=[];const visit=node=>{for(const child of node.children){if(child.matches(selector))found.push(child);visit(child)}};
   visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback)}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback)}
  dispatch(name,extra={}){
   const event={type:name,target:this,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true},...extra};
   for(let node=this;node;node=node.parentNode){
    for(const callback of [...(node.listeners.get(name)||[])])callback(event);
    if(event.stopped)break;
   }
   return event;
  }
  focus(options){
   this.focusAttempts++;this.focusOptions.push(options?.preventScroll===true);
   if(!focusable(this))return;
   const previous=document.activeElement;document.activeElement=this;
   if(previous!==this)this.onFocus?.();
  }
  set innerHTML(html){
   fixture(this.children.length===0,'ONE_TEMPLATE');
   const buttons=[...html.matchAll(/<button class="([^"]+)" type="button" aria-label="([^"]+)"(?: data-i18n-aria="([^"]+)")?>([^<]*)<\/button>/g)];
   const keys=['auth.modal.close','detail.gallery.previous','detail.gallery.next'];
   fixture(buttons.length===3&&buttons.map(m=>m[1]).join(',')==='lightbox-close,lightbox-prev,lightbox-next'&&
    buttons.every((m,i)=>m[3]===undefined||m[3]===keys[i]),'CLOSED_BUTTON_TEMPLATE');
   for(const match of buttons){const button=new Element('button');button.className=match[1];button.setAttribute('type','button');
    button.setAttribute('aria-label',match[2]);if(match[3]!==undefined)button.setAttribute('data-i18n-aria',match[3]);
    button.textContent=match[4];this.appendChild(button)}
   const errorMarkup=html.match(/<div class="lightbox-error" data-lightbox-error(?: data-i18n="(detail\.gallery\.error)")? hidden>([^<]*)<\/div>/);
   fixture(html.includes('<div class="lightbox-stage" data-lightbox-stage>')&&
    html.includes('<img class="lightbox-img" alt="" draggable="false" oncontextmenu="return false;" />')&&
    errorMarkup!==null&&html.includes('data-lightbox-counter'),'CLOSED_STAGE_TEMPLATE');
   const stage=this.appendChild(new Element());stage.className='lightbox-stage';stage.setAttribute('data-lightbox-stage','');
   const image=stage.appendChild(new Element('img'));image.className='lightbox-img';image.setAttribute('alt','');
   const error=stage.appendChild(new Element());error.className='lightbox-error';error.setAttribute('data-lightbox-error','');error.hidden=true;
   error.textContent=errorMarkup[2];if(errorMarkup[1])error.setAttribute('data-i18n',errorMarkup[1]);
   const counter=this.appendChild(new Element());counter.className='lightbox-counter';counter.setAttribute('data-lightbox-counter','');
  }
 }
 function visibility(element){for(let node=element;node;node=node.parentNode)if(node.style.visibility)return node.style.visibility;return 'visible'}
 function focusable(element){return element.isConnected&&element.getClientRects().length>0&&visibility(element)!=='hidden'&&!element.disabled&&
  (element.tagName==='BUTTON'||(element.tagName==='A'&&element.attributes.has('href')))}
 document.body=new Element('body');document.body.style.overflow=overflow;document.activeElement=document.body;
 document.createElement=tag=>new Element(tag);
 document.querySelectorAll=selector=>document.body.querySelectorAll(selector);
 const reflected=new Element();reflected.setAttribute('data-i18n-aria','auth.modal.close');
 fixture(reflected.dataset.i18nAria==='auth.modal.close','DATA_ATTRIBUTE_READ');
 reflected.dataset.i18n='detail.gallery.error';
 fixture(reflected.getAttribute('data-i18n')==='detail.gallery.error','DATA_ATTRIBUTE_WRITE');
 for(const name of ['data-i18n','data-i18n-attr','data-i18n-aria','data-i18n-alt']){
  const probe=new Element();
  fixture(probe.matches('['+name+']')===false,'TRANSLATION_SELECTOR_ABSENT');
  probe.setAttribute(name,'synthetic');
  fixture(probe.matches('['+name+']')===true,'TRANSLATION_SELECTOR_PRESENT');
 }
 document.addEventListener=(name,callback)=>{fixture(name==='keydown','DOCUMENT_EVENT');if(!events.has(name))events.set(name,new Set());events.get(name).add(callback)};
 document.removeEventListener=(name,callback)=>events.get(name)?.delete(callback);
 const opener=document.body.appendChild(new Element('a'));opener.setAttribute('href','https://example.invalid/opener');
 const foreign=document.body.appendChild(new Element('a'));foreign.setAttribute('href','https://example.invalid/foreign');
 opener.focus();fixture(document.activeElement===opener,'INITIAL_FOCUS');
 const context={document,HTMLElement:Element,Node:{TEXT_NODE:3},getComputedStyle:el=>({visibility:visibility(el)})};
 vm.runInNewContext(localeSource+'\n'+applySource+'\n'+source+
  '\nglobalThis.probe={open:openLightbox,close:closeLightbox,state:()=>_lightboxState};'+
  '\nglobalThis.localeProbe={commit:v=>{_currentLocale=normalizeLocale(v)},t,entry:k=>I18N_DICT[k],'+
  'apply:root=>applyI18n(root),locales:()=>[...I18N_LOCALES],forbiddenPresent:()=>'+
  'typeof setLocale!=="undefined"||typeof initI18n!=="undefined"||typeof apiFetch!=="undefined"};',
  context,{timeout:500,filename:'actual-inline-i18n-and-lightbox.js'});
 fixture(context.localeProbe.forbiddenPresent()===false,'ONLY_SELECTED_DEFINITIONS');
 function key(key,shiftKey=false){
  const event={key,shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};
  for(const callback of [...(events.get('keydown')||[])])callback(event);return event;
 }
 function nativeTab(shift=false){
  const event=key('Tab',shift);
  if(!event.defaultPrevented){
   const order=[];const visit=node=>{for(const child of node.children){if(focusable(child))order.push(child);visit(child)}};visit(document.body);
   const index=order.indexOf(document.activeElement);
   if(order.length)order[index<0?(shift?order.length-1:0):(index+(shift?-1:1)+order.length)%order.length].focus();
  }
  return event;
 }
 const overlay=()=>document.body.children.find(el=>el.classList.contains('lightbox-overlay'))||null;
 const control=name=>{const found=overlay()?.querySelector('.lightbox-'+name);fixture(Boolean(found),'CONTROL_'+name.toUpperCase());return found};
 const h={...context.probe,document,body:document.body,opener,foreign,overlay,control,key,nativeTab,
  language:context.localeProbe.commit,translation:context.localeProbe.t,entry:context.localeProbe.entry,
  locales:context.localeProbe.locales,applyGlobal:()=>context.localeProbe.apply(),applyWithin:el=>context.localeProbe.apply(el),
  handlers:()=>events.get('keydown')?.size||0,dispose(){events.clear();for(const element of all){element.listeners.clear();element.onFocus=null;element.onDisplayNone=null}document.body.children=[]}};
 fixtures.push(h);return h;
}
function group(name,label,run){
 test(name,{timeout:2000,concurrency:false},()=>{
  fixtureFaults=0;fixtures=[];
  try{run()}
  finally{
   for(const h of fixtures)h.dispose();
   console.log(JSON.stringify({contract:'feed-lightbox-focus-languages-v1',variant:version,case:label,
    semanticBaselineWitness:version==='baseline'&&BASELINE_RED_CASES.includes(label),fixtureFaults}));
  }
 });
}
group('lightbox valid open owns focus and invalid opens are inert','entry',()=>{
 const h=harness(),initial=h.opener.focusAttempts;
 for(const value of [undefined,null,[],'',{}])h.open(value,0);
 semantic(h.overlay()===null&&h.document.activeElement===h.opener&&h.opener.focusAttempts===initial&&h.handlers()===0,'LIGHTBOX_FOCUS_INVALID_OPEN');
 const images=['synthetic-a','synthetic-b'];h.open(images,0);
 semantic(h.document.activeElement===h.control('close'),'LIGHTBOX_FOCUS_OPEN_ENTRY');
 semantic(h.control('close').focusOptions.at(-1)===true&&h.handlers()===1,'LIGHTBOX_FOCUS_ENTRY_OWNED');
 const active=h.document.activeElement,calls=active.focusAttempts;
 for(const value of [undefined,null,[],'',{}])h.open(value,0);
 semantic(h.document.activeElement===active&&active.focusAttempts===calls&&h.state().sources===images&&h.handlers()===1,
  'LIGHTBOX_FOCUS_ACTIVE_INVALID_OPEN');
});
group('lightbox Tab stays within visible enabled controls','tab-ring',()=>{
 const h=harness();h.open(['a','b'],0);const close=h.control('close'),prev=h.control('prev'),next=h.control('next');
 next.focus();let event=h.nativeTab();
 semantic(event.defaultPrevented&&h.document.activeElement===close,'LIGHTBOX_FOCUS_TAB_RING');
 event=h.nativeTab(true);semantic(event.defaultPrevented&&h.document.activeElement===next,'LIGHTBOX_FOCUS_SHIFT_TAB_RING');
 close.focus();event=h.nativeTab();semantic(!event.defaultPrevented&&h.document.activeElement===prev,'LIGHTBOX_FOCUS_MIDDLE_DEFAULT');
 event=h.nativeTab();semantic(!event.defaultPrevented&&h.document.activeElement===next,'LIGHTBOX_FOCUS_SECOND_MIDDLE_DEFAULT');
 prev.style.display='none';next.disabled=true;close.focus();event=h.nativeTab();
 semantic(event.defaultPrevented&&h.document.activeElement===close,'LIGHTBOX_FOCUS_HIDDEN_DISABLED_EXCLUDED');
 event=h.nativeTab(true);semantic(event.defaultPrevented&&h.document.activeElement===close,'LIGHTBOX_FOCUS_SINGLE_RING_BACKWARD');
 prev.style.display='';prev.style.visibility='hidden';next.disabled=false;close.focus();event=h.nativeTab();
 semantic(!event.defaultPrevented&&h.document.activeElement===next,'LIGHTBOX_FOCUS_VISIBILITY_EXCLUDED');
 h.foreign.focus();event=h.nativeTab();semantic(event.defaultPrevented&&h.document.activeElement===close,'LIGHTBOX_FOCUS_EXTERNAL_FORWARD');
 h.foreign.focus();event=h.nativeTab(true);semantic(event.defaultPrevented&&h.document.activeElement===next,'LIGHTBOX_FOCUS_EXTERNAL_BACKWARD');
 close.disabled=true;next.disabled=true;h.foreign.focus();event=h.nativeTab();
 semantic(event.defaultPrevented&&h.document.activeElement===h.foreign,'LIGHTBOX_FOCUS_EMPTY_RING_SAFE');
});
group('lightbox close paths restore owned focus exactly once','close-return',()=>{
 for(const mode of ['Escape','button','overlay']){
  const h=harness('auto');h.close();semantic(h.document.activeElement===h.opener&&h.handlers()===0,'LIGHTBOX_FOCUS_NEVER_OPEN_CLOSE');
  h.open(['a','b'],0);h.control('close').focus();const calls=h.opener.focusAttempts;
  h.control('close').parentNode.querySelector('.lightbox-stage').dispatch('click');
  semantic(h.overlay().classList.contains('is-open'),'LIGHTBOX_FOCUS_STAGE_NOT_BACKDROP');
  if(mode==='Escape')h.key('Escape');else if(mode==='button')h.control('close').dispatch('click');else h.overlay().dispatch('click');
  semantic(h.document.activeElement===h.opener,'LIGHTBOX_FOCUS_CLOSE_RETURN');
  semantic(h.opener.focusAttempts===calls+1&&h.body.style.overflow==='auto'&&h.handlers()===0,'LIGHTBOX_FOCUS_CLOSE_ONCE');
  h.close();h.key('Escape');semantic(h.opener.focusAttempts===calls+1,'LIGHTBOX_FOCUS_DUPLICATE_CLOSE_INERT');
  const event=h.nativeTab();semantic(!event.defaultPrevented&&h.document.activeElement===h.foreign,'LIGHTBOX_FOCUS_RETIRED_TAB_INERT');
 }
});
group('lightbox repeated opens retain the original focus lifetime','repeat-open',()=>{
 const h=harness();h.open(['a','b'],0);h.control('prev').focus();
 h.open(['c','d'],1);h.open(['e','f'],0);
 semantic(h.document.activeElement===h.control('prev')&&h.handlers()===1,'LIGHTBOX_FOCUS_REPEAT_KEEPS_VALID_CONTROL');
 h.key('ArrowRight');semantic(h.state().index===1,'LIGHTBOX_FOCUS_REPEAT_SINGLE_KEY');
 h.close();semantic(h.document.activeElement===h.opener,'LIGHTBOX_FOCUS_REPEAT_RETURN');
 const m=harness();m.open(['a','b'],0);m.control('next').focus();m.open(['single'],0);
 semantic(m.document.activeElement===m.control('close')&&m.control('next').getClientRects().length===0&&m.handlers()===1,
  'LIGHTBOX_FOCUS_REPEAT_HIDDEN_NAV');
 m.open(['a','b'],0);m.control('prev').focus();m.control('prev').style.visibility='hidden';m.open(['c','d'],0);
 semantic(m.document.activeElement===m.control('close'),'LIGHTBOX_FOCUS_REPEAT_INVISIBLE_NAV');
 m.foreign.focus();const calls=m.foreign.focusAttempts;m.open(['e','f'],0);
 semantic(m.document.activeElement===m.foreign&&m.foreign.focusAttempts===calls&&m.handlers()===1,'LIGHTBOX_FOCUS_REPEAT_FOREIGN_PRESERVED');
 // Finite synchronous hide-time variations, not a claim about observed browser fixup.
 for(const fixup of ['body','null','foreign','eligible']){
  const f=harness();f.open(['a','b'],0);const nav=f.control('next');nav.focus();let hiddenDuringApply=false;
  nav.onDisplayNone=()=>{
   nav.onDisplayNone=null;hiddenDuringApply=f.document.activeElement===nav&&nav.getClientRects().length===0;
   if(fixup==='body')f.document.activeElement=f.body;
   else if(fixup==='null')f.document.activeElement=null;
   else if(fixup==='foreign')f.foreign.focus();else f.control('close').focus();
  };
  f.open(['single'],0);
  semantic(hiddenDuringApply&&f.handlers()===1,'LIGHTBOX_FOCUS_REPEAT_HIDE_DURING_APPLY');
  semantic(f.document.activeElement===(fixup==='foreign'?f.foreign:f.control('close')),
   fixup==='foreign'?'LIGHTBOX_FOCUS_REPEAT_HIDE_FOREIGN_PRESERVED':'LIGHTBOX_FOCUS_REPEAT_HIDE_OWNED_RECOVERED');
  f.close();semantic(f.document.activeElement===(fixup==='foreign'?f.foreign:f.opener),
   'LIGHTBOX_FOCUS_REPEAT_HIDE_ORIGINAL_OPENER');
 }
});
group('lightbox close preserves foreign focus and disconnected openers','foreign-focus',()=>{
 const h=harness();h.open(['a','b'],0);h.foreign.focus();const calls=h.opener.focusAttempts;
 h.close();semantic(h.document.activeElement===h.foreign&&h.opener.focusAttempts===calls&&h.body.style.overflow==='clip'&&h.handlers()===0,
  'LIGHTBOX_FOCUS_FOREIGN_PRESERVED');
 h.close();semantic(h.document.activeElement===h.foreign&&h.opener.focusAttempts===calls,'LIGHTBOX_FOCUS_FOREIGN_DUPLICATE_CLOSE');
 const d=harness();d.open(['a','b'],0);d.control('close').focus();d.opener.remove();const removed=d.opener.focusAttempts;
 d.close();semantic(d.opener.focusAttempts===removed&&d.handlers()===0&&d.body.style.overflow==='clip','LIGHTBOX_FOCUS_DISCONNECTED_SAFE');
});
group('lightbox focus restoration may reopen a fresh lifetime','reentrant-close',()=>{
 const h=harness('clip');h.open(['old-a','old-b'],0);h.control('close').focus();let reopened=false;
 h.opener.onFocus=()=>{
  h.opener.onFocus=null;reopened=true;h.foreign.focus();h.body.style.overflow='scroll';h.open(['fresh-a','fresh-b'],0);
 };
 h.key('Escape');
 semantic(reopened&&h.overlay().classList.contains('is-open'),'LIGHTBOX_FOCUS_REENTRANT_REOPEN');
 semantic(h.handlers()===1&&h.body.style.overflow==='hidden'&&h.document.activeElement===h.control('close')&&
  h.state().sources[0]==='fresh-a','LIGHTBOX_FOCUS_REENTRANT_OWNERSHIP');
 h.key('ArrowRight');semantic(h.state().index===1,'LIGHTBOX_FOCUS_REENTRANT_SINGLE_KEY');
 h.key('Escape');semantic(h.handlers()===0&&h.document.activeElement===h.foreign&&h.body.style.overflow==='scroll',
  'LIGHTBOX_FOCUS_REENTRANT_FRESH_RETURN');
 const calls=h.foreign.focusAttempts;h.close();semantic(h.foreign.focusAttempts===calls,'LIGHTBOX_FOCUS_REENTRANT_DUPLICATE_INERT');
});


const EXPECTED={
 "ko-KR": {
  "name": "\uc0ac\uc9c4 \ubcf4\uae30",
  "close": "\ub2eb\uae30",
  "prev": "\uc774\uc804",
  "next": "\ub2e4\uc74c",
  "error": "\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4."
 },
 "ja-JP": {
  "name": "\u753b\u50cf\u30d3\u30e5\u30fc\u30a2",
  "close": "\u9589\u3058\u308b",
  "prev": "\u524d\u3078",
  "next": "\u6b21\u3078",
  "error": "\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002"
 },
 "en-US": {
  "name": "Image viewer",
  "close": "Close",
  "prev": "Previous",
  "next": "Next",
  "error": "Image could not be loaded."
 },
 "zh-CN": {
  "name": "\u56fe\u7247\u67e5\u770b\u5668",
  "close": "\u5173\u95ed",
  "prev": "\u4e0a\u4e00\u5f20",
  "next": "\u4e0b\u4e00\u5f20",
  "error": "\u65e0\u6cd5\u52a0\u8f7d\u56fe\u7247\u3002"
 },
 "zh-Hant": {
  "name": "\u5716\u7247\u6aa2\u8996\u5668",
  "close": "\u95dc\u9589",
  "prev": "\u4e0a\u4e00\u5f35",
  "next": "\u4e0b\u4e00\u5f35",
  "error": "\u7121\u6cd5\u8f09\u5165\u5716\u7247\u3002"
 }
};
const LOCALES=['ko-KR','ja-JP','en-US','zh-CN','zh-Hant'];
const ALIASES=['ko','ja','en','zh-Hans','zh-Hant'];
function copyMatches(h,locale){
 const e=EXPECTED[locale];
 return h.overlay().getAttribute('aria-label')===e.name&&
  ['close','prev','next'].every(key=>h.control(key).getAttribute('aria-label')===e[key])&&h.control('error').textContent===e.error;
}
function unchangedView(h){
 const image=h.control('img'),error=h.control('error'),counter=h.control('counter');
 return {sources:h.state().sources,index:h.state().index,zoomed:h.state().zoomed,src:image.src,srcWrites:image.srcWrites,
  hidden:error.hidden,hiddenWrites:error.hiddenWrites,broken:h.overlay().classList.contains('is-broken'),
  counter:counter.textContent,counterDisplay:counter.style.display,active:h.document.activeElement,
  handlers:h.handlers(),overflow:h.body.style.overflow};
}
group('lightbox language dictionary and locale fallback stay explicit','dictionary',()=>{
 const h=harness();assert.deepEqual(Array.from(h.locales()),LOCALES);
 const common={close:'auth.modal.close',prev:'detail.gallery.previous',next:'detail.gallery.next',error:'detail.gallery.error'};
 for(let i=0;i<LOCALES.length;i++){
  for(const [label,key]of Object.entries(common))assert.equal(h.translation(key,ALIASES[i]),EXPECTED[LOCALES[i]][label]);
 }
 for(const key of Object.values(common))assert.equal(h.translation(key,'xx-YY'),h.translation(key,'ko-KR'));
 semantic(h.entry('feed.lightbox.name')!==undefined,'LIGHTBOX_LANGUAGE_NAME_DICTIONARY');
 assert.deepEqual(Object.keys(h.entry('feed.lightbox.name')).sort(),[...LOCALES].sort());
 for(let i=0;i<LOCALES.length;i++){
  assert.equal(h.translation('feed.lightbox.name',LOCALES[i]),EXPECTED[LOCALES[i]].name);
  assert.equal(h.translation('feed.lightbox.name',ALIASES[i]),EXPECTED[LOCALES[i]].name);
 }
 assert.equal(h.translation('feed.lightbox.name','xx-YY'),EXPECTED['ko-KR'].name);
});
group('lightbox first open renders all five UI languages','first-open',()=>{
 for(const locale of LOCALES){
  const h=harness();h.language(locale);h.open(['a','b'],0);
  semantic(copyMatches(h,locale),'LIGHTBOX_LANGUAGE_OPEN_COPY');
  assert.equal(h.overlay().dataset.i18nAria,'feed.lightbox.name');
  assert.deepEqual(['close','prev','next'].map(key=>h.control(key).dataset.i18nAria),
   ['auth.modal.close','detail.gallery.previous','detail.gallery.next']);
  assert.deepEqual(['close','prev','next'].map(key=>h.control(key).textContent),['\u00d7','\u2039','\u203a']);
  assert.equal(h.control('img').getAttribute('alt'),'');assert.equal(h.control('error').hidden,true);
  assert.equal(h.control('counter').textContent,'1 / 2');h.key('ArrowRight');
  assert.equal(h.control('counter').textContent,'2 / 2');assert.equal(h.handlers(),1);
  assert.equal(h.document.activeElement,h.control('close'));h.close();
 }
});
group('lightbox global language apply updates the live dialog without side effects','live-apply',()=>{
 const h=harness('auto');h.open(['a','b','c'],1);h.control('next').focus();h.control('img').dispatch('click');
 h.control('img').dispatch('error');const before=unchangedView(h);
 for(const locale of ['ja-JP','en-US','zh-CN','zh-Hant','ko-KR']){
  h.language(locale);h.applyGlobal();
  semantic(copyMatches(h,locale),'LIGHTBOX_LANGUAGE_LIVE_COPY');
  assert.deepEqual(unchangedView(h),before,'LIGHTBOX_LANGUAGE_NO_REDRAW');
 }
 h.close();assert.equal(h.body.style.overflow,'auto');assert.equal(h.document.activeElement,h.opener);
});
group('lightbox hidden cache and reopen follow the selected language','hidden-reopen',()=>{
 const h=harness();h.open(['a','b'],0);h.close();const node=h.overlay();
 for(const locale of LOCALES){
  const before=unchangedView(h);h.language(locale);h.applyGlobal();
  semantic(copyMatches(h,locale),'LIGHTBOX_LANGUAGE_HIDDEN_COPY');
  assert.deepEqual(unchangedView(h),before,'LIGHTBOX_LANGUAGE_HIDDEN_NO_MUTATION');
  node.setAttribute('aria-label','synthetic stale name');
  h.applyWithin(node);assert.equal(node.getAttribute('aria-label'),'synthetic stale name','LIGHTBOX_LANGUAGE_ROOT_EXCLUDED');
  h.open(['c','d'],0);
  assert.equal(h.overlay(),node);assert.equal(copyMatches(h,locale),true,'LIGHTBOX_LANGUAGE_REOPEN_COPY');
  assert.equal(h.handlers(),1);assert.equal(h.document.activeElement,h.control('close'));
  h.close();assert.equal(h.handlers(),0);assert.equal(h.document.activeElement,h.opener);
 }
});
group('lightbox translated errors preserve hidden state sources and numeric counters','error-counter',()=>{
 for(const locale of LOCALES){
  const h=harness();h.language(locale);h.open(['a','b','c'],1);
  const before=unchangedView(h);h.applyGlobal();
  semantic(h.control('error').textContent===EXPECTED[locale].error,'LIGHTBOX_LANGUAGE_ERROR_COPY');
  assert.deepEqual(unchangedView(h),before);
  h.control('img').dispatch('error');assert.equal(h.control('error').hidden,false);
  assert.equal(h.control('error').getAttribute('hidden'),null);
  const shown=unchangedView(h);h.applyGlobal();assert.deepEqual(unchangedView(h),shown);
  h.key('ArrowRight');assert.equal(h.control('counter').textContent,'3 / 3');
  assert.equal(h.control('error').hidden,true);
  h.open(['single'],0);assert.equal(h.control('counter').style.display,'none');
  assert.equal(h.control('prev').getClientRects().length,0);assert.equal(h.control('next').getClientRects().length,0);
  const single=unchangedView(h);h.applyGlobal();assert.deepEqual(unchangedView(h),single);
  assert.equal(h.control('error').textContent,EXPECTED[locale].error);h.close();
 }
});
group('lightbox unsupported locale fallback and invalid opens remain inert','fallback-invalid',()=>{
 const h=harness();h.language('en');
 assert.equal(h.translation('auth.modal.close'),'Close');
 assert.equal(h.translation('auth.modal.close','xx-YY'),EXPECTED['ko-KR'].close);
 assert.equal(h.translation('detail.gallery.error','zz'),EXPECTED['ko-KR'].error);
 assert.equal(h.translation('synthetic.missing.key','en-US'),'synthetic.missing.key');
 for(const value of [undefined,null,[],'',{}])h.open(value,0);
 h.applyGlobal();assert.equal(h.overlay(),null);assert.equal(h.handlers(),0);assert.equal(h.document.activeElement,h.opener);
 h.open(['a','b'],0);const node=h.overlay(),before=unchangedView(h),aria=node.getAttribute('aria-label'),error=h.control('error').textContent;
 for(const value of [undefined,null,[],'',{}])h.open(value,0);
 assert.equal(h.overlay(),node);assert.deepEqual(unchangedView(h),before);
 assert.equal(node.getAttribute('aria-label'),aria);assert.equal(h.control('error').textContent,error);
 h.close();assert.equal(h.document.activeElement,h.opener);assert.equal(h.handlers(),0);
});
