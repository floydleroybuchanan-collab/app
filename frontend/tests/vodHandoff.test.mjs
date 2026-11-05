import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(release=async()=>{}) {
 const effects=[],states=[],calls=[];
 const React={createElement:(...args)=>args,useCallback:fn=>fn,useEffect:fn=>effects.push(fn),useState:initial=>{
  const i=states.length;states.push(initial);return [initial,value=>{states[i]=value;}];
 }};
 const modules={
  react:{...React,default:React},
  'react-native':{Platform:{OS:'android'},View:'View',Text:'Text',Pressable:'Pressable',requireNativeComponent:()=> 'NativeSurface',
   BackHandler:{addEventListener:()=>({remove(){}})},NativeModules:{CharmVod:{configureSurface:async value=>calls.push(['configure',value])}}},
  '@react-navigation/native':{useIsFocused:()=>true},'expo-router':{useRouter:()=>({replace(){}})},
  '@/src/store':{useStore:()=>({deviceLayoutMode:'tv'})},'@/src/utils/tvLayout':{shouldUseTvLayout:()=>true},
  '@/src/core/playbackSession':{stopAllPlaybackSessions:async()=>{calls.push(['release']);await release();}},
  '@/src/core/mediaLibrary':{mediaLibraryPreferences:async()=>({audio:'en'})},'@/src/theme':{tvColors:{}},
  './PurpleTvShell':{usePurpleTvDrawer:()=>({openDrawer(){},closeDrawer(){}})},'./DonationDialog':{useDonation:()=>()=>{}},
 };
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL('../src/components/MediaLabVodContent.tsx',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name];}});
 const tree=exports.MediaLabVodContent({});
 return {states,calls,tree,enter:()=>effects[1]()};
}
test('shared VOD surface waits for Live TV decoder release and keeps all catalog entry controls',async()=>{
 let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));h.enter();await tick();
 assert.equal(h.states[1],false);assert.equal(h.calls.length,1);
 resolve();await tick();assert.equal(h.states[1],true);assert.equal(h.calls[1][0],'configure');
 for(const label of ['Browse','Movies','Series','My list','Search','Sources']) assert.ok(JSON.stringify(h.tree).includes(label));
 assert.doesNotMatch(JSON.stringify(h.tree),/ActivityIndicator|Open Video OnDemand/);
});
test('failed decoder handoff keeps the native VOD surface unmounted',async()=>{
 const h=harness(async()=>{throw Error('busy');});h.enter();await tick();
 assert.equal(h.states[1],false);assert.match(h.states[3],/Unable to release playback/);
});
test('leaving during decoder release cannot mount a stale VOD surface',async()=>{
 let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));const leave=h.enter();leave();resolve();await tick();
 assert.equal(h.states[1],false);
});
