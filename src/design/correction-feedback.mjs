import {hash} from '../generation/compiler.mjs';
import {designWorkspaceCapacity,stagedDesignAllocationEnabled} from '../../contracts/scene-design-allocation.mjs';

// Exact, inert failure evidence, never an adopted/candidate-local baseline.
// Keep the complete wrapper so a rejected edit cannot lose its recipe changes.
export function unapprovedPrototypeProposal(response){
  return {version:1,response:structuredClone(response),responseHash:hash(response),approved:false,canAuthorizePlacement:false,
    interpretation:'Complete preserved rejected response, including its recipes. This is unapproved failure evidence, not the accepted plan/program and not automatic adoption. Bind your new answer to the current input planHash/sourceHash/prototypeProgramHash, not identities inside this rejected wrapper. Recipes in the new answer are a complete replacement list. Retain intended valid changes only through an explicit proposal passing all original checks; no permissions, calls or world authority are added.'};
}

// Only transform compiler-owned feedback, never arbitrary source/design data.
// Full samples remain in feedback.json; calls receive bounded, all-component
// groups so a repeated error cannot bury unrelated components in the prompt.
export function correctionFeedback(report){
  if(!report?.constructionFeedback?.issueGroups)return report;
  const {issueGroups,groupsTruncated,issues,truncated,...construction}=report.constructionFeedback;
  // A complete arithmetic pass can otherwise repeat the same warnings and
  // representative coordinates dozens of times, drowning the actual conflicts.
  // Keep every component, exception-height band and first/last floor. Never
  // condense an incomplete/error report into a positive summary.
  const passed=construction.status==='passed'&&construction.checksComplete===true&&construction.issueCount===0&&issueGroups.length===0&&!groupsTruncated&&!truncated&&construction.canAuthorizePlacement===false&&construction.parametricLayouts?.every(l=>l.checksComplete===true&&l.canAuthorizePlacement===false);
  const layouts=construction.parametricLayouts?.map(({rows,representatives,...layout})=>passed?{
    component:layout.component,host:layout.host,...(layout.floorSource?{floorSource:layout.floorSource}:{}),rule:layout.rule,
    ...(layout.columns?{columns:layout.columns}:{}),floorCount:rows.length,firstFloor:rows[0],
    ...(rows.length>1?{lastFloor:rows.at(-1)}:{lastFloorSameAsFirst:true}),rowBands:layout.rowBands,
    ...(layout.expandedInstanceChecks!==undefined?{expandedInstanceChecks:layout.expandedInstanceChecks}:{}),
    ...(layout.expandedPanelChecks!==undefined?{expandedPanelChecks:layout.expandedPanelChecks}:{}),
    representativeChecks:layout.representativeChecks,checksComplete:layout.checksComplete,canAuthorizePlacement:layout.canAuthorizePlacement,
  }:{...layout,floorCount:rows.length,firstFloor:rows[0],lastFloor:rows.at(-1),representativeSamples:representatives.slice(0,4),representativeSamplesTruncated:representatives.length>4,
    interpretation:'Full rows/representatives are retained in canonical feedback. rowBands are deterministic compressed placement rules, not permission to skip full-scene checks.'});
  return {...report,constructionFeedback:{...construction,...(layouts?{parametricLayouts:layouts}:{}),issues:issueGroups,
    ...(passed?{parametricLayoutFormat:'complete-arithmetic-pass-summaries',parametricLayoutLimitations:[...new Set(construction.parametricLayouts.flatMap(l=>l.limitations??[]))],parametricLayoutInterpretation:'All component IDs, expanded check counts, first/last floors and exceptional rowBands retained. Repeated representative samples and prose omitted ONLY after complete arithmetic checks. Full evidence remains in canonical feedback.json. Source rules remain authoritative. This is not a geometry, ownership, navigation or placement pass.'}:{}),
    issueFormat:'component-rule-groups',truncated:groupsTruncated,rawSamplesTruncated:truncated,
    interpretation:'occurrences counts checks, not distinct cells. panelIndexRange is an inclusive bounding range, NOT a list to delete/exclude; inspect the explicit rhythm and exclusions. First/last panel and violations are evidence, not an automatic repair.'}};
}

