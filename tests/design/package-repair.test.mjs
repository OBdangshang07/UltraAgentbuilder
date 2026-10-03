import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyPlan,packageEdit} from './assembly-fixtures.mjs';
import {shape} from './fixtures.mjs';
import {applyPackageEdit} from '../../contracts/scene-assembly.schema.mjs';
import {packageRepairBase,packageRepairSchema,applyPackageRepair,packageDelta} from '../../contracts/scene-package-repair.mjs';
import {assemblyStageSchema} from '../../contracts/scene-assembly-stage.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';

function fixture(){
 const plan=assemblyPlan(),source=plan.scene,task=plan.packages[0],prefix=task.id+'__';
 const edit=packageEdit({sourceHash:hash(source),previousDraft:source,task});
 edit.components.put=[shape(prefix+'pier',[1,0,1],[1,3,1],'wall'),shape(prefix+'bracket',[3,3,1],[1,1,2],'wall')];
 const candidate=applyPackageEdit(source,edit,task).scene;
 return {source,task,prefix,edit,candidate,base:packageRepairBase(source,{rejectedSource:candidate,rejectedEdit:edit},task)};
}
const repair=(f,put)=>({format:'ScenePackageRepair',version:1,sourceHash:hash(f.source),candidateHash:f.base.candidateHash,
 edit:{format:'SceneDraftEdit',version:1,sourceHash:f.base.candidateHash,components:{put,remove:[]},modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null}});

test('incremental repairs preserve omitted pending details across successive corrections',()=>{
 const f=fixture(),initial=hash(f.candidate),first=structuredClone(f.candidate.components.find(c=>c.id===f.prefix+'pier'));first.at.offset[0]=2;
 const a=applyPackageRepair(f.source,f.base,repair(f,[first]),f.task);
 const next={...f,base:packageRepairBase(f.source,{rejectedSource:a.scene,rejectedEdit:a.effectiveEdit},f.task)};
 const bracket=structuredClone(a.scene.components.find(c=>c.id===f.prefix+'bracket'));bracket.size[2]=1;
 const b=applyPackageRepair(f.source,next.base,repair(next,[bracket]),f.task);
 assert.deepEqual(b.scene.components.find(c=>c.id===first.id),first);
 assert.deepEqual(b.scene.components.find(c=>c.id===bracket.id),bracket);
 assert.equal(hash(f.candidate),initial);assert.equal(hash(applyPackageEdit(f.source,b.effectiveEdit,f.task).scene),hash(b.scene));
 assert.equal(b.effectiveEdit.sourceHash,hash(f.source));assert.notEqual(b.effectiveEdit.sourceHash,next.base.candidateHash);
});

test('repair schema pins accepted and candidate identities and narrows mutable component IDs',()=>{
 const f=fixture(),schema=assemblyStageSchema(packageRepairSchema,{sourceHash:hash(f.source),repairBase:f.base,task:f.task});
 assert.deepEqual(schema.properties.sourceHash.enum,[hash(f.source)]);assert.deepEqual(schema.properties.candidateHash.enum,[f.base.candidateHash]);
 assert.equal(schema.anyOf,undefined);assert.ok(schema.properties.edit.anyOf.length>=3);
 for(const branch of schema.properties.edit.anyOf){assert.deepEqual(branch.properties.sourceHash.enum,[f.base.candidateHash]);assert.equal(branch.additionalProperties,false);assert.deepEqual(branch.required,Object.keys(branch.properties));}
 assert.equal(schemaFeedback(repair(f,[]),schema).valid,false);
 assert.equal(schemaFeedback(repair(f,[f.candidate.components.at(-1)]),schema).valid,true);
 const bad=repair(f,[]);bad.edit.sourceHash=hash(f.source);assert.equal(schemaFeedback(bad,schema).valid,false);
});

