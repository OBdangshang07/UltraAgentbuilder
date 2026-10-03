import {hash} from '../generation/compiler.mjs';
import {compileScene} from './compiler.mjs';
import {checkpointGeometryHash} from './checkpoint.mjs';
import {applyPrototypeExpansion,validatePrototypeExpansion} from '../../contracts/scene-prototype-expansion.mjs';

const encoded=values=>{const bytes=Buffer.alloc(values.length*2);for(let i=0;i<values.length;i++)bytes.writeUInt16LE(values[i],i*2);return bytes;};

function compiledIdentity(scene,compiled){
 const {assetHash,...metadata}=compiled.manifest??{},sourceHash=hash(scene),provenance=compiled.designSources;
 if(!compiled.cells||!compiled.sourceOwners||!compiled.scene||hash(compiled.scene)!==sourceHash||metadata.scene?.sourceHash!==sourceHash||assetHash!==hash(metadata)||!provenance||provenance.sourceHash!==sourceHash||hash(provenance)!==metadata.scene.sourcesHash||compiled.cells.length!==compiled.sourceOwners.length||hash(encoded(compiled.cells))!==metadata.cellsHash||hash(encoded(compiled.sourceOwners))!==metadata.scene.ownersHash)throw Error('Prototype seed asset/source/cells/provenance mismatch');
 if(provenance.diagnostics.some(d=>d.severity==='blocked'))throw Error('Rejected diagnostic geometry cannot prove a constructed seed');
 return {assetHash,metadata,sourceHash,provenance};
}

/** Use the actual saved seed compiled asset, not a replacement recompile.
 * A label, a future promise or a fully covered component is not a built seed.
 * This witness proves geometry/provenance only, NOT visual quality or access. */
export function prototypeSeedWitness(scene,program,compiled){
 validatePrototypeExpansion(scene,program);
 const {assetHash,metadata,sourceHash,provenance}=compiledIdentity(scene,compiled);
 const seeds=program.recipes.map(recipe=>{
  const bounds=provenance.componentBounds[recipe.component];
  if(!bounds?.length||bounds.length!==1)throw Error('Prototype witness requires exactly one actual seed instance');
  const solidCells=provenance.surviving[recipe.component]??0,clearCells=provenance.survivingClear[recipe.component]??0;
  if(!solidCells&&!clearCells)throw Error('Prototype seed has no surviving geometry or explicit clear cells');
  return {component:recipe.component,mode:recipe.mode,bounds:structuredClone(bounds[0]),solidCells,clearCells};
 });
 const data={version:1,sourceHash,seedAssetHash:assetHash,seedCellsHash:metadata.cellsHash,seedOwnersHash:metadata.scene.ownersHash,programHash:hash(program),geometryHash:checkpointGeometryHash(compiled),seeds,
  geometryVerified:true,visualQualityVerified:false,navigationCertified:false,canAuthorizePlacement:false};
 return {...data,witnessHash:hash(data)};
}

/** First construct the real seed geometry, with the normal compiler/quotas.
 * The Bridge must still render/review it before invoking the expansion step. */
export function preparePrototypeSeeds(scene,program){
 validatePrototypeExpansion(scene,program);
 const raw=compileScene(scene,{navigationPolicy:'review'}),{assetHash,...metadata}=raw.manifest;
 const diagnostic={...metadata,diagnosticOnly:true,prototypeSeedOnly:true};
 const seedCompiled={...raw,manifest:{...diagnostic,assetHash:hash(diagnostic)}};
 return {seedCompiled,witness:prototypeSeedWitness(scene,program,seedCompiled)};
}

/** After the separate visual gate, expand only explicitly declared recipes.
 * The original seed remains immutable. EVERY expanded instance is checked by
 * the ordinary compiler, including first/last, exceptional floors and owners.
 * Returned diagnostics are deliberately unplaceable until final assembly. */
export function expandPrototypeSeeds({scene,program,seedCompiled,witness}){
 const actual=prototypeSeedWitness(scene,program,seedCompiled);
 if(hash(actual)!==hash(witness))throw Error('Prototype expansion lacks the exact original seed witness');
 const expandedScene=applyPrototypeExpansion(scene,program),compiled=compileScene(expandedScene,{navigationPolicy:'review'}),geometryHash=checkpointGeometryHash(compiled);
 if(geometryHash===actual.geometryHash)throw Error('Prototype expansion made no actual geometry change');
 const {assetHash,...metadata}=compiled.manifest;
 const diagnostic={...metadata,diagnosticOnly:true,prototypeExpansionOnly:true};
 const diagnosticCompiled={...compiled,manifest:{...diagnostic,assetHash:hash(diagnostic)}};
 return {scene:expandedScene,compiled:diagnosticCompiled,evidence:prototypeExpansionWitness({scene,program,seedCompiled,witness,expandedCompiled:diagnosticCompiled})};
}

/** Bind compiler-worker outputs to the SAME immutable seed without compiling
 * a large building on the Bridge event loop or replacing its saved baseline. */
export function prototypeExpansionWitness({scene,program,seedCompiled,witness,expandedCompiled}){
 const actual=prototypeSeedWitness(scene,program,seedCompiled);
 if(hash(actual)!==hash(witness))throw Error('Prototype expansion lacks the exact original seed witness');
 const expandedScene=applyPrototypeExpansion(scene,program);
 compiledIdentity(expandedScene,expandedCompiled);
 const geometryHash=checkpointGeometryHash(expandedCompiled);
 if(geometryHash===actual.geometryHash)throw Error('Prototype expansion made no actual geometry change');
 const compiled=expandedCompiled;
 const data={version:1,seedSourceHash:hash(scene),expandedSourceHash:hash(expandedScene),seedAssetHash:seedCompiled.manifest.assetHash,programHash:hash(program),witnessHash:witness.witnessHash,
  expandedAssetHash:compiled.manifest.assetHash,expandedGeometryHash:geometryHash,fullCompilerChecked:true,canAuthorizePlacement:false,visualQualityVerified:false,navigationCertified:false,
  expansions:program.recipes.map(r=>({component:r.component,mode:r.mode,requestedRepetitions:r.count,
   verifiedRepetitions:r.mode==='repeat'?compiled.designSources.componentBounds[r.component].length:r.mode==='storeys'?compiled.designSources.parametricLayouts.find(l=>l.component===r.component).rows.length:expandedScene.components.find(c=>c.id===r.component).count[1],
   componentBoundsCount:compiled.designSources.componentBounds[r.component].length}))};
 return {...data,evidenceHash:hash(data)};
}
