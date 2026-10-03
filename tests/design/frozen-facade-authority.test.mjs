import test from 'node:test';
import assert from 'node:assert/strict';
import {storeyStudy} from './storey-layout-fixtures.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {checkPackageGeometry} from '../../src/design/assembly-scope.mjs';
import {PACKAGE_SCOPE_EVIDENCE,PACKAGE_SPATIAL_EVIDENCE,assemblyCorrectionInput} from '../../src/design/correction-feedback.mjs';
import {prototypeEvidence} from '../../src/design/quality-prototypes.mjs';

test('quality concept evidence exposes unowned or separately owned facade hosts without assigning permission',()=>{
 const scene=storeyStudy(),plan={packages:[{id:'skin',editableComponents:['panels']},{id:'structure',editableComponents:[]}]},before=hash({scene,plan});
 const evidence=prototypeEvidence(scene,'ultra',plan),warning=evidence.warnings.find(w=>w.code==='facade-host-outside-package');
 assert.equal(warning.host,'main');assert.deepEqual(warning.hostPackages,[]);
 assert.equal(evidence.facadeAuthority.packageScopeHash,hash(plan.packages));assert.equal(evidence.facadeAuthority.scopeExpanded,false);
 assert.equal(hash({scene,plan}),before);assert.deepEqual(evidence.facadeAuthority.facades[0].facadePackages,['skin']);
 plan.packages[1].editableComponents=['main'];assert.deepEqual(prototypeEvidence(scene,'ultra',plan).facadeAuthority.facades[0].hostPackages,['structure']);
 plan.packages[0].editableComponents.push('main');plan.packages[1].editableComponents=[];
 assert.ok(!prototypeEvidence(scene,'ultra',plan).warnings.some(w=>w.code==='facade-host-outside-package'));
 assert.ok(!prototypeEvidence(scene,'ultra').facadeAuthority);
});

test('facade grid authority cannot be acquired by toggling allowOverwrite; scope feedback explains the actual distinction',()=>{
 const scene=storeyStudy(),base=compileScene(scene),before=hash(scene);
 const task={id:'skin',editableComponents:['panels'],regions:[{origin:[0,0,0],size:[40,24,40]}]};
 for(const permissions of [[],['main']]){
  const candidate=structuredClone(scene);Object.assign(candidate.components[1],{columns:{width:6,gap:2,count:'fit',align:'center'},allowOverwrite:permissions});
  const next=compileScene(candidate);
  assert.throws(()=>checkPackageGeometry(base,next,task,{},{}),error=>{
   const f=error.packageScopeFeedback;
   assert.match(error.message,/protected component main/);assert.equal(f.authority,'frozen-package-scope');
   assert.equal(f.scopeExpanded,false);assert.equal(f.canAuthorizePlacement,false);
   assert.match(f.interpretation,/allowOverwrite cannot expand/);assert.ok(f.groups.some(g=>g.before==='main'&&g.after==='panels'));
   assert.equal(assemblyCorrectionInput({critique:{feedback:{packageScopeFeedback:f}}}).critique.feedback.packageScopeFeedback,f);
   return true;
  });
 }
 assert.equal(hash(scene),before);assert.ok(PACKAGE_SPATIAL_EVIDENCE.startsWith(PACKAGE_SCOPE_EVIDENCE));
 const inScope=structuredClone(scene);inScope.components[1].glazing='black_glass';
 assert.ok(checkPackageGeometry(base,compileScene(inScope),task,{},{}).changedCells>0);
});
