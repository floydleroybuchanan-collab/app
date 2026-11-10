import {useEffect,useSyncExternalStore} from 'react';
let owners=0;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(listener=>listener());
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function usePauseAnnouncements(){useEffect(()=>{owners++;emit();return()=>{owners=Math.max(0,owners-1);emit();};},[]);}
export function useAnnouncementsPaused(){return useSyncExternalStore(subscribe,()=>owners>0,()=>false);}
