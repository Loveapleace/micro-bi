import { useEffect, useRef, useSyncExternalStore } from 'react';
import { resolveDatasetData } from '../../../core/datasetRegistry.js';
import { createLocalDrillQuery, DrillSession } from '../../../report/drillSession.js';
import type { DrillQuery, PublishedDrillIndex } from '../../../report/drillTypes.js';

const registryQuery=createLocalDrillQuery(async id=>{
  const source=await resolveDatasetData(id);return {records:source.data,headers:source.headers};
});
export function useDrillRuntime(index:PublishedDrillIndex|undefined,query:DrillQuery=registryQuery){
  const ref=useRef<DrillSession|null>(null);
  if(!ref.current)ref.current=new DrillSession();
  const session=ref.current;
  const snapshot=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
  useEffect(()=>{session.configure(index,query);},[session,index,query]);
  useEffect(()=>()=>session.dispose(),[session]);
  return {session,snapshot};
}
