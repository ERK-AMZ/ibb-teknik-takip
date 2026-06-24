import { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import { supabase, signIn, signOut, getProfiles, createOvertime, updateOvertime, createLeave, updateLeave, subscribeToChanges } from './lib/supabase';

// Safe array extractor - handles {data:[...]} objects AND raw arrays
const toArr=(v)=>{if(Array.isArray(v))return v;if(v&&typeof v==='object'&&Array.isArray(v.data))return v.data;return[];};
// === Önbellek (stale-while-revalidate): açılışta anında veri, arkada tazeleme ===
const CACHE_KEY='ibb_cache_v1';
const cacheGet=()=>{try{const r=localStorage.getItem(CACHE_KEY);if(!r)return null;const o=JSON.parse(r);return(o&&o.profiles)?o:null;}catch(e){return null;}};
const cacheSave=(patch)=>{try{const cur=cacheGet()||{};const nx={...cur,...patch,ts:Date.now()};if(Array.isArray(nx.faults))nx.faults=nx.faults.map(f=>({...f,photos:[]}));localStorage.setItem(CACHE_KEY,JSON.stringify(nx));}catch(e){try{localStorage.removeItem(CACHE_KEY);}catch(_e){}}};
const cacheClear=()=>{try{localStorage.removeItem(CACHE_KEY);}catch(e){}};

class ErrorBoundary extends Component {
  constructor(props){super(props);this.state={hasError:false,error:null,info:null};}
  static getDerivedStateFromError(error){return{hasError:true,error};}
  componentDidCatch(error,info){this.setState({info});console.error("CRASH:",error,info?.componentStack);}
  render(){
    if(this.state.hasError){
      const errMsg=String(this.state.error?.message||this.state.error||"?");
      const stack=this.state.info?.componentStack||"";
      const diag=typeof window!=='undefined'?window.__DIAG||"yok":"yok";
      return(<div style={{minHeight:"100vh",background:"#0c0e14",color:"#e2e8f0",padding:20}}>
        <div style={{textAlign:"center",marginTop:60}}>
          <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
          <div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Uygulama Hatası v5.3</div>
          <div style={{fontSize:12,color:"#94a3b8",marginBottom:16,maxWidth:340,margin:"0 auto 16px",wordBreak:"break-word"}}>{errMsg}</div>
          <button style={{padding:"12px 24px",background:"#6366f1",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:"pointer",marginBottom:8,display:"block",margin:"0 auto 8px"}} onClick={()=>{
            if('caches' in window)caches.keys().then(n=>n.forEach(k=>caches.delete(k)));
            if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister()));
            localStorage.clear();sessionStorage.clear();
            window.location.href=window.location.origin+"?v="+Date.now();
          }}>🔄 Temizle ve Yeniden Yükle</button>
          <button style={{padding:"10px 20px",background:"#ef4444",color:"white",border:"none",borderRadius:10,fontSize:13,cursor:"pointer",display:"block",margin:"0 auto 16px"}} onClick={()=>{
            supabase.auth.signOut().finally(()=>{localStorage.clear();sessionStorage.clear();if('caches' in window)caches.keys().then(n=>n.forEach(k=>caches.delete(k)));window.location.href=window.location.origin+"?v="+Date.now();});
          }}>🚪 Çıkış Yap + Temizle</button>
        </div>
        <details style={{maxWidth:360,margin:"0 auto",textAlign:"left",fontSize:10,color:"#64748b"}}>
          <summary style={{cursor:"pointer",fontWeight:700,marginBottom:8}}>🔍 Teşhis (screenshot at)</summary>
          <pre style={{whiteSpace:"pre-wrap",background:"#161923",padding:10,borderRadius:8,maxHeight:400,overflow:"auto",fontSize:9,lineHeight:1.4,userSelect:"text"}}>{errMsg+"\n\n--- STATE ---\n"+diag+"\n\n--- STACK ---\n"+stack}</pre>
        </details>
      </div>);
    }
    return this.props.children;
  }
}

