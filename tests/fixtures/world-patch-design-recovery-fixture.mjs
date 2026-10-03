import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareWorldPatchDesignInput} from '../../scripts/world-patch-design-input.mjs';
import {prepareWorldPatchDesignTask, confirmWorldPatchDesignTask} from '../../scripts/world-patch-design-task.mjs';
import {openWorldPatchDesignExperiment} from '../../scripts/world-patch-design-experiment.mjs';
import {patchTaskSnapshot, patchTaskIntent, patchTaskConfirmation, patchTaskProposal} from './world-patch-task-fixture.mjs';

// New isolated process with a FREE simulated provider. Exits without close to
// leave the original ownership lock and durable request for recovery tests.
const directory = path.resolve(process.argv[2]), mode = process.argv[3];
if (!process.send || !['bound-unknown', 'unbound-unknown', 'completed', 'missing-call'].includes(mode)) throw Error('Invalid owned recovery fixture');
const snapshot = patchTaskSnapshot(), input = prepareWorldPatchDesignInput(snapshot), task = prepareWorldPatchDesignTask(snapshot, input, patchTaskIntent());
const review = confirmWorldPatchDesignTask(snapshot, input, task, patchTaskConfirmation(task));
const send = {format: 'WorldPatchDesignExplicitSend', version: 1, confirmed: true, requestHash: task.requestHash,
  disclosureHash: task.disclosure.disclosureHash, promptSha256: task.request.promptSha256, maximumCalls: 1};
const binding = {version: 1, provider: 'codex', storage: 'persistent-single-turn', model: task.request.intent.model,
  effort: task.request.intent.effort, threadId: 'fixture-original-thread', turnId: 'fixture-original-turn', requestHash: 'c'.repeat(64)};
process.on('message', message => { if (message === 'exit-with-owned-lock-retained') process.exit(0); });
process.once('disconnect', () => process.exit(1));
setTimeout(() => process.exit(2), 55000).unref();
try {
  let simulatedCalls = 0;
  const experiment = await openWorldPatchDesignExperiment({directory, snapshot, task, review, recordOwnerProcess: true,
    adapter: {async generate(args) {
      simulatedCalls++;
      if (mode === 'completed') return {spec: patchTaskProposal(snapshot)};
      if (mode !== 'unbound-unknown') await args.onProviderBinding(binding);
      throw Error('Free fixture original receipt remains unknown');
    }}});
  const state = await experiment.dispatch(send);
  if (mode === 'missing-call') await fs.unlink(path.join(directory, 'assembly-journal/call-1.json'));
  process.send({result: 'passed', state: state.state, simulatedCalls, modelCalls: 0, worldWrites: 0,
    ...experiment.ownerProcessReference()});
} catch { process.send({result: 'failed'}); process.exitCode = 1; process.disconnect(); }
