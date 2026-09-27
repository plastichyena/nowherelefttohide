import { applyPresentationFrame, presentationEffects, type PresentationEffect, type PresentationSnapshot, type TurnPresentation } from '../core/presentation';

/** Display-only clock. Cancellation invalidates callbacks before a new seek/render. */
export class TurnPlayback {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation=0;
  private complete: (()=>void)|null=null;
  get active():boolean { return this.complete!==null; }
  play(presentation:TurnPresentation,render:(state:PresentationSnapshot,effects:PresentationEffect[])=>void,complete:()=>void,speed:number|(()=>number)=1):void {
    this.cancel();const token=this.generation;this.complete=complete;
    let state=presentation.base,index=0;render(state,[]);
    const counts=new Map<string,number>();
    for(const frame of presentation.frames)if(frame.actorId)counts.set(frame.actorId,(counts.get(frame.actorId)??0)+1);
    const next=()=>{
      if(token!==this.generation)return;
      if(index>=presentation.frames.length){this.finish();return;}
      const frame=presentation.frames[index++]!,previous=state;state=applyPresentationFrame(state,frame);render(state,presentationEffects(previous,state,frame));
      // Only observable frames count. Every actor is capped at 350ms regardless of path length.
      const delay=frame.actorId?350/Math.max(.25,typeof speed==='function'?speed():speed)/(counts.get(frame.actorId)??1):0;
      this.timer=setTimeout(next,delay);
    };
    next();
  }
  skip():void { if(this.active)this.finish(); }
  cancel():void { this.generation++;if(this.timer!==null)clearTimeout(this.timer);this.timer=null;this.complete=null; }
  private finish():void { const complete=this.complete;this.cancel();complete?.(); }
}

export function turnPresentation(events:readonly {type:string;payload:unknown}[]):TurnPresentation|null {
  const value=events.find(e=>e.type==='zombie_presentation')?.payload as TurnPresentation|undefined;
  return value?.version===1&&Array.isArray(value.frames)&&value.base?value:null;
}

export function createPlaybackControls(parent:HTMLElement,ja:boolean,skip:()=>void):HTMLElement {
  const controls=document.createElement('div');controls.className='zombie-playback-controls';controls.hidden=true;
  const label=document.createElement('strong');label.textContent=ja?'ゾンビターン':'Zombie turn';
  const button=document.createElement('button');button.type='button';button.textContent=ja?'演出をスキップ':'Skip animation';
  let skipping=false;
  button.onclick=(event)=>{
    // A queued Live phase can start synchronously when this one finishes.
    // The same double-click/paint must not also skip that next phase.
    if(skipping||event.detail>1)return;
    skipping=true;skip();requestAnimationFrame(()=>{skipping=false;});
  };
  controls.append(label,button);parent.append(controls);return controls;
}
