import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {summarizeJavaFailures,readJavaFailureDiagnostics} from '../../scripts/ci-java-failure-summary.mjs';

const secret='synthetic-confidential-marker';
const method='builtinAloneStartsBridgeAndCompilesFreeSampleWithoutExternalCompanion';
const xml=body=>`<testsuite name="dev.voxelstudio.client.BuiltinRuntimeTest"><testcase name="${method}(boolean)[1] false">${body}</testcase><system-out>${secret}</system-out></testsuite>`;
const failure=`<failure type="java.io.IOException" message="${secret}">java.io.IOException: ${secret}
    at java.base/java.util.stream.ForEachOps$ForEachOp.evaluateSequential(ForEachOps.java:183)
    at org.junit.jupiter.engine.extension.TempDirectory$CloseablePath.deleteAllFilesAndDirectories(${secret}:91)
    at dev.voxelstudio.client.BuiltinRuntimeTest.builtinAloneStartsBridgeAndCompilesFreeSampleWithoutExternalCompanion(BuiltinRuntimeTest.java:17)
</failure>`;
test('reports known type and method stack without raw failure message or source paths',()=>{
  const r=summarizeJavaFailures(xml(failure));assert.equal(r.failures.length,1);assert.equal(r.failures[0].category,'junit-temporary-cleanup');
  assert.equal(r.failures[0].exceptionType,'java.io.IOException');assert.equal(r.failures[0].method,method);
  assert.equal(r.failures[0].frames.length,3);assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('.java:'));assert.equal(r.testOutcomeUnchanged,true);
});
test('error records stay failures, not accepted or retried outcomes',()=>{const r=summarizeJavaFailures(xml('<error type="java.lang.IllegalStateException">at dev.voxelstudio.client.BridgeClient.close(BridgeClient.java:1)</error>'));assert.equal(r.failures[0].kind,'error');assert.equal(r.failures[0].category,'unclassified');assert.equal(r.failures[0].causeNotProven,true);});
test('empty failure body does not invent a cause or stack',()=>assert.deepEqual(summarizeJavaFailures(xml('<failure type="java.io.IOException"/>')).failures[0].frames,[]));
test('success and skipped cases are not failures',()=>assert.equal(summarizeJavaFailures(xml('<skipped/>')).failures.length,0));
test('private class, parameter and exception names cannot be emitted',()=>{
  const r=summarizeJavaFailures(`<testsuite name="${secret}"><testcase name="${secret}"><failure type="${secret}">at private.account.secret.reader(readme:1)</failure></testcase></testsuite>`);
  assert.equal(r.failures[0].suite,'unreported');assert.equal(r.failures[0].method,'unreported');assert.equal(r.failures[0].exceptionType,'unreported');assert.deepEqual(r.failures[0].frames,[]);assert.ok(!JSON.stringify(r).includes(secret));
});
test('non-frame lines, suppressed messages and standard error are omitted',()=>assert.ok(!JSON.stringify(summarizeJavaFailures(xml(failure+`<system-err>${secret}</system-err>`))).includes(secret)));
test('unsafe XML declarations are rejected without resolution',()=>{assert.throws(()=>summarizeJavaFailures('<!DOCTYPE x SYSTEM "private">'+xml(failure)));assert.throws(()=>summarizeJavaFailures('<!ENTITY x "private">'+xml(failure)));});
test('missing suite and oversized input are rejected',()=>{assert.throws(()=>summarizeJavaFailures('no suite'));assert.throws(()=>summarizeJavaFailures('x'.repeat(8*1024**2+1)));});
test('frame output is bounded without printing truncated raw text',()=>{const rows=Array.from({length:100},()=>`at dev.voxelstudio.client.BridgeClient.close(${secret}:1)`).join('\n');const r=summarizeJavaFailures(xml(`<failure type="java.io.IOException">${rows}</failure>`));assert.equal(r.failures[0].frames.length,48);assert.ok(!JSON.stringify(r).includes(secret));});
async function scratch(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'java-summary-')));assert.match(path.basename(root),/^java-summary-/);t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('diagnostic reader reports absent results without replacing original status',async t=>{const root=await scratch(t);const r=await readJavaFailureDiagnostics(root);assert.equal(r.state,'test-results-absent');assert.equal(r.testOutcomeUnchanged,true);});
test('reader includes only bounded JUnit files and emits no directory paths',async t=>{const root=await scratch(t);const dir=path.join(root,'mod/build/test-results/test');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'TEST-dev.voxelstudio.client.BuiltinRuntimeTest.xml'),xml(failure));await fs.writeFile(path.join(dir,'ignored.log'),secret);const r=await readJavaFailureDiagnostics(root);assert.equal(r.suitesRead,1);assert.equal(r.failures.length,1);assert.ok(!JSON.stringify(r).includes(root));assert.ok(!JSON.stringify(r).includes(secret));});
test('unsafe redirected diagnostic files are rejected',async t=>{const root=await scratch(t);const dir=path.join(root,'mod/build/test-results/test');await fs.mkdir(dir,{recursive:true});await fs.mkdir(path.join(dir,'TEST-dev.voxelstudio.client.BuiltinRuntimeTest.xml'));await assert.rejects(readJavaFailureDiagnostics(root),/Unsafe/);});
test('forged frames under a trusted package cannot print arbitrary identifiers',()=>{const r=summarizeJavaFailures(xml(`<failure type="java.io.${secret}">at dev.voxelstudio.${secret}.read(data:1)\nat java.nio.file.Files.${secret}(data:2)</failure>`));assert.equal(r.failures[0].exceptionType,'unreported');assert.deepEqual(r.failures[0].frames,[]);assert.ok(!JSON.stringify(r).includes(secret));});
test('arbitrary method-shaped display names remain unreported',()=>{const r=summarizeJavaFailures(`<testsuite name="dev.voxelstudio.client.BuiltinRuntimeTest"><testcase name="${secret.replaceAll('-','_')}(String)">${failure}</testcase></testsuite>`);assert.equal(r.failures[0].method,'unreported');});
test('known causes and suppressed types are retained without their messages',()=>{const r=summarizeJavaFailures(xml(`<failure type="java.io.IOException">Caused by: java.nio.file.AccessDeniedException: ${secret}\nSuppressed: java.nio.file.DirectoryNotEmptyException: ${secret}</failure>`));assert.deepEqual(r.failures[0].relatedExceptionTypes,['java.io.IOException','java.nio.file.AccessDeniedException','java.nio.file.DirectoryNotEmptyException']);assert.ok(!JSON.stringify(r).includes(secret));});
test('unknown exception-shaped cause text cannot escape the fixed type list',()=>{const r=summarizeJavaFailures(xml(`<failure type="java.io.IOException">Caused by: java.io.${secret.replaceAll('-','_')}: hidden</failure>`));assert.deepEqual(r.failures[0].relatedExceptionTypes,['java.io.IOException']);assert.ok(!JSON.stringify(r).includes(secret.replaceAll('-','_')));});
test('repeated cause rows are deduplicated rather than expanding output',()=>{const rows=Array.from({length:100},()=>`Caused by: java.io.IOException: ${secret}`).join('\n');const r=summarizeJavaFailures(xml(`<failure type="java.io.IOException">${rows}</failure>`));assert.deepEqual(r.failures[0].relatedExceptionTypes,['java.io.IOException']);});

