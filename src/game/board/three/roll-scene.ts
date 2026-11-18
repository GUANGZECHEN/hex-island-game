import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RESOURCE_PATHS } from '../../ui/icons.ts';
import type { Resource } from '../../rules/state.ts';
import type { RollPresentation } from './roll-presentation.ts';

export const DICE_LANDING_MS = 1150;
export const DICE_END_MS = 2450;

const UP = new THREE.Vector3(0, 1, 0);
const FACE_NORMALS: Readonly<Record<number, THREE.Vector3>> = {
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(1, 0, 0), 4: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 0, 1), 5: new THREE.Vector3(0, 0, -1),
};
const PIPS: Readonly<Record<number, readonly (readonly [number,number])[]>> = {
  1: [[0,0]],
  2: [[-1,-1],[1,1]],
  3: [[-1,-1],[0,0],[1,1]],
  4: [[-1,-1],[-1,1],[1,-1],[1,1]],
  5: [[-1,-1],[-1,1],[0,0],[1,-1],[1,1]],
  6: [[-1,-1],[-1,0],[-1,1],[1,-1],[1,0],[1,1]],
};
const RESOURCE_COLORS: Record<Resource,string> = {
  lumber:'#247a4b', brick:'#c0654a', wool:'#83a34b', grain:'#d3a22e', ore:'#668592',
};
const clamp = (t:number)=>Math.max(0,Math.min(1,t));
const smooth = (t:number)=>{const x=clamp(t);return x*x*(3-2*x);};

/** Actual face normal must point upward at rest (opposing faces sum to seven). */
export function dieRestQuaternion(value:number, yaw=0):THREE.Quaternion {
  const normal=FACE_NORMALS[value];
  if(!normal)throw new Error('Die face must be 1–6.');
  return new THREE.Quaternion().setFromAxisAngle(UP,yaw)
    .multiply(new THREE.Quaternion().setFromUnitVectors(normal,UP));
}

export function visibleTopFace(quaternion:THREE.Quaternion):number {
  let best=0,angle=-Infinity;
  for(const [value,normal] of Object.entries(FACE_NORMALS)){
    const dot=normal.clone().applyQuaternion(quaternion).dot(UP);
    if(dot>angle){angle=dot;best=Number(value);}
  }
  return best;
}

export function diceFlight(elapsed:number,index:number,face:number) {
  const t=clamp(elapsed/DICE_LANDING_MS);
  const finishX=index===0?-.67:.67;
  const startX=index===0?-1.52:1.56;
  const endZ=index===0?-.14:.24;
  const x=finishX+(startX-finishX)*(1-t)**2;
  const z=endZ+(1-t)*.30*Math.sin(index+1.5);
  // Two decreasing bounces, then a stable tabletop rest height.
  const y=.43+1.62*(1-t)**3 + .23*Math.abs(Math.sin(t*3.2*Math.PI))*(1-t);
  const yaw=(face*.29+index*.64);
  const rest=dieRestQuaternion(face,yaw);
  const rollAt=(p:number)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(
    .50+(index+1)*.39+p*9.2,
    .18+face*.22+p*11.7,
    .31+p*8.9, 'XYZ',
  ));
  const last=.70;
  const rotation=t<=last?rollAt(t):rollAt(last).slerp(rest,smooth((t-last)/(1-last)));
  if(t===1)rotation.copy(rest);
  return {x,y,z,rotation};
}

type TextureSprite = {sprite:THREE.Sprite; baseY:number; material:THREE.SpriteMaterial; texture:THREE.CanvasTexture};

/** Independent, disposable presentation layer. It is never part of the static board key. */
export class BoardDiceScene {
  readonly root=new THREE.Group();
  private dice: [THREE.Group,THREE.Group];
  private cubeGeometry=new RoundedBoxGeometry(.49,.49,.49,4,.055);
  private pipGeometry=new THREE.SphereGeometry(.025,10,8);
  private bodyMaterial=new THREE.MeshStandardMaterial({color:'#fff5de',roughness:.39,metalness:.03});
  private pipMaterial=new THREE.MeshStandardMaterial({color:'#24312d',roughness:.72});
  private labels:TextureSprite[]=[];
  private landed=false;
  private lastElapsed=0;

  constructor(readonly event:RollPresentation, private vertexAt:(id:string)=>{x:number;z:number}|undefined,
              private playerColor:(id:string)=>string){
    this.root.name='dice-roll-scene';
    this.dice=[this.makeDie(event.dice[0]),this.makeDie(event.dice[1])];
    this.dice.forEach((die,i)=>this.root.add(die));
    this.advance(0,false);
  }