export const PACKAGE_SCOPE_EVIDENCE='FROZEN PACKAGE AUTHORITY: packageScopeFeedback protected-owner/outside-region is NOT an ordinary scene overlap error. allowOverwrite cannot expand frozen package ownership or regions, and toggling it does not repair a scope conflict. A hosted facade implicitly intersects its host in scene compilation, but that does not grant this package permission to cut new host-owned cells. Changing panel width/gap/alignment can move openings into protected piers even if the facade ID is editable. Compare the accepted component rules and actual owner map with the candidate: change the geometry that crosses the frozen boundary, preserving protected cells and owners. Do not claim the host, change regions, or erase requested features to bypass the check. Valid in-scope design changes still require the full compiler and scope check; no automatic repair is supplied.';
export const PACKAGE_SPATIAL_EVIDENCE=PACKAGE_SCOPE_EVIDENCE+'\npackageSpatialFeedback, when present, is a bounded WORLD-coordinate material/owner map around reported conflicts. Decode rows with its legend and run lengths. Compare accepted and candidate layers before choosing a position: the candidate producer can hide the previous wall, planter or protected air. producerBoundsSamples resolve selected repeated instances, not just at.offset. Inspect the next elevation too: a clear base cell does not imply an empty full-height column. Check the FULL volume of EVERY repeat and package regions; unshown cells are unknown, KEEP is not verified air, and maps never authorize overwrites. This read-only evidence proposes no automatic repair and does not waive strict whole-scene checks.';

export function assemblyCorrectionInput(input){
  // Derived guidance is part of the original model input. Recovery metadata
  // must remain the final suffix, exactly as the controller approved it;
  // inserting capacity guidance after that suffix changes prompt bytes even
  // when the objects have the same canonical hash. No field is discarded.
  const {providerRetryOf,providerRecovery,...original}=input;
  const workspaceCapacity=input.priorPlan?.packages&&input.tier?.prototypes&&stagedDesignAllocationEnabled(input.tier)?designWorkspaceCapacity(input.priorPlan):null;
  const repairRequirement=input.repairBase&&input.critique?.feedback?.geometryPassed===false?{
    status:'rejected-candidate-must-change',acceptedSourceHash:input.sourceHash,candidateHash:input.repairBase.candidateHash,
    feedbackRoles:{feedback:'Last accepted source only; not an approval of repairBase.scene.',critique:'Rejected candidate errors; these are the current repair target.'},
    error:input.critique.feedback.error??null,
    interpretation:'Return a nonempty delta fixing the actual candidate error producers within the original task. Empty arrays everywhere retain the same failed building. A construction arithmetic pass is not an ownership/geometry pass; navigation warnings remain separately advisory. Preserve required features, other owners and full-scale geometry. No automatic movement, deletion, overwrite permission or new calls are granted.',
    canAuthorizePlacement:false,
  }:null;
  return {...(repairRequirement?{repairRequirement}:{}),...original,
    ...(workspaceCapacity?{designWorkspaceCapacity:workspaceCapacity}:{}),
    ...(input.prior?.feedback?.candidates?{prior:{...input.prior,feedback:{...input.prior.feedback,candidates:input.prior.feedback.candidates.map(c=>c.feedback?{...c,feedback:correctionFeedback(c.feedback)}:c)}}}:{}),
    // Decomposed role corrections carry the rejected report under prior.
    // Apply the SAME compiler-owned feedback summary, preserving the whole
    // rejected response/recipes and failed scope/navigation evidence. The
    // canonical input and feedback files remain unchanged; never adopt prior.
    ...(input.prior?.feedback&&!input.prior.feedback.candidates?{prior:{...input.prior,feedback:correctionFeedback(input.prior.feedback)}}:{}),
    ...(input.feedback?{feedback:correctionFeedback(input.feedback)}:{}),
    ...(input.contractFeedback?{contractFeedback:correctionFeedback(input.contractFeedback)}:{}),
    ...(input.critique?.feedback?{critique:{...input.critique,feedback:correctionFeedback(input.critique.feedback)}}:{}),
    ...(Object.hasOwn(input,'providerRetryOf')?{providerRetryOf}:{}),
    ...(Object.hasOwn(input,'providerRecovery')?{providerRecovery}:{})};
}

export const CORRECTION_EVIDENCE=`ENGINEERING FEEDBACK: constructionFeedback.issues groups repeated violations by component/rule/edge. Check every group, not only the first raw error. U is the horizontal panel coordinate; Y is vertical. margin <= startU and startU+(columns-1)*stepU+panelWidth <= hostSpan-margin (for nonexcluded panels). panelIndexRange is only a bounding range, not authority to remove every panel in it. Supplemental ownership may omit INVALID rectangular panels while retaining valid panels, entries and later details. Read its omissions/error/truncation and notChecked fields: every supplemental conflict is conditional until the FULL unchanged design is strictly recompiled. Never copy these audit omissions into the design to silence errors. Ownership firstWrite distinguishes clearing a solid from placing into a protected volume; bounds include all reported writes, not permission to erase that box. Resolve accidental intersections by deliberate placement/rhythm changes; authorize only intended receiving owners. Paths clear air ABOVE their paving. Entry frames, lintels, thresholds and canopies occupy space beyond the door leaves. Keep light fixtures out of door lintels and facade sills out of entrance head clearance. Scope and world-write protections are unchanged.`;