const bridgeSuite='dev.voxelstudio.client.BridgeClientTest';
const bridgeMethods=['referenceHistoryClientReadsOnlyExactOriginalGetRoutesAndNoSendOrConfirmation','exactImageRestoreClientOnlyGetsSelectedOriginalBytesAndRechecksOriginalScope'];
test('fixed Bridge read tests retain the Future wait location without inventing a transport cause',()=>{
  for(const known of bridgeMethods){
    const input=`<testsuite name="${bridgeSuite}"><testcase name="${known}()"><failure type="java.util.concurrent.TimeoutException" message="${secret}">java.util.concurrent.TimeoutException: ${secret}\n at java.base/java.util.concurrent.CompletableFuture.timedGet(CompletableFuture.java:1960)\n at java.base/java.util.concurrent.CompletableFuture.get(CompletableFuture.java:2095)\n at ${bridgeSuite}.${known}(${secret}:109)</failure></testcase></testsuite>`;
    const r=summarizeJavaFailures(input),f=r.failures[0];assert.equal(f.suite,bridgeSuite);assert.equal(f.method,known);assert.equal(f.category,'future-wait-timeout');assert.equal(f.frames.length,3);assert.equal(f.causeNotProven,true);assert.equal(r.testOutcomeUnchanged,true);assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('.java:'));
  }
});
test('trusted Bridge package does not allow arbitrary test names or frame suffixes',()=>{
  const name=bridgeMethods[0]+secret.replaceAll('-','_');const r=summarizeJavaFailures(`<testsuite name="${bridgeSuite}"><testcase name="${name}()"><failure type="java.util.concurrent.TimeoutException">at ${bridgeSuite}.${name}(private:1)\nat java.util.concurrent.CompletableFuture.${name}(private:2)</failure></testcase></testsuite>`);
  assert.equal(r.failures[0].method,'unreported');assert.deepEqual(r.failures[0].frames,[]);assert.equal(r.failures[0].category,'unclassified');assert.ok(!JSON.stringify(r).includes(secret.replaceAll('-','_')));
});
test('known display names are accepted only under their fixed public suite',()=>{
  const r=summarizeJavaFailures(`<testsuite name="${secret}"><testcase name="${bridgeMethods[0]}()"><failure type="java.util.concurrent.TimeoutException"/></testcase></testsuite>`);assert.equal(r.failures[0].suite,'unreported');assert.equal(r.failures[0].method,'unreported');assert.equal(r.failures[0].category,'unclassified');assert.ok(!JSON.stringify(r).includes(secret));
});
test('a TimeoutException alone is not proof of a Future wait or HTTP failure',()=>{
  const r=summarizeJavaFailures(xml('<failure type="java.util.concurrent.TimeoutException"/>'));assert.equal(r.failures[0].category,'unclassified');assert.equal(r.failures[0].causeNotProven,true);assert.deepEqual(r.failures[0].frames,[]);
});

