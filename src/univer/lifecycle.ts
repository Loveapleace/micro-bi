/** 一个编辑器实例自己的异步作用域；关闭后旧任务不能进入下一次挂载。 */
export class EditorSessionClosedError extends Error {
  constructor(){super('报表编辑器会话已关闭');this.name='EditorSessionClosedError';}
}
export function isEditorSessionClosed(error:unknown):error is EditorSessionClosedError {
  return error instanceof EditorSessionClosedError;
}
export class EditorSession {
  private state:'starting'|'ready'|'closing'|'disposed'='starting';
  private readonly controller=new AbortController();
  get signal():AbortSignal{return this.controller.signal;}
  get active():boolean{return this.state==='starting'||this.state==='ready';}
  get ready():boolean{return this.state==='ready';}
  get phase():string{return this.state;}
  allowsCommand(id:string):boolean{return this.active&&(this.ready||id!=='sheet.command.scroll-to-cell');}
  markReady():boolean{if(!this.active)return false;this.state='ready';return true;}
  close():void{if(!this.active)return;this.state='closing';this.controller.abort();}
  dispose():void{this.close();this.state='disposed';}
  assertActive():void{if(!this.active)throw new EditorSessionClosedError();}
  wait<T>(work:Promise<T>):Promise<T>{
    return new Promise<T>((resolve,reject)=>{
      let done=false;
      const finish=(action:()=>void)=>{if(done)return;done=true;this.signal.removeEventListener('abort',abort);action();};
      const abort=()=>finish(()=>reject(new EditorSessionClosedError()));
      // 始终接住work的结束；即使先取消，SDK随后结束也不会产生悬空rejection。
      work.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
      if(this.signal.aborted)abort();else this.signal.addEventListener('abort',abort,{once:true});
    });
  }
}
export async function readyAfterRender(session:EditorSession,rendered:Promise<unknown>):Promise<boolean>{
  try{await session.wait(rendered);return session.markReady();}
  catch(error){if(isEditorSessionClosed(error))return false;throw error;}
}

/** 原生结果通知、超时、关闭共用清理路径；同步回调也只释放一次。 */
export function waitForOwnedEvent(register:((done:()=>void)=>{dispose:()=>void})|undefined,timeoutMs:number,signal?:AbortSignal):Promise<void>{
  return new Promise<void>((resolve,reject)=>{
    let settled=false,subscription:{dispose:()=>void}|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const finish=(cancelled=false)=>{
      if(settled)return;settled=true;
      if(timer!==undefined)clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      subscription?.dispose();subscription=undefined;
      if(cancelled)reject(new EditorSessionClosedError());else resolve();
    };
    const abort=()=>finish(true);
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(),Math.max(0,timeoutMs));
    try{
      subscription=register?.(()=>finish());
      if(settled){subscription?.dispose();subscription=undefined;}
    }catch(error){
      if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);settled=true;reject(error);
    }
  });
}
