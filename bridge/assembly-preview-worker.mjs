import {parentPort,workerData} from 'node:worker_threads';
import {renderOccupancyViews} from '../src/design/occupancy-preview.mjs';
try{parentPort.postMessage({ok:true,evidence:await renderOccupancyViews(workerData.directory,workerData.expected,workerData.out)});}
catch(error){parentPort.postMessage({ok:false,error:error.message});}