const OT_MULT=1.5,WORK_END=17;
function calcOT(st,et,type){if(!st||!et)return 0;const[sh,sm]=st.split(":").map(Number),[eh,em]=et.split(":").map(Number);let s=sh*60+sm,e=eh*60+em;if(e<=s)e+=1440;if(type==="daytime"){return Math.round(((e-s)/60)*10)/10;}const eff=Math.max(s,WORK_END*60);return eff>=e?0:Math.round(((e-eff)/60)*10)/10;}
function calcLH(h){return Math.round(h*OT_MULT*10)/10;}
function fD(d){if(!d)return"";try{return new Date(d+'T00:00:00').toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"});}catch{return d;}}
function fDS(d){if(!d)return"";try{return new Date(d+'T00:00:00').toLocaleDateString("tr-TR",{day:"numeric",month:"short"});}catch{return d;}}
function sColor(s){return s==="approved"?"#22c55e":s==="pending_chef"?"#f59e0b":s==="pending_manager"?"#3b82f6":s==="rejected"?"#ef4444":"#94a3b8";}
function sText(s){return s==="approved"?"Onaylandı":s==="pending_chef"?"Şef Onayı Bekliyor":s==="pending_manager"?"Müh. Onayı Bekliyor":s==="rejected"?"Reddedildi":s;}
function daysSince(d){if(!d)return 0;const t=new Date(),s=new Date(d+'T00:00:00');return Math.max(0,Math.floor((t-s)/(1000*60*60*24)));}
function getVoteWeek(d){
  // Vote period: Wednesday 00:00 → next Tuesday 23:59
  const dt=d?new Date(d):new Date();
  const day=dt.getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed...
  // Find the Wednesday that starts this period
  const diff=day>=3?(day-3):(day+4); // days since last Wednesday
  const wed=new Date(dt);wed.setDate(dt.getDate()-diff);wed.setHours(0,0,0,0);
  return `${wed.getFullYear()}-${String(wed.getMonth()+1).padStart(2,'0')}-${String(wed.getDate()).padStart(2,'0')}`;
}
function getPrevVoteWeek(){
  const now=new Date();
  const prev=new Date(now);prev.setDate(now.getDate()-7);
  return getVoteWeek(prev);
}
function getVoteWeekRange(weekStr){
  // Returns {start, end} date strings for a vote_week
  const wed=new Date(weekStr+"T00:00:00");
  const tue=new Date(wed);tue.setDate(wed.getDate()+6);
  return{start:weekStr,end:`${tue.getFullYear()}-${String(tue.getMonth()+1).padStart(2,'0')}-${String(tue.getDate()).padStart(2,'0')}`};
}
function getVotePeriodInfo(){
  const now=new Date();const day=now.getDay();
  const diff=day>=3?(day-3):(day+4);
  const wed=new Date(now);wed.setDate(now.getDate()-diff);wed.setHours(0,0,0,0);
  const tue=new Date(wed);tue.setDate(wed.getDate()+6);tue.setHours(23,59,59);
  const daysLeft=Math.max(0,Math.ceil((tue-now)/(1000*60*60*24)));
  const isUrgent=daysLeft<=1; // Salı (son gün)
  const isWarning=daysLeft<=2; // Pazartesi-Salı
  return{start:wed,end:tue,daysLeft,isUrgent,isWarning};
}
// Flexible vote_week comparison (handles date format differences)
function vwMatch(vw,target){return String(vw||"").slice(0,10)===String(target||"").slice(0,10);}
function voteMinWeek(){return getVoteWeek(new Date(Date.now()-21*24*60*60*1000));}
function isFriday(){return new Date().getDay()===5;}
function sIcon(s){return s==="approved"?"\u2713":s==="rejected"?"\u2717":"\u23F3";}
function ini(n){if(!n)return"?";try{return n.split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();}catch{return"?";}}

const C={bg:"#0c0e14",card:"#161923",border:"#252a3a",accent:"#6366f1",accentL:"#818cf8",accentD:"rgba(99,102,241,0.12)",text:"#e2e8f0",dim:"#94a3b8",muted:"#64748b",green:"#22c55e",greenD:"rgba(34,197,94,0.12)",orange:"#f59e0b",orangeD:"rgba(245,158,11,0.12)",red:"#ef4444",redD:"rgba(239,68,68,0.12)",blue:"#3b82f6",blueD:"rgba(59,130,246,0.12)",purple:"#a855f7",purpleD:"rgba(168,85,247,0.12)",teal:"#14b8a6",tealD:"rgba(20,184,166,0.12)"};
const avC=[C.accentD,C.greenD,C.orangeD,C.blueD,C.redD,C.purpleD,"rgba(236,72,153,0.12)",C.tealD];
function getAv(i){return avC[i%avC.length];}
const MONTHS=["Ocak","\u015Eubat","Mart","Nisan","May\u0131s","Haziran","Temmuz","A\u011Fustos","Eyl\u00FCl","Ekim","Kas\u0131m","Aral\u0131k"];
const DAYS_TR=["Pzt","Sal","\u00C7ar","Per","Cum","Cmt","Paz"];
// Türkiye resmi tatilleri 2026
const HOLIDAYS_2026={
  "2026-01-01":"Yılbaşı","2026-03-20":"Ramazan Bayramı","2026-03-21":"Ramazan Bayramı","2026-03-22":"Ramazan Bayramı",
  "2026-04-23":"Ulusal Egemenlik","2026-05-01":"İşçi Bayramı","2026-05-19":"Gençlik Bayramı",
  "2026-05-27":"Kurban Bayramı","2026-05-28":"Kurban Bayramı","2026-05-29":"Kurban Bayramı","2026-05-30":"Kurban Bayramı",
  "2026-07-15":"Demokrasi Günü","2026-08-30":"Zafer Bayramı","2026-10-29":"Cumhuriyet Bayramı"
};
function isHoliday(d){return HOLIDAYS_2026[d]||null;}
const YEARLY_OT_LIMIT=270; // Yıllık yasal mesai sınırı (saat)
function daysInMonth(y,m){return new Date(y,m+1,0).getDate();}
function firstDay(y,m){const d=new Date(y,m,1).getDay();return d===0?6:d-1;}
function dateStr(y,m,d){return`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function todayStr(){try{return new Date().toISOString().split("T")[0];}catch{const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;}}

/* iOS-STYLE WHEEL PICKER */
const ITEM_H=44,VISIBLE=5,PICKER_H=ITEM_H*VISIBLE;
function WheelColumn({items,selected,onChange,width}){
  const ref=useRef(null);const t=useRef({sy:0,ss:0,vel:0,ly:0,lt:0});
  const idx=items.findIndex(x=>typeof x==="object"?x.value===selected:x===selected);
  const off=idx>=0?idx:0;
  useEffect(()=>{if(ref.current){ref.current.style.transition='none';ref.current.style.transform=`translateY(${(VISIBLE*.5-.5)*ITEM_H-off*ITEM_H}px)`;}},[]);
  useEffect(()=>{if(ref.current){ref.current.style.transition='transform 0.3s cubic-bezier(0.23,1,0.32,1)';ref.current.style.transform=`translateY(${(VISIBLE*.5-.5)*ITEM_H-off*ITEM_H}px)`;}},[off]);
  function snap(i){const c=Math.max(0,Math.min(items.length-1,i));const val=typeof items[c]==="object"?items[c].value:items[c];if(val!==selected)onChange(val);}
  function getY(){if(!ref.current)return 0;const m=getComputedStyle(ref.current).transform;if(m&&m!=='none'){const v=m.match(/matrix.*\((.+)\)/);if(v)return parseFloat(v[1].split(', ').pop())||0;}return(VISIBLE*.5-.5)*ITEM_H-off*ITEM_H;}
  function idxFromY(y){return Math.round(((VISIBLE*.5-.5)*ITEM_H-y)/ITEM_H);}
  function onTS(e){const tc=t.current;tc.sy=e.touches[0].clientY;tc.ss=getY();tc.ly=e.touches[0].clientY;tc.lt=Date.now();tc.vel=0;if(ref.current)ref.current.style.transition='none';}
  function onTM(e){e.preventDefault();const tc=t.current;const cy=e.touches[0].clientY;const now=Date.now();const dt=now-tc.lt;if(dt>0)tc.vel=(cy-tc.ly)/dt;tc.ly=cy;tc.lt=now;if(ref.current)ref.current.style.transform=`translateY(${tc.ss+(cy-tc.sy)}px)`;}
  function onTE(){const tc=t.current;let cy=getY()+tc.vel*120;const i=Math.max(0,Math.min(items.length-1,idxFromY(cy)));if(ref.current){ref.current.style.transition='transform 0.4s cubic-bezier(0.23,1,0.32,1)';ref.current.style.transform=`translateY(${(VISIBLE*.5-.5)*ITEM_H-i*ITEM_H}px)`;}setTimeout(()=>snap(i),50);}
  return(
    <div style={{width:width||80,height:PICKER_H,overflow:"hidden",position:"relative",touchAction:"none"}} onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}>
      <div ref={ref} style={{willChange:"transform"}}>{items.map((item,i)=>{const dist=Math.abs(i-off);const label=typeof item==="object"?item.label:String(item).padStart(2,"0");return(<div key={`${label}-${i}`} onClick={()=>snap(i)} style={{height:ITEM_H,display:"flex",alignItems:"center",justifyContent:"center",fontSize:dist===0?20:16,fontWeight:dist===0?700:400,color:dist===0?C.text:C.muted,opacity:dist===0?1:dist===1?0.5:0.25,cursor:"pointer",transform:`scale(${dist===0?1:dist===1?0.9:0.8})`,transition:"all 0.2s",userSelect:"none",WebkitUserSelect:"none"}}>{label}</div>);})}</div>
      <div style={{position:"absolute",top:"50%",left:0,right:0,height:ITEM_H,transform:"translateY(-50%)",borderTop:`2px solid ${C.accent}44`,borderBottom:`2px solid ${C.accent}44`,pointerEvents:"none"}}/>
      <div style={{position:"absolute",top:0,left:0,right:0,height:ITEM_H*1.5,background:`linear-gradient(${C.card},transparent)`,pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:ITEM_H*1.5,background:`linear-gradient(to top,${C.card},transparent)`,pointerEvents:"none"}}/>
    </div>);
}

function CustomDatePicker({value,onChange,onClose}){
  const p=value?value.split("-").map(Number):[new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate()];
  const[yr,setYr]=useState(p[0]);const[mo,setMo]=useState(p[1]);const[dy,setDy]=useState(p[2]);
  const years=[];for(let y=2024;y<=2030;y++)years.push(y);
  const months=MONTHS.map((m,i)=>({value:i+1,label:m}));
  const maxD=daysInMonth(yr,mo-1);const days=[];for(let d=1;d<=maxD;d++)days.push(d);
  const adjDay=Math.min(dy,maxD);
  function confirm(){onChange(`${yr}-${String(mo).padStart(2,"0")}-${String(adjDay).padStart(2,"0")}`);onClose();}
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:C.card,borderRadius:"20px 20px 0 0",padding:"16px 16px calc(20px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:15,cursor:"pointer",padding:8}}>İptal</button>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Tarih Seçin</div>
          <button onClick={confirm} style={{background:"none",border:"none",color:C.accent,fontSize:15,fontWeight:700,cursor:"pointer",padding:8}}>Tamam</button>
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:4}}>
          <WheelColumn items={days} selected={adjDay} onChange={setDy} width={60}/>
          <WheelColumn items={months} selected={mo} onChange={setMo} width={120}/>
          <WheelColumn items={years} selected={yr} onChange={setYr} width={80}/>
        </div>
        <div style={{textAlign:"center",marginTop:8,fontSize:14,color:C.accent,fontWeight:600}}>{adjDay} {MONTHS[mo-1]} {yr}</div>
      </div></div>);
}

function CustomTimePicker({value,onChange,onClose,label}){
  const pts=value?value.split(":").map(Number):[17,0];
  const[hr,setHr]=useState(pts[0]);const[mn,setMn]=useState(pts[1]);
  const hours=[];for(let h=0;h<=23;h++)hours.push(h);
  const minutes=[];for(let m=0;m<=55;m+=5)minutes.push(m);
  const nearMn=minutes.reduce((prev,curr)=>Math.abs(curr-mn)<Math.abs(prev-mn)?curr:prev,0);
  function confirm(){onChange(`${String(hr).padStart(2,"0")}:${String(nearMn).padStart(2,"0")}`);onClose();}
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:C.card,borderRadius:"20px 20px 0 0",padding:"16px 16px calc(20px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:15,cursor:"pointer",padding:8}}>İptal</button>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>{label||"Saat Seçin"}</div>
          <button onClick={confirm} style={{background:"none",border:"none",color:C.accent,fontSize:15,fontWeight:700,cursor:"pointer",padding:8}}>Tamam</button>
        </div>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:0}}>
          <WheelColumn items={hours} selected={hr} onChange={setHr} width={80}/>
          <div style={{fontSize:28,fontWeight:800,color:C.text,padding:"0 4px"}}>:</div>
          <WheelColumn items={minutes} selected={nearMn} onChange={setMn} width={80}/>
        </div>
        <div style={{textAlign:"center",marginTop:8,fontSize:18,fontWeight:700,color:C.accent}}>{String(hr).padStart(2,"0")}:{String(nearMn).padStart(2,"0")}</div>
      </div></div>);
}

function PWAInstallGuide({onClose}){
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const isAndroid=/Android/.test(navigator.userAgent);
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:C.card,borderRadius:"20px 20px 0 0",padding:"20px 16px calc(28px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div style={{width:40,height:4,borderRadius:2,background:C.border,margin:"0 auto 16px"}}/>
        <div style={{textAlign:"center",marginBottom:16}}><div style={{fontSize:40,marginBottom:8}}>📲</div><div style={{fontSize:18,fontWeight:700}}>Ana Ekrana Ekle</div><div style={{fontSize:13,color:C.dim,marginTop:4}}>Uygulama gibi kullanın</div></div>
        {isIOS&&<div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:C.accent}}>iPhone / iPad</div>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:8}}><div style={{width:28,height:28,borderRadius:7,background:C.accentD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,fontWeight:700,color:C.accent}}>1</div><div style={{fontSize:13,color:C.text}}>Safari'de alt kısmında Paylaş (📤) butonuna tıklayın</div></div>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:8}}><div style={{width:28,height:28,borderRadius:7,background:C.accentD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,fontWeight:700,color:C.accent}}>2</div><div style={{fontSize:13,color:C.text}}>Asagi kaydırıp Ana Ekrana Ekle'ye tıklayın</div></div>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:8}}><div style={{width:28,height:28,borderRadius:7,background:C.accentD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,fontWeight:700,color:C.accent}}>3</div><div style={{fontSize:13,color:C.text}}>Sag üstten Ekle'ye tıklayın</div></div>
          <div style={{marginTop:8,padding:"6px 10px",background:C.orangeD,borderRadius:8,fontSize:12,color:C.orange,fontWeight:600}}>Sadece Safari'de çalışır</div>
        </div>}
        {isAndroid&&<div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:C.green}}>Android</div>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:8}}><div style={{width:28,height:28,borderRadius:7,background:C.greenD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,fontWeight:700,color:C.green}}>1</div><div style={{fontSize:13,color:C.text}}>Chrome'da sag ust menüye tıklayın</div></div>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:8}}><div style={{width:28,height:28,borderRadius:7,background:C.greenD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,fontWeight:700,color:C.green}}>2</div><div style={{fontSize:13,color:C.text}}>Ana ekrana ekle veya Uygulamayi yükle seçin</div></div>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:8}}><div style={{width:28,height:28,borderRadius:7,background:C.greenD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,fontWeight:700,color:C.green}}>3</div><div style={{fontSize:13,color:C.text}}>Yükle'ye tıklayın</div></div>
        </div>}
        {!isIOS&&!isAndroid&&<div style={{background:C.bg,borderRadius:12,padding:16,marginBottom:12}}><div style={{fontSize:13,color:C.text}}>Tarayici menüsünden Ana ekrana ekle seçeneğini kullanin.</div></div>}
        <button onClick={onClose} style={{width:"100%",padding:"12px 20px",border:"none",borderRadius:10,background:C.accent,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",marginTop:8,WebkitAppearance:"none"}}>Anladım</button>
      </div></div>);
}

export default function App(){return <ErrorBoundary><AppInner/></ErrorBoundary>;}
function AppInner(){
  const[session,setSession]=useState(null);
  const[profile,setProfile]=useState(null);
  const[profiles,setProfilesState]=useState([]);
  const[overtimes,setOvertimesState]=useState([]);
  const[leavesState,setLeavesState]=useState([]);
  const[loading,setLoading]=useState(true);
  const[loadError,setLoadError]=useState(null);
  const[page,setPage]=useState("dashboard");
  // Buildings
  const[buildings,setBuildings]=useState([]);
  const[selBuilding,setSelBuilding]=useState(null);
  const[login,setLogin]=useState({email:"",password:""});
  const[loginErr,setLoginErr]=useState("");
  const[showPwd,setShowPwd]=useState(false);
  const[selPerson,setSelPerson]=useState(null);
  const[selOT,setSelOT]=useState(null);
  const[selLV,setSelLV]=useState(null);
  const[nobetState,setNobetState]=useState([]); // nöbet devir kayıtları
  const[selDay,setSelDay]=useState(null); // gün detay modalı (kim izinde/nöbette)
  const[modNewOT,setModNewOT]=useState(false);
  const[modAddUser,setModAddUser]=useState(false);
  const[modEditUser,setModEditUser]=useState(null);
  const[toast,setToast]=useState(null);
  const[submitting,setSubmitting]=useState(false);
  const[otForm,setOtForm]=useState({date:"",startTime:"17:00",endTime:"",otType:"evening",desc:""});
  const[otErrors,setOtErrors]=useState([]);
  const[nUser,setNUser]=useState({name:"",email:"",password:"",role:"",night:false,userRole:"personnel",buildingId:""});
  const descRef=useRef(null);
  const[showDatePicker,setShowDatePicker]=useState(false);
  const[showStartTP,setShowStartTP]=useState(false);
  const[showEndTP,setShowEndTP]=useState(false);
  const[showPWA,setShowPWA]=useState(false);
  const[showNotifs,setShowNotifs]=useState(false);
  // Faults
  const[faults,setFaults]=useState([]);
  const[faultServices,setFaultServices]=useState([]);
  const[faultVotes,setFaultVotes]=useState([]);
  const[selFault,setSelFault]=useState(null);
  const[modNewFault,setModNewFault]=useState(false);
  const[faultForm,setFaultForm]=useState({title:"",location:"",description:"",detected_date:"",photos:[],services:[],fault_type:"service",material_needed:""});
  const[faultPhotoFiles,setFaultPhotoFiles]=useState([]);
  const[modAddService,setModAddService]=useState(false);
  const[serviceForm,setServiceForm]=useState({service_name:"",visit_date:"",notes:""});
  const[modEditFault,setModEditFault]=useState(null);
  const[showFaultDatePicker,setShowFaultDatePicker]=useState(false);
  const[showServiceDatePicker,setShowServiceDatePicker]=useState(false);
  const[inlineSvcIdx,setInlineSvcIdx]=useState(-1);
  const[showInlineSvcDatePicker,setShowInlineSvcDatePicker]=useState(false);
  const[faultTab,setFaultTab]=useState("active");
  // Stock/Inventory
  const[materials,setMaterials]=useState([]);
  const[stockMovements,setStockMovements]=useState([]);
  const[depoTab,setDepoTab]=useState("stock");
  const[matSearch,setMatSearch]=useState("");
  const[matCategory,setMatCategory]=useState("all");
  const[selMaterial,setSelMaterial]=useState(null);
  const[modNewMat,setModNewMat]=useState(false);
  const[matForm,setMatForm]=useState({name:"",category:"Genel Sarf",unit:"Adet",current_stock:0,min_stock:0,notes:""});
  const[modStockOut,setModStockOut]=useState(null);
  const[stockOutForm,setStockOutForm]=useState({quantity:"",purpose:"",location:""});
  const[modStockIn,setModStockIn]=useState(null);
  const[stockInForm,setStockInForm]=useState({quantity:"",notes:""});
  const[modBulkUpload,setModBulkUpload]=useState(false);
  const[bulkData,setBulkData]=useState([]);
  const[bulkParsed,setBulkParsed]=useState(false);
  const csvRef=useRef(null);
  const MAT_CATS=["Tesisat","Elektrik","Klima/Havalandırma","Sıhhi Tesisat","Boya/İnşaat","Genel Sarf","Diğer"];
  const MAT_UNITS=["Adet","Metre","Kg","Litre","Kutu","Paket","Rulo","Çift","Takım"];
  const[deleteConfirm,setDeleteConfirm]=useState(null);
  const[editOT,setEditOT]=useState(null);
  const[showEditStartTP,setShowEditStartTP]=useState(false);
  const[showEditEndTP,setShowEditEndTP]=useState(false);
  const[leaveReason,setLeaveReason]=useState("");
  // Hourly leave
  const[hourlyMode,setHourlyMode]=useState(false);
  const[hourlyForm,setHourlyForm]=useState({date:"",startTime:"",endTime:"",reason:""});
  const[showHourlyDatePicker,setShowHourlyDatePicker]=useState(false);
  const[showHourlyStartTP,setShowHourlyStartTP]=useState(false);
  const[showHourlyEndTP,setShowHourlyEndTP]=useState(false);
  // Leave document photo
  const now=new Date();
  const[calY,setCalY]=useState(now.getFullYear());
  const[calM,setCalM]=useState(now.getMonth());
  const[calSel,setCalSel]=useState([]);
  const[calMode,setCalMode]=useState("view");
  const[leaveSource,setLeaveSource]=useState("overtime"); // 'overtime' or 'annual'
  const[calModId,setCalModId]=useState(null);
  const[expandedPast,setExpandedPast]=useState(null);

  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(null),3500);return()=>clearTimeout(t);}},[toast]);

  const fetchProfiles=useCallback(async()=>{try{const{data}=await supabase.from('profiles').select('*');if(Array.isArray(data))setProfilesState(data);}catch(e){console.error(e);}},[]);
  const fetchOvertimes=useCallback(async()=>{try{const{data}=await supabase.from('overtimes').select('*').order('work_date',{ascending:false});if(Array.isArray(data))setOvertimesState(data);}catch(e){console.error(e);}},[]);
  const fetchLeaves=useCallback(async()=>{try{const{data}=await supabase.from('leaves').select('*').order('created_at',{ascending:false});if(Array.isArray(data))setLeavesState(data);}catch(e){console.error(e);}},[]);
  const fetchFaults=useCallback(async()=>{try{const{data}=await supabase.from('faults').select('id,title,location,description,detected_date,fault_type,material_needed,status,building_id,created_by,resolved_date,created_at').order('detected_date',{ascending:false});if(Array.isArray(data))setFaults(data);}catch(e){console.error(e);}},[]);
  const fetchFaultServices=useCallback(async()=>{try{const{data}=await supabase.from('fault_services').select('*').order('visit_date',{ascending:false});if(Array.isArray(data))setFaultServices(data);}catch(e){console.error(e);}},[]);
  const fetchFaultVotes=useCallback(async()=>{try{const{data,error}=await supabase.from('fault_votes').select('*').in('vote_week',[getVoteWeek(),getPrevVoteWeek()]).order('created_at',{ascending:false}).limit(1000);if(!error&&Array.isArray(data))setFaultVotes(data);}catch(e){console.error(e);}},[]); 
  const fetchMaterials=useCallback(async()=>{try{const{data}=await supabase.from('materials').select('*').order('name');if(Array.isArray(data))setMaterials(data);}catch(e){console.error(e);}},[]);
  const fetchStockMovements=useCallback(async()=>{try{const{data}=await supabase.from('stock_movements').select('*').order('movement_date',{ascending:false});if(Array.isArray(data))setStockMovements(data);}catch(e){console.error(e);}},[]);
  const fetchBuildings=useCallback(async()=>{try{const{data}=await supabase.from('buildings').select('*').order('name');if(Array.isArray(data))setBuildings(data);}catch(e){console.error(e);}},[]);

  // Silent refresh (no loading screen) for TOKEN_REFRESHED events
  const silentRefresh=useCallback(async(uid)=>{
    try{
      const r=await Promise.allSettled([
        supabase.from('profiles').select('*'),supabase.from('overtimes').select('*').order('work_date',{ascending:false}),
        supabase.from('leaves').select('*').order('created_at',{ascending:false}),supabase.from('buildings').select('*').order('name'),
        supabase.from('faults').select('id,title,location,description,detected_date,fault_type,material_needed,status,building_id,created_by,resolved_date,created_at').order('detected_date',{ascending:false}),supabase.from('fault_services').select('*').order('visit_date',{ascending:false}),
        supabase.from('fault_votes').select('*').in('vote_week',[getVoteWeek(),getPrevVoteWeek()]).order('created_at',{ascending:false}).limit(1000),supabase.from('materials').select('*').order('name'),
        supabase.from('stock_movements').select('*').order('movement_date',{ascending:false}).limit(200)
      ]);
      const profs=toArr(r[0].status==="fulfilled"?r[0].value:null);
      if(profs.length>0){
        setProfilesState(profs);setOvertimesState(toArr(r[1].status==="fulfilled"?r[1].value:null));
        setLeavesState(toArr(r[2].status==="fulfilled"?r[2].value:null));setBuildings(toArr(r[3].status==="fulfilled"?r[3].value:null));
        const fp=profs.find(p=>p.id===uid);if(fp){setProfile(fp);}
      }
      if(r[4].status==="fulfilled"){const d=toArr(r[4].value);if(d.length>0)setFaults(d);}
      if(r[5].status==="fulfilled"){const d=toArr(r[5].value);if(d.length>0)setFaultServices(d);}
      if(r[6].status==="fulfilled"){const d=toArr(r[6].value);if(d.length>0)setFaultVotes(d);}
      if(r[7].status==="fulfilled"){const d=toArr(r[7].value);if(d.length>0)setMaterials(d);}
      if(r[8].status==="fulfilled"){const d=toArr(r[8].value);if(d.length>0)setStockMovements(d);}
    }catch(e){console.error("silentRefresh err:",e);}
  },[]);

  const loadingRef=useRef(false);
  const loadData=useCallback(async(uid)=>{
    if(loadingRef.current)return;
    loadingRef.current=true;
    setLoading(true);setLoadError(null);
    // Önbellek varsa ekranı ANINDA doldur (arıza/depo/onay sayaçları dahil), ağ arkada tazeler
    const cc=cacheGet();
    if(cc&&Array.isArray(cc.profiles)&&cc.profiles.length>0){
      const cfp=cc.profiles.find(p=>p.id===uid);
      if(cfp){
        setProfilesState(cc.profiles);
        if(Array.isArray(cc.overtimes))setOvertimesState(cc.overtimes);
        if(Array.isArray(cc.leaves))setLeavesState(cc.leaves);
        if(Array.isArray(cc.buildings))setBuildings(cc.buildings);
        if(Array.isArray(cc.faults))setFaults(cc.faults);
        if(Array.isArray(cc.faultServices))setFaultServices(cc.faultServices);
        if(Array.isArray(cc.materials))setMaterials(cc.materials);
        if(Array.isArray(cc.stockMovements))setStockMovements(cc.stockMovements);
        if(Array.isArray(cc.nobet))setNobetState(cc.nobet);
        setProfile(cfp);
        if(!selBuilding)setSelBuilding(cfp.building_id||cc.buildings?.[0]?.id||null);
        setLoading(false); // yükleme ekranı yok, taze veri arkada gelecek
      }
    }
    const safetyTimer=setTimeout(()=>{setLoading(false);loadingRef.current=false;},15000);
    // Start BOTH groups simultaneously (before try block for correct scoping)
    const criticalP=Promise.allSettled([
      supabase.from('profiles').select('*'),
      supabase.from('overtimes').select('*').order('work_date',{ascending:false}),
      supabase.from('leaves').select('*').order('created_at',{ascending:false}),
      supabase.from('buildings').select('*').order('name')
    ]);
    const secondaryP=Promise.allSettled([
      supabase.from('faults').select('id,title,location,description,detected_date,fault_type,material_needed,status,building_id,created_by,resolved_date,created_at').order('detected_date',{ascending:false}),
      supabase.from('fault_services').select('*').order('visit_date',{ascending:false}),
      supabase.from('fault_votes').select('*').in('vote_week',[getVoteWeek(),getPrevVoteWeek()]).order('created_at',{ascending:false}).limit(1000),
      supabase.from('materials').select('*').order('name'),
      supabase.from('stock_movements').select('*').order('movement_date',{ascending:false}).limit(200),
      supabase.from('nobet_devir').select('*')
    ]);
    try{
      const r1=await criticalP;
      const profs=toArr(r1[0].status==="fulfilled"?r1[0].value:null);
      setProfilesState(profs);
      setOvertimesState(toArr(r1[1].status==="fulfilled"?r1[1].value:null));
      setLeavesState(toArr(r1[2].status==="fulfilled"?r1[2].value:null));
      const blds=toArr(r1[3].status==="fulfilled"?r1[3].value:null);
      setBuildings(blds);
      const fp=profs.find(p=>p.id===uid);setProfile(fp||null);
      if(fp&&blds.length>0&&!selBuilding){setSelBuilding(fp.building_id||blds[0]?.id||null);}
      if(profs.length>0)cacheSave({profiles:profs,overtimes:toArr(r1[1].status==="fulfilled"?r1[1].value:null),leaves:toArr(r1[2].status==="fulfilled"?r1[2].value:null),buildings:blds});
      if(!fp&&!window.__RETRIED){
        window.__RETRIED=true;loadingRef.current=false;
        setTimeout(async()=>{try{await supabase.auth.refreshSession();}catch(e){}setTimeout(()=>{loadData(uid);},500);},1500);
      }
    }catch(err){setLoadError("Bağlantı hatası");}finally{clearTimeout(safetyTimer);setLoading(false);loadingRef.current=false;}
    // Secondary already running - just await results (no loading screen)
    try{
      const r2=await secondaryP;
      if(r2[0].status==="fulfilled"){const d=toArr(r2[0].value);if(d.length>0)setFaults(d);}
      if(r2[1].status==="fulfilled"){const d=toArr(r2[1].value);if(d.length>0)setFaultServices(d);}
      if(r2[2].status==="fulfilled"){const d=toArr(r2[2].value);if(d.length>0)setFaultVotes(d);}
      if(r2[3].status==="fulfilled"){const d=toArr(r2[3].value);if(d.length>0)setMaterials(d);}
      if(r2[4].status==="fulfilled"){const d=toArr(r2[4].value);if(d.length>0)setStockMovements(d);}
      if(r2[5].status==="fulfilled"){const d=toArr(r2[5].value);if(d.length>0)setNobetState(d);}
      cacheSave({faults:toArr(r2[0].status==="fulfilled"?r2[0].value:null),faultServices:toArr(r2[1].status==="fulfilled"?r2[1].value:null),materials:toArr(r2[3].status==="fulfilled"?r2[3].value:null),stockMovements:toArr(r2[4].status==="fulfilled"?r2[4].value:null),nobet:toArr(r2[5].status==="fulfilled"?r2[5].value:null)});
      // Retry fault_votes if empty (egress limit might have blocked it)
      const votesLoaded=toArr(r2[2].status==="fulfilled"?r2[2].value:null);
      if(votesLoaded.length===0){
        setTimeout(async()=>{try{const{data,error}=await supabase.from('fault_votes').select('*').in('vote_week',[getVoteWeek(),getPrevVoteWeek()]).order('created_at',{ascending:false}).limit(1000);if(!error&&Array.isArray(data))setFaultVotes(data);}catch(e){}},3000);
      }
    }catch(e){}
  },[]);

  useEffect(()=>{
    let m=true,sub=null,initDone=false;
    window.__RETRIED=false;
    // 1) Explicit session check
    const init=async()=>{
      try{
        const{data,error}=await supabase.auth.getSession();
        if(!m)return;
        if(error){setLoading(false);return;}
        const s=data?.session||null;
        setSession(s);
        if(s?.user?.id){await loadData(s.user.id);initDone=true;}
        else{setLoading(false);}
      }catch(e){if(m){setLoading(false);}}
    };
    // 2) Auth state listener
    try{
      const{data}=supabase.auth.onAuthStateChange((event,s)=>{
        if(!m)return;
        setSession(s);
        if(event==='SIGNED_IN'&&s?.user?.id&&!initDone){loadData(s.user.id);}
        else if(event==='TOKEN_REFRESHED'&&s?.user?.id){silentRefresh(s.user.id);}
        else if(event==='SIGNED_OUT'){setProfile(null);setLoading(false);cacheClear();}
      });
      sub=data?.subscription;
    }catch(e){}
    init();
    return()=>{m=false;try{sub?.unsubscribe();}catch(e){}};
  },[loadData,silentRefresh]);

  useEffect(()=>{
    if(!session)return;let subs=[],m=true;
    const s=async()=>{
      try{const c=await subscribeToChanges('overtimes',()=>{if(m)fetchOvertimes();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('leaves',()=>{if(m)fetchLeaves();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('profiles',()=>{if(m)fetchProfiles();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('faults',()=>{if(m)fetchFaults();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('fault_services',()=>{if(m)fetchFaultServices();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('fault_votes',()=>{if(m)fetchFaultVotes();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('materials',()=>{if(m)fetchMaterials();});if(c)subs.push(c);}catch(e){}
      try{const c=await subscribeToChanges('stock_movements',()=>{if(m){fetchStockMovements();fetchMaterials();}});if(c)subs.push(c);}catch(e){}
    };s();return()=>{m=false;subs.forEach(s=>{try{s?.unsubscribe();}catch(e){}});};
  },[session,fetchOvertimes,fetchLeaves,fetchProfiles,fetchFaults,fetchFaultServices,fetchFaultVotes,fetchMaterials,fetchStockMovements]);

  const isAdmin=profile?.user_role==="admin";
  const isChef=profile?.user_role==="chef";
  const isViewer=profile?.user_role==="viewer";
  const isPerso=profile?.user_role==="personnel";
  const canApprove=isAdmin||isChef;
  const canSwitchBuilding=isAdmin||isChef||isViewer;
  // O(1) profile lookup map
  const profileMap=useMemo(()=>{const m=new Map();profiles.forEach(p=>m.set(p.id,p));return m;},[profiles]);
  // Building-scoped data (memoized)
  const bProfiles=useMemo(()=>profiles.filter(p=>!selBuilding||p.building_id===selBuilding),[profiles,selBuilding]);
  const bOvertimes=useMemo(()=>overtimes.filter(o=>{const p=profileMap.get(o.personnel_id);return !selBuilding||p?.building_id===selBuilding;}),[overtimes,profileMap,selBuilding]);
  const bLeaves=useMemo(()=>leavesState.filter(l=>{const p=profileMap.get(l.personnel_id);return !selBuilding||p?.building_id===selBuilding;}),[leavesState,profileMap,selBuilding]);
  const bFaults=useMemo(()=>faults.filter(f=>!selBuilding||f.building_id===selBuilding),[faults,selBuilding]);
  const bMaterials=useMemo(()=>materials.filter(m=>!selBuilding||m.building_id===selBuilding),[materials,selBuilding]);
  const materialMap=useMemo(()=>{const m=new Map();materials.forEach(mt=>m.set(mt.id,mt));return m;},[materials]);
  const bStockMovements=useMemo(()=>stockMovements.filter(mv=>{const mat=materialMap.get(mv.material_id);return !selBuilding||mat?.building_id===selBuilding;}),[stockMovements,materialMap,selBuilding]);
  const curBuildingName=useMemo(()=>buildings.find(b=>b.id===selBuilding)?.short_name||"",[buildings,selBuilding]);

  function getU(id){return profileMap.get(id);}
  // Building-scoped helpers (for dashboard/approvals - shows selected building's data)
  const isOTLeave=(l)=>!l.leave_source||l.leave_source==="overtime";
  const isAnnualLeave=(l)=>l.leave_source==="annual";
  function totLH(pid){return bOvertimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.leave_hours||0),0);}
  function totUsedLV(pid){return bLeaves.filter(l=>l.personnel_id===pid&&isOTLeave(l)&&["approved","pending_chef","pending_manager"].includes(l.status)).reduce((s,l)=>s+(l.total_hours||0),0);}
  function remHours(pid){return Math.round((totLH(pid)-totUsedLV(pid))*10)/10;}
  function totOTH(pid){return bOvertimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.hours||0),0);}
  function remDays(pid){return Math.round((remHours(pid)/8)*10)/10;}
  function debtDays(pid){const r=remDays(pid);return r<0?Math.abs(r):0;}
  function pendCount(pid){return bOvertimes.filter(o=>o.personnel_id===pid&&["pending_chef","pending_manager"].includes(o.status)).length+bLeaves.filter(l=>l.personnel_id===pid&&["pending_chef","pending_manager"].includes(l.status)).length;}
  // Annual leave helpers
  function annualDays(pid){const p=getU(pid);return p?.annual_leave_days||14;}
  function annualUsed(pid){return bLeaves.filter(l=>l.personnel_id===pid&&isAnnualLeave(l)&&["approved","pending_chef","pending_manager"].includes(l.status)).reduce((s,l)=>{const d=Array.isArray(l.dates)?l.dates.length:0;return s+d;},0);}
  function annualRemaining(pid){return annualDays(pid)-annualUsed(pid);}
  // Global helpers (for user's own summary - always shows own data regardless of building)
  function myTotLH(pid){return overtimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.leave_hours||0),0);}
  function myTotUsedLV(pid){return leavesState.filter(l=>l.personnel_id===pid&&isOTLeave(l)&&["approved","pending_chef","pending_manager"].includes(l.status)).reduce((s,l)=>s+(l.total_hours||0),0);}
  function myRemHours(pid){return Math.round((myTotLH(pid)-myTotUsedLV(pid))*10)/10;}
  function myTotOTH(pid){return overtimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.hours||0),0);}
  function yearlyOTH(pid){const yr=String(new Date().getFullYear());return overtimes.filter(o=>o.personnel_id===pid&&o.status==="approved"&&(o.work_date||"").startsWith(yr)).reduce((s,o)=>s+Number(o.hours||0),0);}
  function yearlyOTPct(pid){return Math.round((yearlyOTH(pid)/YEARLY_OT_LIMIT)*100);}
  function myRemDays(pid){return Math.round((myRemHours(pid)/8)*10)/10;}
  function myDebtDays(pid){const r=myRemDays(pid);return r<0?Math.abs(r):0;}
  function myAnnualDays(){return profile?.annual_leave_days||14;}
  function myAnnualUsed(){return leavesState.filter(l=>l.personnel_id===profile?.id&&isAnnualLeave(l)&&["approved","pending_chef","pending_manager"].includes(l.status)).reduce((s,l)=>{const d=Array.isArray(l.dates)?l.dates.length:0;return s+d;},0);}
  function myAnnualRemaining(){return myAnnualDays()-myAnnualUsed();}

  async function doLogin(){setLoginErr("");try{const{error}=await signIn(login.email,login.password);if(error)setLoginErr("Giriş başarısız: "+error.message);}catch(e){setLoginErr("Bağlantı hatası");}}
  async function doLogout(){try{await signOut();}catch(e){}setProfile(null);setPage("dashboard");setSelPerson(null);}
  async function doApproveOT(id,lvl){try{const up=lvl==="chef"?{approved_by_chef:true,status:"pending_manager"}:{approved_by_chef:true,approved_by_manager:true,status:"approved"};await updateOvertime(id,up);await fetchOvertimes();setToast("✓ Mesai onaylandı");}catch(e){setToast("Hata: "+e?.message);}}
  async function doRejectOT(id){try{await updateOvertime(id,{status:"rejected"});await fetchOvertimes();setToast("Reddedildi");}catch(e){setToast("Hata: "+e?.message);}}
  async function doApproveLV(id,lvl){try{const up=lvl==="chef"?{approved_by_chef:true,status:"pending_manager"}:{approved_by_chef:true,approved_by_manager:true,status:"approved"};await updateLeave(id,up);await fetchLeaves();setToast("✓ İzin onaylandı");}catch(e){setToast("Hata: "+e?.message);}}
  async function doRejectLV(id){try{await updateLeave(id,{status:"rejected"});await fetchLeaves();setToast("Reddedildi");}catch(e){setToast("Hata: "+e?.message);}}

  async function doDeleteOT(id){
    setSubmitting(true);
    try{const{error}=await supabase.from('overtimes').delete().eq('id',id);if(error)throw error;await fetchOvertimes();setDeleteConfirm(null);setSelOT(null);setToast("Mesai kaydi silindi");}
    catch(e){setToast("Silinemedi: "+(e?.message||"Hata"));}
    setSubmitting(false);
  }

  async function doDeleteLV(id){
    setSubmitting(true);
    try{const{error}=await supabase.from('leaves').delete().eq('id',id);if(error)throw error;await fetchLeaves();setDeleteConfirm(null);setSelLV(null);setToast("🗑 İzin talebi silindi");}
    catch(e){setToast("Silinemedi: "+(e?.message||"Hata"));}
    setSubmitting(false);
  }

  async function doEditOT(){
    if(!editOT)return;
    const hours=calcOT(editOT.start_time,editOT.end_time,editOT.ot_type);
    if(hours<=0){setToast("⚠ Geçerli saat girin");return;}
    setSubmitting(true);
    try{
      await updateOvertime(editOT.id,{start_time:editOT.start_time,end_time:editOT.end_time,hours,leave_hours:calcLH(hours)});
      await fetchOvertimes();
      setSelOT({...selOT,start_time:editOT.start_time,end_time:editOT.end_time,hours,leave_hours:calcLH(hours)});
      setEditOT(null);
      setToast(`✓ Mesai düzeltildi: ${hours}s → ${calcLH(hours)}s izin`);
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function submitOT(){
    const currentDesc=descRef.current?descRef.current.value:otForm.desc;
    const errors=[];
    if(!otForm.date)errors.push("Tarih seçilmedi");
    if(!otForm.startTime||!otForm.endTime)errors.push("Saat bilgisi eksik");
    const hours=calcOT(otForm.startTime,otForm.endTime,otForm.otType);
    if(hours<=0)errors.push(otForm.otType==="daytime"?"Geçerli saat aralığı girin":"Mesai 17:00 sonrası olmalı");
    if(!currentDesc||currentDesc.trim().length<20)errors.push("Açıklama zorunlu (min 20 karakter)");
    if(errors.length){setOtErrors(errors);return;}
    setSubmitting(true);
    try{
      await supabase.from('overtimes').insert({personnel_id:profile.id,work_date:otForm.date,start_time:otForm.startTime,end_time:otForm.endTime,hours,leave_hours:calcLH(hours),overtime_type:otForm.otType||"evening",description:currentDesc.trim(),status:isChef?"pending_manager":"pending_chef",approved_by_chef:isChef}).throwOnError();
      await fetchOvertimes();
      setOtForm({date:"",startTime:"17:00",endTime:"",otType:"evening",desc:""});
      setOtErrors([]);setModNewOT(false);
      setToast(`${hours}s mesai - ${calcLH(hours)}s izin hakkı onaya gönderildi`);
    }catch(e){setToast("Gönderim hatası: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function submitLeaveReq(){
    if(calSel.length===0){setToast("⚠ Gün seçin");return;}
    
    if(leaveSource==="annual"){
      // Annual leave
      const remaining=myAnnualRemaining();
      if(calSel.length>remaining){setToast(`⚠ Yıllık izin hakkınız ${remaining} gün, ${calSel.length} gün seçtiniz`);return;}
      setSubmitting(true);
      try{
        await createLeave({personnel_id:profile.id,dates:calSel.sort(),total_hours:calSel.length*8,reason:`[Yıllık İzin] ${leaveReason.trim()||"Yıllık izin"}`,leave_type:"daily",leave_source:"annual",status:isChef?"pending_manager":"pending_chef",approved_by_chef:isChef});
        await fetchLeaves();setCalSel([]);setCalMode("view");setLeaveReason("");
        setToast(`🌴 ${calSel.length} günlük yıllık izin onaya gönderildi`);
      }catch(e){setToast("Hata: "+(e?.message||""));}
      setSubmitting(false);
      return;
    }
    
    // Overtime leave (existing logic)
    const needH=calSel.length*8,rH=myRemHours(profile.id),willDebt=rH<needH;
    if(willDebt&&(!leaveReason||leaveReason.trim().length<10)){setToast("⚠ Borçlanma durumu var - izin sebebini yazın (min 10 karakter)");return;}
    setSubmitting(true);
    try{
      const reason=willDebt?`${leaveReason.trim()} (${Math.round((needH-rH)/8*10)/10} gün borçlanma)`:(leaveReason.trim()||"Fazla mesai karşılığı izin");
      let docUrl=null;
      await createLeave({personnel_id:profile.id,dates:calSel.sort(),total_hours:needH,reason,leave_type:"daily",leave_source:"overtime",leave_doc_url:docUrl,status:isChef?"pending_manager":"pending_chef",approved_by_chef:isChef});
      await fetchLeaves();setCalSel([]);setCalMode("view");setLeaveReason("");
      setToast(willDebt?`${calSel.length} gun izin gönderildi (borclanma dahil)`:`${calSel.length} gunluk izin onaya gönderildi`);
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function submitHourlyLeave(){
    const errors=[];
    if(!hourlyForm.date)errors.push("Tarih seçilmedi");
    if(!hourlyForm.startTime)errors.push("Çıkış saati seçilmedi");
    if(!hourlyForm.endTime)errors.push("Dönüş saati seçilmedi");
    if(!hourlyForm.reason||hourlyForm.reason.trim().length<10)errors.push("Sebep zorunlu (min 10 karakter)");
    // Calc hours
    const[sh,sm]=(hourlyForm.startTime||"0:0").split(":").map(Number);
    const[eh,em]=(hourlyForm.endTime||"0:0").split(":").map(Number);
    let totalMin=(eh*60+em)-(sh*60+sm);
    if(totalMin<=0){errors.push("Bitiş saati başlangıçtan sonra olmalı");}
    if(errors.length){setToast("⚠ "+errors[0]);return;}
    const totalH=Math.round(totalMin/60*10)/10;
    setSubmitting(true);
    try{
      let docUrl=null;
      await createLeave({personnel_id:profile.id,dates:[hourlyForm.date],total_hours:totalH,reason:`[Saatlik İzin] ${hourlyForm.startTime}-${hourlyForm.endTime} (${totalH}s) - ${hourlyForm.reason.trim()}`,leave_type:"hourly",leave_start_time:hourlyForm.startTime,leave_end_time:hourlyForm.endTime,leave_doc_url:docUrl,status:isChef?"pending_manager":"pending_chef",approved_by_chef:isChef});
      await fetchLeaves();
      setHourlyForm({date:"",startTime:"",endTime:"",reason:""});
      setHourlyMode(false);
      setToast(`✓ ${totalH} saatlik izin talebi onaya gönderildi`);
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function modifyLeave(){
    if(calSel.length===0){setToast("Yeni tarihleri seçin");return;}
    const lv=leavesState.find(l=>l.id===calModId);if(!lv)return;
    setSubmitting(true);
    try{await updateLeave(calModId,{previous_dates:lv.dates,dates:calSel.sort(),total_hours:calSel.length*8,status:isChef?"pending_manager":"pending_chef",approved_by_chef:isChef,approved_by_manager:false});await fetchLeaves();setCalSel([]);setCalMode("view");setCalModId(null);setToast("Tarihler değiştirildi");}catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  function startModLV(lv){setCalModId(lv.id);setCalSel(Array.isArray(lv.dates)?[...lv.dates]:[]);setCalMode("modify");setSelLV(null);try{const f=new Date(lv.dates[0]+'T00:00:00');setCalY(f.getFullYear());setCalM(f.getMonth());}catch(e){}setPage("calendar");}

  async function doAddUser(){
    if(!nUser.name||!nUser.email||!nUser.password||!nUser.role){setToast("Tum alanlari doldurun");return;}
    setSubmitting(true);
    try{const{data,error}=await supabase.auth.signUp({email:nUser.email,password:nUser.password});if(error)throw error;if(data?.user)await supabase.from('profiles').insert({id:data.user.id,username:nUser.email.split('@')[0],full_name:nUser.name,role:nUser.role,user_role:nUser.userRole,night_shift:nUser.night,active:true,building_id:nUser.buildingId||selBuilding});await fetchProfiles();setNUser({name:"",email:"",password:"",role:"",night:false,userRole:"personnel",buildingId:""});setModAddUser(false);setToast("Personel eklendi");}catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }
  async function doDeactivateU(uid){try{await supabase.from('profiles').update({active:false}).eq('id',uid);await fetchProfiles();setToast("Pasif");setModEditUser(null);}catch(e){setToast("Hata: "+e?.message);}}
  async function doDeleteUser(uid){try{await supabase.from('profiles').delete().eq('id',uid);try{await supabase.auth.admin.deleteUser(uid);}catch(e){}await fetchProfiles();setToast("🗑 Personel silindi (kayıtlar arşivde)");setModEditUser(null);setDeleteConfirm(null);}catch(e){setToast("Hata: "+e?.message);}}
  async function doReactivateU(uid){try{await supabase.from('profiles').update({active:true}).eq('id',uid);await fetchProfiles();setToast("Aktif");}catch(e){setToast("Hata: "+e?.message);}}

  const S={
    app:{fontFamily:"-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",background:C.bg,color:C.text,minHeight:"100vh",maxWidth:480,margin:"0 auto",position:"relative",paddingBottom:80,WebkitTapHighlightColor:"transparent",WebkitTextSizeAdjust:"100%"},
    hdr:{background:"linear-gradient(135deg,#1e1b4b,#312e81)",padding:"16px",borderBottom:`1px solid ${C.border}`},
    nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,display:"flex",background:C.card,borderTop:`1px solid ${C.border}`,zIndex:100,paddingBottom:"env(safe-area-inset-bottom,0px)"},
    navB:(a)=>({flex:1,padding:"10px 0 8px",border:"none",background:"none",color:a?C.accent:C.muted,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,fontSize:10,fontWeight:a?700:500,position:"relative",WebkitTapHighlightColor:"transparent"}),
    dot:{position:"absolute",top:6,right:"50%",transform:"translateX(14px)",width:6,height:6,borderRadius:"50%",background:C.red},
    cnt:{padding:16},
    crd:{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,padding:14,marginBottom:10,cursor:"pointer",WebkitTapHighlightColor:"transparent"},
    av:(bg,sz)=>({width:sz||40,height:sz||40,minWidth:sz||40,borderRadius:10,background:bg||C.accentD,display:"flex",alignItems:"center",justifyContent:"center",fontSize:sz?Math.round(sz*0.38):15,fontWeight:700,flexShrink:0}),
    btn:(bg,clr)=>({padding:"12px 20px",border:"none",borderRadius:10,background:bg,color:clr||"#fff",fontSize:14,fontWeight:600,cursor:"pointer",width:"100%",marginTop:8,boxSizing:"border-box",opacity:submitting?0.6:1,WebkitAppearance:"none"}),
    btnS:(bg,clr)=>({padding:"8px 14px",border:"none",borderRadius:8,background:bg,color:clr||"#fff",fontSize:12,fontWeight:600,cursor:"pointer",WebkitAppearance:"none"}),
    inp:{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:16,outline:"none",boxSizing:"border-box",marginBottom:10,WebkitAppearance:"none"},
    ta:{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:16,outline:"none",minHeight:80,resize:"vertical",boxSizing:"border-box",marginBottom:10,fontFamily:"inherit",WebkitAppearance:"none"},
    lbl:{fontSize:12,color:C.dim,marginBottom:4,display:"block",fontWeight:600},
    mod:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"},
    modC:{background:C.card,borderRadius:"20px 20px 0 0",padding:"20px 16px calc(32px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",WebkitOverflowScrolling:"touch"},
    modH:{width:40,height:4,borderRadius:2,background:C.border,margin:"0 auto 16px"},
    tag:(bg,clr)=>({display:"inline-flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 8px",borderRadius:6,background:bg,color:clr,fontWeight:600}),
    dv:{height:1,background:C.border,margin:"12px 0"},
    tst:{position:"fixed",top:"calc(20px + env(safe-area-inset-top,0px))",left:"50%",transform:"translateX(-50%)",background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 20px",fontSize:13,fontWeight:600,zIndex:400,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",maxWidth:340,textAlign:"center"},
    row:{display:"flex",alignItems:"center",gap:12},
    stB:{display:"flex",gap:6,marginTop:10},
    st:(bg)=>({flex:1,background:bg,borderRadius:8,padding:"8px 6px",textAlign:"center"}),
    sec:{fontSize:15,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:8},

    lawBox:{background:"linear-gradient(135deg,rgba(99,102,241,0.1),rgba(168,85,247,0.1))",border:`1px solid ${C.accent}44`,borderRadius:12,padding:14,marginBottom:12},
    errBox:{background:C.redD,border:`1px solid ${C.red}44`,borderRadius:10,padding:12,marginBottom:12},
    back:{display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:"0 0 12px",fontWeight:600},
    emp:{textAlign:"center",padding:"40px 20px",color:C.muted},
    sel:{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,outline:"none",boxSizing:"border-box",marginBottom:10},
    fInp:{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:16,boxSizing:"border-box",marginBottom:10,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"},
  };

  const pendOTs=useMemo(()=>bOvertimes.filter(o=>(isChef&&o.status==="pending_chef")||(isAdmin&&o.status==="pending_manager")),[bOvertimes,isChef,isAdmin]);
  const pendLVs=useMemo(()=>bLeaves.filter(l=>(isChef&&l.status==="pending_chef")||(isAdmin&&l.status==="pending_manager")),[bLeaves,isChef,isAdmin]);
  const totPend=pendOTs.length+pendLVs.length;
  const allPendOTs=useMemo(()=>bOvertimes.filter(o=>["pending_chef","pending_manager"].includes(o.status)),[bOvertimes]);
  const allPendLVs=useMemo(()=>bLeaves.filter(l=>["pending_chef","pending_manager"].includes(l.status)),[bLeaves]);
  const allPendCount=allPendOTs.length+allPendLVs.length;
  const liveOTH=calcOT(otForm.startTime,otForm.endTime,otForm.otType),liveLH=calcLH(liveOTH);

  // Vote system hooks - MUST be before any early returns (React hooks rules)
  const currentWeek=getVoteWeek();
  const prevWeek=getPrevVoteWeek();
  const votePeriod=getVotePeriodInfo();
  const activeFaultsAll=useMemo(()=>bFaults.filter(f=>f.status==="active"),[bFaults]);
  const myPendingVotes=useMemo(()=>{if(!profile)return[];return activeFaultsAll.filter(f=>!faultVotes.some(v=>v.fault_id===f.id&&v.personnel_id===profile.id&&vwMatch(v.vote_week,currentWeek)));},[activeFaultsAll,faultVotes,profile,currentWeek]);

  // Notification system
  const notifications=useMemo(()=>{
    if(!profile)return[];
    const notifs=[];
    const now=Date.now();
    const sevenDaysAgo=new Date(now-7*24*60*60*1000).toISOString();
    // My recently approved/rejected leaves
    leavesState.filter(l=>l.personnel_id===profile.id&&l.status==="approved"&&(l.updated_at||l.created_at)>sevenDaysAgo).forEach(l=>{
      const isAnn=l.leave_source==="annual";
      const days=Array.isArray(l.dates)?l.dates.length:0;
      notifs.push({id:"la-"+l.id,type:"success",icon:"✅",text:`${isAnn?"Yıllık":"Mesai"} izniniz onaylandı (${days}g)`,time:l.updated_at||l.created_at});
    });
    leavesState.filter(l=>l.personnel_id===profile.id&&l.status==="rejected"&&(l.updated_at||l.created_at)>sevenDaysAgo).forEach(l=>{
      notifs.push({id:"lr-"+l.id,type:"error",icon:"❌",text:"İzin talebiniz reddedildi",time:l.updated_at||l.created_at});
    });
    // My recently approved/rejected overtimes
    overtimes.filter(o=>o.personnel_id===profile.id&&o.status==="approved"&&(o.updated_at||o.created_at)>sevenDaysAgo).forEach(o=>{
      notifs.push({id:"oa-"+o.id,type:"success",icon:"✅",text:`Mesai onaylandı (${o.hours}s → ${o.leave_hours}s izin)`,time:o.updated_at||o.created_at});
    });
    overtimes.filter(o=>o.personnel_id===profile.id&&o.status==="rejected"&&(o.updated_at||o.created_at)>sevenDaysAgo).forEach(o=>{
      notifs.push({id:"or-"+o.id,type:"error",icon:"❌",text:"Mesai talebiniz reddedildi",time:o.updated_at||o.created_at});
    });
    // Pending approvals (chef/admin)
    if(isChef||isAdmin){
      const pc=pendOTs.length+pendLVs.length;
      if(pc>0)notifs.push({id:"pend",type:"warning",icon:"⏳",text:`${pc} onay bekleyen talep var`,time:new Date().toISOString()});
    }
    // Vote reminder
    if(myPendingVotes.length>0)notifs.push({id:"vote",type:"warning",icon:"🗳",text:`${myPendingVotes.length} arıza için oy bekleniyor`,time:new Date().toISOString()});
    // Low stock (chef/admin)
    if((isChef||isAdmin)&&bMaterials.filter(m=>m.current_stock<=m.min_stock&&m.min_stock>0).length>0)notifs.push({id:"stock",type:"error",icon:"📦",text:`${bMaterials.filter(m=>m.current_stock<=m.min_stock&&m.min_stock>0).length} malzeme kritik seviyede`,time:new Date().toISOString()});
    // Sort by time desc
    return notifs.sort((a,b)=>(b.time||"").localeCompare(a.time||""));
  },[profile,leavesState,overtimes,pendOTs,pendLVs,myPendingVotes,bMaterials,isChef,isAdmin]);

  const unreadNotifs=useMemo(()=>{
    try{const lastSeen=localStorage.getItem("notif_seen")||"";return notifications.filter(n=>n.time>lastSeen).length;}catch(e){return notifications.length;}
  },[notifications]);

  // Diagnostic: log state types so ErrorBoundary can display them
  useEffect(()=>{
    try{
      const d=[];
      d.push("profiles: "+(Array.isArray(profiles)?"Array("+profiles.length+")":typeof profiles+" "+String(profiles).slice(0,50)));
      d.push("overtimes: "+(Array.isArray(overtimes)?"Array("+overtimes.length+")":typeof overtimes+" "+String(overtimes).slice(0,50)));
      d.push("leavesState: "+(Array.isArray(leavesState)?"Array("+leavesState.length+")":typeof leavesState+" "+String(leavesState).slice(0,50)));
      d.push("buildings: "+(Array.isArray(buildings)?"Array("+buildings.length+")":typeof buildings+" "+String(buildings).slice(0,50)));
      d.push("faults: "+(Array.isArray(faults)?"Array("+faults.length+")":typeof faults+" "+String(faults).slice(0,50)));
      d.push("faultVotes: "+(Array.isArray(faultVotes)?"Array("+faultVotes.length+")":typeof faultVotes+" "+String(faultVotes).slice(0,50)));
      d.push("materials: "+(Array.isArray(materials)?"Array("+materials.length+")":typeof materials+" "+String(materials).slice(0,50)));
      d.push("profile: "+(profile?"id:"+String(profile.id).slice(0,8)+".. name:"+String(profile.full_name):"null"));
      window.__DIAG=d.join("\n");
    }catch(e){window.__DIAG="diag error: "+String(e);}
  });

  if(loading)return(<div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><div style={{textAlign:"center"}}><div style={{fontSize:40,marginBottom:16}}>🔧</div><div style={{color:C.dim}}>Yükleniyor...</div><div style={{fontSize:10,color:"#475569",marginTop:20}}>v5.3</div></div></div>);
  if(loadError&&!session)return(<div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><div style={{textAlign:"center",padding:24}}><div style={{fontSize:40,marginBottom:16}}>⚠️</div><div style={{color:C.dim,marginBottom:16}}>{loadError}</div><button style={S.btn(C.accent)} onClick={()=>window.location.reload()}>Yenile</button></div></div>);

  if(!session)return(
    <div style={S.app}><div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:24}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{width:72,height:72,borderRadius:18,background:"linear-gradient(135deg,#4f46e5,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 16px",boxShadow:"0 8px 32px rgba(99,102,241,0.3)"}}>🔧</div>
        <div style={{fontSize:22,fontWeight:800}}>İBB Teknik Takip</div>
        <div style={{fontSize:13,color:C.dim,marginTop:4}}>Fazla Mesai & İzin Yonetimi</div>
      </div>
      <div style={{background:C.card,borderRadius:16,border:`1px solid ${C.border}`,padding:20}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:16,textAlign:"center"}}>Giris Yap</div>
        <div style={S.lbl}>E-posta</div>
        <input style={S.inp} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="ornek@ibb.gov.tr" value={login.email} onChange={e=>setLogin(p=>({...p,email:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doLogin()} autoComplete="email"/>
        <div style={S.lbl}>Sifre</div>
        <div style={{position:"relative"}}>
          <input style={{...S.inp,paddingRight:48}} type={showPwd?"text":"password"} placeholder="Şifreniz" value={login.password} onChange={e=>setLogin(p=>({...p,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doLogin()} autoComplete="current-password"/>
          <button onClick={()=>setShowPwd(!showPwd)} style={{position:"absolute",right:10,top:10,background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:18,padding:4}}>{showPwd?"🙈":"👁"}</button>
        </div>
        {loginErr&&<div style={{color:C.red,fontSize:13,marginBottom:10,textAlign:"center"}}>{loginErr}</div>}
        <button style={S.btn("linear-gradient(135deg,#4f46e5,#7c3aed)")} onClick={doLogin}>Giris Yap</button>
      </div>
    </div>{toast&&<div style={S.tst}>{toast}</div>}</div>
  );

  if(!profile){
    // Auto-retry after 2s - token might still be refreshing
    if(session?.user?.id&&!window.__autoRetried){
      window.__autoRetried=true;
      setTimeout(()=>{if(session?.user?.id)loadData(session.user.id);},2500);
    }
    return(<div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><div style={{textAlign:"center",padding:24}}>
    <div style={{fontSize:40,marginBottom:16}}>⏳</div>
    <div style={{color:C.dim,marginBottom:8}}>Profil yükleniyor... Tekrar deneniyor.</div>
    <button style={S.btn(C.accent)} onClick={()=>{window.__autoRetried=false;if(session?.user?.id)loadData(session.user.id);else window.location.reload();}}>Tekrar Dene</button>
    <button style={S.btn(C.red)} onClick={doLogout}>Çıkış Yap + Tekrar Giriş</button>
    <div style={{fontSize:10,color:"#475569",marginTop:20}}>v5.3</div>
    <details style={{marginTop:8,textAlign:"left",fontSize:10,color:"#64748b"}}>
      <summary style={{cursor:"pointer"}}>🔍 Teşhis</summary>
      <pre style={{whiteSpace:"pre-wrap",background:"#161923",padding:8,borderRadius:6,marginTop:6,maxHeight:250,overflow:"auto",fontSize:9}}>{(typeof window!=='undefined'&&window.__LOAD_DEBUG)||"yok"}</pre>
    </details>
  </div></div>);
  }

  const renderPersonDetail=()=>{
    const p=getU(selPerson);if(!p)return<div style={S.emp}>Personel bulunamadi</div>;
    const pOTs=overtimes.filter(o=>o.personnel_id===p.id).sort((a,b)=>(b.work_date||"").localeCompare(a.work_date||""));
    const pLVs=leavesState.filter(l=>l.personnel_id===p.id&&l.status!=="rejected");
    const tOT=totOTH(p.id),tLHV=totLH(p.id),uH=totUsedLV(p.id),rH=remHours(p.id),debt=debtDays(p.id);
    return(<div>
      <button style={S.back} onClick={()=>{setSelPerson(null);setPage("dashboard");}}>&#8592; Geri</button>
      <div style={{...S.crd,background:"linear-gradient(135deg,#1e1b4b,#312e81)",cursor:"default"}}>
        <div style={S.row}><div style={S.av(C.accentD,50)}>{ini(p.full_name)}</div><div><div style={{fontSize:16,fontWeight:700}}>{p.full_name}</div><div style={{fontSize:12,color:C.dim}}>{p.role}{p.night_shift?" 🌙":""}</div></div></div>
        <div style={S.stB}>
          <div style={S.st(C.accentD)}><div style={{fontSize:16,fontWeight:800,color:C.accent}}>{tOT}s</div><div style={{fontSize:9,color:C.dim}}>Çalışılan</div></div>
          <div style={S.st(C.purpleD)}><div style={{fontSize:16,fontWeight:800,color:C.purple}}>{tLHV}s</div><div style={{fontSize:9,color:C.dim}}>İzin Hakkı</div></div>
          <div style={S.st(C.greenD)}><div style={{fontSize:16,fontWeight:800,color:C.green}}>{uH}s</div><div style={{fontSize:9,color:C.dim}}>Kullanılan</div></div>
          <div style={S.st(rH<0?C.redD:"rgba(255,255,255,0.08)")}><div style={{fontSize:16,fontWeight:800,color:rH<0?C.red:C.text}}>{rH}s</div><div style={{fontSize:9,color:C.dim}}>{rH<0?"BORÇ":"Kalan"}</div></div>
        </div>
        {debt>0&&<div style={{marginTop:8,background:C.redD,borderRadius:8,padding:"6px 10px",textAlign:"center"}}><span style={{fontSize:12,color:C.red,fontWeight:700}}>⚠ {debt} gun mesai borcu var</span></div>}
        <div style={{marginTop:10,background:"rgba(20,184,166,0.08)",borderRadius:10,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:C.teal}}>🌴 Yıllık İzin</div>
            <div style={{fontSize:15,fontWeight:800,color:annualRemaining(p.id)>0?C.teal:C.red}}>{annualRemaining(p.id)}g kalan</div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:6}}>
            <div style={{flex:1,background:C.tealD,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:C.teal}}>{annualDays(p.id)}</div><div style={{fontSize:9,color:C.dim}}>Toplam</div></div>
            <div style={{flex:1,background:C.greenD,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:C.green}}>{annualUsed(p.id)}</div><div style={{fontSize:9,color:C.dim}}>Kullanılan</div></div>
            <div style={{flex:1,background:annualRemaining(p.id)<=2?C.redD:"rgba(255,255,255,0.06)",borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:annualRemaining(p.id)<=2?C.red:C.text}}>{annualRemaining(p.id)}</div><div style={{fontSize:9,color:C.dim}}>Kalan</div></div>
          </div>
          <div style={{height:5,borderRadius:3,background:C.bg,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:Math.min(100,Math.round((annualUsed(p.id)/Math.max(annualDays(p.id),1))*100))+"%",background:annualRemaining(p.id)<=2?C.red:C.teal}}/></div>
          {(()=>{
            const annualLvs=leavesState.filter(l=>l.personnel_id===p.id&&isAnnualLeave(l)&&l.status!=="rejected");
            if(annualLvs.length===0)return <div style={{fontSize:11,color:C.dim,marginTop:8}}>Henüz yıllık izin kullanılmamış</div>;
            return(<div style={{marginTop:8}}>{annualLvs.sort((a,b)=>{const da=(Array.isArray(a.dates)?a.dates:["-"])[0];const db=(Array.isArray(b.dates)?b.dates:["-"])[0];return db.localeCompare(da);}).map(l=>{const dates=Array.isArray(l.dates)?l.dates:[];return(<div key={l.id} style={{background:C.bg,borderRadius:8,padding:"8px 10px",marginTop:6,border:"1px solid "+C.border,cursor:"pointer"}} onClick={()=>setSelLV(l)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{dates.map(d=><span key={d} style={{...S.tag(l.status==="approved"?C.tealD:C.orangeD,l.status==="approved"?C.teal:C.orange),fontSize:10}}>{fDS(d)}</span>)}</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:13,fontWeight:700}}>{dates.length}g</span><span style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)}</span></div>
              </div>
              {l.reason&&<div style={{fontSize:10,color:C.dim,marginTop:4}}>{l.reason.replace("[Yıllık İzin] ","")}</div>}
            </div>);})}</div>);
          })()}
        </div>
      </div>
      <div style={{...S.sec,marginTop:16}}><span>⏱</span> Mesai ({pOTs.length})</div>
      {pOTs.length===0&&<div style={{...S.emp,padding:20}}>Kayit yok</div>}
      {pOTs.map(o=>(<div key={o.id} style={S.crd} onClick={()=>setSelOT(o)}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{fD(o.work_date)}</div><div style={{fontSize:11,color:C.dim}}>{o.start_time?.slice(0,5)}→{o.end_time?.slice(0,5)}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:C.accent}}>{o.hours}s<span style={{color:C.purple,fontSize:12}}> →{o.leave_hours}s</span></div><div style={S.tag(sColor(o.status)+"22",sColor(o.status))}>{sIcon(o.status)} {sText(o.status)}</div></div></div>{o.description&&<div style={{fontSize:12,color:C.dim,marginTop:6,borderTop:`1px solid ${C.border}`,paddingTop:6}}>{o.description}</div>}</div>))}
      <div style={{...S.sec,marginTop:16}}><span>🏖</span> Mesai İzni ({pLVs.filter(l=>isOTLeave(l)).length})</div>
      {pLVs.filter(l=>isOTLeave(l)).length===0&&<div style={{...S.emp,padding:20}}>Talep yok</div>}
      {pLVs.filter(l=>isOTLeave(l)).map(l=>{const isHourly=l.leave_type==="hourly";return(<div key={l.id} style={S.crd} onClick={()=>setSelLV(l)}><div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}><div>{isHourly?<div><div style={{...S.tag(C.blueD,C.blue),marginBottom:4}}>🕐 Saatlik</div><div style={{fontSize:12}}>{fDS(l.dates?.[0])} {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)}</div></div>:<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(Array.isArray(l.dates)?l.dates:[]).map(d=><span key={d} style={S.tag(l.status==="approved"?C.greenD:C.orangeD,l.status==="approved"?C.green:C.orange)}>{fDS(d)}</span>)}</div>}</div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:700}}>{isHourly?l.total_hours+"s":(Array.isArray(l.dates)?l.dates.length:0)+"g"}</div><div style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)}</div>{l.leave_doc_url&&<div style={{fontSize:10,color:C.green,marginTop:2}}>📄</div>}</div></div>{l.reason&&<div style={{fontSize:11,color:l.reason.includes("borc")?"#ef4444":C.dim,marginTop:4}}>{l.reason}</div>}</div>);})}
    </div>);
  };

  // ===== FAULT SYSTEM =====
  const canEditFault=isAdmin||isChef||isViewer;
  const canAddFault=true; // herkes arıza ekleyebilir
  const isOwnFault=(f)=>f?.created_by===profile?.id;

  async function submitFault(){
    if(!faultForm.title||!faultForm.location){setToast("⚠ Başlık ve konum zorunlu");return;}
    if(!faultForm.detected_date){setToast("⚠ Tespit tarihi seçin");return;}
    setSubmitting(true);
    try{
      let photoUrls=[...(faultForm.photos||[])];
      if(faultForm.editId){
        // Edit mode
        await supabase.from('faults').update({title:faultForm.title,location:faultForm.location,description:faultForm.description||"",photos:photoUrls,detected_date:faultForm.detected_date,fault_type:faultForm.fault_type,material_needed:faultForm.material_needed||""}).eq('id',faultForm.editId);
        await fetchFaults();
        setToast("✓ Arıza güncellendi");
      } else {
        // New fault
        const{data:inserted}=await supabase.from('faults').insert({title:faultForm.title,location:faultForm.location,description:faultForm.description||"",photos:photoUrls,detected_date:faultForm.detected_date,fault_type:faultForm.fault_type,material_needed:faultForm.material_needed||"",building_id:selBuilding,created_by:profile.id}).select().single();
        if(inserted&&faultForm.services.length>0){
          const svcRows=faultForm.services.map(s=>({fault_id:inserted.id,service_name:s.service_name,visit_date:s.visit_date,notes:s.notes||"",created_by:profile.id}));
          await supabase.from('fault_services').insert(svcRows);
          await fetchFaultServices();
        }
        await fetchFaults();
        setToast("✓ Arıza kaydedildi");
      }
      setFaultForm({title:"",location:"",description:"",detected_date:"",photos:[],services:[],fault_type:"service",material_needed:""});
      setFaultPhotoFiles([]);setModNewFault(false);
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function updateFaultData(id,updates){
    setSubmitting(true);
    try{await supabase.from('faults').update(updates).eq('id',id);await fetchFaults();setToast("✓ Güncellendi");}
    catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function submitService(faultId){
    if(!serviceForm.service_name){setToast("⚠ Servis adı zorunlu");return;}
    if(!serviceForm.visit_date){setToast("⚠ Ziyaret tarihi seçin");return;}
    setSubmitting(true);
    try{
      await supabase.from('fault_services').insert({fault_id:faultId,service_name:serviceForm.service_name,visit_date:serviceForm.visit_date,notes:serviceForm.notes||"",created_by:profile.id});
      await fetchFaultServices();
      setServiceForm({service_name:"",visit_date:"",notes:""});setModAddService(false);
      setToast("✓ Servis kaydı eklendi");
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function submitVote(faultId,vote){
    setSubmitting(true);
    const dbg=[];
    try{
      dbg.push("1. profile.id="+String(profile.id).slice(0,8));
      dbg.push("2. currentWeek="+currentWeek);
      dbg.push("3. faultId="+String(faultId).slice(0,8));
      
      // Step 1: Check existing
      const{data:existing,error:findErr}=await supabase.from('fault_votes').select('*').eq('fault_id',faultId).eq('personnel_id',profile.id).eq('vote_week',currentWeek).maybeSingle();
      dbg.push("4. findErr="+(findErr?.message||"yok"));
      dbg.push("5. existing="+(existing?JSON.stringify(existing).slice(0,80):"null"));
      
      if(existing){
        dbg.push("6. UPDATE mevcut oy");
        const{error:upErr}=await supabase.from('fault_votes').update({vote}).eq('id',existing.id);
        dbg.push("7. upErr="+(upErr?.message||"yok ✓"));
        if(upErr){setToast("⚠ Güncelleme hatası: "+upErr.message);setSubmitting(false);return;}
      } else {
        dbg.push("6. INSERT yeni oy");
        const insertData={fault_id:faultId,personnel_id:profile.id,vote,vote_week:currentWeek};
        dbg.push("7. data="+JSON.stringify(insertData).slice(0,120));
        const{data:ins,error:insErr}=await supabase.from('fault_votes').insert(insertData).select();
        dbg.push("8. insErr="+(insErr?.message||"yok"));
        dbg.push("9. inserted="+(ins?JSON.stringify(ins).slice(0,100):"null"));
        if(insErr){setToast("⚠ INSERT hatası: "+insErr.message);setSubmitting(false);return;}
        if(!ins||ins.length===0){setToast("⚠ Oy kaydedilemedi (veri dönmedi)");setSubmitting(false);return;}
      }
      
      // Optimistic update
      setFaultVotes(prev=>{
        const filtered=prev.filter(v=>!(v.fault_id===faultId&&v.personnel_id===profile.id&&vwMatch(v.vote_week,currentWeek)));
        return[...filtered,{fault_id:faultId,personnel_id:profile.id,vote,vote_week:currentWeek,id:existing?.id||"new-"+Date.now()}];
      });
      
      dbg.push("10. ✓ Başarılı!");
      setToast(vote==="continues"?"🔴 Oy kaydedildi ✓":"🟢 Oy kaydedildi ✓");
      
      // DB'den yeniden senkronla AMA bu oyu garanti koru (yenileme oyu getirmese/gecikse bile geri alma)
      try{
        const cw=getVoteWeek(),pw=getPrevVoteWeek();
        const{data:rs,error:rsErr}=await supabase.from('fault_votes').select('*').in('vote_week',[cw,pw]).order('created_at',{ascending:false}).limit(1000);
        if(!rsErr&&Array.isArray(rs)){
          const mine=v=>v.fault_id===faultId&&v.personnel_id===profile.id&&vwMatch(v.vote_week,cw);
          setFaultVotes(rs.some(mine)?rs:[...rs,{fault_id:faultId,personnel_id:profile.id,vote,vote_week:cw,id:existing?.id||'opt-'+Date.now()}]);
        }
      }catch(e){}
      
    }catch(e){
      dbg.push("HATA: "+String(e?.message||e));
      setToast("⚠ "+String(e?.message||e));
    }
    setSubmitting(false);
    // Store debug for viewing
    window.__VOTE_DEBUG=dbg.join("\n");
    console.log("VOTE DEBUG:\n"+dbg.join("\n"));
  }

  async function deleteFault(id){
    setSubmitting(true);
    try{await supabase.from('faults').delete().eq('id',id);await fetchFaults();setSelFault(null);setDeleteConfirm(null);setToast("🗑 Arıza silindi");}
    catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  const renderFaults=()=>{
    const activeFaults=bFaults.filter(f=>f.status==="active");
    const resolvedFaults=bFaults.filter(f=>f.status==="resolved");
    const canSeeResolved=isAdmin||isViewer||isChef;
    const list=canSeeResolved?(faultTab==="active"?activeFaults:resolvedFaults):activeFaults;
    return(<div>
      <div style={S.sec}><span>🔧</span> Arızalı Envanter</div>
      {canSeeResolved?<div style={{display:"flex",gap:8,marginBottom:12}}>
        <button style={{flex:1,padding:"10px",borderRadius:10,border:`2px solid ${faultTab==="active"?C.red:C.border}`,background:faultTab==="active"?C.redD:"transparent",color:faultTab==="active"?C.red:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>setFaultTab("active")}>🔴 Aktif ({activeFaults.length})</button>
        <button style={{flex:1,padding:"10px",borderRadius:10,border:`2px solid ${faultTab==="resolved"?C.green:C.border}`,background:faultTab==="resolved"?C.greenD:"transparent",color:faultTab==="resolved"?C.green:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>setFaultTab("resolved")}>✅ Çözülen ({resolvedFaults.length})</button>
      </div>:<div style={{fontSize:12,color:C.dim,marginBottom:12}}>🔴 {activeFaults.length} aktif arıza</div>}
      {canAddFault&&<button style={S.btn(C.accent)} onClick={()=>{setFaultForm({title:"",location:"",description:"",detected_date:todayStr(),photos:[],services:[],fault_type:"service",material_needed:""});setFaultPhotoFiles([]);setModNewFault(true);}}>+ Yeni Arıza Ekle</button>}
      {list.length===0&&<div style={S.emp}>{faultTab==="active"?"Aktif arıza yok ✓":"Çözülen arıza yok"}</div>}
      {list.map(f=>{
        const days=daysSince(f.detected_date);
        const svcCount=faultServices.filter(s=>s.fault_id===f.id).length;
        const weekVotes=faultVotes.filter(v=>v.fault_id===f.id&&vwMatch(v.vote_week,currentWeek));
        const pvVotes=faultVotes.filter(v=>v.fault_id===f.id&&vwMatch(v.vote_week,prevWeek));
        const votedCount=weekVotes.length;
        const myVote=weekVotes.find(v=>v.personnel_id===profile.id);
        const pvCont=pvVotes.filter(v=>v.vote==="continues").length;
        const pvRes=pvVotes.filter(v=>v.vote==="resolved").length;
        return(<div key={f.id} style={{...S.crd,borderLeft:`4px solid ${f.status==="active"?C.red:C.green}`}} onClick={()=>setSelFault(f)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700}}>{f.title}</div>
              <div style={{fontSize:12,color:C.dim,marginTop:2}}>📍 {f.location}</div>
            </div>
            {f.status==="active"&&<div style={{textAlign:"right",minWidth:60}}>
              <div style={{fontSize:20,fontWeight:800,color:days>30?C.red:days>7?C.orange:C.text}}>{days}</div>
              <div style={{fontSize:9,color:C.dim}}>gün</div>
            </div>}
          </div>
          <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
            {f.fault_type==="material"?<div style={S.tag("rgba(245,158,11,0.15)",C.orange)}>📦 Malzeme</div>:<div style={S.tag(C.blueD,C.blue)}>🔧 Servis</div>}
            {svcCount>0&&<div style={S.tag(C.blueD,C.blue)}>🔧 {svcCount} servis</div>}
            
            {myVote&&<div style={S.tag(myVote.vote==="continues"?C.redD:C.greenD,myVote.vote==="continues"?C.red:C.green)}>{myVote.vote==="continues"?"🔴 Devam":"🟢 Giderildi"}</div>}
            {!myVote&&f.status==="active"&&<div style={S.tag(C.orangeD,C.orange)}>⏳ Oy bekleniyor</div>}
            {votedCount>0&&<div style={{fontSize:10,color:C.muted,alignSelf:"center"}}>{votedCount} oy</div>}
            {pvVotes.length>0&&<div style={{fontSize:10,color:C.purple,alignSelf:"center"}}>📋 Önceki: {pvCont}🔴 {pvRes}🟢</div>}
          </div>
        </div>);
      })}
    </div>);
  };

  const renderFaultDetail=()=>{
    if(!selFault)return null;
    const f=selFault;
    const days=daysSince(f.detected_date);
    const services=faultServices.filter(s=>s.fault_id===f.id).sort((a,b)=>(b.visit_date||"").localeCompare(a.visit_date||""));
    const weekVotes=faultVotes.filter(v=>v.fault_id===f.id&&vwMatch(v.vote_week,currentWeek));
    const myVote=weekVotes.find(v=>v.personnel_id===profile.id);
    const allActiveProfiles=bProfiles.filter(p=>p.active);
    const creator=profiles.find(p=>p.id===f.created_by);

    return(<div style={S.mod} onClick={()=>{setSelFault(null);setModAddService(false);setModEditFault(null);setDeleteConfirm(null);}}><div style={{...S.modC,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/>
      <div style={{fontSize:17,fontWeight:700,marginBottom:4}}>{f.title}</div>
      <div style={{fontSize:13,color:C.dim,marginBottom:4}}>📍 {f.location}</div>
      {f.status==="active"&&<div style={{display:"inline-flex",alignItems:"center",gap:6,background:days>30?C.redD:days>7?C.orangeD:C.bg,borderRadius:8,padding:"6px 12px",marginBottom:12}}>
        <span style={{fontSize:20,fontWeight:800,color:days>30?C.red:days>7?C.orange:C.text}}>{days} gün</span>
        <span style={{fontSize:11,color:C.dim}}>arızalı</span>
      </div>}
      <div style={{fontSize:12,color:C.dim,marginBottom:12}}>Tespit: {fD(f.detected_date)} {creator&&`• ${creator.full_name}`}</div>
      <div style={{marginBottom:12}}>{f.fault_type==="material"?<div style={S.tag("rgba(245,158,11,0.15)",C.orange)}>📦 Malzeme Eksikliği</div>:<div style={S.tag(C.blueD,C.blue)}>🔧 Servis Gerektiren</div>}</div>

      {f.material_needed&&<div style={{...S.lawBox,marginBottom:12,borderColor:`${C.orange}44`}}><div style={{fontSize:10,color:C.orange,fontWeight:600,marginBottom:4}}>📦 İhtiyaç Duyulan Malzeme</div><div style={{fontSize:13}}>{f.material_needed}</div></div>}

      {f.description&&<div style={{...S.lawBox,marginBottom:12}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>Açıklama</div><div style={{fontSize:13}}>{f.description}</div></div>}

      

      {services.length>0&&<div style={{marginBottom:12}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:6}}>🔧 Servis Geçmişi ({services.length})</div>{services.map(s=>{const sp=profiles.find(p=>p.id===s.created_by);const daysAfter=f.detected_date&&s.visit_date?daysSince(f.detected_date)-daysSince(s.visit_date):null;return(<div key={s.id} style={{background:C.bg,borderRadius:10,padding:10,marginBottom:6,border:`1px solid ${C.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}><div><div style={{fontSize:10,color:C.muted}}>Servis Veren Firma</div><div style={{fontWeight:700,fontSize:13}}>{s.service_name}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:12,color:C.dim}}>{fD(s.visit_date)}</div>{daysAfter!==null&&daysAfter>=0&&<div style={{fontSize:10,color:C.orange}}>tespitden {daysAfter} gün sonra</div>}</div></div>
        {s.notes&&<div style={{fontSize:12,color:C.text,marginTop:4}}>{s.notes}</div>}
        {sp&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>Ekleyen: {sp.full_name}</div>}
      </div>);})}</div>}

      {(canEditFault||isOwnFault(f))&&!modAddService&&<button style={S.btn(C.blueD,C.blue)} onClick={()=>{setServiceForm({service_name:"",visit_date:todayStr(),notes:""});setModAddService(true);}}>+ Servis Kaydı Ekle</button>}
      {modAddService&&<div style={{background:C.bg,borderRadius:12,padding:14,marginBottom:12,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:10,color:C.blue}}>🔧 Yeni Servis Kaydı</div>
        <div style={S.lbl}>Servis Veren Firma</div>
        <input style={S.inp} placeholder="Örn: ABC Klima Servisi" value={serviceForm.service_name} onChange={e=>setServiceForm(p=>({...p,service_name:e.target.value}))}/>
        <div style={S.lbl}>Ziyaret Tarihi</div>
        <div style={S.fInp} onClick={()=>setShowServiceDatePicker(true)}><span style={{color:serviceForm.visit_date?C.text:C.muted}}>{serviceForm.visit_date?fD(serviceForm.visit_date):"Tarih seçin..."}</span><span>📅</span></div>
        <div style={S.lbl}>Notlar / Yapılan İşlem</div>
        <textarea style={S.ta} placeholder="Servisin yaptığı işlem veya tespitler..." value={serviceForm.notes} onChange={e=>setServiceForm(p=>({...p,notes:e.target.value}))}/>
        <div style={{display:"flex",gap:8}}><button style={{...S.btn(C.blue),flex:1}} onClick={()=>submitService(f.id)} disabled={submitting}>{submitting?"...":"Kaydet"}</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setModAddService(false)}>İptal</button></div>
      </div>}

      {/* OYLAMA */}
      {f.status==="active"&&<div style={{...S.lawBox,marginBottom:12,borderColor:`${C.orange}44`}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📊 Haftalık Durum Oylaması <span style={{fontSize:10,color:votePeriod.isUrgent?C.red:C.muted,fontWeight:votePeriod.isUrgent?700:500}}>({fDS(votePeriod.start.toISOString().slice(0,10))} → {fDS(votePeriod.end.toISOString().slice(0,10))}{votePeriod.isUrgent?" ⏰ SON GÜN!":votePeriod.isWarning?" ⚠ "+votePeriod.daysLeft+" gün kaldı":""})</span></div>
        {!myVote?<div style={{display:"flex",gap:8}}>
          <button style={{flex:1,padding:12,borderRadius:10,background:C.redD,border:`2px solid ${C.red}44`,color:C.red,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>submitVote(f.id,"continues")} disabled={submitting}>🔴 Arıza Devam Ediyor</button>
          <button style={{flex:1,padding:12,borderRadius:10,background:C.greenD,border:`2px solid ${C.green}44`,color:C.green,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>submitVote(f.id,"resolved")} disabled={submitting}>🟢 Arıza Giderildi</button>
        </div>:<div style={{textAlign:"center",padding:8,background:myVote.vote==="continues"?C.redD:C.greenD,borderRadius:8}}>
          <span style={{color:myVote.vote==="continues"?C.red:C.green,fontWeight:700}}>{myVote.vote==="continues"?"🔴 Devam ediyor olarak oy kullandınız":"🟢 Giderildi olarak oy kullandınız"}</span>
          {canEditFault&&<div style={{marginTop:6}}><button style={{fontSize:11,color:C.muted,background:"none",border:"none",textDecoration:"underline",cursor:"pointer"}} onClick={()=>submitVote(f.id,myVote.vote==="continues"?"resolved":"continues")}>Oyumu değiştir</button></div>}
          {isPerso&&<div style={{fontSize:10,color:C.muted,marginTop:6}}>🔒 Oyunuz kaydedildi</div>}
        </div>}
        {canEditFault&&<div style={{marginTop:10}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:6}}>Bu hafta oylar ({weekVotes.length}/{allActiveProfiles.length})</div>
          {allActiveProfiles.map(p=>{
            const v=weekVotes.find(vt=>vt.personnel_id===p.id);
            return(<div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:500}}>{p.full_name}</div>
              {v?<div style={{fontSize:11,fontWeight:700,color:v.vote==="continues"?C.red:C.green}}>{v.vote==="continues"?"🔴 Devam":"🟢 Giderildi"}</div>
              :<div style={{fontSize:11,color:C.orange}}>⏳ Oy yok</div>}
            </div>);
          })}
        </div>}
        {/* Debug: vote info */}
        <details style={{marginTop:8}}>
          <summary style={{fontSize:10,color:C.muted,cursor:"pointer"}}>🔍 Oy Debug</summary>
          <pre style={{fontSize:9,color:C.dim,background:C.bg,padding:8,borderRadius:6,whiteSpace:"pre-wrap",marginTop:4}}>{
            "currentWeek: '"+currentWeek+"'"+
            "\nprofile.id: "+String(profile?.id).slice(0,12)+
            "\nfault.id: "+String(f.id).slice(0,12)+
            "\nweekvotes: "+weekVotes.length+
            "\nmyVote: "+(myVote?JSON.stringify(myVote).slice(0,120):"YOK")+
            "\ntoplam faultVotes state: "+faultVotes.length+
            "\nbu arıza tüm oylar: "+faultVotes.filter(v=>v.fault_id===f.id).length+
            "\n\n--- vote_week formatları (bu arıza) ---\n"+
            faultVotes.filter(v=>v.fault_id===f.id).slice(0,5).map(v=>"id:"+String(v.id).slice(0,8)+" week:'"+v.vote_week+"' type:"+typeof v.vote_week+" match:"+vwMatch(v.vote_week,currentWeek)+" pid:"+String(v.personnel_id).slice(0,8)).join("\n")+
            "\n\n"+(typeof window!=="undefined"&&window.__VOTE_DEBUG||"henüz oy kullanılmadı")
          }</pre>
        </details>
      </div>}

      {/* ÖNCEKİ DÖNEM SONUÇLARI */}
      {f.status==="active"&&(()=>{
        // Collect ALL past vote weeks for this fault
        const allVotesForFault=faultVotes.filter(v=>v.fault_id===f.id&&!vwMatch(v.vote_week,currentWeek));
        const pastWeeks=[...new Set(allVotesForFault.map(v=>v.vote_week))].sort((a,b)=>b.localeCompare(a));
        if(pastWeeks.length===0)return null;
        return(<div style={{...S.lawBox,marginBottom:12,borderColor:`${C.purple}44`,background:"rgba(168,85,247,0.04)"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.purple,marginBottom:10}}>📋 Önceki Dönem Sonuçları</div>
          {pastWeeks.map((wk,wi)=>{
            const wkVotes=allVotesForFault.filter(v=>vwMatch(v.vote_week,wk));
            const wkRange=getVoteWeekRange(wk);
            const contCount=wkVotes.filter(v=>v.vote==="continues").length;
            const resCount=wkVotes.filter(v=>v.vote==="resolved").length;
            const noVote=allActiveProfiles.filter(p=>!wkVotes.some(v=>v.personnel_id===p.id));
            const isLatest=wi===0;
            return(<div key={wk} style={{marginBottom:wi<pastWeeks.length-1?12:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:600,color:isLatest?C.purple:C.muted}}>{isLatest?"Geçen Hafta":"Hafta"}: {fDS(wkRange.start)} → {fDS(wkRange.end)}</div>
              </div>
              <div style={{display:"flex",gap:6,marginBottom:canEditFault&&isLatest?8:0}}>
                <div style={{flex:1,background:C.redD,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                  <div style={{fontSize:16,fontWeight:800,color:C.red}}>{contCount}</div>
                  <div style={{fontSize:9,color:C.dim}}>🔴 Devam</div>
                </div>
                <div style={{flex:1,background:C.greenD,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                  <div style={{fontSize:16,fontWeight:800,color:C.green}}>{resCount}</div>
                  <div style={{fontSize:9,color:C.dim}}>🟢 Giderildi</div>
                </div>
                <div style={{flex:1,background:C.orangeD,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                  <div style={{fontSize:16,fontWeight:800,color:C.orange}}>{noVote.length}</div>
                  <div style={{fontSize:9,color:C.dim}}>❌ Yok</div>
                </div>
              </div>
              {canEditFault&&isLatest&&<div>
                {allActiveProfiles.map(p=>{
                  const v=wkVotes.find(vt=>vt.personnel_id===p.id);
                  return(<div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:500}}>{p.full_name}</div>
                    {v?<div style={{fontSize:11,fontWeight:700,color:v.vote==="continues"?C.red:C.green}}>{v.vote==="continues"?"🔴 Devam":"🟢 Giderildi"}</div>
                    :<div style={{fontSize:11,color:C.orange,fontWeight:600}}>❌ Oy kullanmadı</div>}
                  </div>);
                })}
              </div>}
              {wi<pastWeeks.length-1&&<div style={{borderBottom:`1px solid ${C.border}`,marginTop:8}}/>}
            </div>);
          })}
        </div>);
      })()}

      {/* Edit / Admin actions */}
      {isOwnFault(f)&&f.status==="active"&&<button style={S.btn(C.accentD,C.accent)} onClick={()=>{setFaultForm({title:f.title,location:f.location,description:f.description||"",detected_date:f.detected_date,photos:f.photos||[],services:[],fault_type:f.fault_type||"service",material_needed:f.material_needed||"",editId:f.id});setFaultPhotoFiles([]);setSelFault(null);setModNewFault(true);}}>✏️ Arızayı Düzenle</button>}
      {canEditFault&&f.status==="active"&&<button style={S.btn(C.greenD,C.green)} onClick={async()=>{await updateFaultData(f.id,{status:"resolved",resolved_date:todayStr()});setSelFault({...f,status:"resolved"});}}>✅ Arıza Çözüldü Olarak İşaretle</button>}
      {canEditFault&&f.status==="resolved"&&<button style={S.btn(C.orangeD,C.orange)} onClick={async()=>{await updateFaultData(f.id,{status:"active",resolved_date:null});setSelFault({...f,status:"active"});}}>🔄 Tekrar Aktif Yap</button>}
      {isAdmin&&<>{deleteConfirm===f.id?<div style={{background:C.redD,borderRadius:10,padding:14,marginTop:8}}><div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:8,textAlign:"center"}}>⚠ Bu arızayı silmek istediğinize emin misiniz?</div><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.red),flex:1}} onClick={()=>deleteFault(f.id)} disabled={submitting}>🗑 Evet, Sil</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setDeleteConfirm(null)}>İptal</button></div></div>:<button style={S.btn(C.redD,C.red)} onClick={()=>setDeleteConfirm(f.id)}>🗑 Arızayı Sil</button>}</>}
      <button style={S.btn(C.border,C.text)} onClick={()=>{setSelFault(null);setModAddService(false);setDeleteConfirm(null);}}>Kapat</button>
    </div></div>);
  };

  const renderNewFault=()=>{
    if(!modNewFault)return null;
    return(<div style={S.mod} onClick={()=>setModNewFault(false)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>{faultForm.editId?"✏️ Arıza Düzenle":"Yeni Arıza Kaydı"}</div><div style={{fontSize:12,color:C.dim,marginBottom:16}}>{faultForm.editId?"Arıza bilgilerini güncelleyin":"Arızalı envanter bilgilerini girin"}</div>
      <div style={S.lbl}>Arıza Başlığı</div>
      <input style={S.inp} placeholder="Örn: Bayan WC kabin camı kırık" value={faultForm.title} onChange={e=>setFaultForm(p=>({...p,title:e.target.value}))}/>
      <div style={S.lbl}>Konum</div>
      <input style={S.inp} placeholder="Örn: 7. Kat B Blok" value={faultForm.location} onChange={e=>setFaultForm(p=>({...p,location:e.target.value}))}/>
      <div style={S.lbl}>Tespit Tarihi</div>
      <div style={S.fInp} onClick={()=>setShowFaultDatePicker(true)}><span style={{color:faultForm.detected_date?C.text:C.muted}}>{faultForm.detected_date?fD(faultForm.detected_date):"Tarih seçin..."}</span><span>📅</span></div>
      <div style={S.lbl}>Açıklama</div>
      <textarea style={S.ta} placeholder="Arızanın detaylı açıklaması..." value={faultForm.description} onChange={e=>setFaultForm(p=>({...p,description:e.target.value}))}/>

      <div style={S.lbl}>Arıza Türü</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {["service","material"].map(t=>{
          const isSvc=t==="service",active=faultForm.fault_type===t;
          const ac=isSvc?C.blue:C.orange,bg=isSvc?C.blueD:"rgba(245,158,11,0.1)";
          return(<button key={t} style={{flex:1,padding:"12px",borderRadius:10,border:"2px solid "+(active?ac:C.border),background:active?bg:"transparent",color:active?ac:C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}} onClick={()=>setFaultForm(p=>({...p,fault_type:t,...(t==="material"?{services:[]}:{})}))}>{isSvc?"🔧 Servis Gerektiren":"📦 Malzeme Eksikliği"}</button>);
        })}
      </div>

      {faultForm.fault_type==="material"&&<>
        <div style={S.lbl}>İhtiyaç Duyulan Malzeme</div>
        <textarea style={S.ta} placeholder="Örn: 500 lt genleşme tankı, 1 adet..." value={faultForm.material_needed} onChange={e=>setFaultForm(p=>({...p,material_needed:e.target.value}))}/>
      </>}


      {/* Inline Services - only for service type */}
      {faultForm.fault_type==="service"&&<div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={S.lbl}>🔧 Servis Kayıtları</div>
          <button style={{fontSize:11,padding:"4px 12px",borderRadius:8,background:C.blueD,color:C.blue,border:"none",fontWeight:700,cursor:"pointer"}} onClick={()=>setFaultForm(p=>({...p,services:[...p.services,{service_name:"",visit_date:todayStr(),notes:""}]}))}>+ Servis Ekle</button>
        </div>
        {faultForm.services.length===0&&<div style={{fontSize:12,color:C.muted,padding:10,textAlign:"center",background:C.bg,borderRadius:8,border:`1px dashed ${C.border}`}}>Henüz servis kaydı yok. Servis geldiyse ekleyin.</div>}
        {faultForm.services.map((svc,idx)=><div key={idx} style={{background:C.bg,borderRadius:10,padding:12,marginBottom:8,border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,color:C.blue}}>Servis #{idx+1}</div>
            <button onClick={()=>setFaultForm(p=>({...p,services:p.services.filter((_,j)=>j!==idx)}))} style={{fontSize:16,color:C.red,background:"none",border:"none",cursor:"pointer",fontWeight:700}}>×</button>
          </div>
          <div style={S.lbl}>Servis Veren Firma</div>
          <input style={S.inp} placeholder="Örn: ABC Klima Servisi" value={svc.service_name} onChange={e=>{const v=e.target.value;setFaultForm(p=>({...p,services:p.services.map((s,j)=>j===idx?{...s,service_name:v}:s)}));}}/>
          <div style={S.lbl}>Ziyaret Tarihi</div>
          <div style={S.fInp} onClick={()=>{setInlineSvcIdx(idx);setShowInlineSvcDatePicker(true);}}><span style={{color:svc.visit_date?C.text:C.muted}}>{svc.visit_date?fD(svc.visit_date):"Tarih seçin..."}</span><span>📅</span></div>
          <div style={S.lbl}>Notlar / Yapılan İşlem</div>
          <textarea style={{...S.ta,minHeight:50}} placeholder="Servisin tespiti veya yaptığı işlem..." value={svc.notes} onChange={e=>{const v=e.target.value;setFaultForm(p=>({...p,services:p.services.map((s,j)=>j===idx?{...s,notes:v}:s)}));}}/>
          {svc.visit_date&&faultForm.detected_date&&<div style={{fontSize:11,color:C.orange,marginTop:-4,marginBottom:4}}>⏱ Arıza tespitinden {daysSince(faultForm.detected_date)-daysSince(svc.visit_date)} gün sonra geldi</div>}
        </div>)}
      </div>}

      <button style={S.btn(C.accent)} onClick={submitFault} disabled={submitting}>{submitting?"Kaydediliyor...":faultForm.editId?"Güncelle":"Arıza Kaydet"}</button>
      <button style={S.btn(C.border,C.text)} onClick={()=>setModNewFault(false)}>İptal</button>
    </div></div>);
  };

  // ===== STOCK MANAGEMENT SYSTEM =====
  async function addMaterial(){
    if(!matForm.name){setToast("⚠ Malzeme adı zorunlu");return;}
    setSubmitting(true);
    try{
      await supabase.from('materials').insert({name:matForm.name,category:matForm.category,unit:matForm.unit,current_stock:Number(matForm.current_stock)||0,min_stock:Number(matForm.min_stock)||0,notes:matForm.notes||"",building_id:selBuilding,created_by:profile.id});
      await fetchMaterials();setModNewMat(false);setMatForm({name:"",category:"Genel Sarf",unit:"Adet",current_stock:0,min_stock:0,notes:""});setToast("✓ Malzeme eklendi");
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function doStockOut(){
    const qty=Number(stockOutForm.quantity);
    if(!qty||qty<=0){setToast("⚠ Geçerli miktar girin");return;}
    if(!stockOutForm.purpose){setToast("⚠ Hangi iş için aldığınızı yazın");return;}
    setSubmitting(true);
    try{
      const mat=modStockOut;
      await supabase.from('stock_movements').insert({material_id:mat.id,personnel_id:profile.id,quantity:qty,movement_type:'out',purpose:stockOutForm.purpose,location:stockOutForm.location||"",movement_date:new Date().toISOString()});
      const newStock=Math.max(0,(mat.current_stock||0)-qty);
      await supabase.from('materials').update({current_stock:newStock}).eq('id',mat.id);
      await fetchMaterials();await fetchStockMovements();
      setModStockOut(null);setStockOutForm({quantity:"",purpose:"",location:""});
      if(newStock<=mat.min_stock)setToast("⚠ "+mat.name+" kritik seviyenin altında! ("+newStock+" "+mat.unit+")");
      else setToast("✓ "+qty+" "+mat.unit+" "+mat.name+" çıkışı yapıldı");
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function doStockIn(){
    const qty=Number(stockInForm.quantity);
    if(!qty||qty<=0){setToast("⚠ Geçerli miktar girin");return;}
    setSubmitting(true);
    try{
      const mat=modStockIn;
      await supabase.from('stock_movements').insert({material_id:mat.id,personnel_id:profile.id,quantity:qty,movement_type:'in',notes:stockInForm.notes||"",movement_date:new Date().toISOString()});
      await supabase.from('materials').update({current_stock:(mat.current_stock||0)+qty}).eq('id',mat.id);
      await fetchMaterials();await fetchStockMovements();
      setModStockIn(null);setStockInForm({quantity:"",notes:""});setToast("✓ "+qty+" "+mat.unit+" "+mat.name+" girişi yapıldı");
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  function handleCSV(e){
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const text=ev.target.result;
      const lines=text.split('\n').filter(l=>l.trim());
      if(lines.length<2){setToast("⚠ CSV dosyası boş veya hatalı");return;}
      const headers=lines[0].split(/[,;\t]/).map(h=>h.trim().toLowerCase().replace(/['"]/g,''));
      const nameIdx=headers.findIndex(h=>h.includes('malzeme')||h.includes('ad')||h.includes('name')||h.includes('ürün'));
      const catIdx=headers.findIndex(h=>h.includes('kategori')||h.includes('category'));
      const unitIdx=headers.findIndex(h=>h.includes('birim')||h.includes('unit'));
      const stockIdx=headers.findIndex(h=>h.includes('stok')||h.includes('stock')||h.includes('miktar'));
      const minIdx=headers.findIndex(h=>h.includes('min')||h.includes('minimum'));
      if(nameIdx===-1){setToast("⚠ 'Malzeme Adı' kolonu bulunamadı");return;}
      const rows=[];
      for(let i=1;i<lines.length;i++){
        const cols=lines[i].split(/[,;\t]/).map(c=>c.trim().replace(/^['"]|['"]$/g,''));
        const name=cols[nameIdx];if(!name)continue;
        rows.push({name,category:catIdx>=0?cols[catIdx]||"Genel Sarf":"Genel Sarf",unit:unitIdx>=0?cols[unitIdx]||"Adet":"Adet",current_stock:stockIdx>=0?Number(cols[stockIdx])||0:0,min_stock:minIdx>=0?Number(cols[minIdx])||0:0});
      }
      setBulkData(rows);setBulkParsed(true);
      setToast("✓ "+rows.length+" malzeme okundu — kontrol edip yükleyin");
    };
    reader.readAsText(file,'UTF-8');
    if(e.target)e.target.value="";
  }

  async function doBulkUpload(){
    if(!bulkData.length)return;
    setSubmitting(true);
    try{
      const rows=bulkData.map(r=>({...r,building_id:selBuilding,created_by:profile.id}));
      const batchSize=50;
      for(let i=0;i<rows.length;i+=batchSize){
        await supabase.from('materials').insert(rows.slice(i,i+batchSize));
      }
      await fetchMaterials();setBulkData([]);setBulkParsed(false);setModBulkUpload(false);
      setToast("✓ "+rows.length+" malzeme yüklendi");
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  const lowStockMats=bMaterials.filter(m=>m.current_stock<=m.min_stock&&m.min_stock>0);
  const criticalCount=lowStockMats.length;

  const renderDepo=()=>{
    const filtered=bMaterials.filter(m=>{
      if(matCategory!=="all"&&m.category!==matCategory)return false;
      if(matSearch&&!m.name.toLowerCase().includes(matSearch.toLowerCase()))return false;
      return true;
    });
    const purchaseList=lowStockMats.sort((a,b)=>(a.current_stock/Math.max(a.min_stock,1))-(b.current_stock/Math.max(b.min_stock,1)));

    return(<div>
      <div style={S.sec}><span>📦</span> Depo & Stok</div>
      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto"}}>
        {[{k:"stock",l:"📦 Stok",c:bMaterials.length},{k:"purchase",l:"🛒 Satın Alma",c:purchaseList.length},{k:"history",l:"📋 Hareketler",c:null}].map(t=>(
          <button key={t.k} style={{padding:"8px 14px",borderRadius:10,border:"2px solid "+(depoTab===t.k?C.accent:C.border),background:depoTab===t.k?C.accentD:"transparent",color:depoTab===t.k?C.accent:C.muted,fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}} onClick={()=>setDepoTab(t.k)}>{t.l}{t.c!==null&&t.c>0?" ("+t.c+")":""}</button>
        ))}
      </div>

      {/* Critical alert */}
      {criticalCount>0&&depoTab==="stock"&&<div style={{background:C.redD,borderRadius:10,padding:12,marginBottom:12,border:"1px solid "+C.red+"44"}}><div style={{fontSize:13,fontWeight:700,color:C.red}}>🔴 {criticalCount} malzeme kritik seviyede!</div><div style={{fontSize:11,color:C.dim,marginTop:4}}>Satın alma listesini kontrol edin</div></div>}

      {/* STOCK TAB */}
      {depoTab==="stock"&&<>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input style={{...S.inp,flex:1,marginBottom:0}} placeholder="🔍 Malzeme ara..." value={matSearch} onChange={e=>setMatSearch(e.target.value)}/>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
          <button style={{padding:"6px 12px",borderRadius:8,border:"none",background:matCategory==="all"?C.accent:C.bg,color:matCategory==="all"?"#fff":C.muted,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}} onClick={()=>setMatCategory("all")}>Tümü</button>
          {MAT_CATS.map(c=><button key={c} style={{padding:"6px 12px",borderRadius:8,border:"none",background:matCategory===c?C.accent:C.bg,color:matCategory===c?"#fff":C.muted,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}} onClick={()=>setMatCategory(c)}>{c}</button>)}
        </div>
        {canEditFault&&<div style={{display:"flex",gap:8,marginBottom:12}}>
          <button style={{...S.btn(C.accent),flex:1}} onClick={()=>{setMatForm({name:"",category:"Genel Sarf",unit:"Adet",current_stock:0,min_stock:0,notes:""});setModNewMat(true);}}>+ Malzeme Ekle</button>
          <button style={{...S.btn(C.accentD,C.accent),flex:1}} onClick={()=>{setBulkData([]);setBulkParsed(false);setModBulkUpload(true);}}>📄 Toplu Yükle</button>
        </div>}
        {filtered.length===0&&<div style={S.emp}>Malzeme bulunamadı</div>}
        {filtered.map(m=>{const isLow=m.current_stock<=m.min_stock&&m.min_stock>0;const pct=m.min_stock>0?Math.min(100,Math.round((m.current_stock/m.min_stock)*100)):100;return(
          <div key={m.id} style={{...S.crd,borderLeft:"4px solid "+(isLow?C.red:pct<150?C.orange:C.green)}} onClick={()=>setSelMaterial(m)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700}}>{m.name}</div><div style={{fontSize:11,color:C.dim}}>{m.category} • {m.unit}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:800,color:isLow?C.red:C.text}}>{m.current_stock}</div><div style={{fontSize:9,color:C.dim}}>{m.unit}</div></div>
            </div>
            {m.min_stock>0&&<div style={{marginTop:8}}><div style={{height:6,borderRadius:3,background:C.bg,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:Math.min(100,pct)+"%",background:isLow?C.red:pct<150?C.orange:C.green,transition:"width 0.3s"}}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:3}}><div style={{fontSize:9,color:C.dim}}>Min: {m.min_stock}</div>{isLow&&<div style={{fontSize:9,color:C.red,fontWeight:700}}>⚠ Kritik</div>}</div></div>}
            <button style={{marginTop:8,padding:"8px",borderRadius:8,border:"1px solid "+C.accent+"44",background:C.accentD,color:C.accent,fontSize:12,fontWeight:700,cursor:"pointer",width:"100%"}} onClick={e=>{e.stopPropagation();setModStockOut(m);setStockOutForm({quantity:"",purpose:"",location:""});}}>📤 Malzeme Al</button>
          </div>
        );})}
      </>}

      {/* PURCHASE LIST TAB */}
      {depoTab==="purchase"&&(()=>{
        // Split into zero stock (tükenmiş) and low stock (azalan)
        const zeroStock=purchaseList.filter(m=>m.current_stock===0);
        const lowStock=purchaseList.filter(m=>m.current_stock>0);
        // Group by category
        const groupByCategory=(list)=>{
          const groups={};
          list.forEach(m=>{const cat=m.category||"Diğer";if(!groups[cat])groups[cat]=[];groups[cat].push(m);});
          return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0]));
        };
        const zeroGroups=groupByCategory(zeroStock);
        const lowGroups=groupByCategory(lowStock);
        const totalNeed=purchaseList.reduce((s,m)=>s+Math.max(0,(m.min_stock||1)*2-m.current_stock),0);
        
        // Build shareable text
        const buildShareText=()=>{
          let txt="📋 SATIN ALMA LİSTESİ\n"+curBuildingName+" — "+new Date().toLocaleDateString("tr-TR")+"\n\n";
          if(zeroStock.length>0){
            txt+="🔴 STOK TÜKENMİŞ ("+zeroStock.length+" kalem)\n";
            zeroGroups.forEach(([cat,items])=>{
              txt+="  "+cat+":\n";
              items.forEach(m=>{txt+="    • "+m.name+" → "+Math.max(1,(m.min_stock||1)*2)+" "+m.unit+" alınmalı\n";});
            });
            txt+="\n";
          }
          if(lowStock.length>0){
            txt+="🟡 STOK AZALIYOR ("+lowStock.length+" kalem)\n";
            lowGroups.forEach(([cat,items])=>{
              txt+="  "+cat+":\n";
              items.forEach(m=>{const need=Math.max(0,(m.min_stock||1)*2-m.current_stock);txt+="    • "+m.name+" — Mevcut: "+m.current_stock+", "+need+" "+m.unit+" alınmalı\n";});
            });
          }
          txt+="\nToplam "+purchaseList.length+" kalem";
          return txt;
        };

        return(<>
          {/* Summary banner */}
          <div style={{...S.lawBox,marginBottom:12,borderColor:purchaseList.length>0?C.red+"66":C.green+"44",background:purchaseList.length>0?"rgba(239,68,68,0.06)":"rgba(34,197,94,0.06)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:15,fontWeight:800,color:purchaseList.length>0?C.red:C.green}}>🛒 Satın Alma Listesi</div>
                <div style={{fontSize:11,color:C.dim,marginTop:2}}>Minimum stok altındaki malzemeler</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:24,fontWeight:800,color:purchaseList.length>0?C.red:C.green}}>{purchaseList.length}</div>
                <div style={{fontSize:9,color:C.dim}}>kalem</div>
              </div>
            </div>
            {purchaseList.length>0&&<div style={{display:"flex",gap:8,marginTop:10}}>
              <div style={{flex:1,background:C.redD,borderRadius:8,padding:"6px 10px",textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:800,color:C.red}}>{zeroStock.length}</div>
                <div style={{fontSize:9,color:C.dim}}>Tükenmiş</div>
              </div>
              <div style={{flex:1,background:C.orangeD,borderRadius:8,padding:"6px 10px",textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:800,color:C.orange}}>{lowStock.length}</div>
                <div style={{fontSize:9,color:C.dim}}>Azalan</div>
              </div>
            </div>}
          </div>

          {purchaseList.length===0&&<div style={S.emp}>Tüm malzemeler yeterli seviyede ✓</div>}

          {/* Zero stock section */}
          {zeroStock.length>0&&<>
            <div style={{...S.sec,color:C.red}}><span>🔴</span> Stok Tükenmiş ({zeroStock.length})</div>
            {zeroGroups.map(([cat,items])=><div key={"z-"+cat}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,padding:"6px 0",borderBottom:"1px solid "+C.border}}>{cat} ({items.length})</div>
              {items.map(m=>{const need=Math.max(1,(m.min_stock||1)*2);return(
                <div key={m.id} style={{...S.crd,borderLeft:"4px solid "+C.red,background:"rgba(239,68,68,0.04)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{m.name}</div>{m.notes&&<div style={{fontSize:10,color:C.dim}}>{m.notes}</div>}</div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.red}}>STOK YOK</div>
                      <div style={{fontSize:13,fontWeight:800,color:C.accent,marginTop:2}}>{need} {m.unit} al</div>
                    </div>
                  </div>
                </div>
              );})}
            </div>)}
          </>}

          {/* Low stock section */}
          {lowStock.length>0&&<>
            <div style={{...S.sec,color:C.orange,marginTop:zeroStock.length>0?16:0}}><span>🟡</span> Stok Azalıyor ({lowStock.length})</div>
            {lowGroups.map(([cat,items])=><div key={"l-"+cat}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,padding:"6px 0",borderBottom:"1px solid "+C.border}}>{cat} ({items.length})</div>
              {items.map(m=>{const need=Math.max(0,(m.min_stock||1)*2-m.current_stock);const pct=m.min_stock>0?Math.round((m.current_stock/m.min_stock)*100):0;return(
                <div key={m.id} style={{...S.crd,borderLeft:"4px solid "+C.orange}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700}}>{m.name}</div>
                      <div style={{fontSize:11,color:C.dim}}>Mevcut: <span style={{color:C.orange,fontWeight:700}}>{m.current_stock}</span> / Min: {m.min_stock} {m.unit}</div>
                      <div style={{height:4,borderRadius:2,background:C.bg,overflow:"hidden",marginTop:4,maxWidth:120}}><div style={{height:"100%",borderRadius:2,width:pct+"%",background:C.orange}}/></div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:15,fontWeight:800,color:C.accent}}>{need}</div>
                      <div style={{fontSize:10,color:C.dim}}>{m.unit} al</div>
                    </div>
                  </div>
                </div>
              );})}
            </div>)}
          </>}

          {/* Action buttons */}
          {purchaseList.length>0&&canEditFault&&<div style={{marginTop:16,display:"flex",flexDirection:"column",gap:8}}>
            <button style={S.btn(C.accent)} onClick={()=>{const txt=buildShareText();navigator.clipboard?.writeText(txt).then(()=>setToast("📋 Liste panoya kopyalandı")).catch(()=>setToast("Kopyalanamadı"));}}>📋 Listeyi Kopyala</button>
            <button style={S.btn(C.greenD,C.green)} onClick={()=>{const txt=buildShareText();const encoded=encodeURIComponent(txt);window.open("https://wa.me/?text="+encoded,"_blank");}}>💬 WhatsApp ile Paylaş</button>
          </div>}
        </>);
      })()}

      {/* HISTORY TAB */}
      {depoTab==="history"&&<>
        {bStockMovements.slice(0,50).map(mv=>{const mat=materials.find(m=>m.id===mv.material_id);const pers=profiles.find(p=>p.id===mv.personnel_id);const isOut=mv.movement_type==="out";return(
          <div key={mv.id} style={{...S.crd,borderLeft:"4px solid "+(isOut?C.orange:C.green)}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
              <div><div style={{fontSize:13,fontWeight:700}}>{mat?.name||"?"}</div><div style={{fontSize:11,color:C.dim}}>{pers?.full_name||"?"} • {new Date(mv.movement_date).toLocaleDateString("tr-TR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div></div>
              <div style={S.tag(isOut?C.orangeD:C.greenD,isOut?C.orange:C.green)}>{isOut?"📤 -":"📥 +"}{mv.quantity} {mat?.unit||""}</div>
            </div>
            {mv.purpose&&<div style={{fontSize:11,color:C.text,marginTop:4}}>📋 {mv.purpose}</div>}
            {mv.location&&<div style={{fontSize:11,color:C.dim}}>📍 {mv.location}</div>}
          </div>
        );})}
        {bStockMovements.length===0&&<div style={S.emp}>Henüz stok hareketi yok</div>}
      </>}
    </div>);
  };

  const renderMaterialDetail=()=>{
    if(!selMaterial)return null;const m=selMaterial;
    const mvs=stockMovements.filter(mv=>mv.material_id===m.id).slice(0,20);
    const isLow=m.current_stock<=m.min_stock&&m.min_stock>0;
    return(<div style={S.mod} onClick={()=>setSelMaterial(null)}><div style={{...S.modC,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/>
      <div style={{fontSize:17,fontWeight:700,marginBottom:4}}>{m.name}</div>
      <div style={{fontSize:12,color:C.dim,marginBottom:12}}>{m.category} • {m.unit}</div>
      <div style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{flex:1,background:isLow?C.redD:C.greenD,borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:28,fontWeight:800,color:isLow?C.red:C.green}}>{m.current_stock}</div><div style={{fontSize:10,color:C.dim}}>Mevcut Stok</div></div>
        <div style={{flex:1,background:C.bg,borderRadius:10,padding:12,textAlign:"center",border:"1px solid "+C.border}}><div style={{fontSize:28,fontWeight:800,color:C.text}}>{m.min_stock}</div><div style={{fontSize:10,color:C.dim}}>Minimum</div></div>
      </div>
      {isLow&&<div style={{background:C.redD,borderRadius:10,padding:10,marginBottom:12,textAlign:"center"}}><span style={{color:C.red,fontWeight:700,fontSize:13}}>⚠ Kritik — Satın alma gerekli!</span></div>}
      {m.notes&&<div style={{fontSize:12,color:C.dim,marginBottom:12}}>📝 {m.notes}</div>}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <button style={{...S.btn(C.accentD,C.accent),flex:1}} onClick={()=>{setSelMaterial(null);setModStockOut(m);setStockOutForm({quantity:"",purpose:"",location:""});}}>📤 Çıkış</button>
        {canEditFault&&<button style={{...S.btn(C.greenD,C.green),flex:1}} onClick={()=>{setSelMaterial(null);setModStockIn(m);setStockInForm({quantity:"",notes:""});}}>📥 Giriş</button>}
      </div>
      {mvs.length>0&&<div><div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:6}}>Son Hareketler</div>{mvs.map(mv=>{const pers=profiles.find(p=>p.id===mv.personnel_id);const isOut=mv.movement_type==="out";return(
        <div key={mv.id} style={{padding:"8px 0",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:12}}>{pers?.full_name||"?"}</div><div style={{fontSize:10,color:C.dim}}>{new Date(mv.movement_date).toLocaleDateString("tr-TR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>{mv.purpose&&<div style={{fontSize:10,color:C.dim}}>📋 {mv.purpose}</div>}</div>
          <div style={{fontSize:13,fontWeight:700,color:isOut?C.orange:C.green}}>{isOut?"-":"+"}{mv.quantity}</div>
        </div>
      );})}</div>}
      {canEditFault&&<><div style={S.dv}/><button style={S.btn(C.border,C.text)} onClick={()=>{const newMin=prompt("Yeni minimum stok değeri:",m.min_stock);if(newMin!==null){const v=Number(newMin);if(!isNaN(v)){supabase.from('materials').update({min_stock:v}).eq('id',m.id).then(()=>{fetchMaterials();setSelMaterial({...m,min_stock:v});setToast("✓ Min stok güncellendi");});}}}}> Minimum Stok Düzenle</button></>}
      {isAdmin&&<button style={S.btn(C.redD,C.red)} onClick={async()=>{await supabase.from('materials').delete().eq('id',m.id);await fetchMaterials();setSelMaterial(null);setToast("🗑 Malzeme silindi");}}>🗑 Malzemeyi Sil</button>}
      <button style={S.btn(C.border,C.text)} onClick={()=>setSelMaterial(null)}>Kapat</button>
    </div></div>);
  };

  const renderStockOutModal=()=>{
    if(!modStockOut)return null;const m=modStockOut;
    return(<div style={S.mod} onClick={()=>setModStockOut(null)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>📤 Malzeme Çıkışı</div>
      <div style={{fontSize:13,color:C.dim,marginBottom:12}}>{m.name} • Mevcut: <b style={{color:C.accent}}>{m.current_stock} {m.unit}</b></div>
      <div style={S.lbl}>Miktar ({m.unit})</div>
      <input style={S.inp} type="number" inputMode="decimal" placeholder={"Kaç "+m.unit+"?"} value={stockOutForm.quantity} onChange={e=>setStockOutForm(p=>({...p,quantity:e.target.value}))}/>
      {stockOutForm.quantity&&Number(stockOutForm.quantity)>m.current_stock&&<div style={{fontSize:12,color:C.red,marginBottom:8}}>⚠ Stokta yeterli yok! ({m.current_stock} {m.unit} mevcut)</div>}
      <div style={S.lbl}>Hangi iş için? (zorunlu)</div>
      <input style={S.inp} placeholder="Örn: 5. kat klima bakımı" value={stockOutForm.purpose} onChange={e=>setStockOutForm(p=>({...p,purpose:e.target.value}))}/>
      <div style={S.lbl}>Lokasyon</div>
      <input style={S.inp} placeholder="Örn: 7. Kat B Blok" value={stockOutForm.location} onChange={e=>setStockOutForm(p=>({...p,location:e.target.value}))}/>
      <button style={S.btn(C.accent)} onClick={doStockOut} disabled={submitting}>{submitting?"...":"Çıkış Yap"}</button>
      <button style={S.btn(C.border,C.text)} onClick={()=>setModStockOut(null)}>İptal</button>
    </div></div>);
  };

  const renderStockInModal=()=>{
    if(!modStockIn)return null;const m=modStockIn;
    return(<div style={S.mod} onClick={()=>setModStockIn(null)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>📥 Malzeme Girişi</div>
      <div style={{fontSize:13,color:C.dim,marginBottom:12}}>{m.name} • Mevcut: <b style={{color:C.accent}}>{m.current_stock} {m.unit}</b></div>
      <div style={S.lbl}>Miktar ({m.unit})</div>
      <input style={S.inp} type="number" inputMode="decimal" placeholder={"Kaç "+m.unit+" geldi?"} value={stockInForm.quantity} onChange={e=>setStockInForm(p=>({...p,quantity:e.target.value}))}/>
      <div style={S.lbl}>Not (opsiyonel)</div>
      <input style={S.inp} placeholder="Örn: Satın alma ile geldi" value={stockInForm.notes} onChange={e=>setStockInForm(p=>({...p,notes:e.target.value}))}/>
      <button style={S.btn(C.green)} onClick={doStockIn} disabled={submitting}>{submitting?"...":"Giriş Yap"}</button>
      <button style={S.btn(C.border,C.text)} onClick={()=>setModStockIn(null)}>İptal</button>
    </div></div>);
  };

  const renderNewMatModal=()=>{
    if(!modNewMat)return null;
    return(<div style={S.mod} onClick={()=>setModNewMat(false)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:16}}>+ Yeni Malzeme</div>
      <div style={S.lbl}>Malzeme Adı</div>
      <input style={S.inp} placeholder="Örn: 500 lt Genleşme Tankı" value={matForm.name} onChange={e=>setMatForm(p=>({...p,name:e.target.value}))}/>
      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1}}><div style={S.lbl}>Kategori</div><select style={S.sel} value={matForm.category} onChange={e=>setMatForm(p=>({...p,category:e.target.value}))}>{MAT_CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
        <div style={{flex:1}}><div style={S.lbl}>Birim</div><select style={S.sel} value={matForm.unit} onChange={e=>setMatForm(p=>({...p,unit:e.target.value}))}>{MAT_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
      </div>
      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1}}><div style={S.lbl}>Mevcut Stok</div><input style={S.inp} type="number" inputMode="decimal" value={matForm.current_stock} onChange={e=>setMatForm(p=>({...p,current_stock:e.target.value}))}/></div>
        <div style={{flex:1}}><div style={S.lbl}>Minimum Stok</div><input style={S.inp} type="number" inputMode="decimal" value={matForm.min_stock} onChange={e=>setMatForm(p=>({...p,min_stock:e.target.value}))}/></div>
      </div>
      <div style={S.lbl}>Not</div>
      <input style={S.inp} placeholder="Opsiyonel not..." value={matForm.notes} onChange={e=>setMatForm(p=>({...p,notes:e.target.value}))}/>
      <button style={S.btn(C.accent)} onClick={addMaterial} disabled={submitting}>{submitting?"...":"Kaydet"}</button>
      <button style={S.btn(C.border,C.text)} onClick={()=>setModNewMat(false)}>İptal</button>
    </div></div>);
  };

  const renderBulkUploadModal=()=>{
    if(!modBulkUpload)return null;
    return(<div style={S.mod} onClick={()=>setModBulkUpload(false)}><div style={{...S.modC,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>📄 CSV Toplu Yükleme</div>
      <div style={{fontSize:12,color:C.dim,marginBottom:16}}>Excel dosyanızı CSV olarak kaydedin ve yükleyin</div>
      <div style={{...S.lawBox,marginBottom:12}}><div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4}}>CSV Format Örneği:</div><div style={{fontSize:11,color:C.text,fontFamily:"monospace",lineHeight:1.6}}>Malzeme Adı,Kategori,Birim,Stok,Minimum<br/>Genleşme Tankı 500lt,Tesisat,Adet,2,3<br/>Bakır Boru 15mm,Tesisat,Metre,50,20<br/>Kompresör Yağı,Klima/Havalandırma,Litre,10,5</div></div>
      {!bulkParsed?<>
        <button style={S.btn(C.accent)} onClick={()=>csvRef.current?.click()}>📁 CSV Dosyası Seç</button>
        <input ref={csvRef} type="file" accept=".csv,.txt,.tsv" style={{display:"none"}} onChange={handleCSV}/>
      </>:<>
        <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:8}}>✓ {bulkData.length} malzeme okundu</div>
        <div style={{maxHeight:200,overflowY:"auto",marginBottom:12}}>{bulkData.slice(0,20).map((r,i)=>(
          <div key={i} style={{fontSize:11,padding:"6px 0",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between"}}>
            <span>{r.name}</span><span style={{color:C.dim}}>{r.category} • {r.current_stock} {r.unit}</span>
          </div>
        ))}{bulkData.length>20&&<div style={{fontSize:11,color:C.dim,padding:6}}>...ve {bulkData.length-20} malzeme daha</div>}</div>
        <button style={S.btn(C.accent)} onClick={doBulkUpload} disabled={submitting}>{submitting?"Yükleniyor...":"✓ "+bulkData.length+" Malzeme Yükle"}</button>
        <button style={S.btn(C.border,C.text)} onClick={()=>{setBulkData([]);setBulkParsed(false);}}>Farklı Dosya Seç</button>
      </>}
      <button style={S.btn(C.border,C.text)} onClick={()=>setModBulkUpload(false)}>Kapat</button>
    </div></div>);
  };

  const renderDashboard=()=>{
    if(isPerso){
      const myOTs=overtimes.filter(o=>o.personnel_id===profile.id).sort((a,b)=>(b.work_date||"").localeCompare(a.work_date||""));
      const tOT=myTotOTH(profile.id),tLHV=myTotLH(profile.id),uH=myTotUsedLV(profile.id),rH=myRemHours(profile.id),debt=myDebtDays(profile.id);
      return(<div>
        <div style={{...S.crd,background:"linear-gradient(135deg,#1e1b4b,#312e81)",cursor:"default"}}>
          <div style={S.row}><div style={S.av(C.accentD,50)}>{ini(profile.full_name)}</div><div><div style={{fontSize:16,fontWeight:700}}>{profile.full_name}</div><div style={{fontSize:12,color:C.dim}}>{profile.role}</div></div></div>
          <div style={S.stB}>
            <div style={S.st(C.accentD)}><div style={{fontSize:16,fontWeight:800,color:C.accent}}>{tOT}s</div><div style={{fontSize:9,color:C.dim}}>Çalışılan</div></div>
            <div style={S.st(C.purpleD)}><div style={{fontSize:16,fontWeight:800,color:C.purple}}>{tLHV}s</div><div style={{fontSize:9,color:C.dim}}>Hak(x1.5)</div></div>
            <div style={S.st(C.greenD)}><div style={{fontSize:16,fontWeight:800,color:C.green}}>{uH}s</div><div style={{fontSize:9,color:C.dim}}>Kullanılan</div></div>
            <div style={S.st(rH<0?C.redD:"rgba(255,255,255,0.08)")}><div style={{fontSize:16,fontWeight:800,color:rH<0?C.red:C.text}}>{rH}s</div><div style={{fontSize:9,color:C.dim}}>{rH<0?"BORÇ":"Kalan"}</div></div>
          </div>
          {debt>0&&<div style={{marginTop:8,background:C.redD,borderRadius:8,padding:"6px 10px",textAlign:"center"}}><span style={{fontSize:12,color:C.red,fontWeight:700}}>⚠ {debt} gun mesai borcu</span></div>}
        </div>
        <button style={S.btn(C.accent)} onClick={()=>{setOtForm({date:todayStr(),startTime:"17:00",endTime:"",otType:"evening",desc:""});setOtErrors([]);setModNewOT(true);}}>+ Fazla Mesai Bildir</button>
        {myPendingVotes.length>0&&<div style={{...S.crd,background:votePeriod.isUrgent?C.redD:votePeriod.isWarning?"rgba(245,158,11,0.12)":"rgba(99,102,241,0.1)",borderColor:votePeriod.isUrgent?`${C.red}66`:votePeriod.isWarning?`${C.orange}44`:`${C.accent}44`,cursor:"pointer",textAlign:"center"}} onClick={()=>setPage("faults")}>
          <div style={{fontSize:votePeriod.isUrgent?24:20,fontWeight:800,color:votePeriod.isUrgent?C.red:votePeriod.isWarning?C.orange:C.accent}}>🗳 {myPendingVotes.length}</div>
          <div style={{fontSize:12,fontWeight:600,color:votePeriod.isUrgent?C.red:votePeriod.isWarning?C.orange:C.text}}>Arıza için oy bekleniyor</div>
          <div style={{fontSize:10,color:C.muted,marginTop:4}}>{votePeriod.isUrgent?"⏰ Son gün! Bugün oy kullanın":"Kalan süre: "+votePeriod.daysLeft+" gün"}</div>
        </div>}
        <div style={{height:12}}/>
        <div style={S.sec}><span>⏱</span> Son Mesailer</div>
        {myOTs.length===0&&<div style={S.emp}>Henüz mesai kaydi yok</div>}
        {myOTs.slice(0,10).map(o=>(<div key={o.id} style={S.crd} onClick={()=>setSelOT(o)}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{fD(o.work_date)}</div><div style={{fontSize:11,color:C.dim}}>{o.start_time?.slice(0,5)}→{o.end_time?.slice(0,5)}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:C.accent}}>{o.hours}s<span style={{color:C.purple,fontSize:12}}> →{o.leave_hours}s</span></div><div style={S.tag(sColor(o.status)+"22",sColor(o.status))}>{sIcon(o.status)}</div></div></div>{o.description&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>{o.description.slice(0,60)}{o.description.length>60?"...":""}</div>}</div>))}
      </div>);
    }
    const list=bProfiles.filter(u=>u.active&&u.id!==profile?.id);
    const debtors=list.filter(u=>debtDays(u.id)>0);
    const vPC=isViewer?allPendCount:totPend;
    const myOTs=overtimes.filter(o=>o.personnel_id===profile.id).sort((a,b)=>(b.work_date||"").localeCompare(a.work_date||""));
    const myTOT=myTotOTH(profile.id),myLH=myTotLH(profile.id),myUH=myTotUsedLV(profile.id),myRH=myRemHours(profile.id),myDB=myDebtDays(profile.id);
    return(<div>
      {/* Kendi özet kartım */}
      <div style={{...S.crd,background:"linear-gradient(135deg,#1e1b4b,#312e81)",cursor:"default",marginBottom:12}}>
        <div style={S.row}><div style={S.av(C.accentD,40)}>{ini(profile.full_name)}</div><div><div style={{fontSize:15,fontWeight:700}}>{profile.full_name}</div><div style={{fontSize:11,color:C.dim}}>{profile.role}</div></div></div>
        <div style={S.stB}>
          <div style={S.st(C.accentD)}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{myTOT}s</div><div style={{fontSize:9,color:C.dim}}>Mesai</div></div>
          <div style={S.st(C.purpleD)}><div style={{fontSize:14,fontWeight:800,color:C.purple}}>{myLH}s</div><div style={{fontSize:9,color:C.dim}}>Hak</div></div>
          <div style={S.st(C.greenD)}><div style={{fontSize:14,fontWeight:800,color:C.green}}>{myUH}s</div><div style={{fontSize:9,color:C.dim}}>Kullanılan</div></div>
          <div style={S.st(myRH<0?C.redD:"rgba(255,255,255,0.08)")}><div style={{fontSize:14,fontWeight:800,color:myRH<0?C.red:C.text}}>{myRH}s</div><div style={{fontSize:9,color:C.dim}}>{myRH<0?"BORÇ":"Kalan"}</div></div>
        </div>
        <button style={{...S.btn(C.accent),marginTop:8}} onClick={()=>{setOtForm({date:todayStr(),startTime:"17:00",endTime:"",otType:"evening",desc:""});setOtErrors([]);setModNewOT(true);}}>+ Fazla Mesai Bildir</button>
        <div style={{marginTop:8,background:"rgba(20,184,166,0.08)",borderRadius:8,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:12,fontWeight:600,color:C.teal}}>🌴 Yıllık İzin</div>
          <div style={{fontSize:13,fontWeight:800,color:myAnnualRemaining()>0?C.teal:C.red}}>{myAnnualRemaining()}/{myAnnualDays()}g kalan</div>
        </div>
        {(()=>{const yOT=yearlyOTH(profile.id),pct=yearlyOTPct(profile.id);return yOT>0?<div style={{marginTop:8,background:pct>=90?"rgba(239,68,68,0.08)":pct>=70?"rgba(245,158,11,0.08)":"rgba(99,102,241,0.06)",borderRadius:8,padding:"8px 12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:11,fontWeight:600,color:pct>=90?C.red:pct>=70?C.orange:C.dim}}>⚖️ Yıllık Mesai ({new Date().getFullYear()})</div>
            <div style={{fontSize:12,fontWeight:800,color:pct>=90?C.red:pct>=70?C.orange:C.text}}>{yOT}/{YEARLY_OT_LIMIT}s</div>
          </div>
          <div style={{height:4,borderRadius:2,background:C.bg,overflow:"hidden",marginTop:4}}><div style={{height:"100%",borderRadius:2,width:Math.min(100,pct)+"%",background:pct>=90?C.red:pct>=70?C.orange:C.accent}}/></div>
          {pct>=90&&<div style={{fontSize:10,color:C.red,fontWeight:700,marginTop:4}}>⚠ Yasal mesai sınırına yaklaşıldı!</div>}
        </div>:null;})()}
      </div>
      <div style={{...S.crd,background:vPC>0?C.orangeD:C.card,cursor:vPC>0?"pointer":"default",textAlign:"center"}} onClick={()=>vPC>0&&setPage("approvals")}>
        <div style={{fontSize:28,fontWeight:800,color:vPC>0?C.orange:C.green}}>{vPC>0?vPC:"✓"}</div>
        <div style={{fontSize:12,color:C.dim}}>{vPC>0?"Onay Bekleyen Talep":"Bekleyen talep yok"}</div>
        {isViewer&&vPC>0&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>Sadece görüntüleme</div>}
      </div>
      {myPendingVotes.length>0&&<div style={{...S.crd,background:votePeriod.isUrgent?C.redD:votePeriod.isWarning?"rgba(245,158,11,0.12)":"rgba(99,102,241,0.1)",borderColor:votePeriod.isUrgent?`${C.red}66`:votePeriod.isWarning?`${C.orange}44`:`${C.accent}44`,cursor:"pointer"}} onClick={()=>setPage("faults")}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:14,fontWeight:700,color:votePeriod.isUrgent?C.red:C.accent}}>🗳 {myPendingVotes.length} arıza için oy bekleniyor</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>{votePeriod.isUrgent?"⏰ Son gün!":"Kalan: "+votePeriod.daysLeft+" gün"}</div></div>
          <div style={{fontSize:24}}>{votePeriod.isUrgent?"🔴":"📊"}</div>
        </div>
      </div>}
      {debtors.length>0&&<div style={{marginBottom:16}}><div style={{...S.sec,color:C.red}}><span>⚠</span> Borçlu Personel</div>{debtors.map(u=>(<div key={u.id} style={{...S.crd,borderColor:`${C.red}44`}} onClick={()=>{setSelPerson(u.id);setPage("person");}}><div style={S.row}><div style={S.av(C.redD)}>{ini(u.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{u.full_name}</div><div style={{fontSize:11,color:C.dim}}>{u.role}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:C.red}}>{debtDays(u.id)}</div><div style={{fontSize:10,color:C.red}}>gün borç</div></div></div></div>))}</div>}
      {criticalCount>0&&<div style={{...S.crd,background:"rgba(239,68,68,0.06)",borderColor:C.red+"44",cursor:"pointer"}} onClick={()=>{setPage("depo");setDepoTab("purchase");}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:14,fontWeight:700,color:C.red}}>🛒 {criticalCount} malzeme eksik</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>{lowStockMats.filter(m=>m.current_stock===0).length>0?lowStockMats.filter(m=>m.current_stock===0).length+" tükenmiş, ":""}Satın alma listesini kontrol et</div></div>
          <div style={{fontSize:24}}>📦</div>
        </div>
      </div>}
      <div style={S.sec}><span>👥</span> Personel ({list.length})</div>
      {list.map((p,i)=>{const rD=remDays(p.id),debt=debtDays(p.id),pend=pendCount(p.id),aR=annualRemaining(p.id),aT=annualDays(p.id);return(<div key={p.id} style={S.crd} onClick={()=>{setSelPerson(p.id);setPage("person");}}><div style={S.row}><div style={S.av(getAv(i))}>{ini(p.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p.full_name}</div><div style={{fontSize:11,color:C.dim}}>{p.role}{p.night_shift?" 🌙":""}</div>{pend>0&&<div style={{...S.tag(C.orangeD,C.orange),marginTop:4,display:"inline-block"}}>⏳ {pend}</div>}</div><div style={{textAlign:"right"}}>{debt>0?<div style={{fontSize:16,fontWeight:800,color:C.red}}>-{debt}g <span style={{fontSize:10,fontWeight:600}}>borç</span></div>:<div style={{fontSize:16,fontWeight:800,color:rD>0?C.green:C.muted}}>{rD}g <span style={{fontSize:10,fontWeight:600,color:C.dim}}>mesai</span></div>}<div style={{fontSize:12,fontWeight:700,color:aR>3?C.teal:aR>0?C.orange:C.red,marginTop:2}}>🌴 {aR}/{aT}g</div></div></div></div>);})}
    </div>);
  };

  const renderApprovals=()=>{
    if(isPerso)return<div style={S.emp}>Erişim yok</div>;
    const vOTs=isViewer?allPendOTs:pendOTs,vLVs=isViewer?allPendLVs:pendLVs;
    return(<div>
      {isViewer&&<div style={{background:C.blueD,borderRadius:10,padding:"10px 14px",marginBottom:16,textAlign:"center"}}><div style={{fontSize:12,color:C.blue,fontWeight:600}}>👁 Sadece Görüntüleme</div></div>}
      <div style={S.sec}><span>⏱</span> Mesai {vOTs.length>0&&<span style={S.tag(C.orangeD,C.orange)}>{vOTs.length}</span>}</div>
      {vOTs.length===0&&<div style={S.emp}>Yok ✓</div>}
      {vOTs.map(o=>{const p=getU(o.personnel_id);const debt=debtDays(o.personnel_id);return(<div key={o.id} style={S.crd} onClick={()=>setSelOT(o)}>
        <div style={S.row}><div style={S.av(C.orangeD)}>{ini(p?.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p?.full_name}</div><div style={{fontSize:11,color:C.dim}}>{fD(o.work_date)} {o.start_time?.slice(0,5)}→{o.end_time?.slice(0,5)}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:C.accent}}>{o.hours}s</div><div style={{fontSize:11,color:C.purple}}>→{o.leave_hours}s</div></div></div>
        <div style={{fontSize:12,color:C.dim,margin:"8px 0"}}>{o.description}</div>
        
        {debt>0&&<div style={{fontSize:11,color:C.red,fontWeight:600,marginBottom:8}}>⚠ {debt} gun mesai borcu var</div>}
        <div style={{fontSize:11,color:o.status==="pending_chef"?C.orange:C.blue,fontWeight:600,marginBottom:4}}>{o.status==="pending_chef"?"⏳ Şef Onayı Bekliyor":"⏳ Mühendis Onayı Bekliyor"}</div>
        {canApprove&&!isViewer&&<div style={{display:"flex",gap:8}} onClick={e=>e.stopPropagation()}><button style={S.btnS(C.green)} onClick={()=>doApproveOT(o.id,isChef?"chef":"manager")}>✓ Onayla</button><button style={S.btnS(C.redD,C.red)} onClick={()=>doRejectOT(o.id)}>✗ Reddet</button></div>}
      </div>);})}
      <div style={{...S.sec,marginTop:20}}><span>🏖</span> Izin {vLVs.length>0&&<span style={S.tag(C.blueD,C.blue)}>{vLVs.length}</span>}</div>
      {vLVs.length===0&&<div style={S.emp}>Yok ✓</div>}
      {vLVs.map(l=>{const p=getU(l.personnel_id);const rH=remHours(l.personnel_id);const willDebt=rH<l.total_hours;return(<div key={l.id} style={S.crd} onClick={()=>setSelLV(l)}>
        <div style={S.row}><div style={S.av(C.blueD)}>{ini(p?.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p?.full_name}</div>{l.leave_type==="hourly"?<div style={{fontSize:12,color:C.blue,fontWeight:600,marginTop:2}}>🕐 {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)} ({l.total_hours}s)</div>:<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>{(Array.isArray(l.dates)?l.dates:[]).map(d=><span key={d} style={S.tag(C.blueD,C.blue)}>{fDS(d)}</span>)}</div>}</div><div style={{fontSize:18,fontWeight:800}}>{l.leave_type==="hourly"?l.total_hours+"s":(Array.isArray(l.dates)?l.dates.length:0)+"g"}</div></div>
        {l.leave_type==="hourly"&&<div style={{...S.tag(C.blueD,C.blue),marginTop:6}}>🕐 Saatlik İzin - {fD(l.dates?.[0])}</div>}
        {l.reason&&<div style={{fontSize:12,color:C.dim,margin:"8px 0",background:C.bg,borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>📝 Sebep:</div>{l.reason}</div>}
        
        {willDebt&&<div style={{fontSize:11,color:C.red,fontWeight:700,margin:"8px 0",background:C.redD,borderRadius:6,padding:"4px 8px"}}>⚠ Onaylanirsa {Math.round((l.total_hours-rH)/8*10)/10} gün borçlanacak</div>}
        {l.previous_dates&&<div style={{fontSize:11,color:C.orange,margin:"8px 0"}}>🔄 Eski: {(Array.isArray(l.previous_dates)?l.previous_dates:[]).map(d=>fDS(d)).join(", ")}</div>}
        <div style={{fontSize:11,color:l.status==="pending_chef"?C.orange:C.blue,fontWeight:600,marginBottom:4}}>{l.status==="pending_chef"?"⏳ Şef Onayı Bekliyor":"⏳ Mühendis Onayı Bekliyor"}</div>
        {canApprove&&!isViewer&&<div style={{display:"flex",gap:8,marginTop:8}} onClick={e=>e.stopPropagation()}><button style={S.btnS(C.green)} onClick={()=>doApproveLV(l.id,isChef?"chef":"manager")}>✓ Onayla</button><button style={S.btnS(C.redD,C.red)} onClick={()=>doRejectLV(l.id)}>✗ Reddet</button></div>}
      </div>);})}
    </div>);
  };

  const renderAdmin=()=>{
    if(!isAdmin)return<div style={S.emp}>Erişim yok</div>;
    const activeAll=bProfiles.filter(u=>u.active&&u.id!==profile?.id);
    return(<div>
      <div style={S.sec}><span>⚙️</span> Yonetim</div>
      <button style={S.btn(C.accent)} onClick={()=>setModAddUser(true)}>+ Yeni Personel</button>
      <div style={{height:8}}/>
      <button style={S.btn(C.tealD,C.teal)} onClick={()=>setShowPWA(true)}>📲 Ana Ekrana Ekleme Rehberi</button>
      <div style={{height:8}}/>
      <button style={S.btn(C.purpleD,C.purple)} onClick={()=>{
        const yr=new Date().getFullYear(),mo=new Date().getMonth();
        const moName=MONTHS[mo]+" "+yr;
        const rows=bProfiles.filter(p=>p.active).map(p=>{
          const ot=overtimes.filter(o=>o.personnel_id===p.id&&o.status==="approved"&&(o.work_date||"").startsWith(yr+"-"+String(mo+1).padStart(2,"0"))).reduce((s,o)=>s+Number(o.hours||0),0);
          const lh=Math.round(ot*1.5*10)/10;
          const usedLv=leavesState.filter(l=>l.personnel_id===p.id&&isOTLeave(l)&&l.status==="approved"&&(Array.isArray(l.dates)?l.dates:[]).some(d=>d.startsWith(yr+"-"+String(mo+1).padStart(2,"0")))).reduce((s,l)=>{const ds=(Array.isArray(l.dates)?l.dates:[]).filter(d=>d.startsWith(yr+"-"+String(mo+1).padStart(2,"0")));return s+ds.length;},0);
          const annUsed=leavesState.filter(l=>l.personnel_id===p.id&&isAnnualLeave(l)&&l.status==="approved"&&(Array.isArray(l.dates)?l.dates:[]).some(d=>d.startsWith(yr+"-"+String(mo+1).padStart(2,"0")))).reduce((s,l)=>{const ds=(Array.isArray(l.dates)?l.dates:[]).filter(d=>d.startsWith(yr+"-"+String(mo+1).padStart(2,"0")));return s+ds.length;},0);
          const yOT=yearlyOTH(p.id);
          return{name:p.full_name,role:p.role,ot,lh,usedLv,annUsed,annTotal:p.annual_leave_days||14,yOT};
        });
        const activeFaultCount=bFaults.filter(f=>f.status==="active").length;
        const resolvedThisMonth=bFaults.filter(f=>f.status==="resolved"&&(f.resolved_date||"").startsWith(yr+"-"+String(mo+1).padStart(2,"0"))).length;
        const w=window.open("","_blank");
        w.document.write(`<html><head><title>Rapor - ${moName}</title><style>body{font-family:Arial;padding:20px;color:#222}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:12px}th{background:#f0f0f0;font-weight:700}.warn{color:red;font-weight:700}h1{font-size:18px}h2{font-size:14px;margin-top:20px;border-bottom:1px solid #ccc;padding-bottom:4px}@media print{body{padding:10px}}</style></head><body>`);
        w.document.write(`<h1>📊 ${curBuildingName} — ${moName} Raporu</h1><p>Oluşturma: ${new Date().toLocaleString("tr-TR")}</p>`);
        w.document.write(`<h2>👥 Personel Mesai & İzin Özeti</h2><table><tr><th>Personel</th><th>Görev</th><th>Mesai (s)</th><th>İzin Hakkı (s)</th><th>Mesai İzni (g)</th><th>Yıllık İzin (g)</th><th>Yıllık Mesai</th></tr>`);
        rows.forEach(r=>{w.document.write(`<tr><td>${r.name}</td><td>${r.role}</td><td>${r.ot}</td><td>${r.lh}</td><td>${r.usedLv}</td><td>${r.annUsed}/${r.annTotal}</td><td ${r.yOT>YEARLY_OT_LIMIT*0.9?"class=warn":""}>${r.yOT}/${YEARLY_OT_LIMIT}s</td></tr>`);});
        w.document.write(`</table>`);
        w.document.write(`<h2>🔧 Arıza Durumu</h2><p>Aktif: <strong>${activeFaultCount}</strong> | Bu ay çözülen: <strong>${resolvedThisMonth}</strong></p>`);
        if(lowStockMats.length>0){w.document.write(`<h2>📦 Eksik Malzemeler (${lowStockMats.length})</h2><table><tr><th>Malzeme</th><th>Kategori</th><th>Mevcut</th><th>Minimum</th></tr>`);lowStockMats.forEach(m=>{w.document.write(`<tr><td>${m.name}</td><td>${m.category}</td><td>${m.current_stock} ${m.unit}</td><td>${m.min_stock}</td></tr>`);});w.document.write(`</table>`);}
        w.document.write(`</body></html>`);w.document.close();setTimeout(()=>w.print(),500);
      }}>📊 Aylık PDF Rapor</button>
      <div style={{height:16}}/>
      <div style={{height:16}}/>
      <div style={S.sec}><span>🔄</span> Vardiya Durumu</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1,...S.lawBox,borderColor:C.accent+"44",textAlign:"center"}}>
          <div style={{fontSize:11,color:C.accent,fontWeight:600}}>☀️ Gündüz</div>
          <div style={{fontSize:20,fontWeight:800,color:C.accent}}>{activeAll.filter(u=>!u.night_shift).length}</div>
          <div style={{marginTop:6}}>{activeAll.filter(u=>!u.night_shift).map(u=><div key={u.id} style={{fontSize:10,color:C.dim,padding:"1px 0"}}>{u.full_name}</div>)}</div>
        </div>
        <div style={{flex:1,...S.lawBox,borderColor:C.orange+"44",textAlign:"center"}}>
          <div style={{fontSize:11,color:C.orange,fontWeight:600}}>🌙 Gece</div>
          <div style={{fontSize:20,fontWeight:800,color:C.orange}}>{activeAll.filter(u=>u.night_shift).length}</div>
          <div style={{marginTop:6}}>{activeAll.filter(u=>u.night_shift).map(u=><div key={u.id} style={{fontSize:10,color:C.dim,padding:"1px 0"}}>{u.full_name}</div>)}</div>
        </div>
      </div>
      <div style={S.sec}><span>👥</span> Aktif ({activeAll.length})</div>
      {activeAll.map((u,i)=>{const rl=u.user_role==="chef"?"Şef":u.user_role==="viewer"?"İzleyici":u.user_role==="admin"?"Yönetici":"Personel";const rc=u.user_role==="chef"?C.orange:u.user_role==="viewer"?C.blue:u.user_role==="admin"?C.purple:C.green;const rb=u.user_role==="chef"?C.orangeD:u.user_role==="viewer"?C.blueD:u.user_role==="admin"?C.purpleD:C.greenD;return(<div key={u.id} style={S.crd} onClick={()=>setModEditUser(u)}><div style={S.row}><div style={S.av(getAv(i))}>{ini(u.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{u.full_name}</div><div style={{fontSize:11,color:C.dim}}>{u.role}</div></div><div style={S.tag(rb,rc)}>{rl}</div></div></div>);})}
      {bProfiles.filter(u=>!u.active).length>0&&<><div style={{...S.sec,marginTop:20}}><span>🚫</span> Pasif</div>{bProfiles.filter(u=>!u.active).map(u=><div key={u.id} style={{...S.crd,opacity:0.6}}><div style={S.row}><div style={S.av("rgba(255,255,255,0.05)")}>{ini(u.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14}}>{u.full_name}</div></div><button style={S.btnS(C.greenD,C.green)} onClick={e=>{e.stopPropagation();doReactivateU(u.id);}}>Aktif Et</button></div></div>)}</>}
    </div>);
  };

  const renderDayDetail=()=>{
    if(!selDay||page!=="calendar")return null;
    const ds=selDay,hol=isHoliday(ds);
    const lvs=leavesState.filter(l=>l.status!=="rejected"&&(Array.isArray(l.dates)?l.dates:[]).includes(ds)&&(!selBuilding||profileMap.get(l.personnel_id)?.building_id===selBuilding));
    const nbs=nobetState.filter(n=>(n.nobet_date||"").slice(0,10)===ds);
    return(<div style={S.mod} onClick={()=>setSelDay(null)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/>
      <div style={{fontSize:17,fontWeight:700,marginBottom:2}}>{fDS(ds)}</div>
      <div style={{fontSize:12,color:C.dim,marginBottom:12}}>{DAYS_TR[(new Date(ds+"T00:00:00").getDay()+6)%7]}</div>
      {hol&&<div style={{...S.tag(C.redD,C.red),marginBottom:12}}>🔴 {hol}</div>}
      <div style={{fontSize:13,fontWeight:700,color:C.teal,marginBottom:6}}>🌴 İzinde ({lvs.length})</div>
      {lvs.length===0?<div style={{fontSize:12,color:C.dim,marginBottom:12}}>İzinli personel yok</div>
        :<div style={{marginBottom:12}}>{lvs.map(l=>{const pp=getU(l.personnel_id);const ann=l.leave_source==="annual";return(<div key={l.id} onClick={()=>{setSelLV(l);setSelDay(null);}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.bg,borderRadius:8,padding:"8px 10px",marginTop:6,border:"1px solid "+C.border,cursor:"pointer"}}><div style={{fontSize:13,fontWeight:600}}>{pp?.full_name||"—"}</div><div style={S.tag(ann?C.tealD:C.accentD,ann?C.teal:C.accent)}>{ann?"🌴 Yıllık":"⏱ Mesai"}</div></div>);})}</div>}
      <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:6}}>🔵 Nöbetçi ({nbs.length})</div>
      {nbs.length===0?<div style={{fontSize:12,color:C.dim}}>Nöbet kaydı yok</div>
        :<div>{nbs.map(n=>{const dv=getU(n.devralan_id),asl=getU(n.asil_id);return(<div key={n.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.bg,borderRadius:8,padding:"8px 10px",marginTop:6,border:"1px solid "+C.border}}><div style={{fontSize:13,fontWeight:600,color:C.blue}}>{dv?.full_name||"—"}</div>{asl&&<div style={{fontSize:10,color:C.dim}}>{asl.full_name} yerine</div>}</div>);})}</div>}
      <div style={{height:12}}/>
      <button style={S.btn(C.border,C.text)} onClick={()=>setSelDay(null)}>Kapat</button>
    </div></div>);
  };

  const renderCalendar=()=>{
    const dim=daysInMonth(calY,calM),fd=firstDay(calY,calM),isSel=calMode!=="view";
    const myLvs=leavesState.filter(l=>l.personnel_id===profile.id&&l.status!=="rejected");
    const allLvs=isPerso?myLvs:bLeaves.filter(l=>l.status!=="rejected");
    const myLvDates={};myLvs.forEach(l=>(Array.isArray(l.dates)?l.dates:[]).forEach(d=>{myLvDates[d]={status:l.status,id:l.id};}));
    const lvDates={};allLvs.forEach(l=>(Array.isArray(l.dates)?l.dates:[]).forEach(d=>{lvDates[d]={status:l.status,id:l.id};}));
    const dayLeaves={};allLvs.forEach(l=>(Array.isArray(l.dates)?l.dates:[]).forEach(d=>{(dayLeaves[d]=dayLeaves[d]||[]).push(l);}));
    const dayNobet={};nobetState.forEach(n=>{const k=(n.nobet_date||"").slice(0,10);(dayNobet[k]=dayNobet[k]||[]).push(n);});
    const avD=myRemDays(profile.id),today=todayStr();
    function tog(d){if(!isSel)return;const ds=dateStr(calY,calM,d);if(myLvDates[ds]&&(!calModId||myLvDates[ds].id!==calModId)){setToast("Bu tarihte zaten izniniz var");return;}setCalSel(p=>p.includes(ds)?p.filter(x=>x!==ds):[...p,ds].sort());}
    function prev(){calM===0?(setCalY(calY-1),setCalM(11)):setCalM(calM-1);}
    function next(){calM===11?(setCalY(calY+1),setCalM(0)):setCalM(calM+1);}
    const cells=[];for(let i=0;i<fd;i++)cells.push(<div key={`e${i}`}/>);
    for(let d=1;d<=dim;d++){
      const ds=dateStr(calY,calM,d),isSeld=calSel.includes(ds),lv=lvDates[ds],isToday=ds===today,hol=isHoliday(ds);
      const cnt=(dayLeaves[ds]||[]).length,nbCnt=(dayNobet[ds]||[]).length;
      let bg="transparent",clr=C.text,brd="2px solid transparent";
      if(isSeld){bg=C.accent;clr="#fff";brd=`2px solid ${C.accentL}`;}
      else if(hol&&!lv){bg="rgba(239,68,68,0.08)";clr=C.red;}
      else if(lv){bg=lv.status==="approved"?C.greenD:C.orangeD;clr=lv.status==="approved"?C.green:C.orange;}
      else if(isToday)brd=`2px solid ${C.accent}`;
      const canOpen=!isPerso&&(cnt>0||nbCnt>0);
      cells.push(<div key={d} onClick={()=>{if(isSel){tog(d);}else if(canOpen){setSelDay(ds);}}} style={{width:"100%",paddingTop:"100%",borderRadius:10,background:bg,border:brd,position:"relative",cursor:(isSel||canOpen)?"pointer":"default"}}><div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:14,fontWeight:isToday||isSeld?700:500,color:clr}}>{d}</div>{!isPerso&&!isSeld&&cnt>0?<div style={{fontSize:9,fontWeight:800,color:C.teal,lineHeight:1,marginTop:1}}>🌴{cnt}</div>:hol&&!isSeld?<div style={{width:5,height:5,borderRadius:"50%",background:C.red,marginTop:1}}/>:lv&&!isSeld?<div style={{width:4,height:4,borderRadius:"50%",background:lv.status==="approved"?C.green:C.orange,marginTop:2}}/>:null}{!isPerso&&!isSeld&&nbCnt>0?<div style={{position:"absolute",top:2,right:3,fontSize:8,fontWeight:800,color:C.blue}}>N</div>:null}</div></div>);
    }
    const needH=calSel.length*8,currentRH=myRemHours(profile.id),willDebt=needH>0&&currentRH<needH,debtAmt=willDebt?Math.round((needH-currentRH)/8*10)/10:0;
    return(<div>
      <div style={S.sec}><span>📅</span> İzin Takvimi</div>
      {/* Leave source toggle */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        <button style={{flex:1,padding:"10px",borderRadius:10,border:"2px solid "+(leaveSource==="overtime"?C.accent:C.border),background:leaveSource==="overtime"?C.accentD:"transparent",color:leaveSource==="overtime"?C.accent:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>{setLeaveSource("overtime");setCalMode("view");setCalSel([]);setHourlyMode(false);}}>⏱ Mesai İzni</button>
        <button style={{flex:1,padding:"10px",borderRadius:10,border:"2px solid "+(leaveSource==="annual"?C.teal:C.border),background:leaveSource==="annual"?C.tealD:"transparent",color:leaveSource==="annual"?C.teal:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>{setLeaveSource("annual");setCalMode("view");setCalSel([]);setHourlyMode(false);}}>🌴 Yıllık İzin</button>
      </div>
      {/* Balance display */}
      {leaveSource==="overtime"?
        <div style={{...S.lawBox,marginBottom:12,borderColor:C.accent+"44"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:12,fontWeight:700,color:C.accent}}>⏱ Mesai İzin Hakkı</div><div style={{fontSize:10,color:C.dim}}>Fazla mesaiden kazanılan</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:800,color:avD>=0?C.green:C.red}}>{avD}g</div><div style={{fontSize:9,color:C.dim}}>{myRemHours(profile.id)}s kalan</div></div>
          </div>
        </div>
      :<div style={{...S.lawBox,marginBottom:12,borderColor:C.teal+"44"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:12,fontWeight:700,color:C.teal}}>🌴 Yıllık İzin Hakkı</div><div style={{fontSize:10,color:C.dim}}>Toplam: {myAnnualDays()} gün</div></div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:20,fontWeight:800,color:myAnnualRemaining()>0?C.green:C.red}}>{myAnnualRemaining()}g</div>
              <div style={{fontSize:9,color:C.dim}}>{myAnnualUsed()}g kullanıldı</div>
            </div>
          </div>
          <div style={{height:6,borderRadius:3,background:C.bg,overflow:"hidden",marginTop:8}}>
            <div style={{height:"100%",borderRadius:3,width:Math.min(100,Math.round((myAnnualUsed()/Math.max(myAnnualDays(),1))*100))+"%",background:myAnnualRemaining()<=2?C.red:myAnnualRemaining()<=5?C.orange:C.teal}}/>
          </div>
        </div>
      }
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <button onClick={prev} style={{background:C.accentD,border:"none",color:C.accent,width:40,height:40,borderRadius:10,cursor:"pointer",fontSize:18,fontWeight:700,WebkitAppearance:"none"}}>&#8249;</button>
        <div style={{textAlign:"center"}}><div style={{fontSize:17,fontWeight:700}}>{MONTHS[calM]} {calY}</div>{isPerso&&<div style={{fontSize:11,color:avD>0?C.green:avD<0?C.red:C.muted,marginTop:2}}>{avD<0?`Borc: ${Math.abs(avD)} gun`:`Kalan: ${avD} gun`}</div>}</div>
        <button onClick={next} style={{background:C.accentD,border:"none",color:C.accent,width:40,height:40,borderRadius:10,cursor:"pointer",fontSize:18,fontWeight:700,WebkitAppearance:"none"}}>&#8250;</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>{DAYS_TR.map(d=><div key={d} style={{textAlign:"center",fontSize:11,color:C.muted,fontWeight:600,padding:"4px 0"}}>{d}</div>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>{cells}</div>
      {!isPerso&&<div style={{fontSize:10,color:C.dim,marginTop:8,textAlign:"center"}}>🌴 sayı = o gün izinli · <span style={{color:C.blue,fontWeight:700}}>N</span> = nöbet · güne dokun → kim izinde/nöbette</div>}
      {(()=>{const monthHols=Object.entries(HOLIDAYS_2026).filter(([d])=>{const[y,m]=d.split("-");return Number(y)===calY&&Number(m)===calM+1;});return monthHols.length>0?<div style={{marginTop:10,padding:"8px 10px",background:"rgba(239,68,68,0.06)",borderRadius:8,border:`1px solid ${C.red}22`}}><div style={{fontSize:11,fontWeight:700,color:C.red,marginBottom:4}}>🔴 Resmi Tatiller</div>{monthHols.map(([d,name])=><div key={d} style={{fontSize:11,color:C.dim,padding:"2px 0"}}>{fDS(d)} — <span style={{color:C.red}}>{name}</span></div>)}</div>:null;})()}
      {isSel&&calSel.length>0&&<div style={{...S.lawBox,marginTop:12}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{leaveSource==="annual"?"🌴":"📅"} Seçilen ({calSel.length} gun)</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{calSel.sort().map(d=><div key={d} onClick={()=>setCalSel(p=>p.filter(x=>x!==d))} style={{...S.tag(leaveSource==="annual"?C.tealD:C.accentD,leaveSource==="annual"?C.teal:C.accent),cursor:"pointer",padding:"4px 10px"}}>{fDS(d)} ✕</div>)}</div>
        <div style={S.dv}/>
        {leaveSource==="annual"?
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <div><div style={{fontSize:11,color:C.dim}}>Kullanılacak</div><div style={{fontSize:18,fontWeight:800,color:C.teal}}>{calSel.length}g</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:11,color:C.dim}}>Kalan Yıllık İzin</div><div style={{fontSize:18,fontWeight:800,color:myAnnualRemaining()-calSel.length>=0?C.green:C.red}}>{myAnnualRemaining()-calSel.length}g</div></div>
          </div>
        :<>
          <div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:11,color:C.dim}}>Kullanılacak</div><div style={{fontSize:18,fontWeight:800,color:C.purple}}>{needH}s</div></div><div style={{textAlign:"right"}}><div style={{fontSize:11,color:C.dim}}>Kalan Hak</div><div style={{fontSize:18,fontWeight:800,color:avD>=0?C.green:C.red}}>{avD}g</div></div></div>
          {willDebt&&<><div style={{marginTop:8,background:C.redD,borderRadius:8,padding:"6px 10px",textAlign:"center"}}><span style={{fontSize:12,color:C.red,fontWeight:700}}>⚠ {debtAmt} gün borçlanma olacak</span></div><div style={{marginTop:10}}><div style={{...S.lbl,color:C.red}}>📝 Fazla izin sebebi (zorunlu)</div><textarea style={{...S.ta,borderColor:`${C.red}66`,minHeight:60}} placeholder="Neden fazla izin istiyorsunuz?" value={leaveReason} onChange={e=>setLeaveReason(e.target.value)}/></div></>}
        </>}
        {!willDebt&&calMode==="select"&&<div style={{marginTop:10}}><div style={S.lbl}>📝 İzin sebebi (isteğe bağlı)</div><textarea style={{...S.ta,minHeight:50}} placeholder={leaveSource==="annual"?"Yıllık izin sebebiniz...":"İzin sebebiniz..."} value={leaveReason} onChange={e=>setLeaveReason(e.target.value)}/></div>}

      </div>}
      {isSel&&<div>
        {calMode==="select"&&leaveSource==="annual"&&<button style={S.btn(C.teal)} onClick={submitLeaveReq} disabled={submitting}>{submitting?"Gönderiliyor...":`🌴 Yıllık İzin Gönder (${calSel.length} gün)`}</button>}
        {calMode==="select"&&leaveSource==="overtime"&&<button style={S.btn(willDebt?C.orange:C.teal)} onClick={submitLeaveReq} disabled={submitting}>{submitting?"Gönderiliyor...":willDebt?`⚠ Borçlanarak İzin Gönder (${calSel.length} gun)`:`📅 Onaya Gönder (${calSel.length} gun)`}</button>}
        {calMode==="modify"&&<button style={S.btn(C.orange)} onClick={modifyLeave} disabled={submitting}>{submitting?"...":"📅 Tarihleri Değiştir"}</button>}
        <button style={S.btn(C.border,C.text)} onClick={()=>{setCalMode("view");setCalSel([]);setCalModId(null);setLeaveReason("");}}>İptal</button>
      </div>}
      {!isSel&&!hourlyMode&&leaveSource==="overtime"&&<div style={{display:"flex",gap:8}}>
        <button style={{...S.btn(C.teal),flex:1}} onClick={()=>{setCalMode("select");setCalSel([]);setLeaveReason("");}}>📅 Günlük İzin</button>
        <button style={{...S.btn(C.blueD,C.blue),flex:1}} onClick={()=>{setHourlyMode(true);setHourlyForm({date:todayStr(),startTime:"",endTime:"",reason:""});}}>🕐 Saatlik İzin</button>
      </div>}
      {!isSel&&!hourlyMode&&leaveSource==="annual"&&<div>
        <button style={S.btn(C.teal)} onClick={()=>{setCalMode("select");setCalSel([]);setLeaveReason("");}}>🌴 Yıllık İzin Talep Et</button>
      </div>}
      {hourlyMode&&<div style={{...S.lawBox,marginTop:12}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>🕐 Saatlik İzin Talebi</div>
        <div style={S.lbl}>Tarih</div>
        <div style={S.fInp} onClick={()=>setShowHourlyDatePicker(true)}><span style={{color:hourlyForm.date?C.text:C.muted}}>{hourlyForm.date?fD(hourlyForm.date):"Tarih seçin..."}</span><span style={{fontSize:18}}>📅</span></div>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><div style={S.lbl}>Çıkış Saati</div><div style={S.fInp} onClick={()=>setShowHourlyStartTP(true)}><span style={{color:hourlyForm.startTime?C.text:C.muted}}>{hourlyForm.startTime||"Saat"}</span><span>🕐</span></div></div>
          <div style={{flex:1}}><div style={S.lbl}>Dönüş Saati</div><div style={S.fInp} onClick={()=>setShowHourlyEndTP(true)}><span style={{color:hourlyForm.endTime?C.text:C.muted}}>{hourlyForm.endTime||"Saat"}</span><span>🕐</span></div></div>
        </div>
        {hourlyForm.startTime&&hourlyForm.endTime&&(()=>{const[sh,sm]=hourlyForm.startTime.split(":").map(Number);const[eh,em]=hourlyForm.endTime.split(":").map(Number);const mins=(eh*60+em)-(sh*60+sm);const hrs=mins>0?Math.round(mins/60*10)/10:0;return hrs>0?<div style={{background:C.accentD,borderRadius:8,padding:"8px 12px",marginBottom:10,textAlign:"center"}}><span style={{fontSize:16,fontWeight:800,color:C.accent}}>{hrs} saat</span><span style={{color:C.dim,fontSize:12}}> izin kullanılacak</span></div>:null;})()}
        <div style={S.lbl}>📝 Sebep (zorunlu, min 10 karakter)</div>
        <textarea style={S.ta} placeholder="İzin sebebinizi yazın..." value={hourlyForm.reason} onChange={e=>setHourlyForm(p=>({...p,reason:e.target.value}))}/>
        <div style={{fontSize:11,color:hourlyForm.reason.length>=10?C.green:C.muted,marginTop:-6,marginBottom:10,textAlign:"right"}}>{hourlyForm.reason.length}/10</div>

        <button style={S.btn(C.blue)} onClick={submitHourlyLeave} disabled={submitting}>{submitting?"Gönderiliyor...":"🕐 Saatlik İzin Gönder"}</button>
        <button style={S.btn(C.border,C.text)} onClick={()=>{setHourlyMode(false);}}>İptal</button>
      </div>}
      {!isSel&&<div style={{marginTop:16}}>
        {(()=>{
          const today=todayStr();
          const allLeaves=(isPerso?leavesState.filter(l=>l.personnel_id===profile.id):bLeaves).filter(l=>l.status!=="rejected");
          // Future: at least one date >= today OR status is pending
          const future=allLeaves.filter(l=>{
            const dates=Array.isArray(l.dates)?l.dates:[];
            const isPending=["pending_chef","pending_manager"].includes(l.status);
            const hasFuture=dates.some(d=>d>=today);
            const isHourly=l.leave_type==="hourly";
            if(isHourly){return (dates[0]||"")>=today||isPending;}
            return hasFuture||isPending;
          });
          // Past: all dates < today AND approved/used
          const past=allLeaves.filter(l=>{
            const dates=Array.isArray(l.dates)?l.dates:[];
            const isPending=["pending_chef","pending_manager"].includes(l.status);
            const isHourly=l.leave_type==="hourly";
            if(isPending)return false;
            if(isHourly)return (dates[0]||"")<today;
            return dates.length>0&&dates.every(d=>d<today);
          });
          // Group past by person
          const pastByPerson={};
          past.forEach(l=>{const pid=l.personnel_id;if(!pastByPerson[pid])pastByPerson[pid]=[];pastByPerson[pid].push(l);});
          return(<>
            <div style={S.sec}><span>🏖</span> İzin Talepleri {future.length>0&&<span style={{color:C.orange,fontSize:12}}>({future.length})</span>}</div>
            {future.length===0&&<div style={S.emp}>Bekleyen veya gelecek izin yok</div>}
            {future.map(l=>{const p=getU(l.personnel_id);const dates=Array.isArray(l.dates)?l.dates:[];const isHourly=l.leave_type==="hourly";return(<div key={l.id} style={S.crd} onClick={()=>setSelLV(l)}><div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}><div>{!isPerso&&<div style={{fontSize:13,fontWeight:600,marginBottom:4}}>{p?.full_name}</div>}{isHourly?<div><div style={{...S.tag(C.blueD,C.blue),marginBottom:4}}>🕐 Saatlik İzin</div><div style={{fontSize:12,color:C.text}}>{fDS(dates[0])} • {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)}</div></div>:<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{dates.map(d=><span key={d} style={S.tag(l.status==="approved"?C.greenD:C.orangeD,l.status==="approved"?C.green:C.orange)}>{fDS(d)}</span>)}</div>}{l.reason&&<div style={{fontSize:10,color:l.reason.includes("borc")?C.red:C.dim,marginTop:4}}>{l.reason.length>50?l.reason.slice(0,50)+"...":l.reason}</div>}</div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:700}}>{isHourly?l.total_hours+"s":dates.length+"g"}</div><div style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)}</div>{l.leave_doc_url&&<div style={{fontSize:10,color:C.green,marginTop:2}}>📄</div>}</div></div>{!isHourly&&(isPerso||isAdmin)&&l.status!=="approved"&&<button style={{...S.btnS(C.orangeD,C.orange),marginTop:8,fontSize:11}} onClick={e=>{e.stopPropagation();startModLV(l);}}>🔄 Tarihleri Değiştir</button>}</div>);})}

            {past.length>0&&<>
              <div style={{...S.sec,marginTop:20}}><span>✅</span> İzin Kullananlar <span style={{color:C.green,fontSize:12}}>({Object.keys(pastByPerson).length} kişi)</span></div>
              {Object.entries(pastByPerson).map(([pid,leaves])=>{
                const p=getU(pid);
                const totalDays=leaves.reduce((s,l)=>{const d=Array.isArray(l.dates)?l.dates:[];return s+(l.leave_type==="hourly"?0:d.length);},0);
                const totalHourly=leaves.filter(l=>l.leave_type==="hourly").reduce((s,l)=>s+(l.total_hours||0),0);
                const isExpanded=expandedPast===pid;
                return(<div key={pid} style={{...S.crd,cursor:"pointer"}} onClick={()=>{setExpandedPast(isExpanded?null:pid);}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={S.av(C.greenD,36)}>{ini(p?.full_name||"?")}</div>
                      <div>
                        <div style={{fontSize:14,fontWeight:600}}>{p?.full_name||"—"}</div>
                        <div style={{fontSize:11,color:C.dim}}>{p?.role||""}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right",display:"flex",alignItems:"center",gap:8}}>
                      <div>
                        {totalDays>0&&<div style={{fontSize:15,fontWeight:800,color:C.green}}>{totalDays}g</div>}
                        {totalHourly>0&&<div style={{fontSize:12,fontWeight:700,color:C.blue}}>{totalHourly}s</div>}
                      </div>
                      <div style={{fontSize:16,color:C.dim,transition:"transform 0.2s",transform:isExpanded?"rotate(180deg)":"rotate(0deg)"}}>▼</div>
                    </div>
                  </div>
                  {isExpanded&&<div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:12}} onClick={e=>e.stopPropagation()}>
                    {leaves.sort((a,b)=>{const da=(Array.isArray(a.dates)?a.dates:[a.created_at])[0]||"";const db=(Array.isArray(b.dates)?b.dates:[b.created_at])[0]||"";return db.localeCompare(da);}).map(l=>{
                      const dates=Array.isArray(l.dates)?l.dates:[];
                      const isHourly=l.leave_type==="hourly";
                      return(<div key={l.id} style={{background:C.bg,borderRadius:10,padding:10,marginBottom:8,border:`1px solid ${C.border}`}} onClick={()=>setSelLV(l)}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
                          <div>
                            {isHourly?<div><div style={{...S.tag(C.blueD,C.blue),marginBottom:4,display:"inline-block"}}>🕐 Saatlik</div><div style={{fontSize:12}}>{fDS(dates[0])} {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)}</div></div>
                            :<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{dates.map(d=><span key={d} style={{...S.tag(C.greenD,C.green),fontSize:11}}>{fDS(d)}</span>)}</div>}
                            {l.reason&&<div style={{fontSize:10,color:l.reason.includes("borc")?C.red:C.dim,marginTop:4}}>{l.reason.length>80?l.reason.slice(0,80)+"...":l.reason}</div>}
                          </div>
                          <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                            <div style={{fontSize:14,fontWeight:700}}>{isHourly?l.total_hours+"s":dates.length+"g"}</div>
                            <div style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)}</div>
                            {l.leave_doc_url&&<div style={{fontSize:10,color:C.green,marginTop:2}}>📄 Belge</div>}
                          </div>
                        </div>
                      </div>);
                    })}
                  </div>}
                </div>);
              })}
            </>}
          </>);
        })()}
      </div>}
    </div>);
  };

  const renderOTDetail=()=>{
    if(!selOT)return null;const o=selOT,p=getU(o.personnel_id);
    return(<div style={S.mod} onClick={()=>{setSelOT(null);setDeleteConfirm(null);setEditOT(null);}}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>Mesai Detayı</div>
      {p&&<div style={{fontSize:13,color:C.dim,marginBottom:8}}>{p.full_name}</div>}
      {o.overtime_type==="daytime"&&<div style={{...S.tag("rgba(245,158,11,0.15)",C.orange),marginBottom:12}}>☀️ Gündüz Mesai (İstirahat/Haftasonu)</div>}
      <div style={S.lawBox}>
        <div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:11,color:C.dim}}>Tarih</div><div style={{fontSize:15,fontWeight:700}}>{fD(o.work_date)}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:11,color:C.dim}}>Saat</div><div style={{fontSize:15,fontWeight:700}}>{o.start_time?.slice(0,5)} → {o.end_time?.slice(0,5)}</div></div></div>
        <div style={S.dv}/>
        <div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:11,color:C.dim}}>Çalışılan</div><div style={{fontSize:22,fontWeight:800,color:C.accent}}>{o.hours}s</div></div><div><div style={{fontSize:11,color:C.dim}}>→ Izin (x1.5)</div><div style={{fontSize:22,fontWeight:800,color:C.purple}}>{o.leave_hours}s</div></div></div>
      </div>
      <div style={{marginBottom:12}}><div style={S.lbl}>Durum</div><div style={S.tag(sColor(o.status)+"22",sColor(o.status))}>{sIcon(o.status)} {sText(o.status)}</div></div>
      <div style={{marginBottom:12}}><div style={S.lbl}>Açıklama</div><div style={{fontSize:13,color:C.text,background:C.bg,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>{o.description||"—"}</div></div>
      
      {isAdmin&&editOT&&editOT.id===o.id?<div style={{background:C.accentD,borderRadius:12,padding:14,marginTop:12}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:10,color:C.accent}}>✏️ Saatleri Düzelt</div>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><div style={S.lbl}>Başlangıç</div><div style={S.fInp} onClick={()=>setShowEditStartTP(true)}><span>{editOT.start_time||"Saat"}</span><span>🕐</span></div></div>
          <div style={{flex:1}}><div style={S.lbl}>Bitiş</div><div style={S.fInp} onClick={()=>setShowEditEndTP(true)}><span>{editOT.end_time||"Saat"}</span><span>🕐</span></div></div>
        </div>
        {editOT.start_time&&editOT.end_time&&(()=>{const h=calcOT(editOT.start_time,editOT.end_time,editOT.ot_type);return h>0?<div style={{...S.lawBox,marginTop:8,marginBottom:0}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:10,color:C.dim}}>Yeni Mesai</div><div style={{fontSize:20,fontWeight:800,color:C.accent}}>{h}s</div></div><div><div style={{fontSize:10,color:C.dim}}>Yeni İzin</div><div style={{fontSize:20,fontWeight:800,color:C.purple}}>{calcLH(h)}s</div></div></div>{(h!==o.hours)&&<div style={{fontSize:11,color:C.orange,marginTop:6}}>Önceki: {o.hours}s mesai → {o.leave_hours}s izin</div>}</div>:null;})()}
        <div style={{display:"flex",gap:8,marginTop:10}}><button style={{...S.btn(C.accent),flex:1}} onClick={doEditOT} disabled={submitting}>{submitting?"Kaydediliyor...":"💾 Kaydet"}</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setEditOT(null)}>İptal</button></div>
      </div>:isAdmin&&<button style={{...S.btn(C.accentD,C.accent),marginTop:8}} onClick={()=>setEditOT({id:o.id,start_time:o.start_time?.slice(0,5)||"17:00",end_time:o.end_time?.slice(0,5)||"18:00",ot_type:o.overtime_type||"evening"})}>✏️ Saatleri Düzelt</button>}
      {canApprove&&((isChef&&o.status==="pending_chef")||(isAdmin&&o.status==="pending_manager"))&&<><div style={S.dv}/><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.green),flex:1}} onClick={()=>{doApproveOT(o.id,isChef?"chef":"manager");setSelOT(null);}}>✓ Onayla</button><button style={{...S.btn(C.redD,C.red),flex:1}} onClick={()=>{doRejectOT(o.id);setSelOT(null);}}>✗ Reddet</button></div></>}
      {isAdmin&&<><div style={S.dv}/>{deleteConfirm===o.id?<div style={{background:C.redD,borderRadius:10,padding:14}}><div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:8,textAlign:"center"}}>⚠ Bu mesaiyi silmek istediğinize emin misiniz?</div><div style={{fontSize:11,color:C.dim,textAlign:"center",marginBottom:12}}>Geri alınamaz. Izin hakki da silinir.</div><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.red),flex:1}} onClick={()=>doDeleteOT(o.id)} disabled={submitting}>{submitting?"Siliniyor...":"🗑 Evet, Sil"}</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setDeleteConfirm(null)}>İptal</button></div></div>:<button style={S.btn(C.redD,C.red)} onClick={()=>setDeleteConfirm(o.id)}>🗑 Bu Mesaiyi Sil</button>}</>}
      <button style={S.btn(C.border,C.text)} onClick={()=>{setSelOT(null);setDeleteConfirm(null);setEditOT(null);}}>Kapat</button>
    </div></div>);
  };

  const renderLVDetail=()=>{
    if(!selLV)return null;const l=selLV,p=getU(l.personnel_id);const dates=Array.isArray(l.dates)?l.dates:[];const prevDates=Array.isArray(l.previous_dates)?l.previous_dates:[];
    return(<div style={S.mod} onClick={()=>setSelLV(null)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>Izin Detayı</div>
      {l.leave_source==="annual"&&<div style={{...S.tag(C.tealD,C.teal),marginBottom:8}}>🌴 Yıllık İzin</div>}
      {(!l.leave_source||l.leave_source==="overtime")&&l.leave_type!=="hourly"&&<div style={{...S.tag(C.accentD,C.accent),marginBottom:8}}>⏱ Mesai İzni</div>}
      {p&&<div style={{fontSize:13,color:C.dim,marginBottom:12}}>{p.full_name}</div>}
      {l.leave_type==="hourly"?<div style={{marginBottom:12}}>
        <div style={{...S.tag(C.blueD,C.blue),marginBottom:8}}>🕐 Saatlik İzin</div>
        <div style={{fontSize:14}}>Tarih: <strong>{fD(l.dates?.[0])}</strong></div>
        <div style={{fontSize:14,marginTop:4}}>Saat: <strong>{l.leave_start_time?.slice(0,5)} - {l.leave_end_time?.slice(0,5)}</strong></div>
        <div style={{fontSize:14,marginTop:4}}>Süre: <strong>{l.total_hours} saat</strong></div>
      </div>:<>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>{dates.map(d=><span key={d} style={S.tag(l.status==="approved"?C.greenD:C.orangeD,l.status==="approved"?C.green:C.orange)}>{fD(d)}</span>)}</div>
        <div style={{fontSize:14,marginBottom:8}}>Toplam: <strong>{dates.length} gün</strong> ({l.total_hours} saat)</div>
      </>}
      <div style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)} {sText(l.status)}</div>
      {l.reason&&<div style={{marginTop:12,background:C.bg,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>📝 Sebep</div><div style={{fontSize:13,color:l.reason.includes("borc")?C.red:C.text}}>{l.reason}</div></div>}
      
      {prevDates.length>0&&<div style={{fontSize:12,color:C.orange,marginTop:12}}>🔄 Önceki: {prevDates.map(d=>fD(d)).join(", ")}</div>}
      {canApprove&&((isChef&&l.status==="pending_chef")||(isAdmin&&l.status==="pending_manager"))&&<><div style={S.dv}/><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.green),flex:1}} onClick={()=>{doApproveLV(l.id,isChef?"chef":"manager");setSelLV(null);}}>✓ Onayla</button><button style={{...S.btn(C.redD,C.red),flex:1}} onClick={()=>{doRejectLV(l.id);setSelLV(null);}}>✗ Reddet</button></div></>}
      {isAdmin&&<><div style={S.dv}/>{deleteConfirm===l.id?<div style={{background:C.redD,borderRadius:10,padding:14}}><div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:8,textAlign:"center"}}>⚠ Bu izin talebini silmek istediğinize emin misiniz?</div><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.red),flex:1}} onClick={()=>doDeleteLV(l.id)} disabled={submitting}>{submitting?"Siliniyor...":"🗑 Evet, Sil"}</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setDeleteConfirm(null)}>İptal</button></div></div>:<button style={S.btn(C.redD,C.red)} onClick={()=>setDeleteConfirm(l.id)}>🗑 Bu İzni Sil</button>}</>}
      <button style={S.btn(C.border,C.text)} onClick={()=>{setSelLV(null);setDeleteConfirm(null);}}>Kapat</button>
    </div></div>);
  };

  const renderNewOT=()=>{
    if(!modNewOT)return null;
    return(<div style={S.mod} onClick={()=>setModNewOT(false)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:4}}>Fazla Mesai Bildir</div><div style={{fontSize:12,color:C.dim,marginBottom:16}}>Tum alanlar zorunlu</div>
      <div style={S.lbl}>Mesai Türü</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <button style={{flex:1,padding:"12px",borderRadius:10,border:`2px solid ${otForm.otType==="evening"?C.accent:C.border}`,background:otForm.otType==="evening"?C.accentD:C.bg,color:otForm.otType==="evening"?C.accent:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>setOtForm(p=>({...p,otType:"evening",startTime:"17:00",endTime:""}))}>🌙 Akşam/Gece<div style={{fontSize:10,fontWeight:500,marginTop:2}}>17:00 sonrası</div></button>
        <button style={{flex:1,padding:"12px",borderRadius:10,border:`2px solid ${otForm.otType==="daytime"?C.orange:C.border}`,background:otForm.otType==="daytime"?"rgba(245,158,11,0.1)":C.bg,color:otForm.otType==="daytime"?C.orange:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>setOtForm(p=>({...p,otType:"daytime",startTime:"08:00",endTime:""}))}>☀️ Gündüz<div style={{fontSize:10,fontWeight:500,marginTop:2}}>İstirahat/Haftasonu</div></button>
      </div>
      <div style={S.lbl}>Tarih</div>
      <div style={S.fInp} onClick={()=>setShowDatePicker(true)}><span style={{color:otForm.date?C.text:C.muted}}>{otForm.date?fD(otForm.date):"Tarih seçin..."}</span><span style={{fontSize:18}}>📅</span></div>
      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1}}><div style={S.lbl}>Başlangıç</div><div style={S.fInp} onClick={()=>setShowStartTP(true)}><span style={{color:otForm.startTime?C.text:C.muted}}>{otForm.startTime||"Saat"}</span><span>🕐</span></div></div>
        <div style={{flex:1}}><div style={S.lbl}>Bitiş</div><div style={S.fInp} onClick={()=>setShowEndTP(true)}><span style={{color:otForm.endTime?C.text:C.muted}}>{otForm.endTime||"Saat"}</span><span>🕐</span></div></div>
      </div>
      {otForm.endTime&&<div style={S.lawBox}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:11,color:C.dim}}>Mesai</div><div style={{fontSize:24,fontWeight:800,color:liveOTH>0?C.accent:C.red}}>{liveOTH}s</div></div><div style={{fontSize:20,color:C.dim,display:"flex",alignItems:"center"}}>→</div><div style={{textAlign:"right"}}><div style={{fontSize:11,color:C.dim}}>Izin (x1.5)</div><div style={{fontSize:24,fontWeight:800,color:C.purple}}>{liveLH}s</div></div></div></div>}

      <div style={{display:"flex",gap:10,marginBottom:12,justifyContent:"space-between"}}>


      </div>
      <div style={S.lbl}>Açıklama (min 20 karakter)</div>
      <textarea ref={descRef} style={S.ta} placeholder="Yapılan işi detaylı açıklayın..." defaultValue={otForm.desc} onChange={e=>setOtForm(prev=>({...prev,desc:e.target.value}))}/>
      <div style={{fontSize:11,color:(otForm.desc||"").length>=20?C.green:C.muted,marginTop:-6,marginBottom:10,textAlign:"right"}}>{(otForm.desc||"").length}/20</div>
      {otErrors.length>0&&<div style={S.errBox}>{otErrors.map((e,i)=><div key={i} style={{fontSize:12,color:C.red}}>• {e}</div>)}</div>}
      <button style={S.btn(C.accent)} onClick={submitOT} disabled={submitting}>{submitting?"Gönderiliyor...":"Onaya Gönder"}</button>
      <button style={S.btn(C.border,C.text)} onClick={()=>{setModNewOT(false);setOtErrors([]);}}>İptal</button>
    </div></div>);
  };

  const renderAddUser=()=>{if(!modAddUser)return null;return(<div style={S.mod} onClick={()=>setModAddUser(false)}><div style={S.modC} onClick={e=>e.stopPropagation()}><div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:16}}>+ Personel</div><div style={S.lbl}>Ad Soyad</div><input style={S.inp} value={nUser.name} onChange={e=>setNUser(p=>({...p,name:e.target.value}))}/><div style={S.lbl}>E-posta</div><input style={S.inp} type="email" inputMode="email" autoCapitalize="none" value={nUser.email} onChange={e=>setNUser(p=>({...p,email:e.target.value}))}/><div style={S.lbl}>Sifre</div><input style={S.inp} type="text" value={nUser.password} onChange={e=>setNUser(p=>({...p,password:e.target.value}))}/><div style={S.lbl}>Görev</div><input style={S.inp} value={nUser.role} onChange={e=>setNUser(p=>({...p,role:e.target.value}))}/><div style={S.lbl}>Bina</div><select style={S.sel} value={nUser.buildingId||selBuilding||""} onChange={e=>setNUser(p=>({...p,buildingId:e.target.value}))}>{buildings.map(b=><option key={b.id} value={b.id}>{b.short_name||b.name}</option>)}</select><div style={S.lbl}>Yetki</div><select style={S.sel} value={nUser.userRole} onChange={e=>setNUser(p=>({...p,userRole:e.target.value}))}><option value="personnel">Personel</option><option value="chef">Teknik Şef (Onay Yetkili)</option><option value="viewer">İzleyici (Tam Görüntüleme)</option></select><button style={S.btn(C.accent)} onClick={doAddUser} disabled={submitting}>{submitting?"...":"Ekle"}</button><button style={S.btn(C.border,C.text)} onClick={()=>setModAddUser(false)}>İptal</button></div></div>);};

  const renderEditUser=()=>{if(!modEditUser)return null;const u=modEditUser;return(<div style={S.mod} onClick={()=>{setModEditUser(null);setDeleteConfirm(null);}}><div style={S.modC} onClick={e=>e.stopPropagation()}><div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:16}}>Düzenle: {u.full_name}</div><div style={S.lbl}>Görev</div><input style={S.inp} value={u.role||""} onChange={e=>setModEditUser({...u,role:e.target.value})}/><div style={S.lbl}>Bina</div><select style={S.sel} value={u.building_id||""} onChange={e=>setModEditUser({...u,building_id:e.target.value})}>{buildings.map(b=><option key={b.id} value={b.id}>{b.short_name||b.name}</option>)}</select><div style={S.lbl}>Yetki</div><select style={S.sel} value={u.user_role||"personnel"} onChange={e=>setModEditUser({...u,user_role:e.target.value})}><option value="personnel">Personel</option><option value="chef">Teknik Şef (Onay Yetkili)</option><option value="viewer">İzleyici (Tam Görüntüleme)</option></select><div style={S.lbl}>🌴 Yıllık İzin Hakkı (gün)</div><input style={S.inp} type="number" min="0" max="30" value={u.annual_leave_days||14} onChange={e=>setModEditUser({...u,annual_leave_days:Number(e.target.value)||0})}/><div style={{fontSize:10,color:C.dim,marginTop:-8,marginBottom:12}}>Kullanılan: {annualUsed(u.id)}g / Kalan: {annualRemaining(u.id)}g</div><button style={S.btn(C.accent)} onClick={async()=>{try{await supabase.from('profiles').update({role:u.role,user_role:u.user_role,building_id:u.building_id,annual_leave_days:u.annual_leave_days||14}).eq('id',u.id);await fetchProfiles();setModEditUser(null);setToast("Kaydedildi");}catch(e){setToast("Hata: "+e?.message);}}}>Kaydet</button><div style={S.dv}/><button style={S.btn(C.orangeD,C.orange)} onClick={()=>doDeactivateU(u.id)}>🚫 Pasif Yap</button>{deleteConfirm===u.id?<div style={{background:C.redD,borderRadius:10,padding:14,marginTop:8}}><div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:8,textAlign:"center"}}>⚠ {u.full_name} silinecek. Mesai ve izin kayıtları arşivde kalır.</div><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.red),flex:1}} onClick={()=>doDeleteUser(u.id)}>🗑 Evet, Sil</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setDeleteConfirm(null)}>İptal</button></div></div>:<button style={S.btn(C.redD,C.red)} onClick={()=>setDeleteConfirm(u.id)}>🗑 Personeli Sil</button>}<button style={S.btn(C.border,C.text)} onClick={()=>{setModEditUser(null);setDeleteConfirm(null);}}>Kapat</button></div></div>);};

  const navItems=isAdmin?[{k:"dashboard",i:"📊",l:"Özet"},{k:"faults",i:"🔧",l:"Arızalar"},{k:"depo",i:"📦",l:"Depo"},{k:"calendar",i:"📅",l:"Takvim"},{k:"approvals",i:"✅",l:"Onaylar"},{k:"admin",i:"⚙️",l:"Yönetim"}]:(isChef||isViewer)?[{k:"dashboard",i:"📊",l:"Özet"},{k:"faults",i:"🔧",l:"Arızalar"},{k:"depo",i:"📦",l:"Depo"},{k:"calendar",i:"📅",l:"Takvim"},{k:"approvals",i:isViewer?"👁":"✅",l:isViewer?"Takip":"Onaylar"}]:[{k:"dashboard",i:"📊",l:"Özet"},{k:"faults",i:"🔧",l:"Arızalar"},{k:"depo",i:"📦",l:"Depo"},{k:"calendar",i:"📅",l:"Takvim"}];
  const roleLabel=isAdmin?"👑 Yonetici":isChef?"🔧 Sef":isViewer?"👁 Izleyici":"👷 Personel";

  return(
    <div style={S.app}>
      <div style={S.hdr}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:36,height:36,minWidth:36,borderRadius:10,background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🔧</div><div><div style={{fontSize:17,fontWeight:700}}>İBB Teknik Takip</div><div style={{fontSize:11,color:C.dim}}>{curBuildingName||"Fazla Mesai & İzin"}</div></div></div>
          <div style={{display:"flex",gap:6}}><button onClick={()=>setShowPWA(true)} style={{fontSize:14,padding:"6px 8px",borderRadius:20,background:C.accentD,color:C.accent,border:"none",cursor:"pointer"}}>📲</button><button onClick={()=>{setShowNotifs(!showNotifs);try{localStorage.setItem("notif_seen",new Date().toISOString());}catch(e){}}} style={{fontSize:14,padding:"6px 8px",borderRadius:20,background:unreadNotifs>0?C.orangeD:C.accentD,color:unreadNotifs>0?C.orange:C.accent,border:"none",cursor:"pointer",position:"relative"}}>🔔{unreadNotifs>0&&<span style={{position:"absolute",top:-4,right:-4,width:18,height:18,borderRadius:9,background:C.red,color:"#fff",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{unreadNotifs>9?"9+":unreadNotifs}</span>}</button><button onClick={doLogout} style={{fontSize:11,padding:"6px 12px",borderRadius:20,background:C.redD,color:C.red,border:"none",cursor:"pointer",fontWeight:600}}>Çıkış</button></div>
        </div>
        {/* Building Selector */}
        {canSwitchBuilding&&buildings.length>1&&<div style={{display:"flex",gap:6,marginBottom:8,overflowX:"auto",paddingBottom:2}}>
          {buildings.map(b=><button key={b.id} style={{padding:"6px 14px",borderRadius:20,border:"2px solid "+(selBuilding===b.id?C.accent:C.border),background:selBuilding===b.id?C.accentD:"transparent",color:selBuilding===b.id?C.accent:C.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}} onClick={()=>setSelBuilding(b.id)}>{b.short_name||b.name}</button>)}
        </div>}
        <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.05)",borderRadius:8,padding:"8px 12px"}}><div style={S.av(C.accentD,28)}>{ini(profile.full_name)}</div><div><div style={{fontSize:13,fontWeight:600}}>{profile.full_name}</div><div style={{fontSize:10,color:C.dim}}>{roleLabel}</div></div></div>
      </div>
      <div style={S.cnt}>
        {page==="dashboard"&&renderDashboard()}
        {page==="person"&&renderPersonDetail()}
        {page==="faults"&&renderFaults()}
        {page==="depo"&&renderDepo()}
        {page==="calendar"&&renderCalendar()}
        {page==="approvals"&&renderApprovals()}
        {page==="admin"&&renderAdmin()}
      </div>
      <div style={S.nav}>{navItems.map(n=>(<button key={n.k} style={S.navB(page===n.k||(n.k==="dashboard"&&page==="person"))} onClick={()=>{setPage(n.k);setSelPerson(null);if(n.k!=="calendar"){setCalMode("view");setCalSel([]);}}}><span style={{fontSize:18}}>{n.i}</span>{n.l}{n.k==="approvals"&&((canApprove&&totPend>0)||(isViewer&&allPendCount>0))&&<div style={S.dot}/>}{n.k==="depo"&&criticalCount>0&&<div style={S.dot}/>}</button>))}</div>
      {renderNewOT()}
      {renderNewFault()}
      {renderFaultDetail()}
      {renderMaterialDetail()}
      {renderStockOutModal()}
      {renderStockInModal()}
      {renderNewMatModal()}
      {renderBulkUploadModal()}
      {renderAddUser()}
      {renderEditUser()}
      {renderOTDetail()}
      {renderLVDetail()}
      {renderDayDetail()}
      {showDatePicker&&<CustomDatePicker value={otForm.date||todayStr()} onChange={v=>setOtForm(p=>({...p,date:v}))} onClose={()=>setShowDatePicker(false)}/>}
      {showStartTP&&<CustomTimePicker value={otForm.startTime||"17:00"} onChange={v=>setOtForm(p=>({...p,startTime:v}))} onClose={()=>setShowStartTP(false)} label="Başlangıç Saati"/>}
      {showEndTP&&<CustomTimePicker value={otForm.endTime||"18:00"} onChange={v=>setOtForm(p=>({...p,endTime:v}))} onClose={()=>setShowEndTP(false)} label="Bitiş Saati"/>}
      {showPWA&&<PWAInstallGuide onClose={()=>setShowPWA(false)}/>}
      {showNotifs&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",zIndex:250}} onClick={()=>setShowNotifs(false)}>
        <div style={{position:"absolute",top:60,right:8,width:"calc(100% - 16px)",maxWidth:360,maxHeight:"70vh",background:C.card,borderRadius:16,border:`1px solid ${C.border}`,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:15,fontWeight:700}}>🔔 Bildirimler</div>
            <button onClick={()=>setShowNotifs(false)} style={{background:"none",border:"none",color:C.dim,fontSize:18,cursor:"pointer"}}>✕</button>
          </div>
          <div style={{overflowY:"auto",maxHeight:"calc(70vh - 50px)",padding:8}}>
            {notifications.length===0?<div style={{padding:30,textAlign:"center",color:C.dim,fontSize:13}}>Bildirim yok ✓</div>:
            notifications.map(n=>(
              <div key={n.id} style={{display:"flex",gap:10,padding:"10px 8px",borderBottom:`1px solid ${C.border}`,cursor:n.id==="vote"?"pointer":n.id==="stock"?"pointer":n.id==="pend"?"pointer":"default"}} onClick={()=>{
                if(n.id==="vote"){setPage("faults");setShowNotifs(false);}
                else if(n.id==="stock"){setPage("depo");setDepoTab("purchase");setShowNotifs(false);}
                else if(n.id==="pend"){setPage("approvals");setShowNotifs(false);}
              }}>
                <div style={{fontSize:20,flexShrink:0}}>{n.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:n.type==="error"?C.red:n.type==="warning"?C.orange:C.green}}>{n.text}</div>
                  {n.time&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{(()=>{try{const d=new Date(n.time);const diff=Math.round((Date.now()-d.getTime())/60000);if(diff<60)return diff+" dk önce";if(diff<1440)return Math.round(diff/60)+" saat önce";return Math.round(diff/1440)+" gün önce";}catch(e){return"";}})()}</div>}
                </div>
                {(n.id==="vote"||n.id==="stock"||n.id==="pend")&&<div style={{color:C.accent,fontSize:16,alignSelf:"center"}}>›</div>}
              </div>
            ))}
          </div>
        </div>
      </div>}
      {showHourlyDatePicker&&<CustomDatePicker value={hourlyForm.date||todayStr()} onChange={v=>setHourlyForm(p=>({...p,date:v}))} onClose={()=>setShowHourlyDatePicker(false)}/>}
      {showHourlyStartTP&&<CustomTimePicker value={hourlyForm.startTime||"08:00"} onChange={v=>setHourlyForm(p=>({...p,startTime:v}))} onClose={()=>setShowHourlyStartTP(false)} label="Çıkış Saati"/>}
      {showHourlyEndTP&&<CustomTimePicker value={hourlyForm.endTime||"17:00"} onChange={v=>setHourlyForm(p=>({...p,endTime:v}))} onClose={()=>setShowHourlyEndTP(false)} label="Dönüş Saati"/>}
      {showEditStartTP&&editOT&&<CustomTimePicker value={editOT.start_time||"17:00"} onChange={v=>setEditOT(p=>({...p,start_time:v}))} onClose={()=>setShowEditStartTP(false)} label="Başlangıç Düzelt"/>}
      {showEditEndTP&&editOT&&<CustomTimePicker value={editOT.end_time||"18:00"} onChange={v=>setEditOT(p=>({...p,end_time:v}))} onClose={()=>setShowEditEndTP(false)} label="Bitiş Düzelt"/>}
      {showFaultDatePicker&&<CustomDatePicker value={faultForm.detected_date||todayStr()} onChange={v=>setFaultForm(p=>({...p,detected_date:v}))} onClose={()=>setShowFaultDatePicker(false)}/>}
      {showServiceDatePicker&&<CustomDatePicker value={serviceForm.visit_date||todayStr()} onChange={v=>setServiceForm(p=>({...p,visit_date:v}))} onClose={()=>setShowServiceDatePicker(false)}/>}
      {showInlineSvcDatePicker&&inlineSvcIdx>=0&&<CustomDatePicker value={faultForm.services[inlineSvcIdx]?.visit_date||todayStr()} onChange={v=>{setFaultForm(p=>({...p,services:p.services.map((s,j)=>j===inlineSvcIdx?{...s,visit_date:v}:s)}));}} onClose={()=>{setShowInlineSvcDatePicker(false);setInlineSvcIdx(-1);}}/>}
      {toast&&<div style={S.tst}>{toast}</div>}
    </div>
  );
}
