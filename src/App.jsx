import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase, signIn, signOut, getProfiles, getOvertimes, getLeaves, createOvertime, updateOvertime, createLeave, updateLeave, uploadPhoto, subscribeToChanges } from './lib/supabase';

const OT_MULT=1.5,WORK_END=17;
function calcOT(st,et,type){if(!st||!et)return 0;const[sh,sm]=st.split(":").map(Number),[eh,em]=et.split(":").map(Number);let s=sh*60+sm,e=eh*60+em;if(e<=s)e+=1440;if(type==="daytime"){return Math.round(((e-s)/60)*10)/10;}const eff=Math.max(s,WORK_END*60);return eff>=e?0:Math.round(((e-eff)/60)*10)/10;}
function calcLH(h){return Math.round(h*OT_MULT*10)/10;}
function compressImg(file,maxW=1200,q=0.7){return new Promise((res)=>{const img=new Image();img.onload=()=>{let w=img.width,h=img.height;if(w>maxW){h=Math.round(h*(maxW/w));w=maxW;}if(h>maxW){w=Math.round(w*(maxW/h));h=maxW;}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);c.toBlob(b=>{if(b)res(new File([b],file.name.replace(/\.\w+$/,'.jpg'),{type:'image/jpeg'}));else res(file);}, 'image/jpeg',q);};img.onerror=()=>res(file);img.src=URL.createObjectURL(file);});}
function fD(d){if(!d)return"";try{return new Date(d+'T00:00:00').toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"});}catch{return d;}}
function fDS(d){if(!d)return"";try{return new Date(d+'T00:00:00').toLocaleDateString("tr-TR",{day:"numeric",month:"short"});}catch{return d;}}
function sColor(s){return s==="approved"?"#22c55e":s==="pending_chef"?"#f59e0b":s==="pending_manager"?"#3b82f6":s==="rejected"?"#ef4444":"#94a3b8";}
function sText(s){return s==="approved"?"Onaylandı":s==="pending_chef"?"Şef Onayı Bekliyor":s==="pending_manager"?"Müh. Onayı Bekliyor":s==="rejected"?"Reddedildi":s;}
function daysSince(d){if(!d)return 0;const t=new Date(),s=new Date(d+'T00:00:00');return Math.max(0,Math.floor((t-s)/(1000*60*60*24)));}
function getVoteWeek(d){const dt=d||new Date();const jan1=new Date(dt.getFullYear(),0,1);const days=Math.floor((dt-jan1)/(86400000));const wn=Math.ceil((days+jan1.getDay()+1)/7);return `${dt.getFullYear()}-W${String(wn).padStart(2,'0')}`;}
function isFriday(){return new Date().getDay()===5;}
function sIcon(s){return s==="approved"?"\u2713":s==="rejected"?"\u2717":"\u23F3";}
function ini(n){if(!n)return"?";try{return n.split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();}catch{return"?";}}

const C={bg:"#0c0e14",card:"#161923",border:"#252a3a",accent:"#6366f1",accentL:"#818cf8",accentD:"rgba(99,102,241,0.12)",text:"#e2e8f0",dim:"#94a3b8",muted:"#64748b",green:"#22c55e",greenD:"rgba(34,197,94,0.12)",orange:"#f59e0b",orangeD:"rgba(245,158,11,0.12)",red:"#ef4444",redD:"rgba(239,68,68,0.12)",blue:"#3b82f6",blueD:"rgba(59,130,246,0.12)",purple:"#a855f7",purpleD:"rgba(168,85,247,0.12)",teal:"#14b8a6",tealD:"rgba(20,184,166,0.12)"};
const avC=[C.accentD,C.greenD,C.orangeD,C.blueD,C.redD,C.purpleD,"rgba(236,72,153,0.12)",C.tealD];
function getAv(i){return avC[i%avC.length];}
const MONTHS=["Ocak","\u015Eubat","Mart","Nisan","May\u0131s","Haziran","Temmuz","A\u011Fustos","Eyl\u00FCl","Ekim","Kas\u0131m","Aral\u0131k"];
const DAYS_TR=["Pzt","Sal","\u00C7ar","Per","Cum","Cmt","Paz"];
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

export default function App(){
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
  const[modNewOT,setModNewOT]=useState(false);
  const[modAddUser,setModAddUser]=useState(false);
  const[modEditUser,setModEditUser]=useState(null);
  const[toast,setToast]=useState(null);
  const[submitting,setSubmitting]=useState(false);
  const[otForm,setOtForm]=useState({date:"",startTime:"17:00",endTime:"",otType:"evening",desc:"",photoBefore:null,photoAfter:null,fileB:null,fileA:null});
  const[otErrors,setOtErrors]=useState([]);
  const[nUser,setNUser]=useState({name:"",email:"",password:"",role:"",night:false,userRole:"personnel",buildingId:""});
  const beforeRef=useRef(null),afterRef=useRef(null),descRef=useRef(null);
  const[showDatePicker,setShowDatePicker]=useState(false);
  const[showStartTP,setShowStartTP]=useState(false);
  const[showEndTP,setShowEndTP]=useState(false);
  const[showPWA,setShowPWA]=useState(false);
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
  const faultPhotoRef=useRef(null);
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
  const leaveDocRef=useRef(null);
  const[leaveDoc,setLeaveDoc]=useState(null);
  const[leaveDocFile,setLeaveDocFile]=useState(null);
  const hourlyLeaveDocRef=useRef(null);
  const[hourlyLeaveDoc,setHourlyLeaveDoc]=useState(null);
  const[hourlyLeaveDocFile,setHourlyLeaveDocFile]=useState(null);
  const now=new Date();
  const[calY,setCalY]=useState(now.getFullYear());
  const[calM,setCalM]=useState(now.getMonth());
  const[calSel,setCalSel]=useState([]);
  const[calMode,setCalMode]=useState("view");
  const[calModId,setCalModId]=useState(null);

  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(null),3500);return()=>clearTimeout(t);}},[toast]);

  const fetchProfiles=useCallback(async()=>{try{const{data}=await supabase.from('profiles').select('*');if(data)setProfilesState(data);}catch(e){console.error(e);}},[]);
  const fetchOvertimes=useCallback(async()=>{try{const d=await getOvertimes();if(d)setOvertimesState(d);}catch(e){console.error(e);}},[]);
  const fetchLeaves=useCallback(async()=>{try{const d=await getLeaves();if(d)setLeavesState(d);}catch(e){console.error(e);}},[]);
  const fetchFaults=useCallback(async()=>{try{const{data}=await supabase.from('faults').select('*').order('detected_date',{ascending:false});if(data)setFaults(data);}catch(e){console.error(e);}},[]);
  const fetchFaultServices=useCallback(async()=>{try{const{data}=await supabase.from('fault_services').select('*').order('visit_date',{ascending:false});if(data)setFaultServices(data);}catch(e){console.error(e);}},[]);
  const fetchFaultVotes=useCallback(async()=>{try{const{data}=await supabase.from('fault_votes').select('*');if(data)setFaultVotes(data);}catch(e){console.error(e);}},[]); 
  const fetchMaterials=useCallback(async()=>{try{const{data}=await supabase.from('materials').select('*').order('name');if(data)setMaterials(data);}catch(e){console.error(e);}},[]);
  const fetchStockMovements=useCallback(async()=>{try{const{data}=await supabase.from('stock_movements').select('*').order('movement_date',{ascending:false});if(data)setStockMovements(data);}catch(e){console.error(e);}},[]);
  const fetchBuildings=useCallback(async()=>{try{const{data}=await supabase.from('buildings').select('*').order('name');if(data)setBuildings(data);}catch(e){console.error(e);}},[]);

  const loadData=useCallback(async(uid)=>{
    setLoading(true);setLoadError(null);
    try{
      // Phase 1: Critical data (profiles, buildings, overtimes, leaves) - needed for first render
      const r1=await Promise.allSettled([supabase.from('profiles').select('*'),getOvertimes(),getLeaves(),supabase.from('buildings').select('*').order('name')]);
      const profs=r1[0].status==="fulfilled"?(r1[0].value?.data||[]):[];
      const ots=r1[1].status==="fulfilled"?(r1[1].value||[]):[];
      const lvs=r1[2].status==="fulfilled"?(r1[2].value||[]):[];
      const blds=r1[3].status==="fulfilled"?(r1[3].value?.data||[]):[];
      setProfilesState(profs);setOvertimesState(ots);setLeavesState(lvs);setBuildings(blds);
      const fp=profs.find(p=>p.id===uid);setProfile(fp||null);
      if(fp&&blds.length>0&&!selBuilding){setSelBuilding(fp.building_id||blds[0]?.id||null);}
      if(!fp&&profs.length===0)setLoadError("Veri yüklenemedi.");
    }catch(err){setLoadError("Bağlantı hatası");}finally{setLoading(false);}
    // Phase 2: Secondary data (faults, materials, stock) - loads in background
    try{
      const r2=await Promise.allSettled([supabase.from('faults').select('*').order('detected_date',{ascending:false}),supabase.from('fault_services').select('*').order('visit_date',{ascending:false}),supabase.from('fault_votes').select('*'),supabase.from('materials').select('*').order('name'),supabase.from('stock_movements').select('*').order('movement_date',{ascending:false}).limit(200)]);
      if(r2[0].status==="fulfilled")setFaults(r2[0].value?.data||[]);
      if(r2[1].status==="fulfilled")setFaultServices(r2[1].value?.data||[]);
      if(r2[2].status==="fulfilled")setFaultVotes(r2[2].value?.data||[]);
      if(r2[3].status==="fulfilled")setMaterials(r2[3].value?.data||[]);
      if(r2[4].status==="fulfilled")setStockMovements(r2[4].value?.data||[]);
    }catch(e){}
  },[]);

  useEffect(()=>{
    let m=true,sub=null;
    const init=async()=>{
      try{const{data,error}=await supabase.auth.getSession();if(!m)return;if(error){setLoading(false);return;}const s=data?.session||null;setSession(s);if(s?.user?.id)await loadData(s.user.id);else setLoading(false);}
      catch(e){if(m){setLoading(false);setLoadError("Oturum hatası");}}
    };
    try{const{data}=supabase.auth.onAuthStateChange((_,s)=>{if(!m)return;setSession(s);if(s?.user?.id)loadData(s.user.id);else{setProfile(null);setLoading(false);}});sub=data?.subscription;}catch(e){}
    init();return()=>{m=false;try{sub?.unsubscribe();}catch(e){}};
  },[loadData]);

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
  const canSwitchBuilding=isAdmin||isChef;
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
  function totLH(pid){return bOvertimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.leave_hours||0),0);}
  function totUsedLV(pid){return bLeaves.filter(l=>l.personnel_id===pid&&["approved","pending_chef","pending_manager"].includes(l.status)).reduce((s,l)=>s+(l.total_hours||0),0);}
  function remHours(pid){return Math.round((totLH(pid)-totUsedLV(pid))*10)/10;}
  function totOTH(pid){return bOvertimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.hours||0),0);}
  function remDays(pid){return Math.round((remHours(pid)/8)*10)/10;}
  function debtDays(pid){const r=remDays(pid);return r<0?Math.abs(r):0;}
  function pendCount(pid){return bOvertimes.filter(o=>o.personnel_id===pid&&["pending_chef","pending_manager"].includes(o.status)).length+bLeaves.filter(l=>l.personnel_id===pid&&["pending_chef","pending_manager"].includes(l.status)).length;}
  // Global helpers (for user's own summary - always shows own data regardless of building)
  function myTotLH(pid){return overtimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.leave_hours||0),0);}
  function myTotUsedLV(pid){return leavesState.filter(l=>l.personnel_id===pid&&["approved","pending_chef","pending_manager"].includes(l.status)).reduce((s,l)=>s+(l.total_hours||0),0);}
  function myRemHours(pid){return Math.round((myTotLH(pid)-myTotUsedLV(pid))*10)/10;}
  function myTotOTH(pid){return overtimes.filter(o=>o.personnel_id===pid&&o.status==="approved").reduce((s,o)=>s+Number(o.hours||0),0);}
  function myRemDays(pid){return Math.round((myRemHours(pid)/8)*10)/10;}
  function myDebtDays(pid){const r=myRemDays(pid);return r<0?Math.abs(r):0;}

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

  async function handlePhoto(e,type){
    const file=e.target.files?.[0];if(!file)return;
    try{const compressed=await compressImg(file);const reader=new FileReader();reader.onload=(ev)=>{setOtForm(prev=>({...prev,[type==="before"?"photoBefore":"photoAfter"]:ev.target.result,[type==="before"?"fileB":"fileA"]:compressed}));};reader.onerror=()=>{setToast("Fotoğraf okunamadı");};reader.readAsDataURL(compressed);}catch(e){setToast("Foto yüklenemedi");}
    if(e.target)e.target.value="";
  }

  async function submitOT(){
    const currentDesc=descRef.current?descRef.current.value:otForm.desc;
    const errors=[];
    if(!otForm.date)errors.push("Tarih seçilmedi");
    if(!otForm.startTime||!otForm.endTime)errors.push("Saat bilgisi eksik");
    const hours=calcOT(otForm.startTime,otForm.endTime,otForm.otType);
    if(hours<=0)errors.push(otForm.otType==="daytime"?"Geçerli saat aralığı girin":"Mesai 17:00 sonrası olmalı");
    if(!otForm.photoBefore)errors.push("Başlangıç fotografi zorunlu");
    if(!otForm.photoAfter)errors.push("Bitiş fotografi zorunlu");
    if(!currentDesc||currentDesc.trim().length<20)errors.push("Açıklama zorunlu (min 20 karakter)");
    if(errors.length){setOtErrors(errors);return;}
    setSubmitting(true);
    try{
      let pB=null,pA=null;
      if(otForm.fileB){const r=await uploadPhoto(otForm.fileB,'before');pB=r?.url||null;}
      if(otForm.fileA){const r=await uploadPhoto(otForm.fileA,'after');pA=r?.url||null;}
      await supabase.from('overtimes').insert({personnel_id:profile.id,work_date:otForm.date,start_time:otForm.startTime,end_time:otForm.endTime,hours,leave_hours:calcLH(hours),overtime_type:otForm.otType||"evening",description:currentDesc.trim(),photo_before:pB,photo_after:pA,status:"pending_chef"}).throwOnError();
      await fetchOvertimes();
      setOtForm({date:"",startTime:"17:00",endTime:"",otType:"evening",desc:"",photoBefore:null,photoAfter:null,fileB:null,fileA:null});
      setOtErrors([]);setModNewOT(false);
      setToast(`${hours}s mesai - ${calcLH(hours)}s izin hakkı onaya gönderildi`);
    }catch(e){setToast("Gönderim hatası: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function submitLeaveReq(){
    if(calSel.length===0){setToast("⚠ Gün seçin");return;}
    const needH=calSel.length*8,rH=myRemHours(profile.id),willDebt=rH<needH;
    if(willDebt&&(!leaveReason||leaveReason.trim().length<10)){setToast("⚠ Borçlanma durumu var - izin sebebini yazın (min 10 karakter)");return;}
    if(!leaveDoc){setToast("⚠ İzin belgesi fotoğrafı zorunlu");return;}
    setSubmitting(true);
    try{
      const reason=willDebt?`${leaveReason.trim()} (${Math.round((needH-rH)/8*10)/10} gün borçlanma)`:(leaveReason.trim()||"Fazla mesai karşılığı izin");
      let docUrl=null;
      if(leaveDocFile){const r=await uploadPhoto(leaveDocFile,'leave-doc');docUrl=r?.url||null;}
      await createLeave({personnel_id:profile.id,dates:calSel.sort(),total_hours:needH,reason,leave_type:"daily",leave_doc_url:docUrl,status:"pending_chef"});
      await fetchLeaves();setCalSel([]);setCalMode("view");setLeaveReason("");setLeaveDoc(null);setLeaveDocFile(null);
      setToast(willDebt?`${calSel.length} gun izin gönderildi (borclanma dahil)`:`${calSel.length} gunluk izin onaya gönderildi`);
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function handleLeaveDoc(e,setDoc,setFile){
    const file=e.target.files?.[0];if(!file)return;
    try{const compressed=await compressImg(file);const reader=new FileReader();reader.onload=(ev)=>{setDoc(ev.target.result);setFile(compressed);};reader.onerror=()=>{setToast("Fotoğraf okunamadı");};reader.readAsDataURL(compressed);}catch(e){setToast("Fotoğraf yüklenemedi");}
    if(e.target)e.target.value="";
  }

  async function submitHourlyLeave(){
    const errors=[];
    if(!hourlyForm.date)errors.push("Tarih seçilmedi");
    if(!hourlyForm.startTime)errors.push("Çıkış saati seçilmedi");
    if(!hourlyForm.endTime)errors.push("Dönüş saati seçilmedi");
    if(!hourlyForm.reason||hourlyForm.reason.trim().length<10)errors.push("Sebep zorunlu (min 10 karakter)");
    if(!hourlyLeaveDoc)errors.push("İzin belgesi fotoğrafı zorunlu");
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
      if(hourlyLeaveDocFile){const r=await uploadPhoto(hourlyLeaveDocFile,'leave-doc');docUrl=r?.url||null;}
      await createLeave({personnel_id:profile.id,dates:[hourlyForm.date],total_hours:totalH,reason:`[Saatlik İzin] ${hourlyForm.startTime}-${hourlyForm.endTime} (${totalH}s) - ${hourlyForm.reason.trim()}`,leave_type:"hourly",leave_start_time:hourlyForm.startTime,leave_end_time:hourlyForm.endTime,leave_doc_url:docUrl,status:"pending_chef"});
      await fetchLeaves();
      setHourlyForm({date:"",startTime:"",endTime:"",reason:""});
      setHourlyLeaveDoc(null);setHourlyLeaveDocFile(null);
      setHourlyMode(false);
      setToast(`✓ ${totalH} saatlik izin talebi onaya gönderildi`);
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function modifyLeave(){
    if(calSel.length===0){setToast("Yeni tarihleri seçin");return;}
    const lv=leavesState.find(l=>l.id===calModId);if(!lv)return;
    setSubmitting(true);
    try{await updateLeave(calModId,{previous_dates:lv.dates,dates:calSel.sort(),total_hours:calSel.length*8,status:"pending_chef",approved_by_chef:false,approved_by_manager:false});await fetchLeaves();setCalSel([]);setCalMode("view");setCalModId(null);setToast("Tarihler değiştirildi");}catch(e){setToast("Hata: "+(e?.message||""));}
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
    pBox:(has)=>({width:"47%",paddingTop:"47%",borderRadius:12,border:`2px dashed ${has?C.green:C.border}`,background:has?"transparent":C.bg,position:"relative",cursor:"pointer",overflow:"hidden"}),
    pBoxI:{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"},
    lawBox:{background:"linear-gradient(135deg,rgba(99,102,241,0.1),rgba(168,85,247,0.1))",border:`1px solid ${C.accent}44`,borderRadius:12,padding:14,marginBottom:12},
    errBox:{background:C.redD,border:`1px solid ${C.red}44`,borderRadius:10,padding:12,marginBottom:12},
    back:{display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:"0 0 12px",fontWeight:600},
    emp:{textAlign:"center",padding:"40px 20px",color:C.muted},
    sel:{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,outline:"none",boxSizing:"border-box",marginBottom:10},
    fInp:{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:16,boxSizing:"border-box",marginBottom:10,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"},
  };

  const pendOTs=useMemo(()=>bOvertimes.filter(o=>(isChef&&o.status==="pending_chef")||(isAdmin&&["pending_chef","pending_manager"].includes(o.status))),[bOvertimes,isChef,isAdmin]);
  const pendLVs=useMemo(()=>bLeaves.filter(l=>(isChef&&l.status==="pending_chef")||(isAdmin&&["pending_chef","pending_manager"].includes(l.status))),[bLeaves,isChef,isAdmin]);
  const totPend=pendOTs.length+pendLVs.length;
  const allPendOTs=useMemo(()=>bOvertimes.filter(o=>["pending_chef","pending_manager"].includes(o.status)),[bOvertimes]);
  const allPendLVs=useMemo(()=>bLeaves.filter(l=>["pending_chef","pending_manager"].includes(l.status)),[bLeaves]);
  const allPendCount=allPendOTs.length+allPendLVs.length;
  const liveOTH=calcOT(otForm.startTime,otForm.endTime,otForm.otType),liveLH=calcLH(liveOTH);

  if(loading)return(<div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><div style={{textAlign:"center"}}><div style={{fontSize:40,marginBottom:16}}>🔧</div><div style={{color:C.dim}}>Yükleniyor...</div></div></div>);
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

  if(!profile)return(<div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><div style={{textAlign:"center",padding:24}}><div style={{fontSize:40,marginBottom:16}}>⚠️</div><div style={{color:C.dim,marginBottom:8}}>Profil bulunamadı.</div><button style={S.btn(C.accent)} onClick={()=>{if(session?.user?.id)loadData(session.user.id);}}>Tekrar Dene</button><button style={S.btn(C.red)} onClick={doLogout}>Çıkış</button></div></div>);

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
      </div>
      <div style={{...S.sec,marginTop:16}}><span>⏱</span> Mesai ({pOTs.length})</div>
      {pOTs.length===0&&<div style={{...S.emp,padding:20}}>Kayit yok</div>}
      {pOTs.map(o=>(<div key={o.id} style={S.crd} onClick={()=>setSelOT(o)}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{fD(o.work_date)}</div><div style={{fontSize:11,color:C.dim}}>{o.start_time?.slice(0,5)}→{o.end_time?.slice(0,5)}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:C.accent}}>{o.hours}s<span style={{color:C.purple,fontSize:12}}> →{o.leave_hours}s</span></div><div style={S.tag(sColor(o.status)+"22",sColor(o.status))}>{sIcon(o.status)} {sText(o.status)}</div></div></div>{o.description&&<div style={{fontSize:12,color:C.dim,marginTop:6,borderTop:`1px solid ${C.border}`,paddingTop:6}}>{o.description}</div>}</div>))}
      <div style={{...S.sec,marginTop:16}}><span>🏖</span> Izin ({pLVs.length})</div>
      {pLVs.length===0&&<div style={{...S.emp,padding:20}}>Talep yok</div>}
      {pLVs.map(l=>{const isHourly=l.leave_type==="hourly";return(<div key={l.id} style={S.crd} onClick={()=>setSelLV(l)}><div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}><div>{isHourly?<div><div style={{...S.tag(C.blueD,C.blue),marginBottom:4}}>🕐 Saatlik</div><div style={{fontSize:12}}>{fDS(l.dates?.[0])} {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)}</div></div>:<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(Array.isArray(l.dates)?l.dates:[]).map(d=><span key={d} style={S.tag(l.status==="approved"?C.greenD:C.orangeD,l.status==="approved"?C.green:C.orange)}>{fDS(d)}</span>)}</div>}</div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:700}}>{isHourly?l.total_hours+"s":(Array.isArray(l.dates)?l.dates.length:0)+"g"}</div><div style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)}</div>{l.leave_doc_url&&<div style={{fontSize:10,color:C.green,marginTop:2}}>📄</div>}</div></div>{l.reason&&<div style={{fontSize:11,color:l.reason.includes("borc")?"#ef4444":C.dim,marginTop:4}}>{l.reason}</div>}</div>);})}
    </div>);
  };

  // ===== FAULT SYSTEM =====
  const canEditFault=isAdmin||isChef||isViewer;
  const canAddFault=true; // herkes arıza ekleyebilir
  const isOwnFault=(f)=>f?.created_by===profile?.id;
  const currentWeek=getVoteWeek();

  async function submitFault(){
    if(!faultForm.title||!faultForm.location){setToast("⚠ Başlık ve konum zorunlu");return;}
    if(!faultForm.detected_date){setToast("⚠ Tespit tarihi seçin");return;}
    setSubmitting(true);
    try{
      let photoUrls=[...(faultForm.photos||[])];
      for(const file of faultPhotoFiles){
        const r=await uploadPhoto(file,'fault-photos');
        if(r?.url)photoUrls.push(r.url);
      }
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
    try{
      const{data:existing}=await supabase.from('fault_votes').select('id').eq('fault_id',faultId).eq('personnel_id',profile.id).eq('vote_week',currentWeek).single();
      if(existing){await supabase.from('fault_votes').update({vote}).eq('id',existing.id);}
      else{await supabase.from('fault_votes').insert({fault_id:faultId,personnel_id:profile.id,vote,vote_week:currentWeek});}
      await fetchFaultVotes();setToast(vote==="continues"?"🔴 Arıza devam ediyor olarak kaydedildi":"🟢 Arıza giderildi olarak kaydedildi");
    }catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function deleteFault(id){
    setSubmitting(true);
    try{await supabase.from('faults').delete().eq('id',id);await fetchFaults();setSelFault(null);setDeleteConfirm(null);setToast("🗑 Arıza silindi");}
    catch(e){setToast("Hata: "+(e?.message||""));}
    setSubmitting(false);
  }

  async function handleFaultPhoto(e){
    const files=Array.from(e.target.files||[]);if(!files.length)return;
    for(const file of files){
      const compressed=await compressImg(file);
      const reader=new FileReader();
      reader.onload=(ev)=>{setFaultForm(p=>({...p,photos:[...p.photos,ev.target.result]}));setFaultPhotoFiles(p=>[...p,compressed]);};
      reader.readAsDataURL(compressed);
    }
    if(e.target)e.target.value="";
  }

  const renderFaults=()=>{
    const activeFaults=bFaults.filter(f=>f.status==="active");
    const resolvedFaults=bFaults.filter(f=>f.status==="resolved");
    const canSeeResolved=isAdmin||isViewer;
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
        const weekVotes=faultVotes.filter(v=>v.fault_id===f.id&&v.vote_week===currentWeek);
        const votedCount=weekVotes.length;
        const myVote=weekVotes.find(v=>v.personnel_id===profile.id);
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
            {f.photos?.length>0&&<div style={S.tag(C.accentD,C.accent)}>📷 {f.photos.length}</div>}
            {myVote&&<div style={S.tag(myVote.vote==="continues"?C.redD:C.greenD,myVote.vote==="continues"?C.red:C.green)}>{myVote.vote==="continues"?"🔴 Devam":"🟢 Giderildi"}</div>}
            {!myVote&&f.status==="active"&&<div style={S.tag(C.orangeD,C.orange)}>⏳ Oy bekleniyor</div>}
            {votedCount>0&&<div style={{fontSize:10,color:C.muted,alignSelf:"center"}}>{votedCount} oy</div>}
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
    const weekVotes=faultVotes.filter(v=>v.fault_id===f.id&&v.vote_week===currentWeek);
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

      {f.photos?.length>0&&<div style={{marginBottom:12}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:6}}>📷 Fotoğraflar ({f.photos.length})</div><div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8}}>{f.photos.map((p,i)=><img key={i} src={p} alt="" style={{width:200,height:150,objectFit:"cover",borderRadius:10,flexShrink:0}}/>)}</div></div>}

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
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📊 Haftalık Durum Oylaması <span style={{fontSize:10,color:C.muted,fontWeight:500}}>({currentWeek})</span></div>
        {!myVote?<div style={{display:"flex",gap:8}}>
          <button style={{flex:1,padding:12,borderRadius:10,background:C.redD,border:`2px solid ${C.red}44`,color:C.red,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>submitVote(f.id,"continues")} disabled={submitting}>🔴 Arıza Devam Ediyor</button>
          <button style={{flex:1,padding:12,borderRadius:10,background:C.greenD,border:`2px solid ${C.green}44`,color:C.green,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>submitVote(f.id,"resolved")} disabled={submitting}>🟢 Arıza Giderildi</button>
        </div>:<div style={{textAlign:"center",padding:8,background:myVote.vote==="continues"?C.redD:C.greenD,borderRadius:8}}>
          <span style={{color:myVote.vote==="continues"?C.red:C.green,fontWeight:700}}>{myVote.vote==="continues"?"🔴 Devam ediyor olarak oy kullandınız":"🟢 Giderildi olarak oy kullandınız"}</span>
          <div style={{marginTop:6}}><button style={{fontSize:11,color:C.muted,background:"none",border:"none",textDecoration:"underline",cursor:"pointer"}} onClick={()=>submitVote(f.id,myVote.vote==="continues"?"resolved":"continues")}>Oyumu değiştir</button></div>
        </div>}
        <div style={{marginTop:10}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:6}}>Bu hafta oylar ({weekVotes.length}/{allActiveProfiles.length})</div>
          {allActiveProfiles.map(p=>{
            const v=weekVotes.find(vt=>vt.personnel_id===p.id);
            return(<div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:500}}>{p.full_name}</div>
              {v?<div style={{fontSize:11,fontWeight:700,color:v.vote==="continues"?C.red:C.green}}>{v.vote==="continues"?"🔴 Devam":"🟢 Giderildi"}</div>
              :<div style={{fontSize:11,color:C.orange}}>⏳ Oy yok</div>}
            </div>);
          })}
        </div>
      </div>}

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
      <div style={S.lbl}>📷 Fotoğraflar</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {faultForm.photos.map((p,i)=><div key={i} style={{position:"relative"}}><img src={p} alt="" style={{width:80,height:80,objectFit:"cover",borderRadius:10}}/><button onClick={()=>{setFaultForm(prev=>({...prev,photos:prev.photos.filter((_,j)=>j!==i)}));setFaultPhotoFiles(prev=>prev.filter((_,j)=>j!==i));}} style={{position:"absolute",top:-6,right:-6,width:20,height:20,borderRadius:10,background:C.red,color:"#fff",border:"none",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>)}
        <div style={{width:80,height:80,borderRadius:10,border:`2px dashed ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:24,color:C.muted}} onClick={()=>faultPhotoRef.current?.click()}>+</div>
      </div>
      <input ref={faultPhotoRef} type="file" multiple style={{display:"none"}} onChange={handleFaultPhoto}/>

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
      {depoTab==="purchase"&&<>
        <div style={{...S.lawBox,marginBottom:12,borderColor:C.red+"44"}}><div style={{fontSize:14,fontWeight:700,marginBottom:4}}>🛒 Satın Alma Listesi</div><div style={{fontSize:12,color:C.dim}}>Minimum stok seviyesinin altındaki malzemeler</div></div>
        {purchaseList.length===0?<div style={S.emp}>Tüm malzemeler yeterli seviyede ✓</div>:
        purchaseList.map(m=>{const need=Math.max(0,m.min_stock*2-m.current_stock);return(
          <div key={m.id} style={{...S.crd,borderLeft:"4px solid "+C.red}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:14,fontWeight:700}}>{m.name}</div><div style={{fontSize:11,color:C.dim}}>{m.category}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:11,color:C.red}}>Mevcut: {m.current_stock} {m.unit}</div><div style={{fontSize:11,color:C.dim}}>Min: {m.min_stock} {m.unit}</div><div style={{fontSize:13,fontWeight:800,color:C.accent}}>Önerilen: {need} {m.unit}</div></div>
            </div>
          </div>
        );})}
        {purchaseList.length>0&&canEditFault&&<button style={S.btn(C.accent)} onClick={()=>{const txt=purchaseList.map(m=>"• "+m.name+" — "+Math.max(0,m.min_stock*2-m.current_stock)+" "+m.unit+" (Mevcut: "+m.current_stock+")").join("\n");navigator.clipboard?.writeText("SATIN ALMA LİSTESİ\n"+new Date().toLocaleDateString("tr-TR")+"\n\n"+txt).then(()=>setToast("📋 Liste panoya kopyalandı")).catch(()=>setToast("Kopyalanamadı"));}}>📋 Listeyi Kopyala</button>}
      </>}

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
        <button style={S.btn(C.accent)} onClick={()=>{setOtForm({date:todayStr(),startTime:"17:00",endTime:"",otType:"evening",desc:"",photoBefore:null,photoAfter:null,fileB:null,fileA:null});setOtErrors([]);setModNewOT(true);}}>+ Fazla Mesai Bildir</button>
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
        <button style={{...S.btn(C.accent),marginTop:8}} onClick={()=>{setOtForm({date:todayStr(),startTime:"17:00",endTime:"",otType:"evening",desc:"",photoBefore:null,photoAfter:null,fileB:null,fileA:null});setOtErrors([]);setModNewOT(true);}}>+ Fazla Mesai Bildir</button>
      </div>
      <div style={{...S.crd,background:vPC>0?C.orangeD:C.card,cursor:vPC>0?"pointer":"default",textAlign:"center"}} onClick={()=>vPC>0&&setPage("approvals")}>
        <div style={{fontSize:28,fontWeight:800,color:vPC>0?C.orange:C.green}}>{vPC>0?vPC:"✓"}</div>
        <div style={{fontSize:12,color:C.dim}}>{vPC>0?"Onay Bekleyen Talep":"Bekleyen talep yok"}</div>
        {isViewer&&vPC>0&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>Sadece görüntüleme</div>}
      </div>
      {debtors.length>0&&<div style={{marginBottom:16}}><div style={{...S.sec,color:C.red}}><span>⚠</span> Borçlu Personel</div>{debtors.map(u=>(<div key={u.id} style={{...S.crd,borderColor:`${C.red}44`}} onClick={()=>{setSelPerson(u.id);setPage("person");}}><div style={S.row}><div style={S.av(C.redD)}>{ini(u.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{u.full_name}</div><div style={{fontSize:11,color:C.dim}}>{u.role}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:C.red}}>{debtDays(u.id)}</div><div style={{fontSize:10,color:C.red}}>gün borç</div></div></div></div>))}</div>}
      <div style={S.sec}><span>👥</span> Personel ({list.length})</div>
      {list.map((p,i)=>{const rD=remDays(p.id),debt=debtDays(p.id),pend=pendCount(p.id);return(<div key={p.id} style={S.crd} onClick={()=>{setSelPerson(p.id);setPage("person");}}><div style={S.row}><div style={S.av(getAv(i))}>{ini(p.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p.full_name}</div><div style={{fontSize:11,color:C.dim}}>{p.role}{p.night_shift?" 🌙":""}</div></div><div style={{textAlign:"right"}}>{pend>0&&<div style={{...S.tag(C.orangeD,C.orange),marginBottom:4}}>⏳ {pend}</div>}{debt>0?<><div style={{fontSize:18,fontWeight:800,color:C.red}}>-{debt}</div><div style={{fontSize:10,color:C.red}}>borc</div></>:<><div style={{fontSize:18,fontWeight:800,color:rD>0?C.green:C.muted}}>{rD}</div><div style={{fontSize:10,color:C.dim}}>gun</div></>}</div></div></div>);})}
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
        {(o.photo_before||o.photo_after)&&<div style={{display:"flex",gap:8,marginBottom:8}}>{o.photo_before&&<img src={o.photo_before} alt="" style={{width:60,height:60,borderRadius:8,objectFit:"cover"}}/>}{o.photo_after&&<img src={o.photo_after} alt="" style={{width:60,height:60,borderRadius:8,objectFit:"cover"}}/>}</div>}
        {debt>0&&<div style={{fontSize:11,color:C.red,fontWeight:600,marginBottom:8}}>⚠ {debt} gun mesai borcu var</div>}
        <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{sText(o.status)}</div>
        {canApprove&&<div style={{display:"flex",gap:8}} onClick={e=>e.stopPropagation()}><button style={S.btnS(C.green)} onClick={()=>doApproveOT(o.id,isChef?"chef":"manager")}>✓ Onayla</button><button style={S.btnS(C.redD,C.red)} onClick={()=>doRejectOT(o.id)}>✗ Reddet</button></div>}
      </div>);})}
      <div style={{...S.sec,marginTop:20}}><span>🏖</span> Izin {vLVs.length>0&&<span style={S.tag(C.blueD,C.blue)}>{vLVs.length}</span>}</div>
      {vLVs.length===0&&<div style={S.emp}>Yok ✓</div>}
      {vLVs.map(l=>{const p=getU(l.personnel_id);const rH=remHours(l.personnel_id);const willDebt=rH<l.total_hours;return(<div key={l.id} style={S.crd} onClick={()=>setSelLV(l)}>
        <div style={S.row}><div style={S.av(C.blueD)}>{ini(p?.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p?.full_name}</div>{l.leave_type==="hourly"?<div style={{fontSize:12,color:C.blue,fontWeight:600,marginTop:2}}>🕐 {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)} ({l.total_hours}s)</div>:<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>{(Array.isArray(l.dates)?l.dates:[]).map(d=><span key={d} style={S.tag(C.blueD,C.blue)}>{fDS(d)}</span>)}</div>}</div><div style={{fontSize:18,fontWeight:800}}>{l.leave_type==="hourly"?l.total_hours+"s":(Array.isArray(l.dates)?l.dates.length:0)+"g"}</div></div>
        {l.leave_type==="hourly"&&<div style={{...S.tag(C.blueD,C.blue),marginTop:6}}>🕐 Saatlik İzin - {fD(l.dates?.[0])}</div>}
        {l.reason&&<div style={{fontSize:12,color:C.dim,margin:"8px 0",background:C.bg,borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>📝 Sebep:</div>{l.reason}</div>}
        {l.leave_doc_url&&<div style={{marginBottom:8}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>📄 İzin Belgesi:</div><img src={l.leave_doc_url} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:8}}/><a href={l.leave_doc_url} download target="_blank" rel="noopener" style={{display:"block",textAlign:"center",marginTop:6,fontSize:12,color:C.accent,textDecoration:"none",fontWeight:600}} onClick={e=>e.stopPropagation()}>⬇ Görseli İndir</a></div>}
        {willDebt&&<div style={{fontSize:11,color:C.red,fontWeight:700,margin:"8px 0",background:C.redD,borderRadius:6,padding:"4px 8px"}}>⚠ Onaylanirsa {Math.round((l.total_hours-rH)/8*10)/10} gün borçlanacak</div>}
        {l.previous_dates&&<div style={{fontSize:11,color:C.orange,margin:"8px 0"}}>🔄 Eski: {(Array.isArray(l.previous_dates)?l.previous_dates:[]).map(d=>fDS(d)).join(", ")}</div>}
        <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{sText(l.status)}</div>
        {canApprove&&<div style={{display:"flex",gap:8,marginTop:8}} onClick={e=>e.stopPropagation()}><button style={S.btnS(C.green)} onClick={()=>doApproveLV(l.id,isChef?"chef":"manager")}>✓ Onayla</button><button style={S.btnS(C.redD,C.red)} onClick={()=>doRejectLV(l.id)}>✗ Reddet</button></div>}
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
      <div style={{height:16}}/>
      <div style={S.sec}><span>👥</span> Aktif ({activeAll.length})</div>
      {activeAll.map((u,i)=>{const rl=u.user_role==="chef"?"Şef":u.user_role==="viewer"?"İzleyici":u.user_role==="admin"?"Yönetici":"Personel";const rc=u.user_role==="chef"?C.orange:u.user_role==="viewer"?C.blue:u.user_role==="admin"?C.purple:C.green;const rb=u.user_role==="chef"?C.orangeD:u.user_role==="viewer"?C.blueD:u.user_role==="admin"?C.purpleD:C.greenD;return(<div key={u.id} style={S.crd} onClick={()=>setModEditUser(u)}><div style={S.row}><div style={S.av(getAv(i))}>{ini(u.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{u.full_name}</div><div style={{fontSize:11,color:C.dim}}>{u.role}</div></div><div style={S.tag(rb,rc)}>{rl}</div></div></div>);})}
      {bProfiles.filter(u=>!u.active).length>0&&<><div style={{...S.sec,marginTop:20}}><span>🚫</span> Pasif</div>{bProfiles.filter(u=>!u.active).map(u=><div key={u.id} style={{...S.crd,opacity:0.6}}><div style={S.row}><div style={S.av("rgba(255,255,255,0.05)")}>{ini(u.full_name)}</div><div style={{flex:1}}><div style={{fontSize:14}}>{u.full_name}</div></div><button style={S.btnS(C.greenD,C.green)} onClick={e=>{e.stopPropagation();doReactivateU(u.id);}}>Aktif Et</button></div></div>)}</>}
    </div>);
  };

  const renderCalendar=()=>{
    const dim=daysInMonth(calY,calM),fd=firstDay(calY,calM),isSel=calMode!=="view";
    const myLvs=leavesState.filter(l=>l.personnel_id===profile.id&&l.status!=="rejected");
    const allLvs=isPerso?myLvs:bLeaves.filter(l=>l.status!=="rejected");
    const myLvDates={};myLvs.forEach(l=>(Array.isArray(l.dates)?l.dates:[]).forEach(d=>{myLvDates[d]={status:l.status,id:l.id};}));
    const lvDates={};allLvs.forEach(l=>(Array.isArray(l.dates)?l.dates:[]).forEach(d=>{lvDates[d]={status:l.status,id:l.id};}));
    const avD=myRemDays(profile.id),today=todayStr();
    function tog(d){if(!isSel)return;const ds=dateStr(calY,calM,d);if(myLvDates[ds]&&(!calModId||myLvDates[ds].id!==calModId)){setToast("Bu tarihte zaten izniniz var");return;}setCalSel(p=>p.includes(ds)?p.filter(x=>x!==ds):[...p,ds].sort());}
    function prev(){calM===0?(setCalY(calY-1),setCalM(11)):setCalM(calM-1);}
    function next(){calM===11?(setCalY(calY+1),setCalM(0)):setCalM(calM+1);}
    const cells=[];for(let i=0;i<fd;i++)cells.push(<div key={`e${i}`}/>);
    for(let d=1;d<=dim;d++){const ds=dateStr(calY,calM,d),isSeld=calSel.includes(ds),lv=lvDates[ds],isToday=ds===today;let bg="transparent",clr=C.text,brd="2px solid transparent";if(isSeld){bg=C.accent;clr="#fff";brd=`2px solid ${C.accentL}`;}else if(lv){bg=lv.status==="approved"?C.greenD:C.orangeD;clr=lv.status==="approved"?C.green:C.orange;}else if(isToday)brd=`2px solid ${C.accent}`;cells.push(<div key={d} onClick={()=>tog(d)} style={{width:"100%",paddingTop:"100%",borderRadius:10,background:bg,border:brd,position:"relative",cursor:isSel?"pointer":"default"}}><div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:14,fontWeight:isToday||isSeld?700:500,color:clr}}>{d}</div>{lv&&!isSeld&&<div style={{width:4,height:4,borderRadius:"50%",background:lv.status==="approved"?C.green:C.orange,marginTop:2}}/>}</div></div>);}
    const needH=calSel.length*8,currentRH=myRemHours(profile.id),willDebt=needH>0&&currentRH<needH,debtAmt=willDebt?Math.round((needH-currentRH)/8*10)/10:0;
    return(<div>
      <div style={S.sec}><span>📅</span> İzin Takvimi</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <button onClick={prev} style={{background:C.accentD,border:"none",color:C.accent,width:40,height:40,borderRadius:10,cursor:"pointer",fontSize:18,fontWeight:700,WebkitAppearance:"none"}}>&#8249;</button>
        <div style={{textAlign:"center"}}><div style={{fontSize:17,fontWeight:700}}>{MONTHS[calM]} {calY}</div>{isPerso&&<div style={{fontSize:11,color:avD>0?C.green:avD<0?C.red:C.muted,marginTop:2}}>{avD<0?`Borc: ${Math.abs(avD)} gun`:`Kalan: ${avD} gun`}</div>}</div>
        <button onClick={next} style={{background:C.accentD,border:"none",color:C.accent,width:40,height:40,borderRadius:10,cursor:"pointer",fontSize:18,fontWeight:700,WebkitAppearance:"none"}}>&#8250;</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>{DAYS_TR.map(d=><div key={d} style={{textAlign:"center",fontSize:11,color:C.muted,fontWeight:600,padding:"4px 0"}}>{d}</div>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>{cells}</div>
      {isSel&&calSel.length>0&&<div style={{...S.lawBox,marginTop:12}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📅 Seçilen ({calSel.length} gun)</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{calSel.sort().map(d=><div key={d} onClick={()=>setCalSel(p=>p.filter(x=>x!==d))} style={{...S.tag(C.accentD,C.accent),cursor:"pointer",padding:"4px 10px"}}>{fDS(d)} ✕</div>)}</div>
        <div style={S.dv}/>
        <div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:11,color:C.dim}}>Kullanılacak</div><div style={{fontSize:18,fontWeight:800,color:C.purple}}>{needH}s</div></div><div style={{textAlign:"right"}}><div style={{fontSize:11,color:C.dim}}>Kalan Hak</div><div style={{fontSize:18,fontWeight:800,color:avD>=0?C.green:C.red}}>{avD}g</div></div></div>
        {willDebt&&<><div style={{marginTop:8,background:C.redD,borderRadius:8,padding:"6px 10px",textAlign:"center"}}><span style={{fontSize:12,color:C.red,fontWeight:700}}>⚠ {debtAmt} gün borçlanma olacak</span></div><div style={{marginTop:10}}><div style={{...S.lbl,color:C.red}}>📝 Fazla izin sebebi (zorunlu)</div><textarea style={{...S.ta,borderColor:`${C.red}66`,minHeight:60}} placeholder="Neden fazla izin istiyorsunuz?" value={leaveReason} onChange={e=>setLeaveReason(e.target.value)}/></div></>}
        {!willDebt&&calMode==="select"&&<div style={{marginTop:10}}><div style={S.lbl}>📝 İzin sebebi (isteğe bağlı)</div><textarea style={{...S.ta,minHeight:50}} placeholder="İzin sebebiniz..." value={leaveReason} onChange={e=>setLeaveReason(e.target.value)}/></div>}
        <div style={{marginTop:10}}><div style={{...S.lbl,color:C.orange}}>📄 İzin Belgesi Fotoğrafı (zorunlu)</div>
          <div style={{...S.fInp,borderColor:leaveDoc?C.green+"88":C.orange+"88",background:leaveDoc?C.greenD:C.bg}} onClick={()=>leaveDocRef.current?.click()}>
            <span style={{color:leaveDoc?C.green:C.muted}}>{leaveDoc?"✓ Belge yüklendi":"Fotoğraf çekin veya seçin..."}</span><span style={{fontSize:18}}>📄</span>
          </div>
          {leaveDoc&&<img src={leaveDoc} alt="" style={{width:"100%",maxHeight:160,objectFit:"cover",borderRadius:10,marginBottom:8}}/>}
          <input ref={leaveDocRef} type="file"  style={{display:"none"}} onChange={e=>handleLeaveDoc(e,setLeaveDoc,setLeaveDocFile)}/>
        </div>
      </div>}
      {isSel&&<div>
        {calMode==="select"&&<button style={S.btn(willDebt?C.orange:C.teal)} onClick={submitLeaveReq} disabled={submitting}>{submitting?"Gönderiliyor...":willDebt?`⚠ Borçlanarak İzin Gönder (${calSel.length} gun)`:`📅 Onaya Gönder (${calSel.length} gun)`}</button>}
        {calMode==="modify"&&<button style={S.btn(C.orange)} onClick={modifyLeave} disabled={submitting}>{submitting?"...":"📅 Tarihleri Değiştir"}</button>}
        <button style={S.btn(C.border,C.text)} onClick={()=>{setCalMode("view");setCalSel([]);setCalModId(null);setLeaveReason("");}}>İptal</button>
      </div>}
      {!isSel&&!hourlyMode&&<div style={{display:"flex",gap:8}}>
        <button style={{...S.btn(C.teal),flex:1}} onClick={()=>{setCalMode("select");setCalSel([]);setLeaveReason("");setLeaveDoc(null);setLeaveDocFile(null);}}>📅 Günlük İzin</button>
        <button style={{...S.btn(C.blueD,C.blue),flex:1}} onClick={()=>{setHourlyMode(true);setHourlyForm({date:todayStr(),startTime:"",endTime:"",reason:""});setHourlyLeaveDoc(null);setHourlyLeaveDocFile(null);}}>🕐 Saatlik İzin</button>
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
        <div style={{...S.lbl,color:C.orange}}>📄 İzin Belgesi Fotoğrafı (zorunlu)</div>
        <div style={{...S.fInp,borderColor:hourlyLeaveDoc?C.green+"88":C.orange+"88",background:hourlyLeaveDoc?C.greenD:C.bg}} onClick={()=>hourlyLeaveDocRef.current?.click()}>
          <span style={{color:hourlyLeaveDoc?C.green:C.muted}}>{hourlyLeaveDoc?"✓ Belge yüklendi":"Fotoğraf çekin veya seçin..."}</span><span style={{fontSize:18}}>📄</span>
        </div>
        {hourlyLeaveDoc&&<img src={hourlyLeaveDoc} alt="" style={{width:"100%",maxHeight:160,objectFit:"cover",borderRadius:10,marginBottom:8}}/>}
        <input ref={hourlyLeaveDocRef} type="file"  style={{display:"none"}} onChange={e=>handleLeaveDoc(e,setHourlyLeaveDoc,setHourlyLeaveDocFile)}/>
        <button style={S.btn(C.blue)} onClick={submitHourlyLeave} disabled={submitting}>{submitting?"Gönderiliyor...":"🕐 Saatlik İzin Gönder"}</button>
        <button style={S.btn(C.border,C.text)} onClick={()=>{setHourlyMode(false);setHourlyLeaveDoc(null);setHourlyLeaveDocFile(null);}}>İptal</button>
      </div>}
      {!isSel&&<div style={{marginTop:16}}>
        <div style={S.sec}><span>🏖</span> İzin Talepleri</div>
        {(isPerso?leavesState.filter(l=>l.personnel_id===profile.id):bLeaves).filter(l=>l.status!=="rejected").map(l=>{const p=getU(l.personnel_id);const dates=Array.isArray(l.dates)?l.dates:[];const isHourly=l.leave_type==="hourly";return(<div key={l.id} style={S.crd} onClick={()=>setSelLV(l)}><div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}><div>{!isPerso&&<div style={{fontSize:13,fontWeight:600,marginBottom:4}}>{p?.full_name}</div>}{isHourly?<div><div style={{...S.tag(C.blueD,C.blue),marginBottom:4}}>🕐 Saatlik İzin</div><div style={{fontSize:12,color:C.text}}>{fDS(dates[0])} • {l.leave_start_time?.slice(0,5)}-{l.leave_end_time?.slice(0,5)}</div></div>:<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{dates.map(d=><span key={d} style={S.tag(l.status==="approved"?C.greenD:C.orangeD,l.status==="approved"?C.green:C.orange)}>{fDS(d)}</span>)}</div>}{l.reason&&<div style={{fontSize:10,color:l.reason.includes("borc")?C.red:C.dim,marginTop:4}}>{l.reason.length>50?l.reason.slice(0,50)+"...":l.reason}</div>}</div><div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:700}}>{isHourly?l.total_hours+"s":dates.length+"g"}</div><div style={S.tag(sColor(l.status)+"22",sColor(l.status))}>{sIcon(l.status)}</div>{l.leave_doc_url&&<div style={{fontSize:10,color:C.green,marginTop:2}}>📄</div>}</div></div>{!isHourly&&(isPerso||isAdmin)&&l.status!=="approved"&&<button style={{...S.btnS(C.orangeD,C.orange),marginTop:8,fontSize:11}} onClick={e=>{e.stopPropagation();startModLV(l);}}>🔄 Tarihleri Değiştir</button>}</div>);})}
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
      {(o.photo_before||o.photo_after)&&<div><div style={S.lbl}>Fotoğraflar</div><div style={{display:"flex",gap:10}}>{o.photo_before&&<div style={{flex:1}}><div style={{fontSize:10,color:C.orange,fontWeight:700,marginBottom:4}}>ONCE</div><img src={o.photo_before} alt="" style={{width:"100%",borderRadius:10}}/></div>}{o.photo_after&&<div style={{flex:1}}><div style={{fontSize:10,color:C.green,fontWeight:700,marginBottom:4}}>SONRA</div><img src={o.photo_after} alt="" style={{width:"100%",borderRadius:10}}/></div>}</div></div>}
      {isAdmin&&editOT&&editOT.id===o.id?<div style={{background:C.accentD,borderRadius:12,padding:14,marginTop:12}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:10,color:C.accent}}>✏️ Saatleri Düzelt</div>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}><div style={S.lbl}>Başlangıç</div><div style={S.fInp} onClick={()=>setShowEditStartTP(true)}><span>{editOT.start_time||"Saat"}</span><span>🕐</span></div></div>
          <div style={{flex:1}}><div style={S.lbl}>Bitiş</div><div style={S.fInp} onClick={()=>setShowEditEndTP(true)}><span>{editOT.end_time||"Saat"}</span><span>🕐</span></div></div>
        </div>
        {editOT.start_time&&editOT.end_time&&(()=>{const h=calcOT(editOT.start_time,editOT.end_time,editOT.ot_type);return h>0?<div style={{...S.lawBox,marginTop:8,marginBottom:0}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:10,color:C.dim}}>Yeni Mesai</div><div style={{fontSize:20,fontWeight:800,color:C.accent}}>{h}s</div></div><div><div style={{fontSize:10,color:C.dim}}>Yeni İzin</div><div style={{fontSize:20,fontWeight:800,color:C.purple}}>{calcLH(h)}s</div></div></div>{(h!==o.hours)&&<div style={{fontSize:11,color:C.orange,marginTop:6}}>Önceki: {o.hours}s mesai → {o.leave_hours}s izin</div>}</div>:null;})()}
        <div style={{display:"flex",gap:8,marginTop:10}}><button style={{...S.btn(C.accent),flex:1}} onClick={doEditOT} disabled={submitting}>{submitting?"Kaydediliyor...":"💾 Kaydet"}</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setEditOT(null)}>İptal</button></div>
      </div>:isAdmin&&<button style={{...S.btn(C.accentD,C.accent),marginTop:8}} onClick={()=>setEditOT({id:o.id,start_time:o.start_time?.slice(0,5)||"17:00",end_time:o.end_time?.slice(0,5)||"18:00",ot_type:o.overtime_type||"evening"})}>✏️ Saatleri Düzelt</button>}
      {canApprove&&o.status!=="approved"&&o.status!=="rejected"&&<><div style={S.dv}/><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.green),flex:1}} onClick={()=>{doApproveOT(o.id,isChef?"chef":"manager");setSelOT(null);}}>✓ Onayla</button><button style={{...S.btn(C.redD,C.red),flex:1}} onClick={()=>{doRejectOT(o.id);setSelOT(null);}}>✗ Reddet</button></div></>}
      {isAdmin&&<><div style={S.dv}/>{deleteConfirm===o.id?<div style={{background:C.redD,borderRadius:10,padding:14}}><div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:8,textAlign:"center"}}>⚠ Bu mesaiyi silmek istediğinize emin misiniz?</div><div style={{fontSize:11,color:C.dim,textAlign:"center",marginBottom:12}}>Geri alınamaz. Izin hakki da silinir.</div><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.red),flex:1}} onClick={()=>doDeleteOT(o.id)} disabled={submitting}>{submitting?"Siliniyor...":"🗑 Evet, Sil"}</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setDeleteConfirm(null)}>İptal</button></div></div>:<button style={S.btn(C.redD,C.red)} onClick={()=>setDeleteConfirm(o.id)}>🗑 Bu Mesaiyi Sil</button>}</>}
      <button style={S.btn(C.border,C.text)} onClick={()=>{setSelOT(null);setDeleteConfirm(null);setEditOT(null);}}>Kapat</button>
    </div></div>);
  };

  const renderLVDetail=()=>{
    if(!selLV)return null;const l=selLV,p=getU(l.personnel_id);const dates=Array.isArray(l.dates)?l.dates:[];const prevDates=Array.isArray(l.previous_dates)?l.previous_dates:[];
    return(<div style={S.mod} onClick={()=>setSelLV(null)}><div style={S.modC} onClick={e=>e.stopPropagation()}>
      <div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:12}}>Izin Detayı</div>
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
      {l.leave_doc_url&&<div style={{marginTop:12}}><div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>📄 İzin Belgesi</div><img src={l.leave_doc_url} alt="" style={{width:"100%",maxHeight:300,objectFit:"cover",borderRadius:10}}/><a href={l.leave_doc_url} download target="_blank" rel="noopener" style={{display:"block",textAlign:"center",marginTop:8,padding:"10px",background:C.accentD,borderRadius:10,fontSize:13,color:C.accent,textDecoration:"none",fontWeight:700}}>⬇ Görseli İndir</a></div>}
      {prevDates.length>0&&<div style={{fontSize:12,color:C.orange,marginTop:12}}>🔄 Önceki: {prevDates.map(d=>fD(d)).join(", ")}</div>}
      {canApprove&&l.status!=="approved"&&l.status!=="rejected"&&<><div style={S.dv}/><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.green),flex:1}} onClick={()=>{doApproveLV(l.id,isChef?"chef":"manager");setSelLV(null);}}>✓ Onayla</button><button style={{...S.btn(C.redD,C.red),flex:1}} onClick={()=>{doRejectLV(l.id);setSelLV(null);}}>✗ Reddet</button></div></>}
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
      <div style={S.lbl}>📷 Fotoğraflar (2 zorunlu)</div>
      <div style={{display:"flex",gap:10,marginBottom:12,justifyContent:"space-between"}}>
        <div style={S.pBox(!!otForm.photoBefore)} onClick={()=>beforeRef.current?.click()}><div style={S.pBoxI}>{otForm.photoBefore?<><img src={otForm.photoBefore} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:10,position:"absolute",top:0,left:0}}/><div style={{position:"absolute",bottom:6,left:6,fontSize:10,background:"rgba(0,0,0,0.7)",padding:"2px 6px",borderRadius:4,color:C.orange,fontWeight:700,zIndex:1}}>ONCE ✓</div></>:<><div style={{fontSize:28}}>📷</div><div style={{fontSize:11,color:C.orange,fontWeight:600}}>BASLANGIC</div></>}</div><input ref={beforeRef} type="file"  style={{display:"none"}} onChange={e=>handlePhoto(e,"before")}/></div>
        <div style={S.pBox(!!otForm.photoAfter)} onClick={()=>afterRef.current?.click()}><div style={S.pBoxI}>{otForm.photoAfter?<><img src={otForm.photoAfter} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:10,position:"absolute",top:0,left:0}}/><div style={{position:"absolute",bottom:6,left:6,fontSize:10,background:"rgba(0,0,0,0.7)",padding:"2px 6px",borderRadius:4,color:C.green,fontWeight:700,zIndex:1}}>SONRA ✓</div></>:<><div style={{fontSize:28}}>📷</div><div style={{fontSize:11,color:C.green,fontWeight:600}}>BITIS</div></>}</div><input ref={afterRef} type="file"  style={{display:"none"}} onChange={e=>handlePhoto(e,"after")}/></div>
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

  const renderEditUser=()=>{if(!modEditUser)return null;const u=modEditUser;return(<div style={S.mod} onClick={()=>{setModEditUser(null);setDeleteConfirm(null);}}><div style={S.modC} onClick={e=>e.stopPropagation()}><div style={S.modH}/><div style={{fontSize:17,fontWeight:700,marginBottom:16}}>Düzenle: {u.full_name}</div><div style={S.lbl}>Görev</div><input style={S.inp} value={u.role||""} onChange={e=>setModEditUser({...u,role:e.target.value})}/><div style={S.lbl}>Bina</div><select style={S.sel} value={u.building_id||""} onChange={e=>setModEditUser({...u,building_id:e.target.value})}>{buildings.map(b=><option key={b.id} value={b.id}>{b.short_name||b.name}</option>)}</select><div style={S.lbl}>Yetki</div><select style={S.sel} value={u.user_role||"personnel"} onChange={e=>setModEditUser({...u,user_role:e.target.value})}><option value="personnel">Personel</option><option value="chef">Teknik Şef (Onay Yetkili)</option><option value="viewer">İzleyici (Tam Görüntüleme)</option></select><button style={S.btn(C.accent)} onClick={async()=>{try{await supabase.from('profiles').update({role:u.role,user_role:u.user_role,building_id:u.building_id}).eq('id',u.id);await fetchProfiles();setModEditUser(null);setToast("Kaydedildi");}catch(e){setToast("Hata: "+e?.message);}}}>Kaydet</button><div style={S.dv}/><button style={S.btn(C.orangeD,C.orange)} onClick={()=>doDeactivateU(u.id)}>🚫 Pasif Yap</button>{deleteConfirm===u.id?<div style={{background:C.redD,borderRadius:10,padding:14,marginTop:8}}><div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:8,textAlign:"center"}}>⚠ {u.full_name} silinecek. Mesai ve izin kayıtları arşivde kalır.</div><div style={{display:"flex",gap:8}}><button style={{...S.btn(C.red),flex:1}} onClick={()=>doDeleteUser(u.id)}>🗑 Evet, Sil</button><button style={{...S.btn(C.border,C.text),flex:1}} onClick={()=>setDeleteConfirm(null)}>İptal</button></div></div>:<button style={S.btn(C.redD,C.red)} onClick={()=>setDeleteConfirm(u.id)}>🗑 Personeli Sil</button>}<button style={S.btn(C.border,C.text)} onClick={()=>{setModEditUser(null);setDeleteConfirm(null);}}>Kapat</button></div></div>);};

  const navItems=isAdmin?[{k:"dashboard",i:"📊",l:"Özet"},{k:"faults",i:"🔧",l:"Arızalar"},{k:"depo",i:"📦",l:"Depo"},{k:"calendar",i:"📅",l:"Takvim"},{k:"approvals",i:"✅",l:"Onaylar"},{k:"admin",i:"⚙️",l:"Yönetim"}]:(isChef||isViewer)?[{k:"dashboard",i:"📊",l:"Özet"},{k:"faults",i:"🔧",l:"Arızalar"},{k:"depo",i:"📦",l:"Depo"},{k:"calendar",i:"📅",l:"Takvim"},{k:"approvals",i:isViewer?"👁":"✅",l:isViewer?"Takip":"Onaylar"}]:[{k:"dashboard",i:"📊",l:"Özet"},{k:"faults",i:"🔧",l:"Arızalar"},{k:"depo",i:"📦",l:"Depo"},{k:"calendar",i:"📅",l:"Takvim"}];
  const roleLabel=isAdmin?"👑 Yonetici":isChef?"🔧 Sef":isViewer?"👁 Izleyici":"👷 Personel";

  return(
    <div style={S.app}>
      <div style={S.hdr}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:36,height:36,minWidth:36,borderRadius:10,background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🔧</div><div><div style={{fontSize:17,fontWeight:700}}>İBB Teknik Takip</div><div style={{fontSize:11,color:C.dim}}>{curBuildingName||"Fazla Mesai & İzin"}</div></div></div>
          <div style={{display:"flex",gap:6}}><button onClick={()=>setShowPWA(true)} style={{fontSize:14,padding:"6px 8px",borderRadius:20,background:C.accentD,color:C.accent,border:"none",cursor:"pointer"}}>📲</button><button onClick={doLogout} style={{fontSize:11,padding:"6px 12px",borderRadius:20,background:C.redD,color:C.red,border:"none",cursor:"pointer",fontWeight:600}}>Çıkış</button></div>
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
      {showDatePicker&&<CustomDatePicker value={otForm.date||todayStr()} onChange={v=>setOtForm(p=>({...p,date:v}))} onClose={()=>setShowDatePicker(false)}/>}
      {showStartTP&&<CustomTimePicker value={otForm.startTime||"17:00"} onChange={v=>setOtForm(p=>({...p,startTime:v}))} onClose={()=>setShowStartTP(false)} label="Başlangıç Saati"/>}
      {showEndTP&&<CustomTimePicker value={otForm.endTime||"18:00"} onChange={v=>setOtForm(p=>({...p,endTime:v}))} onClose={()=>setShowEndTP(false)} label="Bitiş Saati"/>}
      {showPWA&&<PWAInstallGuide onClose={()=>setShowPWA(false)}/>}
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
