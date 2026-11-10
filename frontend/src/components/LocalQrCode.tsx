import React,{useMemo} from 'react';
import {Image} from 'expo-image';
import createQr from 'qrcode-generator';

/** Generates the image locally; request references never leave the app for an image service. */
export function LocalQrCode({value,size=208}:{value:string;size?:number}){
 const uri=useMemo(()=>{const code=createQr(0,'M');code.addData(value);code.make();return code.createDataURL(6,24);},[value]);
 return <Image source={{uri}} style={{width:size,height:size,backgroundColor:'#fff',borderRadius:12}} contentFit="contain" accessibilityLabel="Scan with your phone to continue privately in Telegram" />;
}
