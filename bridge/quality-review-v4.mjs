import {hash} from '../src/generation/compiler.mjs';
import {schemaFeedback} from '../contracts/schema-feedback.mjs';
import {assemblyReviewSchema,validateAssemblyReview} from '../contracts/scene-assembly.schema.mjs';
import {conceptReviewSchema,validateConceptReview} from './assembly-design-review.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:1200};
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,47}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const list=(items,maxItems=16)=>({type:'array',items,maxItems});
const views=list({type:'integer',minimum:0,maximum:7},8);
const proof={evidence:text,views,components:list(id,8)};
const comparison=object({evidenceHash:digest,beforeSourceHash:digest,afterSourceHash:digest,
  verdict:{type:'string',enum:['improved','equivalent','mixed','regressed']},
  gains:list(object({criterion:text,...proof}),8),losses:list(object({criterion:text,...proof}),8),
  tradeoffs:list(object({factId:text,...proof}),16)});

function extended(base){
  const schema=structuredClone(base),criteria=schema.properties.issues.items.properties.criterion.enum;
  schema.properties.version.enum=[2];schema.properties.issues.items.properties.id=id;schema.properties.issues.items.required.unshift('id');
  Object.assign(schema.properties,{
    findings:list(object({criterion:{type:'string',enum:criteria},status:{type:'string',enum:['strong','adequate','weak','unseen']},...proof}),criteria.length),
    previousIssues:list(object({id,status:{type:'string',enum:['resolved','unresolved','outside-coverage']},...proof}),16),
    comparison:{anyOf:[{type:'null'},comparison]}
  });
  schema.required.push('findings','previousIssues','comparison');return schema;
}
export const conceptReviewSchemaV4=extended(conceptReviewSchema);
export const assemblyReviewSchemaV4=extended(assemblyReviewSchema);

function resolutionScope(previousReview){
  const required=new Map((previousReview?.issues??[]).map(issue=>[issue.id,issue]));
  // These IDs come only from the immediately preceding VALIDATED review, not
  // arbitrary review prose, a rejected response or a model-chosen alias.
  const retainedResolved=new Set((previousReview?.previousIssues??[])
    .filter(issue=>issue.status==='resolved'&&!required.has(issue.id)).map(issue=>issue.id));
  return {required,known:new Set([...required.keys(),...retainedResolved])};
}
export function qualityReviewSchemaV4({concept=false,previousReview=null}={}){
  const schema=structuredClone(concept?conceptReviewSchemaV4:assemblyReviewSchemaV4),{required,known}=resolutionScope(previousReview);
  const resolutions=schema.properties.previousIssues;
  resolutions.minItems=required.size;
  // The base schema shares the generic ID object with component-ID fields.
  // Detach just this property; never restrict component evidence to issue IDs.
  if(known.size)resolutions.items.properties.id={...resolutions.items.properties.id,enum:[...known]};else resolutions.maxItems=0;
  return schema;
}

/** Enforces evidence identities and consistency of the reviewer's claims.
 * It cannot decide aesthetics. A model still must assess the actual pictures. */
