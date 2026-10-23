'use strict';
// AUTHOR/UNRUN. Only the separately approved, hash-pinned CI definition may invoke this.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const [mode, manifestFile, manifestPin, baselineDir, proposalDir, outputDir, proposalHead] = process.argv.slice(2);
const sha = value => createHash('sha256').update(value).digest('hex');
const norm = file => path.resolve(file).replace(/\\/g, '/').toLowerCase();
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + String.fromCharCode(0)).update(bytes).digest('hex');
let manifest, server, before;
const report = { contract: 'current-story-fit-types-only-v1', mode, passed: false,
  phase: 'input', compilerAttempts: 0, compilerInvocations: 0, compilerExit: null,
  diagnosticCount: null, diagnostics: [], programFiles: null, productionSourceFiles: null,
  overlayFilesInProgram: null, semanticTypesVerified: false, inputsStable: null,
  admissionSamples: 0, availablePhysicalBytes: null, guard: null,
  generatedSchemaAdmission: null,
  privateSdkUploaded: false, testsRun: 0, workersRun: 0, providerCalls: 0, databaseCalls: 0,
  productionInstalled: false, overallReady: false, hostileSandboxClaimed: false,
  rawStreamsUploaded: false, rawStreamsPersistAfterRunnerCleanup: false };