test('fixed archive-read diagnostics distinguish an actual HTTP request timeout from a Future wait',()=>{
  const known='archiveReadersUseExactReadOnlyRoutesAndBindActualWorkerRecordsWithoutPostOrGeneration';
  const input=`<testsuite name="${bridgeSuite}"><testcase name="${known}()"><failure type="java.util.concurrent.ExecutionException" message="${secret}">java.util.concurrent.ExecutionException: ${secret}
 at java.base/java.util.concurrent.CompletableFuture.get(CompletableFuture.java:2095)
Caused by: java.lang.IllegalStateException: ${secret}
 at dev.voxelstudio.client.BridgeClient.establish(${secret}:654)
Caused by: java.net.http.HttpTimeoutException: ${secret}
 at java.net.http/jdk.internal.net.http.HttpClientImpl.send(${secret}:905)
 at dev.voxelstudio.client.BridgeClient.exchange(${secret}:643)
</failure></testcase></testsuite>`;
  const r=summarizeJavaFailures(input),f=r.failures[0];assert.equal(f.method,known);assert.equal(f.category,'http-request-timeout');
  assert.ok(f.relatedExceptionTypes.includes('java.net.http.HttpTimeoutException'));assert.ok(f.frames.includes('dev.voxelstudio.client.BridgeClient.establish'));
  assert.equal(f.causeNotProven,true);assert.equal(r.testOutcomeUnchanged,true);assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('.java:'));
});
test('HTTP timeout classification requires an exact whitelisted type, not message text or a class-shaped secret',()=>{
  for(const body of [`java.net.http.HttpTimeoutException: ${secret}`,`Caused by: java.net.http.HttpTimeoutException_${secret.replaceAll('-','_')}: hidden`]){
    const r=summarizeJavaFailures(xml(`<failure type="java.util.concurrent.ExecutionException">${body}</failure>`));
    assert.equal(r.failures[0].category,'unclassified');assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes(secret.replaceAll('-','_')));
  }
});
