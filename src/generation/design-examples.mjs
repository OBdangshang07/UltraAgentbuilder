import {MATERIAL_ROLES} from '../../contracts/building-spec.schema.mjs';
export const designNode=(nodeId,op,origin,size,material='wall',blockState=null,repeat={count:1,step:[0,0,0]})=>({nodeId,op,origin,size,material,blockState,thickness:1,axis:'x',repeat,points:[]});
export function designPalette(overrides={}){const base={wall:'sandstone',floor:'spruce',roof:'deepslate_bricks',glass:'glass',lamp:'sea_lantern',beam:'dark_oak',trim:'smooth_sandstone',accent:'copper_block',frame:'dark_oak',foundation:'stone_bricks',paving:'smooth_stone',foliage:'leaves',furniture:'oak',metal:'black',door:'spruce_door',trapdoor:'spruce_trapdoor',stairs:'spruce_stairs',slab:'sandstone_slab',secondaryWall:'calcite',secondaryRoof:'polished_deepslate',secondaryGlass:'gray_glass',detail:'bricks'};return Object.fromEntries(MATERIAL_ROLES.map(role=>[role,overrides[role]??base[role]]));}
export function designExamples(){const n=designNode;const studies=[
 {schemaVersion:2,id:'terraced-courtyard-study',seed:12,units:'block',bounds:{width:34,height:15,length:30},palette:designPalette(),
 design:{style:'Warm courtyard modernism',concept:'Offset stone volumes frame a shaded terrace and planted entry.',silhouette:'Low wing beside a taller recessed pavilion; roof ledges extend beyond walls.',paletteIntent:'Warm sandstone, dark timber frames, pale inset plaster and restrained copper accents.',features:['Deep framed window bays','Overhanging upper roof','Slab-edged terrace','Timber shutters and a real paired door']},
 nodes:[n('site','box',[1,0,1],[32,1,28],'paving'),n('main','shell',[4,1,6],[18,9,16]),n('wing','shell',[21,1,13],[9,5,12],'secondaryWall'),n('upper-reveal','box',[3,10,5],[20,1,18],'trim'),n('upper-roof','box',[4,11,6],[18,1,16],'slab',{type:'bottom'}),n('wing-roof','box',[20,6,12],[11,1,14],'slab',{type:'top'}),n('door-clear','clear',[17,2,6],[1,2,1]),n('entry-door','door',[17,2,6],[1,2,1],'door',{facing:'north',hinge:'right',open:false}),n('entry-cover','box',[15,5,3],[5,1,4],'slab',{type:'bottom'}),n('terrace','box',[5,1,2],[9,1,4],'slab',{type:'top'}),n('plant-base','box',[25,1,4],[5,1,5],'foundation'),n('plant-crown','box',[26,2,5],[3,2,3],'foliage'),n('accent-band','box',[22,4,13],[7,1,1],'accent')],
 groups:[{id:'window-bay',size:[5,5,2],nodes:[n('cut','clear',[0,0,0],[5,5,2]),n('frame','windowFrame',[0,0,0],[5,5,1],'frame'),n('sill','box',[0,0,1],[5,1,1],'slab',{type:'top'}),n('shutter','box',[0,1,1],[1,3,1],'trapdoor',{facing:'west',half:'bottom',open:true})]}],
 instances:[{id:'front-bays',group:'window-bay',origin:[6,3,5],rotation:0,mirror:false,repeat:{count:2,step:[6,0,0]}},{id:'side-bay',group:'window-bay',origin:[20,3,10],rotation:1,mirror:true,repeat:{count:1,step:[0,0,0]}}],constraints:{interior:false,walkable:false,passages:[]}},
 {schemaVersion:2,id:'timber-teahouse-study',seed:13,units:'block',bounds:{width:29,height:14,length:25},palette:designPalette({wall:'white_terracotta',roof:'dark_oak',trim:'spruce',frame:'dark_oak',slab:'dark_oak_slab',stairs:'dark_oak_stairs',door:'dark_oak_door',trapdoor:'dark_oak_trapdoor',paving:'mossy_stone_bricks'}),
 design:{style:'Timber teahouse',concept:'A broad layered roof shelters an open veranda and framed entry.',silhouette:'Wide eaves with a narrow raised ridge above a low timber hall.',paletteIntent:'Dark roof and posts, warm timber floor, pale plaster, localized warm lamps.',features:['Layered roof with real stair eaves','Veranda and timber rhythm','Paired timber door','Contrasting mossy path and garden']},
 nodes:[n('platform','box',[3,0,3],[23,1,19],'foundation'),n('hall','shell',[6,1,7],[17,6,13]),n('deck','box',[4,1,3],[21,1,4],'floor'),n('posts','box',[4,2,4],[1,4,1],'beam',null,{count:6,step:[4,0,0]}),n('roof-low','box',[2,7,4],[25,1,19],'slab',{type:'bottom'}),n('roof-mid','box',[3,8,6],[23,1,15],'roof'),n('roof-high','box',[4,9,8],[21,1,11],'roof'),n('ridge','box',[3,10,12],[23,1,3],'slab',{type:'top'}),n('north-eave','box',[2,7,3],[25,1,1],'stairs',{facing:'south',half:'bottom',shape:'straight'}),n('south-eave','box',[2,7,23],[25,1,1],'stairs',{facing:'north',half:'bottom',shape:'straight'}),n('entry-open','clear',[13,2,7],[2,3,1]),n('door-left','door',[13,2,7],[1,2,1],'door',{facing:'north',hinge:'left',open:false}),n('door-right','door',[14,2,7],[1,2,1],'door',{facing:'north',hinge:'right',open:false}),n('entry-lamps','box',[11,4,6],[1,1,1],'lamp',null,{count:2,step:[5,0,0]}),n('path','box',[12,0,0],[4,1,3],'paving'),n('garden','box',[0,0,7],[3,1,12],'foliage')],groups:[],instances:[],constraints:{interior:false,walkable:false,passages:[]}}
 ];
 const modern=studies[0];modern.bounds.height=17;
 modern.nodes.push(
  n('roof-pavilion','shell',[9,12,12],[10,4,8],'secondaryWall'),n('pavilion-eave','box',[8,16,11],[12,1,10],'slab',{type:'bottom'}),
  n('pavilion-north','windowFrame',[11,13,12],[5,3,1],'frame'),n('pavilion-south','windowFrame',[11,13,19],[5,3,1],'frame'),
  n('wing-front','windowFrame',[23,2,13],[5,3,1],'frame'),n('wing-rear','windowFrame',[23,2,24],[5,3,1],'frame'),
  n('entry-post','box',[19,1,3],[1,4,1],'beam'),n('entry-lantern','box',[18,4,4],[1,1,1],'lamp'),
  n('pergola-posts','box',[5,2,2],[1,4,1],'beam',null,{count:2,step:[8,0,0]}),n('pergola-edge','box',[5,6,2],[9,1,1],'beam'),
  n('pergola-slats','box',[5,6,2],[1,1,4],'trapdoor',{half:'bottom',open:false,facing:'north'},{count:5,step:[2,0,0]}),
  n('rear-foundation','box',[3,1,22],[19,1,1],'trim'),n('rear-path','box',[4,0,24],[17,1,2],'foundation')
 );
 modern.instances.push({id:'rear-bays',group:'window-bay',origin:[6,3,21],rotation:2,mirror:false,repeat:{count:2,step:[6,0,0]}},{id:'west-bay',group:'window-bay',origin:[3,3,11],rotation:1,mirror:false,repeat:{count:1,step:[0,0,0]}});
 modern.design.silhouette='Three offset heights, a recessed rooftop pavilion, thin ledges and an open timber pergola.';
 modern.design.features.push('Recessed glazed rooftop pavilion','Open pergola over the front terrace','Framed openings on all main elevations');
 const tea=studies[1];tea.nodes.push(
  n('front-left-window','windowFrame',[7,2,7],[5,3,1],'frame'),n('front-right-window','windowFrame',[16,2,7],[5,3,1],'frame'),
  n('rear-left-window','windowFrame',[7,2,19],[5,3,1],'frame'),n('rear-right-window','windowFrame',[16,2,19],[5,3,1],'frame'),
  {...n('west-window','windowFrame',[6,2,11],[1,3,5],'frame'),axis:'z'},{...n('east-window','windowFrame',[22,2,11],[1,3,5],'frame'),axis:'z'},
  n('front-timber-band','box',[6,5,7],[17,1,1],'beam'),n('rear-timber-band','box',[6,5,19],[17,1,1],'beam'),
  n('west-timber-band','box',[6,5,7],[1,1,13],'beam'),n('east-timber-band','box',[22,5,7],[1,1,13],'beam'),
  n('rear-posts','box',[6,1,20],[1,5,1],'beam',null,{count:5,step:[4,0,0]}),
  n('ridge-west-cap','box',[3,11,12],[1,1,3],'stairs',{facing:'east',half:'top',shape:'straight'}),n('ridge-east-cap','box',[25,11,12],[1,1,3],'stairs',{facing:'west',half:'top',shape:'straight'}),
  n('entry-step','box',[12,0,2],[4,1,1],'slab',{type:'top'}),n('garden-stones','box',[1,1,8],[1,1,1],'foundation',null,{count:4,step:[0,0,3]})
 );
 return studies;}
