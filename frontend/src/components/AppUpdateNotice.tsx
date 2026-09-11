import { useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";
import Constants from "expo-constants";
import { usePathname } from "expo-router";
import { useAppPolicy } from "@/src/core/useAppPolicy";

export function AppUpdateNotice() {
 const {update}=useAppPolicy(),path=usePathname(),shown=useRef(0);
 useEffect(()=>{
  // Never interrupt a live player, a movie, or multiview with an update prompt.
  if(!['/','/index','/home','/settings'].includes(path))return;
  if(update.version_code<=Number(Constants.expoConfig?.android?.versionCode||0)||shown.current===update.version_code||!update.url)return;
  shown.current=update.version_code;
  Alert.alert('CharmIPTV update available',update.message,[{text:'Later',style:'cancel'},{text:'Open download page',onPress:()=>{void Linking.openURL(update.url).catch(()=>Alert.alert('Download page unavailable','Try again from Settings → About.'));}}]);
 },[path,update]);
 return null;
}
