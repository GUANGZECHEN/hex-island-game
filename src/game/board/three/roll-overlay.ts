import { createBoardView } from '../presentation.ts';
import { createIslandBoard } from '../geometry.ts';
import { resourceIcon } from '../../ui/icons.ts';
import type { Resource } from '../../rules/state.ts';
import type { RollPresentation } from './roll-presentation.ts';
import type { BoardSceneView } from './model.ts';
import { DICE_LANDING_MS, DICE_END_MS, DICE_GAIN_END_MS, DICE_REDUCED_END_MS } from './roll-scene.ts';

/** 2D/WebGL-fallback rendering uses the very same public dice and production event. */
export class BoardRollOverlay {
  private root:HTMLDivElement;
  private gains:HTMLDivElement[]=[];
  private timers:number[]=[];
  private landed=false;
  private ended=false;
  private host:HTMLElement;
  private event:RollPresentation;
  private view:BoardSceneView;

  constructor(host:HTMLElement,event:RollPresentation,view:BoardSceneView,onComplete:()=>void){
    this.host=host;this.event=event;this.view=view;
    const root=document.createElement('div');root.className='board-roll-overlay';
    root.setAttribute('role','status');root.setAttribute('aria-live','polite');
    root.setAttribute('aria-label',`Dice ${event.dice[0]} plus ${event.dice[1]} equals ${event.dice[0]+event.dice[1]}`);
    this.root=root;
    const dice=document.createElement('div');dice.className='board-roll-dice-row';
    const pips:Readonly<Record<number,number[]>>={
      1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9],
    };
    for(const [index,value] of event.dice.entries()){
      const die=document.createElement('span');die.className='board-rolled-die';
      die.setAttribute('data-value',String(value));die.setAttribute('aria-label',`Die ${index+1}: ${value}`);
      for(let i=1;i<=9;i++){
        const dot=document.createElement('i');dot.className=pips[value].includes(i)?'board-roll-pip':'board-roll-empty';
        die.append(dot);
      }
      dice.append(die);
    }
    root.append(dice);host.append(root);
    // Dice end quickly, while production badges remain long enough to read.
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduced){root.classList.add('board-roll-reduced');this.land();}
    else this.timers.push(window.setTimeout(()=>this.land(),DICE_LANDING_MS));
    if(!reduced)this.timers.push(window.setTimeout(()=>dice.remove(),DICE_END_MS));
    this.timers.push(window.setTimeout(()=>{this.dispose();onComplete();},reduced?DICE_REDUCED_END_MS:DICE_GAIN_END_MS));
  }
  update(view:BoardSceneView):void {
    this.view=view;
    if(!this.root.isConnected && !this.ended)this.host.append(this.root);
    this.positionGains();
  }
  private land():void {
    if(this.ended||this.landed)return;
    this.landed=true;
    for(const hexId of this.event.hexIds){
      const tile=Array.from(this.host.querySelectorAll<SVGGElement>('[data-hex-id]')).find(el=>el.getAttribute('data-hex-id')===hexId);
      if(!tile)continue;
      tile.classList.remove('roll-producing-hex');void tile.getBoundingClientRect();
      tile.classList.add('roll-producing-hex');
    }
    const byVertex=new Map<string,typeof this.event.gains>();
    for(const gain of this.event.gains)byVertex.set(gain.vertexId,[...(byVertex.get(gain.vertexId)??[]),gain]);
    for(const [vertexId,gains] of byVertex){
      const player=this.view.players.find(p=>p.id===gains[0].playerId);
      const tag=document.createElement('div');tag.className='board-roll-gain';
      tag.dataset.rollBuilding=vertexId;
      tag.style.setProperty('--roll-player-color',player?.color??'#4b6e66');
      tag.setAttribute('aria-label',`${player?.name??gains[0].playerId} receives ${gains.map(g=>`${g.count} ${g.resource}`).join(', ')}`);
      for(const gain of gains){
        const item=document.createElement('span');item.className='board-roll-gain-resource';
        item.dataset.resource=gain.resource;
        item.append(resourceIcon(gain.resource as Resource),document.createTextNode('+'+gain.count));
        tag.append(item);
      }
      this.root.append(tag);this.gains.push(tag);
    }
    this.positionGains();
  }
  private positionGains():void {
    const svg=this.host.querySelector<SVGSVGElement>('svg.island-board');
    const matrix=svg?.getScreenCTM();
    if(!svg||!matrix)return;
    const points=new Map(createBoardView(createIslandBoard(this.view.board.layout)).vertices.map(v=>[v.id,v.point]));
    const rect=this.host.getBoundingClientRect();
    for(const tag of this.gains){
      const point=points.get(tag.dataset.rollBuilding??'');
      if(!point)continue;
      const screen=new DOMPoint(point.x,point.y).matrixTransform(matrix);
      tag.style.left=`${screen.x-rect.left}px`;
      tag.style.top=`${screen.y-rect.top-18}px`;
    }
  }
  inspect(){return {dice:this.event.dice,landed:this.landed,gainLabels:this.gains.length,hexIds:this.event.hexIds};}
  dispose():void {
    if(this.ended)return;this.ended=true;
    this.timers.forEach(timer=>window.clearTimeout(timer));this.timers=[];
    this.root.remove();this.gains=[];
  }
}