  private makeDie(value:number):THREE.Group {
    const group=new THREE.Group();group.name='roll-die';group.userData.value=value;
    const body=new THREE.Mesh(this.cubeGeometry,this.bodyMaterial);
    body.castShadow=true;group.add(body);
    for(const [v,normal] of Object.entries(FACE_NORMALS)){
      const value=Number(v);
      const u=Math.abs(normal.x)>.5?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0);
      const w=new THREE.Vector3().crossVectors(normal,u);
      for(const [a,b] of PIPS[value]){
        const dot=new THREE.Mesh(this.pipGeometry,this.pipMaterial);
        dot.position.copy(normal).multiplyScalar(.243).addScaledVector(u,a*.105).addScaledVector(w,b*.105);
        dot.castShadow=false;group.add(dot);
      }
    }
    return group;
  }

  private createGainLabels():void {
    const atVertex=new Map<string,typeof this.event.gains>();
    for(const item of this.event.gains)atVertex.set(item.vertexId,[...(atVertex.get(item.vertexId)??[]),item]);
    for(const [vertexId,gains] of atVertex){
      const point=this.vertexAt(vertexId);
      if(!point)continue;
      const canvas=document.createElement('canvas');canvas.width=448;canvas.height=112;
      const ctx=canvas.getContext('2d');
      if(!ctx)continue;
      const playerColor=this.playerColor(gains[0].playerId);
      ctx.fillStyle='#fffdf0';ctx.strokeStyle=playerColor;ctx.lineWidth=8;
      ctx.beginPath();ctx.roundRect(7,8,434,96,20);ctx.fill();ctx.stroke();
      const step=410/gains.length;
      for(const [index,gain] of gains.entries()){
        const offset=18+step*index;
        ctx.save();ctx.translate(offset,32);ctx.scale(2.15,2.15);
        ctx.strokeStyle=RESOURCE_COLORS[gain.resource];ctx.lineWidth=2.8;ctx.lineCap='round';ctx.lineJoin='round';
        ctx.stroke(new Path2D(RESOURCE_PATHS[gain.resource]));ctx.restore();
        ctx.fillStyle=playerColor;ctx.font='bold 39px system-ui,sans-serif';ctx.textBaseline='middle';
        ctx.fillText('+'+gain.count,offset+62,59,step-62);
      }
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,opacity:0});
      const sprite=new THREE.Sprite(material);sprite.name='building-resource-gain';sprite.renderOrder=30;
      const baseY=gains[0].kind==='city'?1.14:.88;
      sprite.position.set(point.x,baseY,point.z);sprite.scale.set(1.32,.33,1);
      sprite.userData={vertexId,playerId:gains[0].playerId,gains:gains.map(g=>({resource:g.resource,count:g.count})),color:playerColor};
      this.root.add(sprite);this.labels.push({sprite,baseY,material,texture});
    }
  }

  /** Returns true exactly once when the dice have landed. */
  advance(elapsedMs:number,reducedMotion=false):boolean {
    const previous=this.landed;this.lastElapsed=elapsedMs;
    const diceElapsed=reducedMotion?DICE_LANDING_MS:elapsedMs;
    this.dice.forEach((die,index)=>{
      const pose=diceFlight(diceElapsed,index,this.event.dice[index]);
      die.position.set(pose.x,pose.y,pose.z);
      die.quaternion.copy(pose.rotation);
      const dieFade=clamp((DICE_END_MS-elapsedMs)/340);
      die.visible=dieFade>0;
      die.scale.setScalar(reducedMotion?1: .99 + .01*dieFade);
    });
    if(!this.landed&&(reducedMotion||elapsedMs>=DICE_LANDING_MS)){
      this.landed=true;this.createGainLabels();
    }
    for(const {sprite,material,baseY} of this.labels){
      const age=reducedMotion?450:Math.max(0,elapsedMs-DICE_LANDING_MS);
      material.opacity=reducedMotion?1:Math.min(1,age/200,Math.max(0,(DICE_END_MS-elapsedMs)/450));
      sprite.position.y=baseY+(reducedMotion?0:Math.min(age/1100,.32));
    }
    return !previous&&this.landed;
  }

  get complete():boolean {return this.lastElapsed>=DICE_END_MS;}
  inspect(){
    return {dice:this.event.dice,top:this.dice.map(d=>visibleTopFace(d.quaternion)),
      landed:this.landed,gainLabels:this.labels.map(({sprite})=>sprite.userData),
      shown:this.dice.map(d=>d.visible),elapsed:this.lastElapsed};
  }
  dispose():void {
    this.root.removeFromParent();
    for(const {material,texture} of this.labels){material.dispose();texture.dispose();}
    this.labels=[];this.root.clear();
    this.cubeGeometry.dispose();this.pipGeometry.dispose();this.bodyMaterial.dispose();this.pipMaterial.dispose();
  }
}
