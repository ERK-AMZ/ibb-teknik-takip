import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, signIn, signOut, getProfiles, getOvertimes, getLeaves, createOvertime, updateOvertime, createLeave, updateLeave, uploadPhoto, subscribeToChanges } from './lib/supabase';

const OT_MULT = 1.5, DAILY_H = 8, WORK_END = 17;
function calcOT(st, et) { if (!st || !et) return 0; const [sh, sm] = st.split(":").map(Number), [eh, em] = et.split(":").map(Number); let s = sh * 60 + sm, e = eh * 60 + em; if (e <= s) e += 1440; const eff = Math.max(s, WORK_END * 60); return eff >= e ? 0 : Math.round(((e - eff) / 60) * 10) / 10; }
function calcLH(h) { return Math.round(h * OT_MULT * 10) / 10; }
function fD(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : ""; }
function fDS(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : ""; }
function sColor(s) { return s === "approved" ? "#22c55e" : s === "pending_chef" ? "#f59e0b" : s === "pending_manager" ? "#3b82f6" : s === "rejected" ? "#ef4444" : "#94a3b8"; }
function sText(s) { return s === "approved" ? "Onaylandı" : s === "pending_chef" ? "Şef Onayı Bekliyor" : s === "pending_manager" ? "Müh. Onayı Bekliyor" : s === "rejected" ? "Reddedildi" : s; }
function sIcon(s) { return s === "approved" ? "✓" : s === "rejected" ? "✗" : "⏳"; }
function ini(n) { return n ? n.split(" ").map(x => x[0]).slice(0, 2).join("") : "?"; }

