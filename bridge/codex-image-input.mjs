import assert from 'node:assert/strict';
import {validateModelImageFiles} from './native-evidence.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';

export async function codexImageInput({images=[],referenceInput,cwd,model}){
  assert.ok(Array.isArray(images),'Model image list required');
  if(referenceInput!==undefined){
    assert.equal(images.length,0,'User references cannot be mixed with native review images');
    const reference=await readJobReferenceInput({directory:cwd,input:referenceInput,model,runtimeHash:await assemblyRuntimeIdentity()});
    return {images:reference.images,referenceBindingHash:reference.binding.bindingHash};
  }
  await validateModelImageFiles(images,cwd);return {images};
}
