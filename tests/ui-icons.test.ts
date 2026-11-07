import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_PATHS, RESOURCE_PATHS, affordable, resourceChip } from '../src/game/ui/icons.ts';

test('the five resources and common actions have distinct local SVG paths',()=>{
 assert.deepEqual(Object.keys(RESOURCE_PATHS).sort(),['brick','grain','lumber','ore','wool']);
 assert.equal(new Set(Object.values(RESOURCE_PATHS)).size,5);
 for(const name of ['dice','road','settlement','city','card','hand','trade','end'] as const)assert.ok(ACTION_PATHS[name]);
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
