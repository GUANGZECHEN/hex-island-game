import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ACTION_PATHS, BOARD_BUILDING_PATHS, DESERT_PATH, DEVELOPMENT_PATHS, RESOURCE_PATHS, WOOL_ASSET, affordable, desertIcon, developmentChip, resourceChip, resourceIcon } from '../src/game/ui/icons.ts';

test('vector resources and common actions have distinct local SVG paths, with wool pinned to the S4 asset',()=>{
 assert.deepEqual(Object.keys(RESOURCE_PATHS).sort(),['brick','grain','lumber','ore']);
 assert.equal(new Set(Object.values(RESOURCE_PATHS)).size,4);assert.equal(WOOL_ASSET,'assets/wool-s4.png');assert.ok(DESERT_PATH.length>10);
 for(const name of ['dice','road','settlement','city','card','hand','trade','victory','end'] as const)assert.ok(ACTION_PATHS[name]);
 assert.deepEqual(Object.keys(DEVELOPMENT_PATHS).sort(),['invention','knight','monopoly','road-building','victory-point']);assert.equal(new Set(Object.values(DEVELOPMENT_PATHS)).size,5);
});
test('desert uses a local SVG icon',()=>{
 class Element { attributes=new Map<string,string>();children:Element[]=[];className='';setAttribute(k:string,v:string){this.attributes.set(k,v);}append(...items:Element[]){this.children.push(...items);} }
 const previous=globalThis.document;Object.assign(globalThis,{document:{createElementNS:()=>new Element()}});
 try{const svg=desertIcon() as unknown as Element;assert.equal(svg.attributes.get('data-terrain-icon'),'desert');}
 finally{Object.assign(globalThis,{document:previous});}
});
test('resource chips provide an accessible resource and count',()=>{
 class Element { attributes=new Map<string,string>();children:Element[]=[];textContent='';className='';tag:string;constructor(tag:string){this.tag=tag;}setAttribute(key:string,value:string){this.attributes.set(key,value);}append(...items:Element[]){this.children.push(...items);} }
 const previous=globalThis.document;Object.assign(globalThis,{document:{createElement:(tag:string)=>new Element(tag),createElementNS:(_ns:string,tag:string)=>new Element(tag)}});
 try {const chip=resourceChip('lumber',3) as unknown as Element;assert.equal(chip.attributes.get('role'),'img');assert.equal(chip.attributes.get('aria-label'),'lumber: 3');assert.equal(chip.children[0].attributes.get('data-resource-icon'),'lumber');assert.equal(chip.children[1].textContent,'3');}
 finally {Object.assign(globalThis,{document:previous});}
});
test('affordability checks all required resource quantities',()=>{
 const hand={lumber:1,brick:1,wool:0,grain:2,ore:3};
 assert.equal(affordable(hand,{lumber:1,brick:1}),true);assert.equal(affordable(hand,{wool:1}),false);assert.equal(affordable(hand,{grain:2,ore:3}),true);assert.equal(affordable(hand,{grain:3}),false);
});

test('development chips expose card type, count and new-card state',()=>{
 class Element { attributes=new Map<string,string>();children:Element[]=[];textContent='';className='';tag:string;constructor(tag:string){this.tag=tag;}setAttribute(key:string,value:string){this.attributes.set(key,value);}append(...items:Element[]){this.children.push(...items);} }
 const previous=globalThis.document;Object.assign(globalThis,{document:{createElement:(tag:string)=>new Element(tag),createElementNS:(_ns:string,tag:string)=>new Element(tag)}});
 try{const chip=developmentChip('knight',2,1) as unknown as Element;assert.equal(chip.attributes.get('role'),'img');assert.match(chip.attributes.get('aria-label')??'',/Knight: 2/);assert.equal(chip.children[0].attributes.get('data-development-icon'),'knight');assert.equal(chip.children[1].textContent,'2');assert.equal(chip.children[2].textContent,'1 new');}
 finally{Object.assign(globalThis,{document:previous});}
});


test('selected S4 sheep is the exact pinned image asset and B3 buildings remain local SVG artwork',()=>{
 assert.equal(WOOL_ASSET,'assets/wool-s4.png');
 const bytes=readFileSync(`public/${WOOL_ASSET}`);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'730f04eab45abe0532562dd4829b2c0719e9ff316516d2dcf594c9ba9768be8d');
 assert.deepEqual(Object.keys(BOARD_BUILDING_PATHS).sort(),['city','settlement']);
 for(const kind of ['settlement','city'] as const){
  assert.ok(BOARD_BUILDING_PATHS[kind].shell.length>10);
  assert.ok(BOARD_BUILDING_PATHS[kind].accent.length>5);
  assert.ok(BOARD_BUILDING_PATHS[kind].detail.length>5);
 }
 assert.notEqual(BOARD_BUILDING_PATHS.settlement.shell,BOARD_BUILDING_PATHS.city.shell);
});

test('wool icon embeds the S4 image asset instead of a hand-drawn path',()=>{
 class Element { attributes=new Map<string,string>();children:Element[]=[];className='';setAttribute(k:string,v:string){this.attributes.set(k,v);}append(...items:Element[]){this.children.push(...items);} }
 const previous=globalThis.document;Object.assign(globalThis,{document:{createElementNS:()=>new Element()}});
 try{
  const svg=resourceIcon('wool') as unknown as Element;
  assert.equal(svg.attributes.get('viewBox'),'0 0 56 51');
  assert.equal(svg.attributes.get('data-resource-icon'),'wool');
  assert.equal(svg.children.length,1);
  assert.equal(svg.children[0].attributes.get('href'),'assets/wool-s4.png');
 }
 finally{Object.assign(globalThis,{document:previous});}
});