export function validateQualityReviewV4(response,{scene,visualScene=scene,plan,evidence,previousReview=null,measurements=null,concept=false}){
  const schema=qualityReviewSchemaV4({concept,previousReview}),contract=schemaFeedback(response,schema);
  if(!contract.valid)throw new Error('Quality review contract: '+contract.issues.map(i=>i.path+': '+i.code).join('; '));
  const {findings,previousIssues,comparison,...legacy}=response;
  legacy.version=1;legacy.issues=legacy.issues.map(({id,...issue})=>issue);
  if(concept)validateConceptReview(legacy,plan,evidence);else validateAssemblyReview(legacy,scene,plan);
  const currentVisualHash=hash(visualScene),expansion=evidence.prototypeExpansion;
  if(currentVisualHash!==hash(scene)&&(!concept||expansion?.version!==2||expansion.reviewSubject!=='expanded'||expansion.seedSourceHash!==hash(scene)||expansion.expandedSourceHash!==currentVisualHash||expansion.expandedAssetHash!==evidence.assetHash||expansion.seedOnly!==false||expansion.expandedPixelsSupplied!==true))throw new Error('Quality review expansion differs from its editable seed');
  if(evidence.sourceHash!==currentVisualHash)throw new Error('Quality review evidence does not describe the current scene');
  const components=new Set(scene.components.map(c=>c.id)),historicalComponents=new Set([...components,...(measurements?.changedComponents??[]).filter(c=>c.change==='removed').map(c=>c.id)]),issueIds=new Set();
  for(const issue of response.issues){if(issueIds.has(issue.id))throw new Error('Duplicate quality issue ID');issueIds.add(issue.id);}
  const checkProof=(item,currentOnly=false)=>{
    if(new Set(item.views).size!==item.views.length||item.views.some(i=>!evidence.views[i]||currentOnly&&evidence.kind==='native-revision'&&evidence.views[i].subjectId!=='after'))throw new Error('Review cites missing or historical current-view evidence');
    const allowed=currentOnly?components:historicalComponents;
    if(new Set(item.components).size!==item.components.length||item.components.some(id=>!allowed.has(id)))throw new Error('Review cites absent current component');
    if(!item.views.length&&!item.components.length)throw new Error('Review claim lacks image or source evidence');
  };
  const criteria=schema.properties.issues.items.properties.criterion.enum,found=new Set();
  for(const finding of findings){
    if(found.has(finding.criterion))throw new Error('Duplicate review criterion');found.add(finding.criterion);
    if(finding.status!=='unseen')checkProof(finding,true);
    else if(finding.views.length||finding.components.length)checkProof(finding,true);
    if(response.verdict==='accept'&&finding.status==='weak')throw new Error('Acceptance contradicts a weak architectural finding');
  }
  if(found.size!==criteria.length)throw new Error('Missing architectural review criterion');
  if(response.verdict==='accept'&&findings.every(f=>f.status==='unseen'))throw new Error('Acceptance lacks any observed architectural criterion');
  const {required:expected,known}=resolutionScope(previousReview),resolved=new Set();
  for(const resolution of previousIssues){
    if(!known.has(resolution.id)||resolved.has(resolution.id))throw new Error('Unknown or duplicate previous issue resolution');resolved.add(resolution.id);
    if(resolution.status==='resolved')checkProof(resolution,true);
    else if(!issueIds.has(resolution.id))throw new Error('Unresolved previous issue was dropped');
    if(resolution.status==='resolved'&&issueIds.has(resolution.id))throw new Error('Resolved issue is still marked actionable');
  }
  if([...expected.keys()].some(id=>!resolved.has(id)))throw new Error('Previous issues lack explicit resolution');
  if(evidence.kind!=='native-revision'){
    if(comparison!==null||measurements!==null)throw new Error('Review invented a before/after comparison');
  }else{
    const [before,after]=evidence.subjects;
    if(before?.id!=='before'||after?.id!=='after'||after.sourceHash!==currentVisualHash||!comparison||comparison.evidenceHash!==evidence.evidenceHash||comparison.beforeSourceHash!==before.sourceHash||comparison.afterSourceHash!==after.sourceHash||!measurements||measurements.beforeSourceHash!==before.sourceHash||measurements.afterSourceHash!==currentVisualHash)throw new Error('Review comparison identity mismatch');
    for(const item of [...comparison.gains,...comparison.losses,...comparison.tradeoffs])checkProof(item);
    if(comparison.verdict==='improved'&&!comparison.gains.length)throw new Error('Improvement claimed without evidence');
    if(comparison.verdict==='regressed'&&!comparison.losses.length)throw new Error('Regression claimed without evidence');
    if(response.verdict==='accept'&&comparison.verdict==='regressed')throw new Error('Acceptance contradicts regression');
    const facts=new Set(measurements.facadeChanges.map(f=>f.id)),explained=new Set();
    for(const item of comparison.tradeoffs){if(!facts.has(item.factId)||explained.has(item.factId))throw new Error('Unknown or duplicate design tradeoff');explained.add(item.factId);}
    if(measurements.requiredTradeoffFacts.some(id=>!explained.has(id)))throw new Error('Reduced openings or changed glazing lack a tradeoff explanation');
  }
  return response;
}

export const QUALITY_V4_REVIEW_RULES=`QUALITY V4: return review version=2 with a finding for EVERY schema criterion. Evaluate actual current geometry: strong/adequate/weak/unseen, citing current image indices or existing source component IDs. A small material change, more components, a successful compile or renamed design prose is not architectural improvement. Keep the original user brief and selected design goals authoritative; do not justify an accidental loss after the fact by inventing a new design intention.
Every actionable issue has a stable unique id. For EVERY issue in previousReview.issues, provide previousIssues with resolved/unresolved/outside-coverage and concrete evidence. You MAY additionally restate previously resolved IDs from previousReview.previousIssues, but only with current image/source evidence and a consistent current status; this does not replace any required outstanding issue. The response schema lists the exact allowed IDs. Do not invent aliases or repeat an ID. With no prior review, previousIssues must be empty. Unresolved/outside-coverage issues retain the SAME id in issues; absence from a new summary does not resolve them. Do not reject merely because conservative stairs/navigation remain unverified.
When designEvidence.kind=native-revision, attachments are interleaved BEFORE then AFTER in each pair. BEFORE is historical and AFTER is current. Compare the same crop/camera. comparison binds this exact evidenceHash and both source hashes, states improved/equivalent/mixed/regressed, and identifies gains AND losses. Explicitly explain every revisionMeasurements.requiredTradeoffFacts item using its factId. Nominal aperture counts are not measured whole-building glass ratios and are never a universal style requirement. Intentional masonry can be excellent; accidental thinning of openings or removal of a feature needs concrete design reasoning and image/source evidence.
When there is no paired evidence, comparison=null; do not claim to have seen a prior asset. Unseen areas need an honest coverage statement. verdict=accept cannot coexist with weak findings, unresolved issues or a regressed comparison. Final review checks completed room functions, furniture relationships, facade/corner/entry/crown and real core interfaces. This contract verifies evidence and consistency, not aesthetic truth or building-code certification.`;
