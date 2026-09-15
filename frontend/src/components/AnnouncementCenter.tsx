import React,{useEffect,useRef,useState} from 'react';
import {AppState,Linking,Modal,NativeModules,Platform,Pressable,ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import Constants from 'expo-constants';
import {usePathname} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {useAppPolicy} from '@/src/core/useAppPolicy';
import {useAuth} from '@/src/auth/AuthContext';
import {securityRequest} from '@/src/auth/securityApi';
import {storage} from '@/src/utils/storage';
import {fonts,tvColors} from '@/src/theme';
import {FocusGuide} from './TVFocusGuideView';
import {LocalQrCode} from './LocalQrCode';
import {useAnnouncementsPaused} from '@/src/core/announcementPause';

type Notice={id:string;title:string;message:string;url:string;version_code:number;kind:'update'|'general';expires_at:number;reminder_hours:number;sound:boolean};
type History=Record<string,{next:number;sounded:boolean}>;
export const UPDATE_SOUND_KEY='charm_announcement_sound';
const validLink=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
export function AnnouncementCenter(){
 const policy=useAppPolicy(),path=usePathname(),{user}=useAuth(),{width,height}=useWindowDimensions();
 const userId=user?.id,paused=useAnnouncementsPaused();
 const [notices,setNotices]=useState<Notice[]>([]),[active,setActive]=useState<Notice|null>(null),[ready,setReady]=useState(false),[foreground,setForeground]=useState(AppState.currentState==='active');
 const [sound,setSound]=useState(true),[help,setHelp]=useState(false),[error,setError]=useState('');
 const history=useRef<History>({}),cooldown=useRef(0),busy=useRef(false);
 const historyKey='charm_announcement_history:'+user?.id;
 const [loadedHistoryKey,setLoadedHistoryKey]=useState('');
 const version=Number(Constants.expoConfig?.android?.versionCode||0);
 // Native VOD is a separate activity. Foreground state defers notices there too.
 const safe=!!userId&&!paused&&loadedHistoryKey===historyKey&&foreground&&['/','/index','/home','/settings'].includes(path);
 useEffect(()=>{
  let stopped=false;
  setReady(false);setActive(null);setNotices([]);history.current={};
  void Promise.all([storage.getItem<History>(historyKey,{}),storage.getItem<boolean>(UPDATE_SOUND_KEY,true)]).then(([saved,soundEnabled])=>{if(!stopped){history.current=saved||{};setSound(soundEnabled!==false);setLoadedHistoryKey(historyKey);setReady(true);}});
  return()=>{stopped=true;};
 },[historyKey]);
 useEffect(()=>{
  let stopped=false;
  const refresh=async()=>{
   if(!userId||busy.current||AppState.currentState!=='active'||!policy.announcements_supported||!version)return;
   busy.current=true;
   try{
    const data=await securityRequest<{announcements:Notice[]}>('/announcements',{version_code:version},true);
    if(!stopped){const list=data.announcements.filter(a=>a.expires_at>Date.now()/1000&&(!a.url||validLink(a.url)));setNotices(list);setActive(current=>current&&!current.id.startsWith('legacy:')?(list.find(a=>a.id===current.id)||null):current);}
   }catch{/* Notification failures must not block watching. */}finally{busy.current=false;}
  };
  void refresh();const timer=setInterval(()=>void refresh(),5*60_000);
  const subscription=AppState.addEventListener('change',state=>{setForeground(state==='active');if(state==='active')void refresh();});
  return()=>{stopped=true;clearInterval(timer);subscription.remove();};
 },[policy.announcements_supported,version,userId]);
 useEffect(()=>{
  if(!safe||!ready||active||Date.now()<cooldown.current)return;
  const legacy=!policy.announcements_supported&&policy.update.version_code>version&&validLink(policy.update.url)?{id:'legacy:'+policy.update.version_code,title:'Charming MediaLab update available',message:policy.update.message,url:policy.update.url,version_code:policy.update.version_code,kind:'update' as const,expires_at:Math.floor(Date.now()/1000)+86400,reminder_hours:24,sound:false}:null;
  const list=notices.length?notices:legacy?[legacy]:[];
  const next=list.find(a=>a.expires_at>Date.now()/1000&&(a.kind!=='update'||a.version_code>version)&&(!history.current[a.id]||history.current[a.id].next<=Date.now()));
  if(next){setError('');setHelp(false);setActive(next);}
 },[safe,ready,active,notices,policy.update,policy.announcements_supported,version]);
 useEffect(()=>{
  if(!active)return;
  let timer:ReturnType<typeof setTimeout>;
  const check=()=>{const remaining=active.expires_at*1000-Date.now();if(remaining<=0)setActive(null);else timer=setTimeout(check,Math.min(remaining,3600_000));};
  check();return()=>clearTimeout(timer);
 },[active]);
 const persist=()=>{history.current=Object.fromEntries(Object.entries(history.current).sort((a,b)=>b[1].next-a[1].next).slice(0,100));void storage.setItem(historyKey,history.current);};
 const receipt=(event:'displayed'|'dismissed'|'opened')=>{if(active&&!active.id.startsWith('legacy:'))void securityRequest('/announcements/receipt',{id:active.id,event},true).catch(()=>{});};
 const onShow=()=>{
  if(!active)return;const previous=history.current[active.id];
  history.current[active.id]={next:Date.now()+active.reminder_hours*3600_000,sounded:true};persist();receipt('displayed');
  if(active.sound&&sound&&!previous?.sounded)void NativeModules.CharmAnnouncements?.playChime?.().catch(()=>{});
 };
 const dismiss=()=>{receipt('dismissed');cooldown.current=Date.now()+30_000;setActive(null);};
 const open=async()=>{if(!active?.url)return;try{await Linking.openURL(active.url);receipt('opened');}catch{setError('Telegram could not open on this device. Scan the QR with your phone or use Installation help.');}};
 const button=(label:string,action:()=>void,primary=false)=><Pressable key={label} accessibilityRole="button" onPress={action} style={({focused})=>[styles.button,primary&&styles.primary,focused&&styles.focused]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
 if(!active||!safe)return null;
 return <Modal transparent animationType="fade" onShow={onShow} onRequestClose={dismiss}><View style={styles.scrim}><FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[styles.card,{width:Math.min(width-40,820),maxHeight:height-40}]}><ScrollView contentContainerStyle={styles.content}>
  <View style={styles.header}><Ionicons name="cloud-download-outline" size={34} color="#C4B5FD"/><Text style={styles.brand}>CHARMING MEDIALAB</Text></View>
  <Text style={styles.title}>{active.title}</Text><Text style={styles.message}>{active.message}</Text>
  {help?<View style={styles.help}><Text style={styles.message}>1. Open Mr Charm on your phone and choose Mr Charm Download App. Find the release announced here.</Text><Text style={styles.message}>2. On your television, open Downloader and use the download code or address supplied with that release.</Text><Text style={styles.message}>3. Download the APK and follow Android’s installation prompts. Install it over the existing app to keep your settings. Do not uninstall first.</Text><Text style={styles.message}>Scanning on a phone opens Telegram on that phone. It does not install the update on your TV.</Text>{button('Back to update',()=>setHelp(false))}</View>:<>
   {!!active.url&&<View style={[styles.download,width<600&&{flexDirection:'column'}]}><LocalQrCode value={active.url} size={176}/><View style={{flex:1,gap:12}}><Text style={styles.message}>{Platform.isTV?'Scan with your phone to open the Telegram release.':'Open the release in Telegram to download the update.'}</Text>{button(active.kind==='update'?'Get update in Telegram':'Open link',()=>void open(),true)}{active.kind==='update'&&button('Installation help',()=>setHelp(true))}</View></View>}
  </>}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  {button(active.reminder_hours===24?'Remind me tomorrow':'Remind me in '+active.reminder_hours+' hours',dismiss)}
  {button('Alert sounds: '+(sound?'On':'Off'),()=>{const enabled=!sound;setSound(enabled);void storage.setItem(UPDATE_SOUND_KEY,enabled);})}
 </ScrollView></FocusGuide></View></Modal>;
}
const styles=StyleSheet.create({scrim:{flex:1,backgroundColor:'rgba(3,4,9,.88)',justifyContent:'center',alignItems:'center'},card:{borderRadius:24,backgroundColor:'#13141F',borderWidth:1,borderColor:'#514363'},content:{padding:30,gap:18},header:{flexDirection:'row',alignItems:'center',gap:14},brand:{color:'#C4B5FD',fontFamily:fonts.bold,fontSize:12,letterSpacing:3},title:{color:'#fff',fontSize:30,fontFamily:fonts.bold},message:{color:'#CDC9DA',fontSize:16,lineHeight:25,fontFamily:fonts.regular},download:{flexDirection:'row',alignItems:'center',gap:24},button:{paddingVertical:13,paddingHorizontal:18,minHeight:48,backgroundColor:'#232231',borderWidth:2,borderColor:'#40374E',borderRadius:12,alignItems:'center'},primary:{backgroundColor:tvColors.purple,borderColor:tvColors.purple},focused:{borderColor:'#fff',backgroundColor:'#6831BE'},buttonText:{color:'#fff',fontFamily:fonts.semibold,fontSize:15},help:{gap:14,padding:18,backgroundColor:'#1C1D2B',borderRadius:14},error:{color:'#FDA4AF',fontSize:14}});
