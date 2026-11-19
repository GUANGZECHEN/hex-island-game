import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RESOURCE_PATHS } from '../../ui/icons.ts';
import type { Resource } from '../../rules/state.ts';
import type { RollPresentation } from './roll-presentation.ts';

export const DICE_LANDING_MS = 1150;
export const DICE_END_MS = 2450;

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);
const DEFAULT_DICE_VIEW = new THREE.Vector3(0, .79, .61);
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

/** Presentation-only isometric pose: a true upward face plus two camera-facing
 * sides. The main board camera never moves, including when the user selects
 * Top view; a mild local die tilt makes the two side faces legible from above.
 * At rest the authoritative rolled face remains the world's highest face.
 */
export function isometricDieQuaternion(value:number,index:number,viewDirection:THREE.Vector3):THREE.Quaternion {
  const view=viewDirection.clone().normalize();
  if(view.lengthSq()<.001)view.copy(DEFAULT_DICE_VIEW);
  const azimuth=Math.atan2(view.x,view.z);
  // Rotate two adjacent lateral faces toward the viewing direction.
  const yaw=-Math.PI/4+(index===0?-.09:.09);
  // Top-down cameras need a little more die tilt to reveal both side faces.
  // Even at maximum tilt (< 27 degrees), the actual top face is highest.
  const elevation=Math.asin(THREE.MathUtils.clamp(view.y,-1,1));
  const tilt=.13+.30*smooth((elevation-.72)/(.85));
  return new THREE.Quaternion().setFromAxisAngle(UP,azimuth)
    .multiply(new THREE.Quaternion().setFromAxisAngle(SIDE,-tilt))
    .multiply(dieRestQuaternion(value,yaw));
}

export function visibleDieFaces(quaternion:THREE.Quaternion,viewDirection:THREE.Vector3):number[] {
  const view=viewDirection.clone().normalize();
  return Object.entries(FACE_NORMALS).filter(([,normal])=>
    normal.clone().applyQuaternion(quaternion).dot(view)>.10).map(([value])=>Number(value));
}

/** Keep each tilted die suspended high enough that no corner clips the board props. */
export function diceRestHeight(rotation:THREE.Quaternion):number {
  const extents=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)]
    .reduce((sum,axis)=>sum+Math.abs(axis.applyQuaternion(rotation).y),0);
  return .92+.265*extents+.015;
}

