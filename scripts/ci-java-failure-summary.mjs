import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const maximumBytes=8*1024**2;
const builtinSuite='dev.voxelstudio.client.BuiltinRuntimeTest';
const builtinMethod='builtinAloneStartsBridgeAndCompilesFreeSampleWithoutExternalCompanion';
const bridgeSuite='dev.voxelstudio.client.BridgeClientTest';
const bridgeMethods=['referenceHistoryClientReadsOnlyExactOriginalGetRoutesAndNoSendOrConfirmation','exactImageRestoreClientOnlyGetsSelectedOriginalBytesAndRechecksOriginalScope','archiveReadersUseExactReadOnlyRoutesAndBindActualWorkerRecordsWithoutPostOrGeneration'];
const suiteMethods=new Map([[builtinSuite,[builtinMethod]],[bridgeSuite,bridgeMethods]]);
const exceptionTypes=new Set(['java.io.IOException','java.nio.file.AccessDeniedException','java.nio.file.DirectoryNotEmptyException','java.nio.file.NoSuchFileException','java.nio.file.FileSystemException','java.net.http.HttpTimeoutException','java.lang.IllegalStateException','java.lang.AssertionError','java.util.concurrent.ExecutionException','java.util.concurrent.TimeoutException','org.opentest4j.AssertionFailedError','org.junit.platform.commons.JUnitException']);
// Fixed public method names, not arbitrary message text that happens to look
// like a Java frame. A model answer or forged XML cannot encode a secret here.
const frameMethods=new Map([
  ['java.util.stream.ForEachOps$ForEachOp',['evaluateSequential','evaluateParallel']],
  ['java.util.stream.ForEachOps$ForEachOp$OfRef',['accept']],
  ['java.util.stream.ReferencePipeline',['forEach','forEachWithCancel']],
  ['java.util.stream.AbstractPipeline',['evaluate','copyInto','wrapAndCopyInto']],
  ['java.nio.file.Files',['delete','deleteIfExists','walkFileTree','walk','readAttributes']],
  ['java.nio.file.FileTreeWalker',['next','walk']],
  ['java.nio.file.FileTreeIterator',['hasNext','fetchNextIfNeeded']],
  ['sun.nio.fs.WindowsFileSystemProvider',['delete','deleteIfExists','newFileChannel','checkAccess','readAttributes']],
  ['sun.nio.fs.WindowsException',['rethrowAsIOException','translateToIOException','asIOException']],
  ['sun.nio.fs.AbstractFileSystemProvider',['delete']],
  ['org.junit.jupiter.engine.extension.TempDirectory$CloseablePath',['close','deleteAllFilesAndDirectories']],
  ['org.junit.jupiter.engine.extension.TempDirectory$CloseablePath$1',['visitFile','postVisitDirectory']],
  ['org.junit.platform.engine.support.hierarchical.ThrowableCollector',['execute']],
  ['dev.voxelstudio.client.BridgeClient',['close','establish','exchange']],
  ['jdk.internal.net.http.HttpClientImpl',['send']],
  ['java.util.concurrent.CompletableFuture',['get','timedGet']],
  [bridgeSuite,bridgeMethods],
  [builtinSuite,[builtinMethod]],
]);
const allowedFrames=new Set([...frameMethods].flatMap(([name,methods])=>methods.map(method=>name+'.'+method)));
function attribute(text,key){return text.match(new RegExp('(?:^|\\s)'+key+'="([^"<]*)"'))?.[1]??'';}
function safeMethod(suite,value){return suiteMethods.get(suite)?.find(method=>value===method||value.startsWith(method+'('))??'unreported';}

