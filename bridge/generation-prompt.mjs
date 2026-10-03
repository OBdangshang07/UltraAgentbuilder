import fs from 'node:fs/promises';
import {compileSpec} from '../src/generation/compiler.mjs';
import {generatorExamples} from '../src/generation/generator-examples.mjs';
import {designExamples} from '../src/generation/design-examples.mjs';
export async function generationInstructions(){
  const rules=await fs.readFile(new URL('../prompts/building-v1.md',import.meta.url),'utf8');
  const examples=generatorExamples();
  for(const example of examples){const c=compileSpec(example);if(c.manifest.quality.navigation!=='verified')throw new Error('Generator teaching example failed strict navigation');}
  const designs=designExamples();for(const design of designs)compileSpec(design,{navigationPolicy:'review'});
  return rules+'\n\nDESIGN STUDIES (v2):\n'+JSON.stringify(designs)+'\nThese are geometry/state-checked design studies, NOT navigation-certified or user-selected templates. Follow material/depth/composition relationships, invent the requested architecture.\n\nVERIFIED TEACHING EXAMPLES (v1 circulation syntax subset; emit v2 with design, groups, instances and blockState):\n'+JSON.stringify(examples)+'\nExample 1 puts the passage at feet Y=1 above floor Y=0 and explicitly clears the wall. Example 2 aligns repeated slabs, slab openings and hollow box treads, reaching feet Y=13 on floor Y=12. Solid stair volumes repeated directly above themselves can block the preceding flight headroom; hollow box treads avoid that overlap. Adapt these construction relationships, not the entire building. The checker has already verified both examples locally.\n';
}
