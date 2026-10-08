import fs from 'node:fs/promises';
import path from 'node:path';
import {ReferenceWorldAssemblyResources} from '../../bridge/reference-world-assembly-resources.mjs';
import {createReferenceWorldAssemblyJobRegistry} from '../../bridge/reference-world-assembly-job-registry.mjs';

// A separately OWNED, synthetic test process. It runs the actual reservation
// controller and real self-owner query, then pauses before request.json commits.
// No adapter, provider, image interpretation, game or world API is imported.
process.once('message',async input=>{
  const resources=new ReferenceWorldAssemblyResources({dataDir:input.dataDir});
  let registry;
  try {
    registry=await createReferenceWorldAssemblyJobRegistry({dataDir:input.dataDir,resources});
    const file=path.join(registry.root,input.request.referenceOwnerId,'request.json'),original=fs.open;
    fs.open=async function(target,...args) {
      if(target===file&&args[0]==='wx') {
        process.send({state:'before-original-request-commit',pid:process.pid});
        await new Promise(resolve=>process.once('message',message=>{if(message?.proceed===true)resolve();}));
      }
      return original.call(fs,target,...args);
    };
    await registry.reserve({request:input.request,selectedCapability:input.selectedCapability});
    process.send({state:'original-request-committed',pid:process.pid});
  }catch(error){process.send({state:'synthetic-process-rejected',message:error.message});}
  finally{await registry?.close();await resources.close();process.disconnect();}
});
