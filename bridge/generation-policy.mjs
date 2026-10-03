import {BUILDING_LIMITS as LIMITS} from '../contracts/building-limits.mjs';
import {validateSceneScope} from '../src/design/revision.mjs';
import {validateFailedRepairRequest} from './failed-scene-repair.mjs';
import {checkpointPreflight} from './scene-checkpoints.mjs';
import {assemblyPreflight} from './quality-tiers.mjs';

export function outputBudget(value){
  if(value===undefined||value===null)return null; // Omit the SDK override; inherit Harness/model configuration.
  if(!Number.isSafeInteger(value)||value<1)throw new Error('自定义输出预算须为正整数，或留空跟随 Harness / 模型配置；尚未调用模型。');
  return value;
}
// Conservative recognition of explicit numeric heights; no implicit rescaling or building-template guess.
export function requestedHeight(prompt=''){
  const found=[];
  const unit='(?:米|公尺|格|方块|metres?|meters?|blocks?|m\\b)';
  const number='(\\d+(?:\\.\\d+)?)';
  for(const re of [new RegExp('(?:高度|楼高|楼体高|建筑高|高为|高达|高约|高|height\\s*[:=]?|tall\\s*[:=]?)\\s*'+number+'\\s*'+unit,'giu'),new RegExp(number+'\\s*'+unit+'\\s*(?:以上|高|tall|high|in height)','giu')]){
    for(const m of prompt.matchAll(re))found.push(Math.ceil(Number(m[1])));
  }
  return found.length?Math.max(...found):null;
}
// Only an explicit three-axis boundary. Ambiguous length/width/height prose is not guessed.
export function requestedBounds(prompt=''){
  const matches=[...prompt.matchAll(/(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)\s*(?:格|米|blocks?|m)?\s*(?:边界|范围|bounding\s+box|bounds)/giu)];
  if(matches.length!==1||/(?:长宽高|长[×x]宽[×x]高|长\s*×\s*宽\s*×\s*高)/u.test(prompt))return null;
  return Object.fromEntries(['width','height','length'].map((key,i)=>[key,Number(matches[0][i+1])]));
}
export function generationPreflight(input){
  if(['referenceUpload','referenceSet','referenceInput','referenceImages','referenceConfirmation','referencePreparationHash','userImages'].some(k=>Object.hasOwn(input,k)))
    throw new Error('User reference images require the versioned reference preparation workflow; image sending is not connected here, no model invoked');
  validateFailedRepairRequest(input);
  const checkpoints=checkpointPreflight(input);
  const assembly=assemblyPreflight(input);
  const local=!!(input.sample||input.spec||input.patch||input.scenePatch||input.importDirectory||input.revalidateJobId);
  const mode=input.generationMode??'single';
  if(!['single','layered','scene'].includes(mode))throw new Error('未知生成模式；尚未调用模型。');
  const repairs=input.maxRepairs??0;
  const navigationPolicy=input.navigationPolicy??'review';if(!['strict','review'].includes(navigationPolicy))throw new Error('Invalid navigation policy; no model was invoked');
  if(input.reviewImages!==undefined){if(input.agent!=='codex'||!input.baseJobId||!input.baseHash||!['single','scene'].includes(mode)||repairs!==0||local)throw new Error('视觉精修目前仅支持 Codex 的图像模型、已有建筑和单次调用（0 修复）');if(!Array.isArray(input.reviewImages)||input.reviewImages.length!==4)throw new Error('视觉精修须提供 4 个视角');}
  if(!Number.isInteger(repairs)||repairs<0||repairs>2)throw new Error('maxRepairs must be 0..2');
  if(mode==='layered'&&(local||input.baseJobId||repairs!==0))throw new Error('两阶段模式仅用于新建筑，自动修复预算须为 0；尚未调用模型。');
  if(mode==='scene'&&repairs!==0)throw new Error('实验设计层固定 0 自动修复；失败保留原始结果，额外精修须单独确认。');
  if(input.scenePatch&&(mode!=='scene'||!input.baseJobId||!input.baseHash))throw new Error('ScenePatch requires an explicit scene base revision');
  if(mode==='scene'&&input.baseJobId)validateSceneScope(input.sceneScope);
  if(input.sceneScope&&mode!=='scene')throw new Error('Scene revision scope requires scene mode');
  if(input.maxOutputTokens!==undefined&&input.agent!=='deepseek')throw new Error('显式输出预算目前仅适用于 DeepSeek Harness；尚未调用模型。');
  const budget=input.agent==='deepseek'?outputBudget(input.maxOutputTokens):null;
  if(!local&&(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000))throw new Error('请输入 1..16000 字符的建筑描述；尚未调用模型。');
  const height=local||input.repairJobId?null:requestedHeight(input.prompt);
  const maximumBounds=local||input.repairJobId?null:requestedBounds(input.prompt);
  if(maximumBounds){
    for(const k of ['width','height','length'])if(!Number.isSafeInteger(maximumBounds[k])||maximumBounds[k]<1||maximumBounds[k]>LIMITS[k])throw new Error(`请求的 X/Y/Z 边界超出当前 ${LIMITS.width}×${LIMITS.height}×${LIMITS.length} 格限制；尚未调用模型。`);
    if(maximumBounds.width*maximumBounds.height*maximumBounds.length>LIMITS.cells)throw new Error('请求边界体积超过当前资产限制；尚未调用模型，不自动缩小。');
    if(height!==null&&height>maximumBounds.height)throw new Error('请求的实际高度超过给定 X/Y/Z 边界的 Y 高度；请先澄清尺寸，尚未调用模型。');
  }
  if(height!==null&&(height<1||height>LIMITS.height))throw new Error(`请求高度 ${height} 格超出当前 1..${LIMITS.height} 格上限；未缩放、未裁剪、尚未调用模型。`);
  const world=input.worldHeight;
  if(world!==undefined&&(!Number.isInteger(world)||world<1||world>4096))throw new Error('Invalid world height; no model was invoked');
  if(height!==null&&world!==undefined&&height>world)throw new Error(`请求高度 ${height} 格超过当前维度总高度 ${world} 格；请选择其他维度或明确调整要求。尚未调用模型。`);
  const maximumCalls=assembly?.maximumCalls??checkpoints?.maximumCalls??(local?0:mode==='layered'?2:1+repairs);
  return {...(assembly?{assembly}:{}),mode,navigationPolicy,minimumHeight:height,maximumBounds,worldHeight:world??null,maxOutputTokens:budget,budgetSource:budget===null?'agent-default':'custom',maximumCalls,totalOutputTokenLimit:budget!==null&&Number.isSafeInteger(budget*maximumCalls)?budget*maximumCalls:null,limits:LIMITS,
    ...(checkpoints?{checkpoints}:{}),warnings:[...(maximumBounds?[`识别最大边界 X×Y×Z＝${maximumBounds.width}×${maximumBounds.height}×${maximumBounds.length} 格；第二个数是高度，不自动交换长高。`]:[]),...(height>128?['高楼按 1 格＝1 米生成；采用重复楼层压缩结构。世界内可放置的锚点还需满足顶/底高度限制。']:[]),...(mode==='layered'?['两阶段最多调用 2 次模型：外壳 → 内饰与楼梯。任一阶段失败立即停止，不自动续写或重试。']:[]),...(checkpoints?[`设计检查点最多 ${maximumCalls} 次底层模型调用，包含布局、细化及预算内纠错；不是 1 次调用。中间稿不可建造；取消/中断不重发。`]:[]),...(assembly?[`组件化 ${assembly.id} 最多 ${maximumCalls} 次底层调用，包含总纲、制作、纠错、文本复核及精修；不要求花满，不是图像审美认证。未完成中间稿不可建造；预算用尽时可能仍有待复核意见。`]:[]),'数字高度预检只识别明确的米/格高度表达；最终几何仍须严格校验。']};
}
export function validateRequestedHeight(compiled,policy){
  if(policy?.maximumBounds)for(const k of ['width','height','length'])if(compiled.manifest.dimensions[k]>policy.maximumBounds[k])throw new Error(`生成边界 ${k}=${compiled.manifest.dimensions[k]} 超过请求的 ${policy.maximumBounds[k]}；不自动换轴、缩放或裁剪。`);
  const target=policy?.minimumHeight;if(!target)return;
  const {width,height,length}=compiled.manifest.dimensions;
  let bottom=height,top=-1;
  for(let i=0;i<compiled.cells.length;i++)if(compiled.cells[i]>=2){const y=Math.floor(i/(width*length));bottom=Math.min(bottom,y);top=Math.max(top,y);}
  const actual=top<0?0:top-bottom+1;
  if(actual<target)throw new Error(`实际建筑高度 ${actual} 格低于请求的至少 ${target} 格；拒绝静默缩小或用空白边界冒充高度。`);
}