const C = { bg: "#0c0e14", card: "#161923", border: "#252a3a", accent: "#6366f1", accentL: "#818cf8", accentD: "rgba(99,102,241,0.12)", text: "#e2e8f0", dim: "#94a3b8", muted: "#64748b", green: "#22c55e", greenD: "rgba(34,197,94,0.12)", orange: "#f59e0b", orangeD: "rgba(245,158,11,0.12)", red: "#ef4444", redD: "rgba(239,68,68,0.12)", blue: "#3b82f6", blueD: "rgba(59,130,246,0.12)", purple: "#a855f7", purpleD: "rgba(168,85,247,0.12)", teal: "#14b8a6", tealD: "rgba(20,184,166,0.12)" };
const avC = [C.accentD, C.greenD, C.orangeD, C.blueD, C.redD, C.purpleD, "rgba(236,72,153,0.12)", C.tealD];
function getAv(i) { return avC[i % avC.length]; }
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstDay(y, m) { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }
function dateStr(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

export default function App() {
  // ═══ STATE ═══
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfilesState] = useState([]);
  const [overtimes, setOvertimesState] = useState([]);
  const [leavesState, setLeavesState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginErr, setLoginErr] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [selPerson, setSelPerson] = useState(null);
  const [selOT, setSelOT] = useState(null);
  const [selLV, setSelLV] = useState(null);
  const [modNewOT, setModNewOT] = useState(false);
  const [modAddUser, setModAddUser] = useState(false);
  const [modEditUser, setModEditUser] = useState(null);
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [otForm, setOtForm] = useState({ date: "", startTime: "17:00", endTime: "", desc: "", photoBefore: null, photoAfter: null, fileB: null, fileA: null });
  const [otErrors, setOtErrors] = useState([]);
  const [nUser, setNUser] = useState({ name: "", email: "", password: "", role: "", night: false, userRole: "personnel" });
  const beforeRef = useRef(null);
  const afterRef = useRef(null);

  // Calendar
  const now = new Date();
  const [calY, setCalY] = useState(now.getFullYear());
  const [calM, setCalM] = useState(now.getMonth());
  const [calSel, setCalSel] = useState([]);
  const [calMode, setCalMode] = useState("view");
  const [calModId, setCalModId] = useState(null);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  // ═══ AUTH & DATA LOADING ═══
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadData(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadData(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Realtime subscriptions
  useEffect(() => {
    if (!session) return;
    const ch1 = subscribeToChanges('overtimes', () => fetchOvertimes());
    const ch2 = subscribeToChanges('leaves', () => fetchLeaves());
    const ch3 = subscribeToChanges('profiles', () => fetchProfiles());
    return () => { ch1.then(c => c.unsubscribe()); ch2.then(c => c.unsubscribe()); ch3.then(c => c.unsubscribe()); };
  }, [session]);

  async function loadData(userId) {
    setLoading(true);
    const [profs, ots, lvs] = await Promise.all([getProfiles(), getOvertimes(), getLeaves()]);
    setProfilesState(profs);
    setOvertimesState(ots);
    setLeavesState(lvs);
    const myProfile = profs.find(p => p.id === userId);
    setProfile(myProfile);
    setLoading(false);
  }

  async function fetchProfiles() { const d = await getProfiles(); setProfilesState(d); }
  async function fetchOvertimes() { const d = await getOvertimes(); setOvertimesState(d); }
  async function fetchLeaves() { const d = await getLeaves(); setLeavesState(d); }

  const isAdmin = profile?.user_role === "admin";
  const isChef = profile?.user_role === "chef";
  const isPerso = profile?.user_role === "personnel";
  const activePers = profiles.filter(u => u.active && u.user_role === "personnel");
  const activeAll = profiles.filter(u => u.active && u.id !== profile?.id);

  function getU(id) { return profiles.find(u => u.id === id); }
  function totApproved(pid) { return overtimes.filter(o => o.personnel_id === pid && o.status === "approved").reduce((s, o) => s + Number(o.leave_hours || 0), 0); }
  function totUsedLV(pid) { return leavesState.filter(l => l.personnel_id === pid && ["approved", "pending_chef", "pending_manager"].includes(l.status)).reduce((s, l) => s + (l.total_hours || 0), 0); }
  function remHours(pid) { return Math.round((totApproved(pid) - totUsedLV(pid)) * 10) / 10; }
  function totOTH(pid) { return overtimes.filter(o => o.personnel_id === pid && o.status === "approved").reduce((s, o) => s + Number(o.hours), 0); }
  function remDays(pid) { return Math.round((remHours(pid) / 8) * 10) / 10; }

  // ═══ ACTIONS ═══
  async function doLogin() {
    setLoginErr("");
    const { error } = await signIn(login.email, login.password);
    if (error) setLoginErr("Giriş başarısız: " + error.message);
  }

  async function doLogout() {
    await signOut();
    setProfile(null); setPage("dashboard"); setSelPerson(null);
  }

  async function doApproveOT(id, lvl) {
    const updates = lvl === "chef"
      ? { approved_by_chef: true, status: "pending_manager" }
      : { approved_by_manager: true, status: "approved" };
    await updateOvertime(id, updates);
    await fetchOvertimes();
    setToast("✓ Mesai onaylandı");
  }

  async function doRejectOT(id) {
    await updateOvertime(id, { status: "rejected" });
    await fetchOvertimes();
    setToast("✗ Reddedildi");
  }

  async function doApproveLV(id, lvl) {
    const updates = lvl === "chef"
      ? { approved_by_chef: true, status: "pending_manager" }
      : { approved_by_manager: true, status: "approved", previous_dates: null };
    await updateLeave(id, updates);
    await fetchLeaves();
    setToast("✓ İzin onaylandı");
  }

  async function doRejectLV(id) {
    await updateLeave(id, { status: "rejected" });
    await fetchLeaves();
    setToast("✗ Reddedildi");
  }

  function handlePhoto(e, type) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setOtForm(prev => ({
      ...prev,
      [type === "before" ? "photoBefore" : "photoAfter"]: ev.target.result,
      [type === "before" ? "fileB" : "fileA"]: file
    }));
    reader.readAsDataURL(file);
  }

  async function submitOT() {
    const errors = [];
    if (!otForm.date) errors.push("Tarih seçilmedi");
    if (!otForm.startTime || !otForm.endTime) errors.push("Saat bilgisi eksik");
    const hours = calcOT(otForm.startTime, otForm.endTime);
    if (hours <= 0) errors.push("Mesai 17:00 sonrası olmalı");
    if (!otForm.photoBefore) errors.push("⚠ Başlangıç fotoğrafı zorunlu!");
    if (!otForm.photoAfter) errors.push("⚠ Bitiş fotoğrafı zorunlu!");
    if (!otForm.desc || otForm.desc.trim().length < 10) errors.push("⚠ Açıklama zorunlu (min 10 karakter)");
    if (errors.length > 0) { setOtErrors(errors); return; }

    setSubmitting(true);
    try {
      let photoBeforeUrl = null, photoAfterUrl = null;
      if (otForm.fileB) {
        const { url } = await uploadPhoto(otForm.fileB, 'before');
        photoBeforeUrl = url;
      }
      if (otForm.fileA) {
        const { url } = await uploadPhoto(otForm.fileA, 'after');
        photoAfterUrl = url;
      }

      const lH = calcLH(hours);
      await createOvertime({
        personnel_id: profile.id,
        work_date: otForm.date,
        start_time: otForm.startTime,
        end_time: otForm.endTime,
        hours,
        leave_hours: lH,
        description: otForm.desc.trim(),
        photo_before: photoBeforeUrl,
        photo_after: photoAfterUrl,
        status: "pending_chef"
      });

      await fetchOvertimes();
      setOtForm({ date: "", startTime: "17:00", endTime: "", desc: "", photoBefore: null, photoAfter: null, fileB: null, fileA: null });
      setOtErrors([]); setModNewOT(false);
      setToast(`✓ ${hours}s mesai → ${lH}s izin hakkı onaya gönderildi`);
    } catch (err) {
      setToast("❌ Hata: " + err.message);
    }
    setSubmitting(false);
  }

  async function submitLeaveReq() {
    if (calSel.length === 0) { setToast("⚠ Gün seçin"); return; }
    const needH = calSel.length * 8;
    if (remHours(profile.id) < needH) { setToast("⚠ Yeterli hak yok"); return; }
    setSubmitting(true);
    try {
      await createLeave({
        personnel_id: profile.id,
        dates: calSel.sort(),
        total_hours: needH,
        reason: "Fazla mesai karşılığı izin",
        status: "pending_chef"
      });
      await fetchLeaves();
      setCalSel([]); setCalMode("view");
      setToast(`✓ ${calSel.length} günlük izin onaya gönderildi`);
    } catch (err) { setToast("❌ " + err.message); }
    setSubmitting(false);
  }

  async function modifyLeave() {
    if (calSel.length === 0) { setToast("⚠ Yeni tarihleri seçin"); return; }
    const lv = leavesState.find(l => l.id === calModId);
    if (!lv) return;
    setSubmitting(true);
    try {
      await updateLeave(calModId, {
        previous_dates: lv.dates,
        dates: calSel.sort(),
        total_hours: calSel.length * 8,
        status: "pending_chef",
        approved_by_chef: false,
        approved_by_manager: false
      });
      await fetchLeaves();
      setCalSel([]); setCalMode("view"); setCalModId(null);
      setToast("✓ Tarihler değiştirildi, onaya gönderildi");
    } catch (err) { setToast("❌ " + err.message); }
    setSubmitting(false);
  }

  function startModLV(lv) {
    setCalModId(lv.id); setCalSel([...lv.dates]); setCalMode("modify");
    setSelLV(null);
    const f = new Date(lv.dates[0] + 'T00:00:00');
    setCalY(f.getFullYear()); setCalM(f.getMonth());
    setPage("calendar");
  }

  async function doAddUser() {
    if (!nUser.name || !nUser.email || !nUser.password || !nUser.role) { setToast("⚠ Doldurun"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: nUser.email, password: nUser.password });
      if (error) throw error;
      if (data.user) {
        await supabase.from('profiles').insert({
          id: data.user.id,
          username: nUser.email.split('@')[0],
          full_name: nUser.name,
          role: nUser.role,
          user_role: nUser.userRole,
          night_shift: nUser.night,
          active: true
        });
      }
      await fetchProfiles();
      setNUser({ name: "", email: "", password: "", role: "", night: false, userRole: "personnel" });
      setModAddUser(false);
      setToast("✓ Personel eklendi");
    } catch (err) { setToast("❌ " + err.message); }
    setSubmitting(false);
  }

  async function doDeactivateU(uid) {
    await supabase.from('profiles').update({ active: false }).eq('id', uid);
    await fetchProfiles();
    setToast("✓ Pasif"); setModEditUser(null);
  }

  async function doReactivateU(uid) {
    await supabase.from('profiles').update({ active: true }).eq('id', uid);
    await fetchProfiles();
    setToast("✓ Aktif");
  }

  // ═══ STYLES ═══
  const S = {
    app: { fontFamily: "'Segoe UI',-apple-system,sans-serif", background: C.bg, color: C.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 80 },
    hdr: { background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: 16, borderBottom: `1px solid ${C.border}` },
    nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: C.card, borderTop: `1px solid ${C.border}`, zIndex: 100 },
    navB: (a) => ({ flex: 1, padding: "10px 0 8px", border: "none", background: "none", color: a ? C.accent : C.muted, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10, fontWeight: a ? 700 : 500, position: "relative" }),
    dot: { position: "absolute", top: 6, right: "50%", transform: "translateX(14px)", width: 6, height: 6, borderRadius: "50%", background: C.red },
    cnt: { padding: 16 },
    crd: { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 14, marginBottom: 10, cursor: "pointer" },
    av: (bg, sz) => ({ width: sz || 40, height: sz || 40, borderRadius: 10, background: bg || C.accentD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: sz ? sz * 0.38 : 15, fontWeight: 700, flexShrink: 0 }),
    btn: (bg, clr) => ({ padding: "10px 20px", border: "none", borderRadius: 10, background: bg, color: clr || "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%", marginTop: 8, boxSizing: "border-box", opacity: submitting ? 0.6 : 1 }),
    btnS: (bg, clr) => ({ padding: "6px 14px", border: "none", borderRadius: 8, background: bg, color: clr || "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }),
    inp: { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 },
    sel: { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10, appearance: "none" },
    ta: { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, outline: "none", minHeight: 80, resize: "vertical", boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit" },
    lbl: { fontSize: 12, color: C.dim, marginBottom: 4, display: "block", fontWeight: 600 },
    mod: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" },
    modC: { background: C.card, borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" },
    modH: { width: 40, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 16px" },
    tag: (bg, clr) => ({ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px", borderRadius: 6, background: bg, color: clr, fontWeight: 600 }),
    dv: { height: 1, background: C.border, margin: "12px 0" },
    tst: { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 20px", fontSize: 13, fontWeight: 600, zIndex: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxWidth: 380, textAlign: "center" },
    row: { display: "flex", alignItems: "center", gap: 12 },
    stB: { display: "flex", gap: 6, marginTop: 10 },
    st: (bg) => ({ flex: 1, background: bg, borderRadius: 8, padding: "8px 6px", textAlign: "center" }),
    sG: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
    sC: (bg) => ({ background: bg, borderRadius: 12, padding: 14, textAlign: "center" }),
    emp: { textAlign: "center", padding: "40px 20px", color: C.muted },
    sec: { fontSize: 15, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 },
    pBox: (has) => ({ width: "48%", aspectRatio: "1", borderRadius: 12, border: `2px dashed ${has ? C.green : C.border}`, background: has ? "transparent" : C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", position: "relative" }),
    lawBox: { background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))", border: `1px solid ${C.accent}44`, borderRadius: 12, padding: 14, marginBottom: 12 },
    errBox: { background: C.redD, border: `1px solid ${C.red}44`, borderRadius: 10, padding: 12, marginBottom: 12 },
  };

  const pendOTs = overtimes.filter(o => (isChef && o.status === "pending_chef") || (isAdmin && o.status === "pending_manager"));
  const pendLVs = leavesState.filter(l => (isChef && l.status === "pending_chef") || (isAdmin && l.status === "pending_manager"));
  const totPend = pendOTs.length + pendLVs.length;
  const liveOTH = calcOT(otForm.startTime, otForm.endTime), liveLH = calcLH(liveOTH);

  // ═══ LOADING ═══
  if (loading) return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔧</div>
        <div style={{ color: C.dim }}>Yükleniyor...</div>
      </div>
    </div>
  );

  // ═══ LOGIN ═══
  if (!session) return (
    <div style={S.app}>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "linear-gradient(135deg,#4f46e5,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 16px", boxShadow: "0 8px 32px rgba(99,102,241,0.3)" }}>🔧</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>İBB Teknik Takip</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Fazla Mesai & İzin Yönetimi</div>
        </div>
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, textAlign: "center" }}>Giriş Yap</div>
          <div style={S.lbl}>E-posta</div>
          <input style={S.inp} type="email" placeholder="ornek@ibb.gov.tr" value={login.email} onChange={e => setLogin({ ...login, email: e.target.value })} onKeyDown={e => e.key === "Enter" && doLogin()} />
          <div style={S.lbl}>Şifre</div>
          <div style={{ position: "relative" }}>
            <input style={{ ...S.inp, paddingRight: 40 }} type={showPwd ? "text" : "password"} placeholder="Şifreniz" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} onKeyDown={e => e.key === "Enter" && doLogin()} />
            <button onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: 10, top: 10, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 16 }}>{showPwd ? "🙈" : "👁"}</button>
          </div>
          {loginErr && <div style={{ color: C.red, fontSize: 13, marginBottom: 10, textAlign: "center" }}>{loginErr}</div>}
          <button style={S.btn("linear-gradient(135deg,#4f46e5,#7c3aed)")} onClick={doLogin}>Giriş Yap</button>
        </div>
      </div>
      {toast && <div style={S.tst}>{toast}</div>}
    </div>
  );

  if (!profile) return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <div style={{ color: C.dim, marginBottom: 16 }}>Profil bulunamadı. Yönetici ile iletişime geçin.</div>
        <button style={S.btn(C.red)} onClick={doLogout}>Çıkış</button>
      </div>
    </div>
  );

  // ═══ CALENDAR ═══
  function Cal() {
    const dim = daysInMonth(calY, calM), fd = firstDay(calY, calM);
    const isSel = calMode !== "view";
    const myLvs = isPerso ? leavesState.filter(l => l.personnel_id === profile.id && l.status !== "rejected") : leavesState.filter(l => l.status !== "rejected");
    const lvDates = {};
    myLvs.forEach(l => l.dates.forEach(d => { lvDates[d] = { status: l.status, id: l.id }; }));
    const avD = isPerso ? remDays(profile.id) : 0;

    function tog(d) {
      if (!isSel) return;
      const ds = dateStr(calY, calM, d);
      if (new Date(ds) < new Date(new Date().toISOString().split("T")[0])) { setToast("⚠ Geçmiş tarih seçilemez"); return; }
      if (lvDates[ds] && (!calModId || lvDates[ds].id !== calModId)) { setToast("⚠ Bu tarihte izin var"); return; }
      setCalSel(p => p.includes(ds) ? p.filter(x => x !== ds) : [...p, ds].sort());
    }
    function prev() { calM === 0 ? (setCalY(calY - 1), setCalM(11)) : setCalM(calM - 1); }
    function next() { calM === 11 ? (setCalY(calY + 1), setCalM(0)) : setCalM(calM + 1); }

    const cells = [];
    for (let i = 0; i < fd; i++) cells.push(<div key={`e${i}`} />);
    for (let d = 1; d <= dim; d++) {
      const ds = dateStr(calY, calM, d), isSeld = calSel.includes(ds), lv = lvDates[ds];
      const isToday = ds === new Date().toISOString().split("T")[0];
      let bg = "transparent", clr = C.text, brd = "2px solid transparent";
      if (isSeld) { bg = C.accent; clr = "#fff"; brd = `2px solid ${C.accentL}`; }
      else if (lv) { bg = lv.status === "approved" ? C.greenD : C.orangeD; clr = lv.status === "approved" ? C.green : C.orange; }
      else if (isToday) brd = `2px solid ${C.accent}`;
      cells.push(<div key={d} onClick={() => tog(d)} style={{ width: "100%", aspectRatio: "1", borderRadius: 10, background: bg, border: brd, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: isSel ? "pointer" : "default" }}><div style={{ fontSize: 14, fontWeight: isToday || isSeld ? 700 : 500, color: clr }}>{d}</div>{lv && !isSeld && <div style={{ width: 4, height: 4, borderRadius: "50%", background: lv.status === "approved" ? C.green : C.orange, marginTop: 2 }} />}</div>);
    }

    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={prev} style={{ background: C.accentD, border: "none", color: C.accent, width: 36, height: 36, borderRadius: 10, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>‹</button>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 17, fontWeight: 700 }}>{MONTHS[calM]} {calY}</div>{isPerso && <div style={{ fontSize: 11, color: avD > 0 ? C.green : C.muted, marginTop: 2 }}>Kalan: {avD} gün</div>}</div>
        <button onClick={next} style={{ background: C.accentD, border: "none", color: C.accent, width: 36, height: 36, borderRadius: 10, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>{DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, color: C.muted, fontWeight: 600, padding: "4px 0" }}>{d}</div>)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>{cells}</div>
      {isSel && calSel.length > 0 && <div style={{ ...S.lawBox, marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📅 Seçilen ({calSel.length})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{calSel.sort().map(d => <div key={d} onClick={() => setCalSel(p => p.filter(x => x !== d))} style={{ ...S.tag(C.accentD, C.accent), cursor: "pointer", padding: "4px 10px" }}>{fDS(d)} ✕</div>)}</div>
        <div style={S.dv} />
        <div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 11, color: C.dim }}>Kullanılacak</div><div style={{ fontSize: 18, fontWeight: 800, color: C.purple }}>{calSel.length * 8}s</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: C.dim }}>Kalan Hak</div><div style={{ fontSize: 18, fontWeight: 800, color: avD >= calSel.length ? C.green : C.red }}>{avD}g</div></div></div>
      </div>}
      {isSel && <div>
        {calMode === "select" && <button style={S.btn(C.teal)} onClick={submitLeaveReq} disabled={submitting}>{submitting ? "Gönderiliyor..." : `📅 Onaya Gönder (${calSel.length} gün)`}</button>}
        {calMode === "modify" && <button style={S.btn(C.orange)} onClick={modifyLeave} disabled={submitting}>{submitting ? "..." : "📅 Tarihleri Değiştir"}</button>}
        <button style={S.btn(C.border, C.text)} onClick={() => { setCalMode("view"); setCalSel([]); setCalModId(null); }}>İptal</button>
      </div>}
      {!isSel && isPerso && avD > 0 && <button style={S.btn(C.teal)} onClick={() => { setCalMode("select"); setCalSel([]); }}>📅 İzin Günlerini Seç</button>}
      {!isSel && <div style={{ marginTop: 16 }}>
        <div style={S.sec}><span>🏖</span> İzin Talepleri</div>
        {(isPerso ? leavesState.filter(l => l.personnel_id === profile.id) : leavesState).filter(l => l.status !== "rejected").map(l => {
          const p = getU(l.personnel_id);
          return (<div key={l.id} style={S.crd} onClick={() => setSelLV(l)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div>{!isPerso && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p?.full_name}</div>}<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{l.dates.map(d => <span key={d} style={S.tag(l.status === "approved" ? C.greenD : C.orangeD, l.status === "approved" ? C.green : C.orange)}>{fDS(d)}</span>)}</div>{l.previous_dates && <div style={{ fontSize: 10, color: C.orange, marginTop: 4 }}>🔄 Değiştirildi</div>}</div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700 }}>{l.dates.length}g</div><div style={S.tag(sColor(l.status) + "22", sColor(l.status))}>{sIcon(l.status)}</div></div>
            </div>
            {(isPerso || isAdmin) && <button style={{ ...S.btnS(C.orangeD, C.orange), marginTop: 8, fontSize: 11 }} onClick={e => { e.stopPropagation(); startModLV(l); }}>🔄 Tarihleri Değiştir</button>}
          </div>);
        })}
      </div>}
    </div>);
  }

  // ═══ PAGES ═══
  // Dashboard, PersonDetail, Approvals, Admin pages follow the same structure
  // as the prototype but use Supabase field names (personnel_id, work_date, etc.)
  // For brevity, key render sections below:

  function Dashboard() {
    if (isPerso) {
      const myOTs = overtimes.filter(o => o.personnel_id === profile.id);
      const tOT = totOTH(profile.id), tLH = totApproved(profile.id), uH = totUsedLV(profile.id), rH = remHours(profile.id);
      return (<div>
        <div style={{ ...S.crd, background: "linear-gradient(135deg,#1e1b4b,#312e81)", cursor: "default" }}>
          <div style={S.row}><div style={S.av(C.accentD, 50)}>{ini(profile.full_name)}</div><div><div style={{ fontSize: 16, fontWeight: 700 }}>{profile.full_name}</div><div style={{ fontSize: 12, color: C.dim }}>{profile.role}</div></div></div>
          <div style={S.stB}>
            <div style={S.st(C.accentD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{tOT}s</div><div style={{ fontSize: 9, color: C.dim }}>Çalışılan</div></div>
            <div style={S.st(C.purpleD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.purple }}>{tLH}s</div><div style={{ fontSize: 9, color: C.dim }}>Hak(×1.5)</div></div>
            <div style={S.st(C.greenD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>{uH}s</div><div style={{ fontSize: 9, color: C.dim }}>Kullanılan</div></div>
            <div style={S.st("rgba(255,255,255,0.08)")}><div style={{ fontSize: 16, fontWeight: 800 }}>{rH}s</div><div style={{ fontSize: 9, color: C.dim }}>Kalan</div></div>
          </div>
        </div>
        <button style={S.btn(C.accent)} onClick={() => { setOtForm({ date: new Date().toISOString().split("T")[0], startTime: "17:00", endTime: "", desc: "", photoBefore: null, photoAfter: null, fileB: null, fileA: null }); setOtErrors([]); setModNewOT(true); }}>+ Fazla Mesai Bildir</button>
        <div style={{ height: 12 }} />
        <div style={S.sec}><span>⏱</span> Son Mesailer</div>
        {myOTs.slice(0, 5).map(o => (<div key={o.id} style={S.crd} onClick={() => setSelOT(o)}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 13, fontWeight: 600 }}>{fD(o.work_date)}</div><div style={{ fontSize: 11, color: C.dim }}>{o.start_time?.slice(0, 5)}→{o.end_time?.slice(0, 5)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{o.hours}s<span style={{ color: C.purple, fontSize: 12 }}> →{o.leave_hours}s</span></div><div style={S.tag(sColor(o.status) + "22", sColor(o.status))}>{sIcon(o.status)}</div></div></div></div>))}
      </div>);
    }
    const list = isAdmin ? profiles.filter(u => u.active && u.id !== profile.id) : activePers;
    return (<div>
      <div style={S.sG}>
        <div style={S.sC(C.accentD)}><div style={{ fontSize: 24, fontWeight: 800, color: C.accent }}>{overtimes.filter(o => o.status === "approved").reduce((s, o) => s + Number(o.hours), 0)}s</div><div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Çalışılan</div></div>
        <div style={S.sC(C.purpleD)}><div style={{ fontSize: 24, fontWeight: 800, color: C.purple }}>{overtimes.filter(o => o.status === "approved").reduce((s, o) => s + Number(o.leave_hours), 0)}s</div><div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>İzin Hakkı</div></div>
        <div style={S.sC(C.greenD)}><div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>{leavesState.filter(l => l.status === "approved").reduce((s, l) => s + l.dates.length, 0)}g</div><div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Kull. İzin</div></div>
        <div style={S.sC(C.orangeD)}><div style={{ fontSize: 24, fontWeight: 800, color: C.orange }}>{totPend}</div><div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Bekleyen</div></div>
      </div>
      <div style={S.sec}><span>👥</span> Personel</div>
      {list.map((p, i) => { const rD = remDays(p.id); return (<div key={p.id} style={S.crd} onClick={() => { setSelPerson(p.id); setPage("person"); }}><div style={S.row}><div style={S.av(getAv(i))}>{ini(p.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{p.role}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 800, color: rD > 0 ? C.green : C.muted }}>{rD}</div><div style={{ fontSize: 10, color: C.dim }}>gün</div></div></div></div>); })}
    </div>);
  }

  function Approvals() {
    if (isPerso) return <div style={S.emp}>Erişim yok</div>;
    return (<div>
      <div style={S.sec}><span>⏱</span> Mesai {pendOTs.length > 0 && <span style={S.tag(C.orangeD, C.orange)}>{pendOTs.length}</span>}</div>
      {pendOTs.length === 0 && <div style={S.emp}>Yok ✓</div>}
      {pendOTs.map(o => { const p = getU(o.personnel_id); return (<div key={o.id} style={S.crd}>
        <div style={S.row}><div style={S.av(C.orangeD)}>{ini(p?.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{p?.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{fD(o.work_date)} • {o.start_time?.slice(0, 5)}→{o.end_time?.slice(0, 5)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{o.hours}s</div><div style={{ fontSize: 11, color: C.purple }}>→{o.leave_hours}s</div></div></div>
        <div style={{ fontSize: 12, color: C.dim, margin: "8px 0" }}>{o.description}</div>
        {(o.photo_before || o.photo_after) && <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>{o.photo_before && <img src={o.photo_before} style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover" }} />}{o.photo_after && <img src={o.photo_after} style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover" }} />}</div>}
        <div style={{ display: "flex", gap: 8 }}><button style={S.btnS(C.green)} onClick={() => doApproveOT(o.id, isChef ? "chef" : "manager")}>✓ Onayla</button><button style={S.btnS(C.redD, C.red)} onClick={() => doRejectOT(o.id)}>✗ Reddet</button></div>
      </div>); })}
      <div style={{ ...S.sec, marginTop: 20 }}><span>🏖</span> İzin {pendLVs.length > 0 && <span style={S.tag(C.blueD, C.blue)}>{pendLVs.length}</span>}</div>
      {pendLVs.length === 0 && <div style={S.emp}>Yok ✓</div>}
      {pendLVs.map(l => { const p = getU(l.personnel_id); return (<div key={l.id} style={S.crd}>
        <div style={S.row}><div style={S.av(C.blueD)}>{ini(p?.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{p?.full_name}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{l.dates.map(d => <span key={d} style={S.tag(C.blueD, C.blue)}>{fDS(d)}</span>)}</div></div><div style={{ fontSize: 18, fontWeight: 800 }}>{l.dates.length}g</div></div>
        {l.previous_dates && <div style={{ fontSize: 11, color: C.orange, margin: "8px 0" }}>🔄 Eski: {l.previous_dates.map(d => fDS(d)).join(", ")}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button style={S.btnS(C.green)} onClick={() => doApproveLV(l.id, isChef ? "chef" : "manager")}>✓ Onayla</button><button style={S.btnS(C.redD, C.red)} onClick={() => doRejectLV(l.id)}>✗ Reddet</button></div>
      </div>); })}
    </div>);
  }

  function Admin() {
    if (!isAdmin) return <div style={S.emp}>Erişim yok</div>;
    return (<div>
      <div style={S.sec}><span>⚙️</span> Yönetim</div>
      <button style={S.btn(C.accent)} onClick={() => setModAddUser(true)}>+ Yeni Personel</button><div style={{ height: 16 }} />
      <div style={S.sec}><span>👥</span> Aktif ({activeAll.length})</div>
      {activeAll.map((u, i) => (<div key={u.id} style={S.crd} onClick={() => setModEditUser(u)}><div style={S.row}><div style={S.av(getAv(i))}>{ini(u.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{u.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{u.role}</div></div><div style={S.tag(u.user_role === "chef" ? C.orangeD : C.greenD, u.user_role === "chef" ? C.orange : C.green)}>{u.user_role === "chef" ? "Şef" : "Personel"}</div></div></div>))}
      {profiles.filter(u => !u.active).length > 0 && <><div style={{ ...S.sec, marginTop: 20 }}><span>🚫</span> Pasif</div>{profiles.filter(u => !u.active).map(u => <div key={u.id} style={{ ...S.crd, opacity: 0.6 }}><div style={S.row}><div style={S.av("rgba(255,255,255,0.05)")}>{ini(u.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14 }}>{u.full_name}</div></div><button style={S.btnS(C.greenD, C.green)} onClick={() => doReactivateU(u.id)}>Aktif Et</button></div></div>)}</>}
    </div>);
  }

  // ═══ MODALS ═══
  function NewOTMod() {
    if (!modNewOT) return null;
    return (<div style={S.mod} onClick={() => setModNewOT(false)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Fazla Mesai Bildir</div><div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Tüm alanlar zorunlu</div>
      <div style={S.lbl}>Tarih</div><input type="date" style={S.inp} value={otForm.date} onChange={e => setOtForm({ ...otForm, date: e.target.value })} />
      <div style={{ display: "flex", gap: 10 }}><div style={{ flex: 1 }}><div style={S.lbl}>Başlangıç</div><input type="time" style={S.inp} value={otForm.startTime} onChange={e => setOtForm({ ...otForm, startTime: e.target.value })} /></div><div style={{ flex: 1 }}><div style={S.lbl}>Bitiş</div><input type="time" style={S.inp} value={otForm.endTime} onChange={e => setOtForm({ ...otForm, endTime: e.target.value })} /></div></div>
      {otForm.endTime && <div style={S.lawBox}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 11, color: C.dim }}>Mesai</div><div style={{ fontSize: 24, fontWeight: 800, color: liveOTH > 0 ? C.accent : C.red }}>{liveOTH}s</div></div><div style={{ fontSize: 20, color: C.dim }}>→</div><div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: C.dim }}>İzin (×1.5)</div><div style={{ fontSize: 24, fontWeight: 800, color: C.purple }}>{liveLH}s</div></div></div><div style={{ fontSize: 10, color: C.muted, marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>📋 İş Kanunu Md.41</div></div>}
      <div style={S.lbl}>📷 Fotoğraflar (2 zorunlu)</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, justifyContent: "space-between" }}>
        <div style={S.pBox(!!otForm.photoBefore)} onClick={() => beforeRef.current?.click()}>{otForm.photoBefore ? <><img src={otForm.photoBefore} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} /><div style={{ position: "absolute", bottom: 6, left: 6, fontSize: 10, background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4, color: C.orange, fontWeight: 700 }}>ÖNCE ✓</div></> : <><div style={{ fontSize: 28 }}>📷</div><div style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>BAŞLANGIÇ</div></>}<input ref={beforeRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handlePhoto(e, "before")} /></div>
        <div style={S.pBox(!!otForm.photoAfter)} onClick={() => afterRef.current?.click()}>{otForm.photoAfter ? <><img src={otForm.photoAfter} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} /><div style={{ position: "absolute", bottom: 6, left: 6, fontSize: 10, background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4, color: C.green, fontWeight: 700 }}>SONRA ✓</div></> : <><div style={{ fontSize: 28 }}>📷</div><div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>BİTİŞ</div></>}<input ref={afterRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handlePhoto(e, "after")} /></div>
      </div>
      <div style={S.lbl}>Açıklama (min 10 karakter)</div><textarea style={S.ta} placeholder="Ne yapıldı?" value={otForm.desc} onChange={e => setOtForm({ ...otForm, desc: e.target.value })} />
      {otErrors.length > 0 && <div style={S.errBox}>{otErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: C.red }}>• {e}</div>)}</div>}
      <button style={S.btn(C.accent)} onClick={submitOT} disabled={submitting}>{submitting ? "Gönderiliyor..." : "Onaya Gönder"}</button>
      <button style={S.btn(C.border, C.text)} onClick={() => { setModNewOT(false); setOtErrors([]); }}>İptal</button>
    </div></div>);
  }

  function AddUserMod() {
    if (!modAddUser) return null;
    return (<div style={S.mod} onClick={() => setModAddUser(false)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>+ Personel</div>
      <div style={S.lbl}>Ad Soyad</div><input style={S.inp} value={nUser.name} onChange={e => setNUser({ ...nUser, name: e.target.value })} />
      <div style={S.lbl}>E-posta (giriş için)</div><input style={S.inp} type="email" placeholder="isim@ibb.gov.tr" value={nUser.email} onChange={e => setNUser({ ...nUser, email: e.target.value })} />
      <div style={S.lbl}>Şifre</div><input style={S.inp} value={nUser.password} onChange={e => setNUser({ ...nUser, password: e.target.value })} />
      <div style={S.lbl}>Görev</div><input style={S.inp} value={nUser.role} onChange={e => setNUser({ ...nUser, role: e.target.value })} />
      <div style={S.lbl}>Yetki</div><select style={S.sel} value={nUser.userRole} onChange={e => setNUser({ ...nUser, userRole: e.target.value })}><option value="personnel">Personel</option><option value="chef">Teknik Şef</option></select>
      <button style={S.btn(C.accent)} onClick={doAddUser} disabled={submitting}>{submitting ? "..." : "Ekle"}</button>
      <button style={S.btn(C.border, C.text)} onClick={() => setModAddUser(false)}>İptal</button>
    </div></div>);
  }

  function EditUserMod() {
    if (!modEditUser) return null; const u = modEditUser;
    return (<div style={S.mod} onClick={() => setModEditUser(null)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Düzenle: {u.full_name}</div>
      <div style={S.lbl}>Görev</div><input style={S.inp} value={u.role} onChange={e => setModEditUser({ ...u, role: e.target.value })} />
      <div style={S.lbl}>Yetki</div><select style={S.sel} value={u.user_role} onChange={e => setModEditUser({ ...u, user_role: e.target.value })}><option value="personnel">Personel</option><option value="chef">Teknik Şef</option></select>
      <button style={S.btn(C.accent)} onClick={async () => { await supabase.from('profiles').update({ role: u.role, user_role: u.user_role }).eq('id', u.id); await fetchProfiles(); setModEditUser(null); setToast("✓ Kaydedildi"); }}>Kaydet</button>
      <div style={S.dv} /><button style={S.btn(C.red)} onClick={() => doDeactivateU(u.id)}>🚫 Pasif Yap</button>
      <button style={{ ...S.btn(C.border, C.text) }} onClick={() => setModEditUser(null)}>Kapat</button>
    </div></div>);
  }

  // ═══ NAV & RENDER ═══
  const navItems = isAdmin
    ? [{ k: "dashboard", i: "📊", l: "Özet" }, { k: "calendar", i: "📅", l: "Takvim" }, { k: "approvals", i: "✅", l: "Onaylar" }, { k: "admin", i: "⚙️", l: "Yönetim" }]
    : isChef
    ? [{ k: "dashboard", i: "📊", l: "Özet" }, { k: "approvals", i: "✅", l: "Onaylar" }]
    : [{ k: "dashboard", i: "📊", l: "Özet" }, { k: "calendar", i: "📅", l: "Takvim" }];

  return (
    <div style={S.app}>
      <div style={S.hdr}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 36, height: 36, borderRadius: 10, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔧</div><div><div style={{ fontSize: 17, fontWeight: 700 }}>İBB Teknik Takip</div><div style={{ fontSize: 11, color: C.dim }}>Fazla Mesai & İzin</div></div></div>
          <button onClick={doLogout} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: C.redD, color: C.red, border: "none", cursor: "pointer", fontWeight: 600 }}>Çıkış</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 12px" }}><div style={S.av(C.accentD, 28)}>{ini(profile.full_name)}</div><div><div style={{ fontSize: 13, fontWeight: 600 }}>{profile.full_name}</div><div style={{ fontSize: 10, color: C.dim }}>{isAdmin ? "👑 Yönetici" : isChef ? "🔧 Şef" : "👷 Personel"}</div></div></div>
      </div>
      <div style={S.cnt}>
        {page === "dashboard" && <Dashboard />}
        {page === "calendar" && <div><div style={S.sec}><span>📅</span> İzin Takvimi</div><Cal /></div>}
        {page === "approvals" && <Approvals />}
        {page === "admin" && <Admin />}
      </div>
      <div style={S.nav}>{navItems.map(n => (<button key={n.k} style={S.navB(page === n.k)} onClick={() => { setPage(n.k); setSelPerson(null); setCalMode("view"); setCalSel([]); }}><span style={{ fontSize: 18 }}>{n.i}</span>{n.l}{n.k === "approvals" && totPend > 0 && <div style={S.dot} />}</button>))}</div>
      <NewOTMod /><AddUserMod /><EditUserMod />
      {toast && <div style={S.tst}>{toast}</div>}
    </div>
  );
}