test('nonempty output constraint allows component removal, module-only and palette-only repairs without widening authority',()=>{
 const f=fixture(),before=hash(packageRepairSchema),input={sourceHash:hash(f.source),repairBase:f.base,task:f.task};
 const schema=assemblyStageSchema(packageRepairSchema,input);
 const removal=repair(f,[]);removal.edit.components.remove=[f.prefix+'pier'];assert.equal(schemaFeedback(removal,schema).valid,true);
 const module=repair(f,[]);module.edit.modules.put=[{id:f.prefix+'detail',parameters:[],size:[1,1,1],nodes:[{nodeId:'n',op:'box',origin:[0,0,0],size:[1,1,1],material:'wall',thickness:1,axis:'x',repeat:{count:1,step:[0,0,0]},points:[],blockState:null}]}];
 assert.equal(schemaFeedback(module,schema).valid,true);
 const palette=repair(f,[]);palette.edit.palette.put=[{role:f.prefix+'stone',material:'stone'}];assert.equal(schemaFeedback(palette,schema).valid,true);
 const candidate=structuredClone(f.base);candidate.scene.modules=module.edit.modules.put;
 const removalSchema=assemblyStageSchema(packageRepairSchema,{...input,repairBase:candidate});
 const removeModule=repair(f,[]);removeModule.edit.modules.remove=[f.prefix+'detail'];assert.equal(schemaFeedback(removeModule,removalSchema).valid,true);
 for(const change of [r=>r.edit.design=f.source.design,r=>r.edit.components.put[0].id='foreign',r=>r.edit.palette.remove=[f.source.palette[0].role],r=>r.edit.sourceHash=hash(f.source),r=>r.edit.reservations.remove=['reserved']]){
  const r=repair(f,[structuredClone(f.candidate.components.at(-1))]);change(r);assert.equal(schemaFeedback(r,schema).valid,false);
 }
 assert.equal(hash(packageRepairSchema),before);assert.ok(JSON.stringify(schema).length<JSON.stringify(packageRepairSchema).length+20000);
 // Local legacy validation still records a provider's bad/no-op reply. It is
 // never silently changed; the orchestration's same-candidate stop remains.
 assert.equal(hash(applyPackageRepair(f.source,f.base,repair(f,[]),f.task).scene),hash(f.candidate));
});

test('repair candidates and deltas cannot substitute stale data or expand frozen authority',()=>{
 const f=fixture();
 assert.equal(packageRepairBase(f.source,{rejectedSource:f.source,rejectedEdit:f.edit},f.task),null);
 for(const key of ['sourceHash','candidateHash']){const r=repair(f,[]);r[key]='0'.repeat(64);assert.throws(()=>applyPackageRepair(f.source,f.base,r,f.task),/identity/);}
 const changed=structuredClone(f.base);changed.scene.seed++;assert.throws(()=>applyPackageRepair(f.source,changed,repair(f,[]),f.task),/identity/);
 const global=repair(f,[]);global.edit.constraints=f.source.constraints;assert.throws(()=>applyPackageRepair(f.source,f.base,global,f.task),/global/);
 const foreign=repair(f,[shape('foreign',[0,0,0],[1,1,1],'wall')]);assert.throws(()=>applyPackageRepair(f.source,f.base,foreign,f.task),/ownership/);
 const before=hash(f.source);const palette=repair(f,[]);palette.edit.palette.put=[{...f.source.palette[0]}];assert.throws(()=>applyPackageRepair(f.source,f.base,palette,f.task),/palette/);assert.equal(hash(f.source),before);
});

test('composed proposals retain original edit quotas instead of accumulating unlimited sub-edits',()=>{
 const f=fixture(),candidate=structuredClone(f.source);
 for(let i=0;i<257;i++)candidate.components.push(shape(f.prefix+'n'+i,[1,1,1],[1,1,1],'wall'));
 assert.throws(()=>packageDelta(f.source,candidate),/original edit contract/);
});
