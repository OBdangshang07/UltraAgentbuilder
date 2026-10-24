import {createReferenceAssemblyInputProtocol} from './reference-assembly-input-core.mjs';
import {coupledReferenceWorldAssemblyPreparation,verifyCoupledReferenceWorldAssemblySend,freezeCoupledReferenceWorldAssembly} from './coupled-reference-world-assembly-preparation.mjs';

// Canonical pixels -> ONE explicitly new coupled full SEND. No ordinary image
// or legacy v2 confirmation is created, copied or transferred into this lane.
const protocol=createReferenceAssemblyInputProtocol({purpose:'coupled-reference-world-assembly',version:1,
  inputFormat:'CoupledAssemblyReferenceInput',referencePreparationFormat:'CoupledAssemblyReferencePreparation',
  referenceBindingFormat:'CoupledAssemblyReferenceBinding',fullPreparationFormat:'CoupledReferenceWorldAssemblyPreparation',
  preparationBuilder:coupledReferenceWorldAssemblyPreparation,verifySend:verifyCoupledReferenceWorldAssemblySend,freezeArchive:freezeCoupledReferenceWorldAssembly});
export const prepareCoupledReferenceWorldAssemblyDraft=protocol.prepareDraft;
export const bindCoupledReferenceWorldAssemblyDraft=protocol.bindDraft;
export const validateCoupledAssemblyReferenceInput=protocol.validateInput;
export const readCoupledAssemblyReferenceInput=protocol.readInput;
