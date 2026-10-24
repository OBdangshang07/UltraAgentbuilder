import fs from 'node:fs/promises';
import path from 'node:path';
import {parentPort,workerData} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../contracts/world-assembly-limits.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {prepareCoupledReferenceWorldAssemblyDraft,bindCoupledReferenceWorldAssemblyDraft,validateCoupledAssemblyReferenceInput} from './coupled-reference-world-assembly-input.mjs';
import {readCoupledReferenceWorldAssemblyCandidate} from './coupled-reference-world-assembly.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY} from './coupled-reference-world-assembly-candidate.mjs';
import {readReferenceAssemblyProofMember as member} from './reference-world-assembly-candidate.mjs';
import {JOINT_ASSEMBLY_RESOURCE_LIMITS} from './coupled-reference-world-assembly-resources.mjs';
import {readCoupledReferenceWorldAssemblyJobRecord} from './coupled-reference-world-assembly-job-data.mjs';
import {readCoupledReferenceWorldAssemblyJobStatus,listCoupledReferenceWorldAssemblyRecords} from './coupled-reference-world-assembly-history.mjs';
import {readCoupledReferenceWorldAssemblyNative,uploadCoupledReferenceWorldAssemblyNative} from './coupled-reference-world-assembly-native.mjs';
import {publicCoupledAssemblyAdmissionFailure} from './coupled-reference-world-assembly-admission-failure.mjs';

const operations=['prepare','bind','metadata','part','native-cells','job-record','job-status','job-list','native-read','native-upload'];
async function physical(root){
  root=path.resolve(root);let ancestor=path.parse(root).root;
  for(const part of path.relative(ancestor,root).split(path.sep)){ancestor=path.join(ancestor,part);const s=await fs.lstat(ancestor);if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(ancestor)!==ancestor)throw Error('Original coupled directory redirected');}
  return root;
}
// Fixed new namespace/operations only. No caller paths, providers, runtime
// override, old cached cohort, source recompilation or world API is admitted.
try{
  exactKeys(workerData,['dataDir','operation','id','payload','cohort'],'private coupled resource worker');
  const {operation,id,payload}=workerData;
  if(workerData.cohort!==null||!operations.includes(operation)||(operation==='job-list'?id!==null:typeof id!=='string'||!REFERENCE_OWNER.test(id)))throw Error('Independent original coupled operation/UUID required');
  if(!(payload instanceof Uint8Array)||!payload.byteLength||payload.byteLength>(operation==='native-upload'?JOINT_ASSEMBLY_RESOURCE_LIMITS.nativeUploadBytes:JOINT_ASSEMBLY_RESOURCE_LIMITS.inputBytes))throw Object.assign(Error('Coupled resource input quota'),{statusCode:413});
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload)),dataDir=await physical(workerData.dataDir),directory=id===null?null:path.join(dataDir,'coupled-reference-world-assembly-jobs',id);
  let result;
  if(operation==='prepare'||operation==='bind'){
    exactKeys(input,['contextId','referenceSetHash','generation','selectedCapability',...(operation==='bind'?['send']:[])],'new independent coupled resource preparation');
    if(input.generation?.key!==id)throw Error('Coupled generation key differs from original pixel owner');
    const options={...input,dataDir,referenceOwnerId:id};result=operation==='prepare'?await prepareCoupledReferenceWorldAssemblyDraft(options):await bindCoupledReferenceWorldAssemblyDraft({...options,directory});
  }else if(operation==='job-record'){
    exactKeys(input,['expectedRequestHash'],'original coupled reservation read');result=await readCoupledReferenceWorldAssemblyJobRecord({dataDir,id,...input});
  }else if(operation==='job-list'){
    exactKeys(input,[],'original coupled history list');result=await listCoupledReferenceWorldAssemblyRecords({dataDir});
  }else if(operation==='job-status'){
    exactKeys(input,['expectedRequestHash'],'original coupled status');result=await readCoupledReferenceWorldAssemblyJobStatus({dataDir,id,...input});
  }else if(operation==='native-read'||operation==='native-upload'){
    exactKeys(input,['expectedRequestHash','evidenceId',operation==='native-read'?'member':'upload'],'original coupled native transport');
    result=await(operation==='native-read'?readCoupledReferenceWorldAssemblyNative:uploadCoupledReferenceWorldAssemblyNative)({dataDir,id,...input});
  }else{
    exactKeys(input,['referenceInput','preparationHash','candidateHash',...(operation==='part'?['partIndex']:[])],'original complete coupled result identity');
    validateCoupledAssemblyReferenceInput(input.referenceInput);
    if(input.referenceInput.ownerId!==id||input.referenceInput.preparationHash!==input.preparationHash||!/^[a-f0-9]{64}$/.test(input.candidateHash??''))throw Error('Original complete coupled result pins required');
    const original=await readCoupledReferenceWorldAssemblyCandidate({...input,directory});
    const root=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
    async function file(name,maximum,encoding='utf8'){
      const bytes=await member(root,name,maximum),pin=original.candidate.files.find(p=>p.path===name);
      if(name==='binding.json'? !bytes.equals(Buffer.from(JSON.stringify(original.binding))) : !pin||pin.bytes!==bytes.length||pin.sha256!==hash(bytes))throw Error('Original coupled payload changed after complete verification');
      return {path:name,bytes:bytes.length,sha256:hash(bytes),encoding,data:encoding==='utf8'?new TextDecoder('utf-8',{fatal:true}).decode(bytes):bytes.toString('base64')};
    }
    const common={version:1,purpose:'coupled-reference-world-assembly',preparationHash:input.preparationHash,candidateHash:original.candidate.candidateHash,
      completeSetVerified:true,partIsApplyScope:false,canAuthorizePlacement:false,serverBaselineVerified:false,additionalModelCalls:0,worldWrites:0};
    if(operation==='metadata')result={format:'CoupledReferenceWorldAssemblyCandidateMetadata',...common,candidate:original.candidate,
      files:await Promise.all(['native-manifest.json','coupling-plan.json','patch-set.json','binding.json'].map(name=>file(name,WORLD_ASSEMBLY_LIMITS.metadataBytes)))};
    else if(operation==='native-cells')result={format:'CoupledReferenceWorldAssemblyCandidateCells',...common,file:await file('cells.bin',16777216,'base64')};
    else{
      if(!Number.isSafeInteger(input.partIndex)||input.partIndex<0||input.partIndex>=original.candidate.partCount)throw Error('Exact complete coupled part index required');
      const index=input.partIndex,name=kind=>kind+'-'+String(index).padStart(3,'0')+'.json';
      result={format:'CoupledReferenceWorldAssemblyCandidatePart',...common,index,partCount:original.candidate.partCount,
        files:await Promise.all([name('part'),name('preview')].map(n=>file(n,WORLD_ASSEMBLY_LIMITS.partBytes)))};
    }
  }
  const reply={operation,id,ok:true,result};
  if(Buffer.byteLength(JSON.stringify(reply))>JOINT_ASSEMBLY_RESOURCE_LIMITS.outputBytes)throw Object.assign(Error('Coupled output quota; no partial result'),{statusCode:413});
  parentPort.postMessage(reply);
}catch(error){parentPort.postMessage({operation:workerData?.operation,id:workerData?.id,ok:false,statusCode:[400,409,413].includes(error.statusCode)?error.statusCode:409,
  ...(publicCoupledAssemblyAdmissionFailure(error)?{admissionDiagnostic:publicCoupledAssemblyAdmissionFailure(error)}:{})});}
