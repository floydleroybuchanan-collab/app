import { useSyncExternalStore } from "react";
import { getAppPolicy,subscribeAppPolicy } from "./appPolicy";
export function useAppPolicy() {return useSyncExternalStore(subscribeAppPolicy,getAppPolicy,getAppPolicy);}