function check(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
function safeError(error) {
  return { code: /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code || '') ? error.code : null,
    messageSha256: sha(String(error?.message || '')), stackSha256: sha(String(error?.stack || '')) };
}
function real(file) {
  const resolved = path.resolve(file);
  check(norm(fs.realpathSync.native(resolved)) === norm(resolved), 'REPARSE_INPUT');
  return resolved;
}
function bytes(file) {
  const target = real(file), stat = fs.statSync(target);
  check(stat.isFile() && stat.size <= 128 * 1024 * 1024, 'INPUT_SIZE');
  return fs.readFileSync(target);
}
function normalized(file) {
  const value = bytes(file);
  check(!(value[0] === 239 && value[1] === 187 && value[2] === 191), 'INPUT_BOM');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/\r\n/g, '\n');
  check(!text.includes('\r'), 'INPUT_LINE_ENDINGS');
  return Buffer.from(text);
}
function write(name, value) {
  const file = path.resolve(outputDir, name);
  check(norm(file).startsWith(norm(outputDir) + '/'), 'OUTPUT_ESCAPE');
  fs.writeFileSync(file, value, { flag: 'wx' });
  return file;
}
function cleanEnv() {
  const home = path.join(outputDir, 'home');
  const value = { SystemRoot: process.env.SystemRoot || 'C:/Windows',
    WINDIR: process.env.WINDIR || 'C:/Windows',
    PATH: path.dirname(process.execPath) + ';C:/Windows/System32;C:/Program Files/Git/cmd',
    CI: 'true', NODE_ENV: 'test', GIT_CONFIG_GLOBAL: 'NUL', GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' };
  for (const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','XDG_CACHE_HOME','npm_config_cache']) value[key] = home;
  return value;
}
function git(dir, args, raw = false) {
  const value = cp.execFileSync('C:/Program Files/Git/cmd/git.exe', ['-C', dir, ...args],
    { env: cleanEnv(), windowsHide: true, timeout: 30000, maxBuffer: 256000 });
  return raw ? value : value.toString('utf8').trim();
}
function baselinePins() {
  check(git(baselineDir, ['rev-parse','HEAD']) === manifest.baseline, 'BASELINE_REF');
  for (const [name, expected] of Object.entries(manifest.sourcePins)) {
    check(git(baselineDir, ['rev-parse','HEAD:' + name]) === expected, 'BASELINE_GIT_PIN');
    check(blob(normalized(path.join(baselineDir, name))) === expected, 'BASELINE_WORKING_PIN');
  }
  const schema = normalized(path.join(server, 'prisma/schema.prisma'));
  check(sha(schema) === manifest.schemaSha256 &&
    (schema.toString('utf8').match(/^model\s+/gm) || []).length === 174, 'SCHEMA_SCOPE');
}
function overlayStable() {
  return manifest.files.every(row => {
    try { const b = bytes(path.join(baselineDir, row.target)); return b.length === row.bytes && sha(b) === row.sha256 && blob(b) === row.gitBlob; }
    catch { return false; }
  });
}
function sourceStatus() {
  const actual = git(baselineDir, ['status','--porcelain','--untracked-files=all','--','server'], true)
    .toString('utf8').replace(/\r?\n$/, '');
  const expected = manifest.files.map(row =>
    (manifest.originalBlobs[row.target] ? ' M ' : '?? ') + row.target).sort();
  assert.deepEqual(actual ? actual.split(/\r?\n/).sort() : [], expected);
}
function snapshot() {
  const files = new Set();
  function walk(dir, accept) {
    real(dir);
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      check(!item.isSymbolicLink(), 'GRAPH_REPARSE');
      const target = path.join(dir, item.name);
      if (item.isDirectory()) walk(target, accept);
      else if (item.isFile() && accept(target)) files.add(target);
      check(files.size <= 50000, 'GRAPH_FILE_BOUND');
    }
  }
  const resolutionInput = file => /\.(?:[cm]?[jt]sx?|json)$/i.test(file);
  walk(path.join(server, 'src'), resolutionInput);
  walk(path.join(server, 'node_modules'), resolutionInput);
  for (const name of Object.keys(manifest.sourcePins)) files.add(path.join(baselineDir, name));
  for (const name of Object.keys(manifest.versions)) files.add(path.join(server, 'node_modules', name, 'package.json'));
  files.add(path.join(server, 'node_modules/.prisma/client/schema.prisma'));
  files.add(path.join(server, 'node_modules/typescript/bin/tsc'));
  return [...files].sort().map(file => ({ file: real(file), sha256: sha(bytes(file)) }));
}
function inventoryStable(rows) {
  try { return JSON.stringify(snapshot()) === JSON.stringify(rows); } catch { return false; }
}
function relativeDiagnostic(file) {
  const relative = path.relative(server, path.resolve(server, file));
  return relative && !path.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith('..' + path.sep) ? relative.replace(/\\/g, '/') : null;
}
function preload(guardFile) {
  return "'use strict';\n" +
    "const fs=require('node:fs'),path=require('node:path');const raw=fs.writeFileSync.bind(fs);\n" +
    "const output=" + JSON.stringify(guardFile) + ";const stats={blockedEnvReads:0,blockedWrites:0,blockedNetwork:0,blockedChildProcesses:0};\n" +
    "function deny(k){return function(){stats[k]++;process.exitCode=1;throw new Error('QUALIFICATION_FORBIDDEN_OPERATION')}}\n" +
    "function env(p){if(typeof p==='string'&&/^\\.env(?:\\..*)?$/i.test(path.basename(p)))deny('blockedEnvReads')()}\n" +
    "for(const k of ['readFileSync','readFile','openSync','open']){const f=fs[k];fs[k]=function(p,...a){env(p);const w=typeof a[0]==='string'?/[wa+]/.test(a[0]):typeof a[0]==='number'&&(a[0]&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_TRUNC));if((k==='openSync'||k==='open')&&w&&p!==output)return deny('blockedWrites')();return f.call(this,p,...a)}}\n" +
    "const read=fs.promises.readFile.bind(fs.promises);fs.promises.readFile=async(p,...a)=>{env(p);return read(p,...a)};\n" +
    "fs.writeFileSync=function(p,...a){if(p!==output)return deny('blockedWrites')();return raw(p,...a)};\n" +
    "for(const k of ['writeFile','appendFile','appendFileSync','createWriteStream','mkdir','mkdirSync','rm','rmSync','rmdir','rmdirSync','unlink','unlinkSync','rename','renameSync','copyFile','copyFileSync','symlink','symlinkSync','link','linkSync'])fs[k]=deny('blockedWrites');\n" +
    "for(const k of ['writeFile','appendFile','mkdir','rm','rmdir','unlink','rename','copyFile','symlink','link','open'])fs.promises[k]=async()=>deny('blockedWrites')();\n" +
    "const c=require('node:child_process');for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])c[k]=deny('blockedChildProcesses');\n" +
    "require('node:worker_threads').Worker=deny('blockedChildProcesses');process.dlopen=deny('blockedChildProcesses');\n" +
    "require('node:net').Socket.prototype.connect=deny('blockedNetwork');require('node:net').Server.prototype.listen=deny('blockedNetwork');\n" +
    "for(const n of ['node:http','node:https'])for(const k of ['get','request','createServer'])require(n)[k]=deny('blockedNetwork');globalThis.fetch=deny('blockedNetwork');\n" +
    "require('node:module').syncBuiltinESMExports();process.once('exit',()=>raw(output,JSON.stringify(stats),{flag:'wx'}));\n";
}
try {
  check(process.argv.length === 9 && ['prepare','compile'].includes(mode) && /^[a-f0-9]{64}$/.test(manifestPin || '') &&
    /^[a-f0-9]{40}$/.test(proposalHead || ''), 'ARGUMENT_CONTRACT');
  check(process.platform === 'win32' && process.version === 'v22.14.0', 'NODE_RUNTIME');
  const names = new Set(Object.keys(process.env).map(key => key.toUpperCase()));
  for (const name of ['DATABASE_URL','DIRECT_URL','SHADOW_DATABASE_URL','NODE_OPTIONS','NODE_PATH',
    'OPENAI_API_KEY','ANTHROPIC_API_KEY','RUNWAY_API_KEY','PRISMA_SCHEMA_ENGINE_BINARY',
    'PRISMA_QUERY_ENGINE_LIBRARY','PRISMA_QUERY_ENGINE_BINARY']) check(!names.has(name), 'UNEXPECTED_OPERATING_ENV');
  check(norm(outputDir).startsWith(norm(process.env.RUNNER_TEMP) + '/'), 'JOB_OUTPUT_SCOPE');
  real(baselineDir); real(proposalDir);
  const input = bytes(manifestFile);
  check(sha(input) === manifestPin, 'MANIFEST_PIN');
  manifest = JSON.parse(input);
  check(manifest.contract === 'current-story-fit-ci-input-v1' &&
    manifest.baseline === 'cba30d0c67873f913b6cfd47e5b3b4fb7b3e882b' &&
    manifest.files.length === 7 && manifest.files.filter(row => row.root).length === 4, 'MANIFEST_SCOPE');
  check(new Set(manifest.files.map(row => row.target)).size === 7, 'UNIQUE_OVERLAYS');
  server = real(path.join(baselineDir, 'server'));
  report.baseline = manifest.baseline; report.manifestSha256 = manifestPin;
  report.nodeSha256 = sha(bytes(process.execPath));
  check(report.nodeSha256 === manifest.nodeSha256, 'NODE_BINARY');
  for (const name of [path.join(baselineDir,'.env'),path.join(server,'.env'),path.join(server,'prisma/.env'),
    path.join(baselineDir,'.npmrc'),path.join(server,'.npmrc')]) check(!fs.existsSync(name), 'LOCAL_OPERATING_CONFIG');
  if (mode === 'prepare') {
    fs.mkdirSync(outputDir); fs.mkdirSync(path.join(outputDir, 'home'));
    baselinePins();
    check(git(baselineDir, ['status','--porcelain','--untracked-files=all','--','server']) === '', 'BASELINE_NOT_CLEAN');
    check(git(proposalDir, ['rev-parse','HEAD']) === proposalHead, 'PROPOSAL_REF');
    const payloads = manifest.files.map(row => {
      check(/^server\/src\/story-production\/[a-z0-9.-]+\.ts$/.test(row.target) &&
        row.path === 'qa/ci-current-story-fit-inputs/' + row.target, 'OVERLAY_PATH');
      check(git(proposalDir, ['rev-parse','HEAD:' + row.path]) === row.gitBlob, 'PAYLOAD_GIT_REF');
      const data = git(proposalDir, ['cat-file','blob',row.gitBlob], true);
      check(data.length === row.bytes && sha(data) === row.sha256 && blob(data) === row.gitBlob, 'PAYLOAD_IDENTITY');
      check(!(data[0] === 239 && data[1] === 187 && data[2] === 191) &&
        !data.includes(13) && Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(data)).equals(data), 'PAYLOAD_ENCODING');
      const original = git(baselineDir, ['ls-tree','HEAD','--',row.target]);
      if (manifest.originalBlobs[row.target]) check(original.split(/\s+/)[2] === manifest.originalBlobs[row.target], 'ORIGINAL_TARGET_PIN');
      else check(original === '', 'NEW_TARGET_EXISTS');
      return { row, data };
    });
    for (const { row, data } of payloads) {
      const file = path.join(baselineDir, row.target); real(path.dirname(file));
      fs.writeFileSync(file, data, { flag: manifest.originalBlobs[row.target] ? 'w' : 'wx' });
    }
    check(overlayStable(), 'OVERLAY_COPY'); sourceStatus();
    report.overlaysCopied = 7; report.passed = true;
  } else {
    real(outputDir);
    const prepared = JSON.parse(bytes(path.join(outputDir, 'prepare-result.json')));
    check(prepared.passed === true && prepared.manifestSha256 === manifestPin && prepared.overlaysCopied === 7, 'PREPARE_RESULT');
    baselinePins(); check(overlayStable(), 'OVERLAY_PRECOMPILE'); sourceStatus();
    for (const [name, version] of Object.entries(manifest.versions))
      check(JSON.parse(bytes(path.join(server, 'node_modules', name, 'package.json'))).version === version, 'DEPENDENCY_VERSION');
    const sdkSchema = normalized(path.join(server,'node_modules/.prisma/client/schema.prisma'));
    const sdkSchemaSha256 = sha(sdkSchema);
    const sdkSchemaModels = (sdkSchema.toString('utf8').match(/^model\s+/gm) || []).length;
    report.generatedSchemaAdmission = {
      normalizedBytes: sdkSchema.length, normalizedSha256: sdkSchemaSha256,
      modelCount: sdkSchemaModels,
      expectedSha256: '16dc7b6ee1c189cb4d32b4f9567fa891398972ac8e7e28ab0a443a01a27a10ce',
      expectedModelCount: 174 };
    check(sdkSchemaSha256 === manifest.generatedSchemaSha256 &&
      sdkSchemaModels === 174, 'GENERATED_SCHEMA');
    report.generatedIndexSha256 = sha(bytes(path.join(server,'node_modules/.prisma/client/index.d.ts')));
    report.phase = 'admission'; report.admissionSamples = 1; report.availablePhysicalBytes = os.freemem();
    check(report.availablePhysicalBytes >= 2048 * 1024 * 1024, 'CANDIDATE_ENVIRONMENT_HEADROOM');
    before = snapshot(); report.graphInputFiles = before.length;
    report.inventorySha256 = sha(JSON.stringify(before.map(row => ({file:path.relative(server,row.file).replace(/\\/g,'/'),sha256:row.sha256}))));
    const guardFile = path.join(outputDir,'compiler-guard.json');
    const guard = write('compiler-preload.cjs',preload(guardFile));
    report.phase = 'compiler'; report.compilerAttempts = 1;
    const child = cp.spawnSync(process.execPath,['--max-old-space-size=1024','--require',guard,
      path.join(server,'node_modules/typescript/bin/tsc'),'--project','tsconfig.build.json',
      '--noEmit','--incremental','false','--pretty','false','--listFiles'],
      { cwd:server,env:cleanEnv(),windowsHide:true,timeout:90000,maxBuffer:32*1024*1024 });
    report.compilerInvocations = Number.isInteger(child.pid) && child.pid > 0 ? 1 : 0;
    report.compilerExit = child.status;
    report.child = { signal:child.signal,error:child.error?safeError(child.error):null,
      stdoutBytes:child.stdout?.length||0,stderrBytes:child.stderr?.length||0,
      stdoutSha256:sha(child.stdout||''),stderrSha256:sha(child.stderr||''),
      stdoutFile:null,stderrFile:null,stdoutWriteError:null,stderrWriteError:null };
    for (const stream of ['stdout','stderr']) {
      try { const name='compiler.'+stream+'.raw';write(name,child[stream]||'');report.child[stream+'File']=name; }
      catch(error){report.child[stream+'WriteError']=safeError(error)}
    }
    try { report.guard=JSON.parse(bytes(guardFile)); } catch(error){report.guardError=safeError(error)}
    const diagnostics=[],loaded=[];
    for(const line of String(child.stdout||'').split(/\r?\n/)){
      const at=line.match(/^(.+)\((\d+),(\d+)\): error TS(\d+):/),general=line.match(/^error TS(\d+):/);
      if(at)diagnostics.push({file:relativeDiagnostic(at[1]),line:Number(at[2]),column:Number(at[3]),code:Number(at[4])});
      else if(general)diagnostics.push({file:null,line:null,column:null,code:Number(general[1])});
      else if(path.isAbsolute(line))loaded.push(norm(line));
    }
    report.diagnostics=diagnostics.slice(0,256);report.diagnosticDetailsTruncated=diagnostics.length>256;
    report.programFiles=loaded.length;
    report.productionSourceFiles=loaded.filter(file=>file.startsWith(norm(path.join(server,'src'))+'/')).length;
    report.overlayFilesInProgram=manifest.files.filter(row=>loaded.includes(norm(path.join(baselineDir,row.target)))).length;
    const frozen = new Set(before.map(row => norm(row.file)));
    report.programInputsFrozen=loaded.length>0&&new Set(loaded).size===loaded.length&&
      loaded.every(file=>file.startsWith(norm(server)+'/')&&frozen.has(file));
    const required=['node_modules/.prisma/client/index.d.ts','node_modules/@prisma/client/runtime/library.d.ts',
      'node_modules/@types/node/index.d.ts','node_modules/@types/node/worker_threads.d.ts'];
    report.requiredDeclarationsPresent=required.every(file=>loaded.includes(norm(path.join(server,file))));
    const complete=!child.error&&child.signal===null&&child.status!==null;
    report.diagnosticCountComplete=complete;
    const qualifiedGraph=report.productionSourceFiles>0&&report.overlayFilesInProgram===7&&
      report.requiredDeclarationsPresent&&report.programInputsFrozen;
    report.diagnosticCount=diagnostics.length>0?diagnostics.length:
      complete&&child.status===0&&report.child.stderrBytes===0&&qualifiedGraph?0:null;
    report.phase='stability';report.inputsStable=inventoryStable(before)&&overlayStable();
    baselinePins();sourceStatus();
    const zero={blockedEnvReads:0,blockedWrites:0,blockedNetwork:0,blockedChildProcesses:0};
    check(complete&&child.status===0&&report.compilerInvocations===1&&report.child.stdoutWriteError===null&&
      report.child.stderrWriteError===null&&
      report.child.stderrBytes===0,'COMPILER_FAILED_OR_UNMEASURED');
    assert.deepEqual(report.guard,zero);
    check(qualifiedGraph&&
      report.diagnosticCount===0&&report.inputsStable===true,'PROGRAM_UNQUALIFIED');
    report.semanticTypesVerified=true;report.passed=true;
  }
} catch(error) { report.error=safeError(error); }
finally {
  if(before){report.inputsStable=report.inputsStable!==false&&inventoryStable(before)&&overlayStable();if(!report.inputsStable){report.passed=false;report.semanticTypesVerified=false}}
  try { real(outputDir);write(mode==='prepare'?'prepare-result.json':'compile-result.json',JSON.stringify(report,null,2)); }
  catch(error){report.passed=false;report.receiptError=safeError(error);try{process.stdout.write(JSON.stringify({contract:'candidate-type-receipt-unavailable-v1',passed:false,error:report.receiptError})+'\n')}catch{}}
  if(!report.passed)process.exitCode=1;
}