/** Diagnostic only: never emit exception messages, paths, output streams or XML. */
export function summarizeJavaFailures(xml){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>maximumBytes||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsupported JUnit diagnostic input');
  const suite=xml.match(/<testsuite\b([^>]*)>/)?.[1];if(!suite)throw new Error('Missing JUnit suite');
  const suiteName=attribute(suite,'name'),safeSuite=suiteMethods.has(suiteName)?suiteName:'unreported';
  const failures=[];
  for(const test of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)){
    for(const failed of (test[2]??'').matchAll(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)){
      if(failures.length>=1024)throw new Error('JUnit diagnostic count exceeded');
      const type=attribute(failed[2],'type'),frames=[],relatedTypes=new Set(exceptionTypes.has(type)?[type]:[]);
      for(const line of (failed[3]??'').split(/\r?\n/)){
        const related=/^\s*(?:Caused by|Suppressed):\s+([A-Za-z0-9_.$]+)(?::|\s*$)/.exec(line);
        if(related&&exceptionTypes.has(related[1]))relatedTypes.add(related[1]);
        const match=/^\s*at\s+(?:[A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.-]+)?\/)?([A-Za-z0-9_.$]+)\([^\r\n]*\)\s*$/.exec(line);
        if(match&&allowedFrames.has(match[1])&&frames.length<48)frames.push(match[1]);
      }
      const cleanup=frames.some(frame=>frame.startsWith('org.junit.')&&frame.includes('TempDirectory'));
      const futureWait=type==='java.util.concurrent.TimeoutException'&&frames.some(frame=>frame==='java.util.concurrent.CompletableFuture.get'||frame==='java.util.concurrent.CompletableFuture.timedGet');
      const httpTimeout=relatedTypes.has('java.net.http.HttpTimeoutException');
      failures.push({suite:safeSuite,method:safeMethod(suiteName,attribute(test[1],'name')),kind:failed[1],exceptionType:exceptionTypes.has(type)?type:'unreported',relatedExceptionTypes:[...relatedTypes].sort(),
        category:cleanup?'junit-temporary-cleanup':futureWait?'future-wait-timeout':httpTimeout?'http-request-timeout':'unclassified',frames,rawMessageOmitted:true,rawStreamsOmitted:true,pathsOmitted:true,causeNotProven:true});
    }
  }
  return {format:'SanitizedJavaFailureDiagnostics',version:1,failures,diagnosticOnly:true,testOutcomeUnchanged:true};
}

export async function readJavaFailureDiagnostics(project){
  project=path.resolve(project);const directory=path.join(project,'mod/build/test-results/test');
  let stat;try{stat=await fs.lstat(directory);}catch(error){if(error.code==='ENOENT')return {format:'SanitizedJavaFailureDiagnostics',version:1,state:'test-results-absent',failures:[],testOutcomeUnchanged:true};throw new Error('JUnit diagnostic directory unreadable');}
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(directory)!==directory)throw new Error('Unsafe JUnit diagnostic directory');
  const names=(await fs.readdir(directory)).filter(name=>/^TEST-[A-Za-z0-9_.$]+\.xml$/.test(name)).sort();
  if(names.length>512)throw new Error('JUnit suite count exceeded');const failures=[];let totalBytes=0;
  for(const name of names){const file=path.join(directory,name),entry=await fs.lstat(file);
    if(!entry.isFile()||entry.isSymbolicLink()||entry.size>maximumBytes||await fs.realpath(file)!==file)throw new Error('Unsafe JUnit diagnostic file');
    totalBytes+=entry.size;if(totalBytes>32*1024**2)throw new Error('JUnit total diagnostic bytes exceeded');
    failures.push(...summarizeJavaFailures(await fs.readFile(file,'utf8')).failures);
    if(failures.length>4096)throw new Error('JUnit total diagnostic failures exceeded');
  }
  return {format:'SanitizedJavaFailureDiagnostics',version:1,state:'read',suitesRead:names.length,failures,diagnosticOnly:true,testOutcomeUnchanged:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2)throw new Error('No external diagnostic paths accepted');
  const project=fileURLToPath(new URL('../',import.meta.url));
  try{console.log(JSON.stringify(await readJavaFailureDiagnostics(project)));}
  catch{console.log(JSON.stringify({format:'SanitizedJavaFailureDiagnostics',version:1,state:'diagnostic-read-failed',rawDetailsOmitted:true,testOutcomeUnchanged:true}));process.exitCode=1;}
}
