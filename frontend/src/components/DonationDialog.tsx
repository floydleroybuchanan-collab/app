import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, NativeModules, Pressable, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "qrcode-generator";
import { DONATION_DESCRIPTION, DONATION_LIGHTNING_ADDRESS, DONATION_USD_PRESETS, invoiceCallbackUrl, lightningAddressUrl, usdToMillisats, validateInvoice, validateLnurlDetails } from "@/src/core/donation";
import { fonts, tvColors } from "@/src/theme";

type OpenDonation = (afterClose?: () => void) => void;
const DonationContext = createContext<OpenDonation>(() => undefined);

export function useDonation() { return useContext(DonationContext); }

export function DonationProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [usd, setUsd] = useState("5");
  const [invoice, setInvoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const { width, height } = useWindowDimensions();
  const tv = width >= 700 && width > height;

  const show = useCallback<OpenDonation>((resume) => { afterClose.current = resume; setInvoice(""); setMessage(""); setOpen(true); }, []);
  const close = useCallback(() => { setOpen(false); setInvoice(""); const resume = afterClose.current; afterClose.current = undefined; setTimeout(() => resume?.(), 120); }, []);

  const createInvoice = useCallback(async () => {
    const amount = Number(usd);
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) { setMessage("Enter an amount from $1 to $500."); return; }
    setBusy(true); setMessage(""); setInvoice("");
    try {
      const priceResponse = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
      const priceJson = await priceResponse.json();
      const bitcoinUsd = Number(priceJson?.data?.amount);
      const detailsResponse = await fetch(lightningAddressUrl());
      const details = validateLnurlDetails(await detailsResponse.json());
      const millisats = usdToMillisats(amount, bitcoinUsd);
      if (millisats < details.minSendable || millisats > details.maxSendable) throw new Error("That amount is outside the wallet's allowed range.");
      const invoiceResponse = await fetch(invoiceCallbackUrl(details.callback, millisats));
      setInvoice(validateInvoice(await invoiceResponse.json()));
      setMessage("Fresh invoice created. Complete it in your wallet; this app does not claim payment was received.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a donation request. Try again.");
    } finally { setBusy(false); }
  }, [usd]);

  const qr = useMemo(() => {
    if (!invoice) return "";
    const value = QRCode(0, "M"); value.addData(`lightning:${invoice}`); value.make(); return value.createDataURL(5, 8);
  }, [invoice]);
  const copy = useCallback(async () => {
    if (!invoice) return;
    if (NativeModules.CharmVod?.copyDonationInvoice) await NativeModules.CharmVod.copyDonationInvoice(invoice);
    else await Share.share({ message: invoice, title: DONATION_DESCRIPTION });
    setMessage("Payment request copied. It contains public receiving information only.");
  }, [invoice]);
  const wallet = useCallback(async () => {
    if (!invoice) return;
    try { await Linking.openURL(`lightning:${invoice}`); setMessage("Payment request opened. Finish and verify it in your wallet."); }
    catch { setMessage("No compatible wallet opened. Scan the QR code or copy the payment request."); }
  }, [invoice]);

  return <DonationContext.Provider value={show}>{children}<Modal visible={open} transparent animationType="fade" onRequestClose={close}>
    <View style={styles.scrim}><View style={[styles.card, tv && styles.cardTv]} testID="donation-dialog">
      <View style={styles.heading}><View><Text style={styles.eyebrow}>VOLUNTARY BITCOIN SUPPORT</Text><Text style={styles.title}>Support Charming MediaLab</Text></View><Pressable onPress={close} accessibilityLabel="Close donation window" style={({focused})=>[styles.close,focused&&styles.focused]}><Ionicons name="close" size={25} color="#fff" /></Pressable></View>
      <Text style={styles.body}>Choose an amount. A fresh Lightning invoice goes directly to the public Lexe receiving address. No seed phrase, private key, wallet login, or donor account information is stored here.</Text>
      {!invoice ? <>
        <View style={styles.amounts}>{DONATION_USD_PRESETS.map(value=><Pressable key={value} hasTVPreferredFocus={value===5} onPress={()=>setUsd(String(value))} style={({focused})=>[styles.amount,usd===String(value)&&styles.selected,focused&&styles.focused]}><Text style={styles.amountText}>${value}</Text></Pressable>)}</View>
        <TextInput value={usd} onChangeText={setUsd} keyboardType="decimal-pad" placeholder="Custom USD amount" placeholderTextColor="#AAA1B5" style={styles.input} accessibilityLabel="Donation amount in US dollars" />
        <Pressable disabled={busy} onPress={()=>void createInvoice()} style={({focused})=>[styles.primary,focused&&styles.focused]}>{busy?<ActivityIndicator color="#fff"/>:<><Ionicons name="logo-bitcoin" size={22} color="#fff"/><Text style={styles.primaryText}>Create secure payment request</Text></>}</Pressable>
      </> : <View style={[styles.invoice, tv && {flexDirection:"row"}]}>
        <Image source={{uri:qr}} style={[styles.qr,{width:Math.min(tv?270:width-96,tv?270:height*.35),height:Math.min(tv?270:width-96,tv?270:height*.35)}]} />
        <View style={styles.invoiceActions}><Text style={styles.address}>{DONATION_LIGHTNING_ADDRESS}</Text><Text style={styles.body}>Scan with any Lightning wallet. The invoice is single-use and normally expires automatically.</Text><Pressable onPress={()=>void wallet()} style={({focused})=>[styles.primary,focused&&styles.focused]}><Text style={styles.primaryText}>Open Bitcoin wallet</Text></Pressable><Pressable onPress={()=>void copy()} style={({focused})=>[styles.secondary,focused&&styles.focused]}><Text style={styles.secondaryText}>Copy payment request</Text></Pressable><Pressable onPress={()=>{setInvoice("");setMessage("");}} style={({focused})=>[styles.secondary,focused&&styles.focused]}><Text style={styles.secondaryText}>Choose another amount</Text></Pressable></View>
      </View>}
      {message?<Text accessibilityRole="alert" style={styles.message}>{message}</Text>:null}
    </View></View>
  </Modal></DonationContext.Provider>;
}

