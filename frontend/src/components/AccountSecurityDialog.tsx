import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Linking,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {securityRequest,type AccountChallenge,type ChallengeStatus} from '@/src/auth/securityApi';
import {fonts,radius,tvColors} from '@/src/theme';
import {FocusGuide} from './TVFocusGuideView';
import {LocalQrCode} from './LocalQrCode';
import {usePauseAnnouncements} from '@/src/core/announcementPause';

export type SecurityScreen='reset'|'access'|'link'|'password'|'community'|'registration'|'security';
type Props={kind:SecurityScreen;initialLogin?:string;registration?:{invite_code:string;username:string;email:string};onApproved?:(token:string)=>Promise<void>;onClose:()=>void};
export function AccountSecurityDialog({kind,initialLogin='',registration,onApproved,onClose}:Props){
 usePauseAnnouncements();
 const {width,height}=useWindowDimensions(),wide=width>750&&width>height;
 const [login,setLogin]=useState(initialLogin),[currentPassword,setCurrentPassword]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [recoveryCode,setRecoveryCode]=useState(''),[showRecovery,setShowRecovery]=useState(false);
 const [challenge,setChallenge]=useState<AccountChallenge|null>(null),[status,setStatus]=useState<ChallengeStatus>('waiting');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[clock,setClock]=useState(Date.now());
 const [community,setCommunity]=useState<{bot_username:string;bot_url:string;community_url:string|null}|null>(null);
 const [security,setSecurity]=useState<{telegram:{telegram_id:string;username:string;name:string}|null;activity:{action:string;created_at:number}[]}|null>(null);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const title={reset:'Forgot Password',access:'Request App Access',link:'Link Telegram',password:'Change Password',community:'Telegram Community',registration:'Approve your account',security:'Account Security'}[kind];
 useEffect(()=>{
  if(kind!=='security')return;
  let stopped=false;
  void securityRequest<NonNullable<typeof security>>('/me/security',undefined,true).then(result=>{if(!stopped)setSecurity(result);}).catch(e=>{if(!stopped)setError(e.message);});
  return()=>{stopped=true;};
 },[kind]);
 const remaining=challenge?Math.max(0,challenge.expires_at-Math.floor(clock/1000)):0;
 const close=()=>{if(challenge&&status==='waiting')void securityRequest('/auth/challenges/cancel',{token:challenge.token}).catch(()=>{});onClose();};
 const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await action();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to complete this request. Please try again.');}finally{if(mounted.current)setBusy(false);}};
 const begin=()=>run(async()=>{
  if(kind==='reset'&&!login.trim())throw new Error('Enter your username or email.');
  if(kind==='link'&&!currentPassword)throw new Error('Enter your current app password.');
  const result=await securityRequest<AccountChallenge>('/auth/challenges',{kind,login,current_password:currentPassword,recovery_code:recoveryCode||undefined,...registration},kind==='link');
  if(mounted.current){setChallenge(result);setStatus('waiting');setCurrentPassword('');setClock(Date.now());}
 });
 useEffect(()=>{
  if(kind!=='community')return;
  void securityRequest<{bot_username:string;bot_url:string;community_url:string|null}>('/auth/community').then(data=>{if(mounted.current)setCommunity(data);}).catch(e=>{if(mounted.current)setError(e.message);});
 },[kind]);
 useEffect(()=>{
  if(!challenge)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const clockTimer=setInterval(()=>setClock(Date.now()),1000);
  const poll=async()=>{
   if(stopped||Date.now()>=challenge.expires_at*1000)return;
   if(AppState.currentState==='active')try{
    const response=await securityRequest<{status:ChallengeStatus}>('/auth/challenges/status',{token:challenge.token});
    if(!stopped){setError('');setStatus(response.status);if(response.status!=='waiting')return;}
   }catch(e){if(!stopped)setError(e instanceof Error?e.message:'Unable to check your request.');}
   if(!stopped)timer=setTimeout(()=>void poll(),5000);
  };
  void poll();return()=>{stopped=true;clearTimeout(timer);clearInterval(clockTimer);};
 },[challenge]);
 const finish=()=>run(async()=>{
  if(kind==='registration'){await onApproved?.(challenge!.token);return;}
  if(password.length<8||password.length>256)throw new Error('Use a password of 8–256 characters.');
  if(password!==confirm)throw new Error('The passwords do not match.');
  const result=await securityRequest<{message:string}>(kind==='password'?'/me/password':'/auth/reset-password',{token:challenge?.token,current_password:currentPassword,new_password:password},kind==='password');
  if(mounted.current){setPassword('');setConfirm('');setCurrentPassword('');setDone(result.message);}
 });
 const open=(url:string)=>run(async()=>{await Linking.openURL(url);});
 const button=(label:string,action:()=>void,primary=false)=><Pressable key={label} accessibilityRole="button" disabled={busy} onPress={action} style={({focused})=>[styles.button,primary&&styles.primary,focused&&styles.focused,busy&&styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
 const input=(label:string,value:string,change:(s:string)=>void,secure=false)=><View><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} maxLength={256} editable={!busy} style={styles.input} placeholderTextColor={tvColors.textMuted}/></View>;
 const confirmed=status==='approved'||status==='consumed';
 const inactive=!!challenge&&(remaining===0||['denied','canceled'].includes(status));
 return <Modal transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
  <View style={styles.backdrop}><FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[styles.card,{maxHeight:height-32,width:Math.min(width-32,wide?840:520)}]}>
   <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.heading}><View style={styles.icon}><Ionicons name={kind==='access'?'person-add-outline':'shield-checkmark-outline'} color="#fff" size={28}/></View><View style={{flex:1}}><Text style={styles.eyebrow}>CHARMING MEDIALAB · YOUR ACCOUNT</Text><Text style={styles.title}>{title}</Text></View></View>
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!done?<><Text style={styles.copy}>{done}</Text>{button('Done',close,true)}</>:kind==='security'?<>
     <Text style={styles.label}>Verified Telegram account</Text>
     <Text style={styles.copy}>{security?security.telegram?`${security.telegram.username?'@'+security.telegram.username:security.telegram.name} · ID ${security.telegram.telegram_id}`:'No verified Telegram account is linked. Use Link Telegram in Account settings to enable recovery.':'Loading account security…'}</Text>
     <Text style={styles.copy}>Changing your Telegram username keeps this link. Replacing a lost Telegram account requires an Admin to verify ownership.</Text>
     <Text style={styles.label}>Recent security activity</Text>
     {security?.activity.map((entry,index)=><Text key={entry.created_at+':'+index} style={styles.copy}>{entry.action.replace(/_/g,' ')} · {new Date(entry.created_at*1000).toLocaleString()}</Text>)}
     {security&&!security.activity.length&&<Text style={styles.copy}>No recent security events.</Text>}
    </>:kind==='community'?<>
     <Text style={styles.copy}>Open the room if you already belong. Otherwise, request to join and wait for an Admin’s approval. A new Telegram account does not restore your old app account.</Text>
     {community?.community_url?<><LocalQrCode value={community.community_url}/>{button('Open Telegram room',()=>void open(community.community_url!),true)}</>:<Text style={styles.copy}>Ask Mr Charm for access to the room.</Text>}
     {community&&button('Open Mr Charm',()=>void open(community.bot_url))}
    </>:kind==='password'?<>{input('Current app password',currentPassword,setCurrentPassword,true)}{input('New password',password,setPassword,true)}{input('Confirm new password',confirm,setConfirm,true)}{button('Save new password',()=>void finish(),true)}</>:!challenge?<>
     <Text style={styles.copy}>{kind==='reset'?'Reset your app password with approval from your linked Telegram account. Your new password is entered here in the app.':kind==='link'?'Verify your current app password, then approve the link in Telegram. Your Telegram username can change without breaking this link.':kind==='registration'?'Confirm this registration privately in Telegram before creating your account.':'Continue on your phone with Mr Charm. Your personal room invitation and app registration code will be issued through the existing approval process.'}</Text>
     {kind==='reset'&&input('Username or email',login,setLogin)}{kind==='link'&&input('Current app password',currentPassword,setCurrentPassword,true)}
     {kind==='reset'&&<>{button('Lost Telegram / legacy account help',()=>setShowRecovery(!showRecovery))}{showRecovery&&<><Text style={styles.copy}>An Admin must verify account ownership before issuing a one-time recovery code. This allows you to approve recovery with your replacement Telegram account. Room membership alone is not proof of ownership.</Text>{input('One-time code from your Admin',recoveryCode,setRecoveryCode)}</>}</>}
     {button(kind==='access'?'Start my access request':'Continue with Telegram',()=>void begin(),true)}
    </>:inactive?<><Text style={styles.copy}>{remaining===0?'This request expired.':'This request was declined or canceled.'} Start again for a fresh QR and code.</Text>{button('Start again',()=>{setChallenge(null);setError('');},true)}</>:confirmed?<>
     <Text style={styles.success}>Telegram confirmed ✓</Text>
     {kind==='reset'?<>{input('New password',password,setPassword,true)}{input('Confirm new password',confirm,setConfirm,true)}{button('Reset password',()=>void finish(),true)}</>:kind==='registration'?button('Finish creating my account',()=>void finish(),true):<><Text style={styles.copy}>{kind==='access'?'Continue with Mr Charm on your phone. Request to join the room, wait for approval, then use your private app invitation to register.':'Your Telegram account is linked.'}</Text>{button(kind==='access'?'Return to sign in':'Done',close,true)}</>}
    </>:<View style={[styles.pairing,wide&&{flexDirection:'row'}]}>
     <LocalQrCode value={challenge.telegram_url}/><View style={{flex:1,gap:12}}><Text style={styles.copy}>Scan with your phone, open Mr Charm and press Start if asked. Confirm only the request you started.</Text><Text style={styles.label}>Or open @{challenge.bot_username} and send this complete command:</Text><Text selectable style={styles.code}>{`Mr Charm ${{reset:'Forgot Password',link:'Link My Account',access:'Request App Access',registration:'Confirm Registration'}[kind as 'reset'|'link'|'access'|'registration']||'Request App Access'} ${challenge.code}`}</Text><Text style={styles.copy}>Expires in {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')} · Waiting for Telegram</Text>{!Platform.isTV&&button('Open Telegram',()=>void open(challenge.telegram_url),true)}</View>
    </View>}
    {busy&&<ActivityIndicator color={tvColors.purpleBright}/>}
    {!done&&button('Back',close)}
   </ScrollView>
  </FocusGuide></View>
 </Modal>;
}
const styles=StyleSheet.create({
 backdrop:{flex:1,backgroundColor:'rgba(3,4,9,.9)',alignItems:'center',justifyContent:'center'},card:{backgroundColor:'#12131D',borderWidth:1,borderColor:'#393348',borderRadius:24},content:{padding:28,gap:16},heading:{flexDirection:'row',alignItems:'center',gap:16},icon:{width:54,height:54,backgroundColor:tvColors.purple,borderRadius:16,alignItems:'center',justifyContent:'center'},eyebrow:{color:'#C4B5FD',fontSize:10,letterSpacing:2,fontFamily:fonts.bold},title:{color:'#fff',fontSize:27,fontFamily:fonts.bold,marginTop:6},copy:{color:'#C1BFCD',fontSize:15,lineHeight:23,fontFamily:fonts.regular},label:{color:'#D8D4E7',fontSize:13,fontFamily:fonts.semibold,marginBottom:6},input:{borderWidth:2,borderColor:'#494052',backgroundColor:'#1A1B28',borderRadius:radius.md,padding:14,color:'#fff',fontSize:17,minHeight:52},button:{minHeight:48,borderRadius:12,borderWidth:2,borderColor:'#393348',backgroundColor:'#1D1D2A',justifyContent:'center',alignItems:'center',paddingHorizontal:18,paddingVertical:10},primary:{backgroundColor:tvColors.purple,borderColor:tvColors.purple},buttonText:{color:'#fff',fontSize:15,fontFamily:fonts.semibold},focused:{borderColor:'#fff',backgroundColor:'#6935C5'},disabled:{opacity:.5},pairing:{gap:24,alignItems:'center'},code:{color:'#fff',fontSize:30,letterSpacing:4,fontFamily:fonts.bold},error:{color:'#FDA4AF',fontSize:14,lineHeight:22},success:{color:'#6EE7B7',fontSize:18,fontFamily:fonts.semibold}
});
