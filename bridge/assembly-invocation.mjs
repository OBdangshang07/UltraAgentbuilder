import {hash} from '../src/generation/compiler.mjs';

// One canonical invocation identity for the write-ahead journal and read-only
// receipt checks. Image contents, not temporary filenames, bind the call.
export function assemblyInvocationFingerprint({prompt,index,outputSchema,stageName,stageCount,imageHashes,referenceInput}){
  return hash({prompt,index,schema:outputSchema,phase:stageName,maximum:stageCount,images:imageHashes,
    ...(referenceInput!==undefined?{referenceInput}:{})});
}