export function DonationButton({ compact=false }: { compact?: boolean }) {
  const show = useDonation();
  return <Pressable onPress={()=>show()} accessibilityRole="button" accessibilityLabel="Donate Bitcoin" testID="donation-button" style={({focused})=>[styles.glassButton,compact&&styles.glassCompact,focused&&styles.focused]}><Ionicons name="logo-bitcoin" size={compact?16:19} color="#FFD88A"/><Text style={styles.glassText}>Donate</Text></Pressable>;
}

const styles=StyleSheet.create({
  scrim:{flex:1,backgroundColor:"rgba(2,1,7,.82)",alignItems:"center",justifyContent:"center",padding:20}, card:{width:"100%",maxWidth:620,maxHeight:"94%",padding:20,borderRadius:20,borderWidth:1,borderColor:"rgba(224,190,255,.55)",backgroundColor:"rgba(22,13,35,.97)"},cardTv:{maxWidth:920,padding:26},heading:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:16},eyebrow:{color:"#D8B4FE",fontFamily:fonts.semibold,fontSize:11,letterSpacing:1.3},title:{color:"#fff",fontFamily:fonts.bold,fontSize:24,marginTop:3},body:{color:"#DDD6E7",fontFamily:fonts.regular,fontSize:14,lineHeight:20,marginTop:12},close:{width:48,height:48,alignItems:"center",justifyContent:"center",borderRadius:14,borderWidth:1,borderColor:"#806198",backgroundColor:"rgba(255,255,255,.08)"},amounts:{flexDirection:"row",gap:10,marginTop:18},amount:{flex:1,minHeight:52,alignItems:"center",justifyContent:"center",borderRadius:14,borderWidth:1,borderColor:"#84679A",backgroundColor:"rgba(255,255,255,.07)"},selected:{borderColor:"#E2B8FF",backgroundColor:"rgba(139,92,246,.42)"},amountText:{color:"#fff",fontFamily:fonts.bold,fontSize:18},input:{minHeight:52,marginTop:12,paddingHorizontal:16,borderRadius:14,borderWidth:1,borderColor:"#755A8B",backgroundColor:"rgba(255,255,255,.07)",color:"#fff",fontSize:17},primary:{minHeight:52,marginTop:14,paddingHorizontal:18,flexDirection:"row",gap:9,alignItems:"center",justifyContent:"center",borderRadius:14,borderWidth:2,borderColor:"transparent",backgroundColor:"#7137B8"},primaryText:{color:"#fff",fontFamily:fonts.semibold,fontSize:15},secondary:{minHeight:48,marginTop:9,alignItems:"center",justifyContent:"center",borderRadius:13,borderWidth:1,borderColor:"#806198",backgroundColor:"rgba(255,255,255,.07)"},secondaryText:{color:"#fff",fontFamily:fonts.semibold,fontSize:14},message:{color:"#E9D5FF",fontSize:13,lineHeight:18,marginTop:12},invoice:{gap:20,marginTop:16,alignItems:"center"},invoiceActions:{flex:1,width:"100%"},qr:{backgroundColor:"#fff",borderRadius:10},address:{color:"#FFD88A",fontFamily:fonts.semibold,fontSize:14},glassButton:{minHeight:46,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,borderRadius:14,borderWidth:1,borderColor:"rgba(228,198,255,.66)",backgroundColor:"rgba(39,22,55,.64)",shadowColor:"#000",shadowOpacity:.32,shadowRadius:8},glassCompact:{minHeight:40,paddingHorizontal:12,borderRadius:12},glassText:{color:"#fff",fontFamily:fonts.semibold,fontSize:14,textShadowColor:"#000",textShadowRadius:4},focused:{borderColor:"#fff",borderWidth:2,backgroundColor:tvColors.purpleDeep}
});
