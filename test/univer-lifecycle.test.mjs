import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession, EditorSessionClosedError, isEditorSessionClosed, readyAfterRender, waitForOwnedEvent } from '../dist/esm/univer/lifecycle.js';
import { waitForFormulaSettled } from '../dist/esm/univer/adapter.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};};

test('UL-01 source session is not interactive until the rendered lifecycle promise completes',async()=>{
  const session=new EditorSession(),rendered=deferred();let published=0;
  const ready=readyAfterRender(session,rendered.promise).then(value=>{if(value)published++;return value;});
  assert.equal(session.ready,false);assert.equal(session.phase,'starting');assert.equal(published,0);
  rendered.resolve();assert.equal(await ready,true);assert.equal(session.ready,true);assert.equal(published,1);
});
test('UL-02 StrictMode setup-cleanup-setup cannot publish the first abandoned instance',async()=>{
  const first=new EditorSession(),second=new EditorSession(),a=deferred(),b=deferred(),published=[];
  const x=readyAfterRender(first,a.promise).then(ready=>{if(ready)published.push('first');});
  first.close();const y=readyAfterRender(second,b.promise).then(ready=>{if(ready)published.push('second');});
  b.resolve();a.resolve();await Promise.all([x,y]);assert.deepEqual(published,['second']);assert.equal(first.phase,'closing');assert.equal(second.ready,true);
});
test('UL-03 close cancels a pending owner wait immediately and ignores a later old result',async()=>{
  const session=new EditorSession(),work=deferred();let writes=0;
  const pending=session.wait(work.promise).then(()=>{session.assertActive();writes++;});
  const rejected=assert.rejects(pending,EditorSessionClosedError);session.close();await rejected;
  work.resolve('old');await Promise.resolve();assert.equal(writes,0);
});
test('UL-04 genuine SDK readiness errors remain observable while the owner is active',async()=>{
  const session=new EditorSession(),error=new Error('render initialization failed');
  await assert.rejects(readyAfterRender(session,Promise.reject(error)),e=>e===error);assert.equal(session.ready,false);
});
test('UL-05 close and dispose are idempotent and never revive a terminated owner',()=>{
  const session=new EditorSession();session.markReady();session.close();session.close();assert.equal(session.signal.aborted,true);assert.equal(session.markReady(),false);session.dispose();session.dispose();assert.equal(session.phase,'disposed');assert.throws(()=>session.assertActive(),EditorSessionClosedError);
});
test('UL-06 result completion disposes the formula listener exactly once and cancels timeout',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let callback,disposed=0;
  const pending=waitForOwnedEvent(done=>{callback=done;return {dispose:()=>disposed++};},300);
  callback();await pending;assert.equal(disposed,1);t.mock.timers.tick(1000);callback();assert.equal(disposed,1);
});
test('UL-07 timeout removes formula listener and a later close does not dispose twice',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const session=new EditorSession();let disposed=0;
  const pending=waitForOwnedEvent(()=>({dispose:()=>disposed++}),300,session.signal);
  t.mock.timers.tick(300);await pending;session.close();assert.equal(disposed,1);
});
test('UL-08 editor close aborts formula wait and releases its subscription before SDK destruction',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const session=new EditorSession();let disposed=0;
  const pending=waitForOwnedEvent(()=>({dispose:()=>disposed++}),300,session.signal);
  const rejected=assert.rejects(pending,EditorSessionClosedError);session.close();assert.equal(disposed,1);await rejected;t.mock.timers.tick(1000);assert.equal(disposed,1);
});
test('UL-09 an idle callback queued by the SDK after unsubscribe cannot settle a closed wait again',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const session=new EditorSession();let callback,disposed=0;
  const pending=waitForOwnedEvent(done=>{callback=done;return {dispose:()=>disposed++};},300,session.signal);
  const rejected=assert.rejects(pending,EditorSessionClosedError);session.close();await rejected;callback();t.mock.timers.tick(500);assert.equal(disposed,1);
});
test('UL-10 synchronously applied formula result still releases the returned subscription',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let disposed=0;
  await waitForOwnedEvent(done=>{done();return {dispose:()=>disposed++};},300);assert.equal(disposed,1);t.mock.timers.tick(500);assert.equal(disposed,1);
});
test('UL-11 subscription failures propagate and do not leave a running timeout',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const session=new EditorSession(),error=new Error('listener registration failed');
  await assert.rejects(waitForOwnedEvent(()=>{throw error;},300,session.signal),e=>e===error);session.close();t.mock.timers.tick(500);
});
test('UL-12 already closed owners do not register new formula listeners',async()=>{
  const session=new EditorSession();session.close();let registrations=0;
  await assert.rejects(waitForOwnedEvent(()=>{registrations++;return {dispose(){}};},300,session.signal),EditorSessionClosedError);assert.equal(registrations,0);
});
test('UL-13 closing before an already fulfilled microtask continuation prevents a stale commit',async()=>{
  const session=new EditorSession();let writes=0;
  const pending=session.wait(Promise.resolve()).then(()=>{session.assertActive();writes++;});
  const rejected=assert.rejects(pending,EditorSessionClosedError);session.close();await rejected;assert.equal(writes,0);
});
test('UL-14 SDK rejection after owner cancellation is consumed without replacing the close result',async()=>{
  const session=new EditorSession(),work=deferred(),ready=readyAfterRender(session,work.promise);session.close();assert.equal(await ready,false);work.reject(new Error('SDK lifecycle unreachable after dispose'));await Promise.resolve();
});
test('UL-15 repeated open/close leaves no active formula subscription or timeout settlement',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let active=0,total=0;
  for(let i=0;i<100;i++){
    const session=new EditorSession();session.markReady();const p=waitForOwnedEvent(()=>{active++;total++;return {dispose:()=>active--};},300,session.signal);
    const rejected=assert.rejects(p,EditorSessionClosedError);session.close();await rejected;assert.equal(active,0);
  }
  t.mock.timers.tick(1000);assert.equal(active,0);assert.equal(total,100);
});
test('UL-16 ownerless fallback wait is bounded and explicit cancellation errors are distinguishable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const p=waitForOwnedEvent(undefined,150);t.mock.timers.tick(150);await p;assert.equal(isEditorSessionClosed(new EditorSessionClosedError()),true);assert.equal(isEditorSessionClosed(new Error('real SDK failure')),false);
});
test('UL-17 scroll requiring a render controller is blocked before Rendered; closed owners reject every command',()=>{
  const session=new EditorSession();assert.equal(session.allowsCommand('sheet.command.scroll-to-cell'),false);assert.equal(session.allowsCommand('sheet.mutation.set-range-values'),true);session.markReady();assert.equal(session.allowsCommand('sheet.command.scroll-to-cell'),true);session.close();assert.equal(session.allowsCommand('sheet.command.scroll-to-cell'),false);assert.equal(session.allowsCommand('sheet.mutation.set-range-values'),false);
});
test('UL-18 formula adapter uses the disposable result API instead of passing a callback to the timeout API',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let callback,disposed=0,wrongApi=0;
  const api={getFormula:()=>({calculationResultApplied(done){callback=done;return {dispose:()=>disposed++};},onCalculationResultApplied(){wrongApi++;throw new Error('timeout API must not be called with callback');}})};
  const pending=waitForFormulaSettled(api,300);assert.equal(typeof callback,'function');callback();await pending;t.mock.timers.tick(500);assert.equal(disposed,1);assert.equal(wrongApi,0);
});
