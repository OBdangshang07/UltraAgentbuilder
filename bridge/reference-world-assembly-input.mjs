import {createReferenceAssemblyInputProtocol} from './reference-assembly-input-core.mjs';
import {referenceWorldAssemblyPreparation,verifyReferenceWorldAssemblySend,freezeReferenceWorldAssembly} from './reference-world-assembly.mjs';

// Legacy full v2 bytes and independent consent remain unchanged.
const protocol=createReferenceAssemblyInputProtocol({purpose:'reference-world-assembly',version:2,
  inputFormat:'JointAssemblyReferenceInput',referencePreparationFormat:'JointAssemblyReferencePreparation',
  referenceBindingFormat:'JointAssemblyReferenceBinding',fullPreparationFormat:'ReferenceWorldAssemblyPreparation',
  preparationBuilder:referenceWorldAssemblyPreparation,verifySend:verifyReferenceWorldAssemblySend,freezeArchive:freezeReferenceWorldAssembly});
export const prepareReferenceWorldAssemblyDraft=protocol.prepareDraft;
export const bindReferenceWorldAssemblyDraft=protocol.bindDraft;
export const validateJointAssemblyReferenceInput=protocol.validateInput;
export const readJointAssemblyReferenceInput=protocol.readInput;