export function diceFlight(elapsed:number,index:number,face:number,viewDirection:THREE.Vector3=DEFAULT_DICE_VIEW) {
  const t=clamp(elapsed/DICE_LANDING_MS);
  const finishX=index===0?-.67:.67;
  const startX=index===0?-1.52:1.56;
  const endZ=index===0?-.14:.24;
  const x=finishX+(startX-finishX)*(1-t)**2;
  const z=endZ+(1-t)*.30*Math.sin(index+1.5);
  // Two decreasing bounces, then a stable floating height above the board.
  const rest=isometricDieQuaternion(face,index,viewDirection);
  const y=diceRestHeight(rest)+1.62*(1-t)**3 + .23*Math.abs(Math.sin(t*3.2*Math.PI))*(1-t);
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
  private cubeGeometry=new RoundedBoxGeometry(.53,.53,.53,6,.071);
  private pipGeometry=new THREE.CircleGeometry(.027,28);
  private insetGeometry=new THREE.RingGeometry(.028,.037,28);
  private wellGlintGeometry=new THREE.RingGeometry(.037,.0405,28);
  private faceContourGeometry=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-.188,-.188,.002),new THREE.Vector3(.188,-.188,.002),
    new THREE.Vector3(.188,.188,.002),new THREE.Vector3(-.188,.188,.002),
  ]);
  private panelGeometries=new Map<number,THREE.ShapeGeometry>();
  // Broad rounded ivory bevels catch the key light; matte recessed face panels
  // and contrasting pip wells prevent the cubes from reading as flat 2D tiles.
  private bodyMaterial=new THREE.MeshPhysicalMaterial({
    color:'#efe0c8',roughness:.19,metalness:.04,clearcoat:.86,clearcoatRoughness:.12,
  });
  private panelMaterial=new THREE.MeshPhysicalMaterial({
    color:'#fff8e9',roughness:.31,metalness:.02,clearcoat:.38,clearcoatRoughness:.22,side:THREE.DoubleSide,
  });
  private insetMaterial=new THREE.MeshBasicMaterial({color:'#806f60',side:THREE.DoubleSide});
  private wellGlintMaterial=new THREE.MeshBasicMaterial({color:'#fffee8',side:THREE.DoubleSide,transparent:true,opacity:.65});
  private faceContourMaterial=new THREE.LineBasicMaterial({color:'#e2cdb2',transparent:true,opacity:.42});
  private redPips=new THREE.MeshStandardMaterial({color:'#d73541',roughness:.59,side:THREE.DoubleSide});
  private bluePips=new THREE.MeshStandardMaterial({color:'#2879c8',roughness:.59,side:THREE.DoubleSide});
  private labels:TextureSprite[]=[];
  private landed=false;
  private lastElapsed=0;
  private viewDirection=DEFAULT_DICE_VIEW.clone();

  readonly event:RollPresentation;
  private vertexAt:(id:string)=>{x:number;z:number}|undefined;
  private playerColor:(id:string)=>string;

  constructor(event:RollPresentation,vertexAt:(id:string)=>{x:number;z:number}|undefined,
              playerColor:(id:string)=>string){
    this.event=event;this.vertexAt=vertexAt;this.playerColor=playerColor;
    this.root.name='dice-roll-scene';
    // Temporary lights emphasize real convex bevels and concave pip rims
    // without changing the lighting of the underlying static board.
    const key=new THREE.PointLight('#fff3dc',1.45,4.7,2);
    key.name='dice-warm-edge-key';key.position.set(-1.0,3.0,1.3);
    const fill=new THREE.PointLight('#d5e8ff',.6,3.5,2);
    fill.name='dice-cool-edge-fill';fill.position.set(1.1,2.35,-.65);
    this.root.add(key,fill);
    this.dice=[this.makeDie(event.dice[0]),this.makeDie(event.dice[1])];
    this.dice.forEach((die,i)=>this.root.add(die));
    this.advance(0,false);
  }

  /** Six actual perforated ivory face panels: colored pip wells sit below
   * the surface, with inset shadow rings. 1/4 red, 2/3/5/6 blue. */
  private faceGeometry(value:number):THREE.ShapeGeometry {
    const existing=this.panelGeometries.get(value);if(existing)return existing;
    const size=.188,shape=new THREE.Shape();
    shape.moveTo(-size,-size);shape.lineTo(size,-size);shape.lineTo(size,size);
    shape.lineTo(-size,size);shape.closePath();
    for(const [px,py] of PIPS[value]){
      const hole=new THREE.Path();
      hole.absarc(px*.107,py*.107,.036,0,Math.PI*2,true);
      shape.holes.push(hole);
    }
    const geometry=new THREE.ShapeGeometry(shape,12);
    this.panelGeometries.set(value,geometry);return geometry;
  }
  private makeDie(value:number):THREE.Group {
    const group=new THREE.Group();group.name='roll-die';group.userData.value=value;
    const body=new THREE.Mesh(this.cubeGeometry,this.bodyMaterial);
    body.name='rounded-ivory-beveled-body';
    body.renderOrder=20;body.castShadow=false;group.add(body);
    for(const [v,normal] of Object.entries(FACE_NORMALS)){
      const face=Number(v);
      const panel=new THREE.Group();panel.position.copy(normal).multiplyScalar(.280);
      panel.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
      const plate=new THREE.Mesh(this.faceGeometry(face),this.panelMaterial);
      plate.name='die-face-'+face;plate.renderOrder=21;panel.add(plate);
      const contour=new THREE.LineLoop(this.faceContourGeometry,this.faceContourMaterial);
      contour.name='die-face-ivory-contour';contour.renderOrder=22;panel.add(contour);
      for(const [px,py] of PIPS[face]){
        const center=new THREE.Vector3(px*.107,py*.107,0);
        const pit=new THREE.Mesh(this.pipGeometry,face===1||face===4?this.redPips:this.bluePips);
        pit.name='recessed-pip-'+face;pit.position.copy(center);pit.position.z=-.011;
        pit.renderOrder=22;panel.add(pit);
        const shadow=new THREE.Mesh(this.insetGeometry,this.insetMaterial);
        shadow.name='pip-well-rim';shadow.position.copy(center);shadow.position.z=.001;
        shadow.renderOrder=23;panel.add(shadow);
        const glint=new THREE.Mesh(this.wellGlintGeometry,this.wellGlintMaterial);
        glint.name='pip-well-highlight';glint.position.copy(center);glint.position.z=.002;
        glint.renderOrder=24;panel.add(glint);
      }
      group.add(panel);
    }
    return group;
  }

  private createGainLabels():void {
    const atVertex=new Map<string,typeof this.event.gains>();
    for(const item of this.event.gains)atVertex.set(item.vertexId,[...(atVertex.get(item.vertexId)??[]),item]);
    for(const [vertexId,gains] of atVertex){
      const point=this.vertexAt(vertexId);
      if(!point)continue;
      // Size grows with distinct resource types. Same-type gains already
      // aggregate to +2/+4, while mixed adjacent tiles stay individually legible.
      const width=58+gains.length*186;
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=112;
      const ctx=canvas.getContext('2d');
      if(!ctx)continue;
      const playerColor=this.playerColor(gains[0].playerId);
      ctx.fillStyle='#fffdf0';ctx.strokeStyle=playerColor;ctx.lineWidth=8;
      ctx.beginPath();ctx.roundRect(7,8,width-14,96,20);ctx.fill();ctx.stroke();
      for(const [index,gain] of gains.entries()){
        const offset=24+186*index;
        ctx.save();ctx.translate(offset,32);ctx.scale(2.15,2.15);
        ctx.strokeStyle=RESOURCE_COLORS[gain.resource];ctx.lineWidth=2.8;ctx.lineCap='round';ctx.lineJoin='round';
        ctx.stroke(new Path2D(RESOURCE_PATHS[gain.resource]));ctx.restore();
        ctx.fillStyle=playerColor;ctx.font='bold 39px system-ui,sans-serif';ctx.textBaseline='middle';
        ctx.fillText('+'+gain.count,offset+68,59,105);
      }
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,opacity:0});
      const sprite=new THREE.Sprite(material);sprite.name='building-resource-gain';sprite.renderOrder=30;
      const baseY=gains[0].kind==='city'?1.14:.88;
      sprite.position.set(point.x,baseY+.10,point.z);sprite.scale.set(width*.0047,.54,1);
      sprite.userData={vertexId,playerId:gains[0].playerId,gains:gains.map(g=>({resource:g.resource,count:g.count})),color:playerColor};
      this.root.add(sprite);this.labels.push({sprite,baseY,material,texture});
    }
  }

  /** The dice presentation tracks orbiting without rotating the game camera. */
  setViewDirection(view:THREE.Vector3):void {this.viewDirection.copy(view).normalize();}

  /** Returns true exactly once when the dice have landed. */
  advance(elapsedMs:number,reducedMotion=false):boolean {
    const previous=this.landed;this.lastElapsed=elapsedMs;
    const diceElapsed=reducedMotion?DICE_LANDING_MS:elapsedMs;
    this.dice.forEach((die,index)=>{
      const pose=diceFlight(diceElapsed,index,this.event.dice[index],this.viewDirection);
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
      visibleFaces:this.dice.map(d=>visibleDieFaces(d.quaternion,this.viewDirection)),
      cameraDirection:this.viewDirection.toArray(),
      landed:this.landed,gainLabels:this.labels.map(({sprite})=>sprite.userData),
      shown:this.dice.map(d=>d.visible),elapsed:this.lastElapsed};
  }
  dispose():void {
    this.root.removeFromParent();
    for(const {material,texture} of this.labels){material.dispose();texture.dispose();}
    this.labels=[];this.root.clear();
    this.cubeGeometry.dispose();this.pipGeometry.dispose();this.insetGeometry.dispose();
    this.wellGlintGeometry.dispose();this.faceContourGeometry.dispose();
    this.panelGeometries.forEach(geometry=>geometry.dispose());this.panelGeometries.clear();
    for(const material of [this.bodyMaterial,this.panelMaterial,this.insetMaterial,this.wellGlintMaterial,this.faceContourMaterial,
      this.redPips,this.bluePips])material.dispose();
  }
}
