import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, signIn, signOut, getProfiles, getOvertimes, getLeaves, createOvertime, updateOvertime, createLeave, updateLeave, uploadPhoto, subscribeToChanges } from './lib/supabase';

const OT_MULT = 1.5, WORK_END = 17;
function calcOT(st, et) { if (!st || !et) return 0; const [sh, sm] = st.split(":").map(Number), [eh, em] = et.split(":").map(Number); let s = sh * 60 + sm, e = eh * 60 + em; if (e <= s) e += 1440; const eff = Math.max(s, WORK_END * 60); return eff >= e ? 0 : Math.round(((e - eff) / 60) * 10) / 10; }
function calcLH(h) { return Math.round(h * OT_MULT * 10) / 10; }
function fD(d) { if (!d) return ""; try { return new Date(d + 'T00:00:00').toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; } }
function fDS(d) { if (!d) return ""; try { return new Date(d + 'T00:00:00').toLocaleDateString("tr-TR", { day: "numeric", month: "short" }); } catch { return d; } }
function sColor(s) { return s === "approved" ? "#22c55e" : s === "pending_chef" ? "#f59e0b" : s === "pending_manager" ? "#3b82f6" : s === "rejected" ? "#ef4444" : "#94a3b8"; }
function sText(s) { return s === "approved" ? "Onaylandı" : s === "pending_chef" ? "Şef Onayı Bekliyor" : s === "pending_manager" ? "Müh. Onayı Bekliyor" : s === "rejected" ? "Reddedildi" : s; }
function sIcon(s) { return s === "approved" ? "✓" : s === "rejected" ? "✗" : "⏳"; }
function ini(n) { if (!n) return "?"; try { return n.split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase(); } catch { return "?"; } }

const C = { bg: "#0c0e14", card: "#161923", border: "#252a3a", accent: "#6366f1", accentL: "#818cf8", accentD: "rgba(99,102,241,0.12)", text: "#e2e8f0", dim: "#94a3b8", muted: "#64748b", green: "#22c55e", greenD: "rgba(34,197,94,0.12)", orange: "#f59e0b", orangeD: "rgba(245,158,11,0.12)", red: "#ef4444", redD: "rgba(239,68,68,0.12)", blue: "#3b82f6", blueD: "rgba(59,130,246,0.12)", purple: "#a855f7", purpleD: "rgba(168,85,247,0.12)", teal: "#14b8a6", tealD: "rgba(20,184,166,0.12)" };
const avC = [C.accentD, C.greenD, C.orangeD, C.blueD, C.redD, C.purpleD, "rgba(236,72,153,0.12)", C.tealD];
function getAv(i) { return avC[i % avC.length]; }
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstDay(y, m) { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }
function dateStr(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function todayStr() { try { return new Date().toISOString().split("T")[0]; } catch { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; } }

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfilesState] = useState([]);
  const [overtimes, setOvertimesState] = useState([]);
  const [leavesState, setLeavesState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
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
  const descRef = useRef(null);

  const now = new Date();
  const [calY, setCalY] = useState(now.getFullYear());
  const [calM, setCalM] = useState(now.getMonth());
  const [calSel, setCalSel] = useState([]);
  const [calMode, setCalMode] = useState("view");
  const [calModId, setCalModId] = useState(null);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  // ═══ SAFE DATA FETCHERS ═══
  const fetchProfiles = useCallback(async () => {
    try { const data = await getProfiles(); if (data) setProfilesState(data); }
    catch (err) { console.error("fetchProfiles error:", err); }
  }, []);

  const fetchOvertimes = useCallback(async () => {
    try { const data = await getOvertimes(); if (data) setOvertimesState(data); }
    catch (err) { console.error("fetchOvertimes error:", err); }
  }, []);

  const fetchLeaves = useCallback(async () => {
    try { const data = await getLeaves(); if (data) setLeavesState(data); }
    catch (err) { console.error("fetchLeaves error:", err); }
  }, []);

  const loadData = useCallback(async (uid) => {
    setLoading(true);
    setLoadError(null);
    try {
      const results = await Promise.allSettled([getProfiles(), getOvertimes(), getLeaves()]);
      const profs = results[0].status === "fulfilled" ? (results[0].value || []) : [];
      const ots = results[1].status === "fulfilled" ? (results[1].value || []) : [];
      const lvs = results[2].status === "fulfilled" ? (results[2].value || []) : [];

      setProfilesState(profs);
      setOvertimesState(ots);
      setLeavesState(lvs);

      const foundProfile = profs.find(p => p.id === uid);
      setProfile(foundProfile || null);

      if (!foundProfile && profs.length === 0) {
        setLoadError("Veri yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.");
      }
    } catch (err) {
      console.error("loadData error:", err);
      setLoadError("Bağlantı hatası: " + (err?.message || "Bilinmeyen hata"));
    } finally {
      setLoading(false);
    }
  }, []);

  // ═══ AUTH - with full error handling ═══
  useEffect(() => {
    let mounted = true;
    let authSubscription = null;

    const initAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          console.error("getSession error:", error);
          setLoading(false);
          return;
        }
        const s = data?.session || null;
        setSession(s);
        if (s?.user?.id) {
          await loadData(s.user.id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("initAuth error:", err);
        if (mounted) {
          setLoading(false);
          setLoadError("Oturum kontrol edilemedi. Sayfayı yenileyin.");
        }
      }
    };

    try {
      const { data } = supabase.auth.onAuthStateChange((_ev, s) => {
        if (!mounted) return;
        setSession(s);
        if (s?.user?.id) {
          loadData(s.user.id);
        } else {
          setProfile(null);
          setLoading(false);
        }
      });
      authSubscription = data?.subscription;
    } catch (err) {
      console.error("onAuthStateChange error:", err);
    }

    initAuth();

    return () => {
      mounted = false;
      try { authSubscription?.unsubscribe(); } catch (e) { /* ignore */ }
    };
  }, [loadData]);

  // ═══ REALTIME SUBSCRIPTIONS - with error handling ═══
  useEffect(() => {
    if (!session) return;
    let subs = [];
    let mounted = true;

    const setupSubs = async () => {
      try {
        const ch1 = await subscribeToChanges('overtimes', () => { if (mounted) fetchOvertimes(); });
        if (ch1) subs.push(ch1);
      } catch (e) { console.error("sub overtimes error:", e); }
      try {
        const ch2 = await subscribeToChanges('leaves', () => { if (mounted) fetchLeaves(); });
        if (ch2) subs.push(ch2);
      } catch (e) { console.error("sub leaves error:", e); }
      try {
        const ch3 = await subscribeToChanges('profiles', () => { if (mounted) fetchProfiles(); });
        if (ch3) subs.push(ch3);
      } catch (e) { console.error("sub profiles error:", e); }
    };

    setupSubs();

    return () => {
      mounted = false;
      subs.forEach(s => { try { s?.unsubscribe(); } catch (e) { /* ignore */ } });
    };
  }, [session, fetchOvertimes, fetchLeaves, fetchProfiles]);

  // ═══ ROLE HELPERS ═══
  // Roller: admin (Fatih - tam yetki), chef (Eyüp - onay yetkisi), viewer (Onur/Kadir - tam görüntüleme, onay yok), personnel (personel)
  const isAdmin = profile?.user_role === "admin";
  const isChef = profile?.user_role === "chef";
  const isViewer = profile?.user_role === "viewer";
  const isPerso = profile?.user_role === "personnel";
  // Tüm sistemi görebilen roller (admin, chef, viewer)
  const canViewAll = isAdmin || isChef || isViewer;
  // Onay verebilen roller (sadece admin ve chef)
  const canApprove = isAdmin || isChef;

  function getU(id) { return profiles.find(u => u.id === id); }
  function totLH(pid) { return overtimes.filter(o => o.personnel_id === pid && o.status === "approved").reduce((s, o) => s + Number(o.leave_hours || 0), 0); }
  function totUsedLV(pid) { return leavesState.filter(l => l.personnel_id === pid && ["approved", "pending_chef", "pending_manager"].includes(l.status)).reduce((s, l) => s + (l.total_hours || 0), 0); }
  function remHours(pid) { return Math.round((totLH(pid) - totUsedLV(pid)) * 10) / 10; }
  function totOTH(pid) { return overtimes.filter(o => o.personnel_id === pid && o.status === "approved").reduce((s, o) => s + Number(o.hours || 0), 0); }
  function remDays(pid) { return Math.round((remHours(pid) / 8) * 10) / 10; }
  function debtDays(pid) { const r = remDays(pid); return r < 0 ? Math.abs(r) : 0; }
  function pendCount(pid) { return overtimes.filter(o => o.personnel_id === pid && ["pending_chef", "pending_manager"].includes(o.status)).length + leavesState.filter(l => l.personnel_id === pid && ["pending_chef", "pending_manager"].includes(l.status)).length; }

  // ═══ ACTIONS ═══
  async function doLogin() {
    setLoginErr("");
    try {
      const { error } = await signIn(login.email, login.password);
      if (error) setLoginErr("Giriş başarısız: " + error.message);
    } catch (err) {
      setLoginErr("Bağlantı hatası: " + (err?.message || "Tekrar deneyin"));
    }
  }

  async function doLogout() {
    try { await signOut(); } catch (e) { console.error("logout error:", e); }
    setProfile(null); setPage("dashboard"); setSelPerson(null);
  }

  async function doApproveOT(id, lvl) {
    try {
      const up = lvl === "chef" ? { approved_by_chef: true, status: "pending_manager" } : { approved_by_manager: true, status: "approved" };
      await updateOvertime(id, up); await fetchOvertimes(); setToast("✓ Mesai onaylandı");
    } catch (err) { setToast("❌ " + (err?.message || "Hata")); }
  }
  async function doRejectOT(id) {
    try { await updateOvertime(id, { status: "rejected" }); await fetchOvertimes(); setToast("✗ Reddedildi"); }
    catch (err) { setToast("❌ " + (err?.message || "Hata")); }
  }
  async function doApproveLV(id, lvl) {
    try {
      const up = lvl === "chef" ? { approved_by_chef: true, status: "pending_manager" } : { approved_by_manager: true, status: "approved" };
      await updateLeave(id, up); await fetchLeaves(); setToast("✓ İzin onaylandı");
    } catch (err) { setToast("❌ " + (err?.message || "Hata")); }
  }
  async function doRejectLV(id) {
    try { await updateLeave(id, { status: "rejected" }); await fetchLeaves(); setToast("✗ Reddedildi"); }
    catch (err) { setToast("❌ " + (err?.message || "Hata")); }
  }

  function handlePhoto(e, type) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setOtForm(prev => ({
          ...prev,
          [type === "before" ? "photoBefore" : "photoAfter"]: ev.target.result,
          [type === "before" ? "fileB" : "fileA"]: file
        }));
      };
      reader.onerror = () => { setToast("❌ Fotoğraf okunamadı"); };
      reader.readAsDataURL(file);
    } catch (err) {
      setToast("❌ Fotoğraf yüklenemedi");
    }
    // iOS fix: Reset input value so same file can be selected again
    if (e.target) e.target.value = "";
  }

  async function submitOT() {
    // Read desc from ref first
    const currentDesc = descRef.current ? descRef.current.value : otForm.desc;

    const errors = [];
    if (!otForm.date) errors.push("Tarih seçilmedi");
    if (!otForm.startTime || !otForm.endTime) errors.push("Saat bilgisi eksik");
    const hours = calcOT(otForm.startTime, otForm.endTime);
    if (hours <= 0) errors.push("Mesai 17:00 sonrası olmalı");
    if (!otForm.photoBefore) errors.push("Başlangıç fotoğrafı zorunlu");
    if (!otForm.photoAfter) errors.push("Bitiş fotoğrafı zorunlu");
    if (!currentDesc || currentDesc.trim().length < 10) errors.push("Açıklama zorunlu (min 10 karakter)");
    if (errors.length) { setOtErrors(errors); return; }

    setSubmitting(true);
    try {
      let pBUrl = null, pAUrl = null;
      if (otForm.fileB) {
        const result = await uploadPhoto(otForm.fileB, 'before');
        pBUrl = result?.url || null;
      }
      if (otForm.fileA) {
        const result = await uploadPhoto(otForm.fileA, 'after');
        pAUrl = result?.url || null;
      }
      await createOvertime({
        personnel_id: profile.id,
        work_date: otForm.date,
        start_time: otForm.startTime,
        end_time: otForm.endTime,
        hours,
        leave_hours: calcLH(hours),
        description: currentDesc.trim(),
        photo_before: pBUrl,
        photo_after: pAUrl,
        status: "pending_chef"
      });
      await fetchOvertimes();
      setOtForm({ date: "", startTime: "17:00", endTime: "", desc: "", photoBefore: null, photoAfter: null, fileB: null, fileA: null });
      setOtErrors([]);
      setModNewOT(false);
      setToast(`✓ ${hours}s mesai → ${calcLH(hours)}s izin hakkı onaya gönderildi`);
    } catch (err) { setToast("❌ " + (err?.message || "Gönderim hatası")); }
    setSubmitting(false);
  }

  async function submitLeaveReq() {
    if (calSel.length === 0) { setToast("⚠ Gün seçin"); return; }
    const needH = calSel.length * 8;
    const rH = remHours(profile.id);
    const willDebt = rH < needH;
    setSubmitting(true);
    try {
      await createLeave({
        personnel_id: profile.id,
        dates: calSel.sort(),
        total_hours: needH,
        reason: willDebt ? `Fazla mesai karşılığı izin (${Math.round((needH - rH) / 8 * 10) / 10} gün borçlanma)` : "Fazla mesai karşılığı izin",
        status: "pending_chef"
      });
      await fetchLeaves();
      setCalSel([]);
      setCalMode("view");
      setToast(willDebt ? `⚠ ${calSel.length} gün izin gönderildi (borçlanma dahil)` : `✓ ${calSel.length} günlük izin onaya gönderildi`);
    } catch (err) { setToast("❌ " + (err?.message || "Hata")); }
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
      setCalSel([]);
      setCalMode("view");
      setCalModId(null);
      setToast("✓ Tarihler değiştirildi");
    } catch (err) { setToast("❌ " + (err?.message || "Hata")); }
    setSubmitting(false);
  }

  function startModLV(lv) {
    setCalModId(lv.id);
    setCalSel(Array.isArray(lv.dates) ? [...lv.dates] : []);
    setCalMode("modify");
    setSelLV(null);
    try {
      const f = new Date(lv.dates[0] + 'T00:00:00');
      setCalY(f.getFullYear());
      setCalM(f.getMonth());
    } catch (e) { /* keep current month */ }
    setPage("calendar");
  }

  async function doAddUser() {
    if (!nUser.name || !nUser.email || !nUser.password || !nUser.role) { setToast("⚠ Tüm alanları doldurun"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: nUser.email, password: nUser.password });
      if (error) throw error;
      if (data?.user) {
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
    } catch (err) { setToast("❌ " + (err?.message || "Hata")); }
    setSubmitting(false);
  }

  async function doDeactivateU(uid) {
    try { await supabase.from('profiles').update({ active: false }).eq('id', uid); await fetchProfiles(); setToast("✓ Pasif"); setModEditUser(null); }
    catch (err) { setToast("❌ " + (err?.message || "Hata")); }
  }
  async function doReactivateU(uid) {
    try { await supabase.from('profiles').update({ active: true }).eq('id', uid); await fetchProfiles(); setToast("✓ Aktif"); }
    catch (err) { setToast("❌ " + (err?.message || "Hata")); }
  }

  // ═══ STYLES (iOS/Android uyumlu) ═══
  const S = {
    app: { fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", background: C.bg, color: C.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 80, WebkitTapHighlightColor: "transparent", WebkitTextSizeAdjust: "100%" },
    hdr: { background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: "16px 16px env(safe-area-inset-top, 0px) 16px", borderBottom: `1px solid ${C.border}` },
    nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: C.card, borderTop: `1px solid ${C.border}`, zIndex: 100, paddingBottom: "env(safe-area-inset-bottom, 0px)" },
    navB: (a) => ({ flex: 1, padding: "10px 0 8px", border: "none", background: "none", color: a ? C.accent : C.muted, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10, fontWeight: a ? 700 : 500, position: "relative", WebkitTapHighlightColor: "transparent" }),
    dot: { position: "absolute", top: 6, right: "50%", transform: "translateX(14px)", width: 6, height: 6, borderRadius: "50%", background: C.red },
    cnt: { padding: 16 },
    crd: { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 14, marginBottom: 10, cursor: "pointer", WebkitTapHighlightColor: "transparent" },
    av: (bg, sz) => ({ width: sz || 40, height: sz || 40, minWidth: sz || 40, minHeight: sz || 40, borderRadius: 10, background: bg || C.accentD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: sz ? Math.round(sz * 0.38) : 15, fontWeight: 700, flexShrink: 0 }),
    btn: (bg, clr) => ({ padding: "12px 20px", border: "none", borderRadius: 10, background: bg, color: clr || "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%", marginTop: 8, boxSizing: "border-box", opacity: submitting ? 0.6 : 1, WebkitAppearance: "none", WebkitTapHighlightColor: "transparent" }),
    btnS: (bg, clr) => ({ padding: "8px 14px", border: "none", borderRadius: 8, background: bg, color: clr || "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", WebkitAppearance: "none", WebkitTapHighlightColor: "transparent" }),
    inp: { width: "100%", padding: "12px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 16, outline: "none", boxSizing: "border-box", marginBottom: 10, WebkitAppearance: "none" },
    ta: { width: "100%", padding: "12px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 16, outline: "none", minHeight: 80, resize: "vertical", boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit", WebkitAppearance: "none" },
    lbl: { fontSize: 12, color: C.dim, marginBottom: 4, display: "block", fontWeight: 600 },
    mod: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" },
    modC: { background: C.card, borderRadius: "20px 20px 0 0", padding: "20px 16px calc(32px + env(safe-area-inset-bottom, 0px))", width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch" },
    modH: { width: 40, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 16px" },
    tag: (bg, clr) => ({ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px", borderRadius: 6, background: bg, color: clr, fontWeight: 600 }),
    dv: { height: 1, background: C.border, margin: "12px 0" },
    tst: { position: "fixed", top: "calc(20px + env(safe-area-inset-top, 0px))", left: "50%", transform: "translateX(-50%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 20px", fontSize: 13, fontWeight: 600, zIndex: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxWidth: 340, textAlign: "center", width: "auto" },
    row: { display: "flex", alignItems: "center", gap: 12 },
    stB: { display: "flex", gap: 6, marginTop: 10 },
    st: (bg) => ({ flex: 1, background: bg, borderRadius: 8, padding: "8px 6px", textAlign: "center" }),
    sec: { fontSize: 15, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 },
    pBox: (has) => ({ width: "47%", paddingTop: "47%", borderRadius: 12, border: `2px dashed ${has ? C.green : C.border}`, background: has ? "transparent" : C.bg, position: "relative", cursor: "pointer", overflow: "hidden" }),
    pBoxInner: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
    lawBox: { background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))", border: `1px solid ${C.accent}44`, borderRadius: 12, padding: 14, marginBottom: 12 },
    errBox: { background: C.redD, border: `1px solid ${C.red}44`, borderRadius: 10, padding: 12, marginBottom: 12 },
    back: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: "0 0 12px", fontWeight: 600, WebkitTapHighlightColor: "transparent" },
    emp: { textAlign: "center", padding: "40px 20px", color: C.muted },
    sel: { width: "100%", padding: "12px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 },
  };

  const pendOTs = overtimes.filter(o => (isChef && o.status === "pending_chef") || (isAdmin && o.status === "pending_manager"));
  const pendLVs = leavesState.filter(l => (isChef && l.status === "pending_chef") || (isAdmin && l.status === "pending_manager"));
  const totPend = pendOTs.length + pendLVs.length;
  // Viewer'lar için tüm bekleyen sayısı (sadece görüntüleme)
  const allPendOTs = overtimes.filter(o => ["pending_chef", "pending_manager"].includes(o.status));
  const allPendLVs = leavesState.filter(l => ["pending_chef", "pending_manager"].includes(l.status));
  const allPendCount = allPendOTs.length + allPendLVs.length;
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

  // ═══ LOAD ERROR ═══
  if (loadError && !session) return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <div style={{ color: C.dim, marginBottom: 16, fontSize: 14 }}>{loadError}</div>
        <button style={S.btn(C.accent)} onClick={() => window.location.reload()}>Yenile</button>
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
          <input style={S.inp} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="ornek@ibb.gov.tr" value={login.email} onChange={e => setLogin(p => ({ ...p, email: e.target.value }))} onKeyDown={e => e.key === "Enter" && doLogin()} autoComplete="email" />
          <div style={S.lbl}>Şifre</div>
          <div style={{ position: "relative" }}>
            <input style={{ ...S.inp, paddingRight: 48 }} type={showPwd ? "text" : "password"} placeholder="Şifreniz" value={login.password} onChange={e => setLogin(p => ({ ...p, password: e.target.value }))} onKeyDown={e => e.key === "Enter" && doLogin()} autoComplete="current-password" />
            <button onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: 10, top: 10, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, padding: 4 }}>{showPwd ? "🙈" : "👁"}</button>
          </div>
          {loginErr && <div style={{ color: C.red, fontSize: 13, marginBottom: 10, textAlign: "center" }}>{loginErr}</div>}
          <button style={S.btn("linear-gradient(135deg,#4f46e5,#7c3aed)")} onClick={doLogin}>Giriş Yap</button>
        </div>
      </div>
      {toast && <div style={S.tst}>{toast}</div>}
    </div>
  );

  // ═══ PROFILE NOT FOUND (with retry) ═══
  if (!profile) return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <div style={{ color: C.dim, marginBottom: 8 }}>Profil bulunamadı.</div>
        {loadError && <div style={{ color: C.red, marginBottom: 16, fontSize: 13 }}>{loadError}</div>}
        <button style={S.btn(C.accent)} onClick={() => { if (session?.user?.id) loadData(session.user.id); }}>Tekrar Dene</button>
        <button style={S.btn(C.red)} onClick={doLogout}>Çıkış</button>
      </div>
    </div>
  );

  // ═══ RENDER SECTIONS ═══

  const renderPersonDetail = () => {
    const p = getU(selPerson);
    if (!p) return <div style={S.emp}>Personel bulunamadı</div>;
    const pOTs = overtimes.filter(o => o.personnel_id === p.id).sort((a, b) => (b.work_date || "").localeCompare(a.work_date || ""));
    const pLVs = leavesState.filter(l => l.personnel_id === p.id && l.status !== "rejected");
    const tOT = totOTH(p.id), tLHVal = totLH(p.id), uH = totUsedLV(p.id), rH = remHours(p.id), debt = debtDays(p.id);

    return (<div>
      <button style={S.back} onClick={() => { setSelPerson(null); setPage("dashboard"); }}>← Geri</button>
      <div style={{ ...S.crd, background: "linear-gradient(135deg,#1e1b4b,#312e81)", cursor: "default" }}>
        <div style={S.row}><div style={S.av(C.accentD, 50)}>{ini(p.full_name)}</div><div><div style={{ fontSize: 16, fontWeight: 700 }}>{p.full_name}</div><div style={{ fontSize: 12, color: C.dim }}>{p.role}{p.night_shift ? " • 🌙" : ""}</div></div></div>
        <div style={S.stB}>
          <div style={S.st(C.accentD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{tOT}s</div><div style={{ fontSize: 9, color: C.dim }}>Çalışılan</div></div>
          <div style={S.st(C.purpleD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.purple }}>{tLHVal}s</div><div style={{ fontSize: 9, color: C.dim }}>İzin Hakkı</div></div>
          <div style={S.st(C.greenD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>{uH}s</div><div style={{ fontSize: 9, color: C.dim }}>Kullanılan</div></div>
          <div style={S.st(rH < 0 ? C.redD : "rgba(255,255,255,0.08)")}><div style={{ fontSize: 16, fontWeight: 800, color: rH < 0 ? C.red : C.text }}>{rH}s</div><div style={{ fontSize: 9, color: C.dim }}>{rH < 0 ? "BORÇ" : "Kalan"}</div></div>
        </div>
        {debt > 0 && <div style={{ marginTop: 8, background: C.redD, borderRadius: 8, padding: "6px 10px", textAlign: "center" }}><span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>⚠ {debt} gün mesai borcu var</span></div>}
      </div>

      <div style={{ ...S.sec, marginTop: 16 }}><span>⏱</span> Mesai Kayıtları ({pOTs.length})</div>
      {pOTs.length === 0 && <div style={{ ...S.emp, padding: 20 }}>Henüz kayıt yok</div>}
      {pOTs.map(o => (<div key={o.id} style={S.crd} onClick={() => setSelOT(o)}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 13, fontWeight: 600 }}>{fD(o.work_date)}</div><div style={{ fontSize: 11, color: C.dim }}>{o.start_time?.slice(0, 5)}→{o.end_time?.slice(0, 5)}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{o.hours}s<span style={{ color: C.purple, fontSize: 12 }}> →{o.leave_hours}s</span></div><div style={S.tag(sColor(o.status) + "22", sColor(o.status))}>{sIcon(o.status)} {sText(o.status)}</div></div>
        </div>
        {o.description && <div style={{ fontSize: 12, color: C.dim, marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>{o.description}</div>}
        {(o.photo_before || o.photo_after) && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{o.photo_before && <img src={o.photo_before} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }} />}{o.photo_after && <img src={o.photo_after} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }} />}</div>}
      </div>))}

      <div style={{ ...S.sec, marginTop: 16 }}><span>🏖</span> İzin Talepleri ({pLVs.length})</div>
      {pLVs.length === 0 && <div style={{ ...S.emp, padding: 20 }}>Henüz talep yok</div>}
      {pLVs.map(l => (<div key={l.id} style={S.crd}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{(Array.isArray(l.dates) ? l.dates : []).map(d => <span key={d} style={S.tag(l.status === "approved" ? C.greenD : C.orangeD, l.status === "approved" ? C.green : C.orange)}>{fDS(d)}</span>)}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700 }}>{(Array.isArray(l.dates) ? l.dates.length : 0)}g</div><div style={S.tag(sColor(l.status) + "22", sColor(l.status))}>{sIcon(l.status)}</div></div>
        </div>
        {l.reason && l.reason.includes("borçlanma") && <div style={{ fontSize: 11, color: C.red, marginTop: 4, fontWeight: 600 }}>⚠ Borçlanma dahil</div>}
      </div>))}
    </div>);
  };

  const renderDashboard = () => {
    // Personnel dashboard (kendi verilerini görür)
    if (isPerso) {
      const myOTs = overtimes.filter(o => o.personnel_id === profile.id).sort((a, b) => (b.work_date || "").localeCompare(a.work_date || ""));
      const tOT = totOTH(profile.id), tLHVal = totLH(profile.id), uH = totUsedLV(profile.id), rH = remHours(profile.id), debt = debtDays(profile.id);
      return (<div>
        <div style={{ ...S.crd, background: "linear-gradient(135deg,#1e1b4b,#312e81)", cursor: "default" }}>
          <div style={S.row}><div style={S.av(C.accentD, 50)}>{ini(profile.full_name)}</div><div><div style={{ fontSize: 16, fontWeight: 700 }}>{profile.full_name}</div><div style={{ fontSize: 12, color: C.dim }}>{profile.role}</div></div></div>
          <div style={S.stB}>
            <div style={S.st(C.accentD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{tOT}s</div><div style={{ fontSize: 9, color: C.dim }}>Çalışılan</div></div>
            <div style={S.st(C.purpleD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.purple }}>{tLHVal}s</div><div style={{ fontSize: 9, color: C.dim }}>Hak(×1.5)</div></div>
            <div style={S.st(C.greenD)}><div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>{uH}s</div><div style={{ fontSize: 9, color: C.dim }}>Kullanılan</div></div>
            <div style={S.st(rH < 0 ? C.redD : "rgba(255,255,255,0.08)")}><div style={{ fontSize: 16, fontWeight: 800, color: rH < 0 ? C.red : C.text }}>{rH}s</div><div style={{ fontSize: 9, color: C.dim }}>{rH < 0 ? "BORÇ" : "Kalan"}</div></div>
          </div>
          {debt > 0 && <div style={{ marginTop: 8, background: C.redD, borderRadius: 8, padding: "6px 10px", textAlign: "center" }}><span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>⚠ {debt} gün mesai borcu</span></div>}
        </div>
        <button style={S.btn(C.accent)} onClick={() => { setOtForm({ date: todayStr(), startTime: "17:00", endTime: "", desc: "", photoBefore: null, photoAfter: null, fileB: null, fileA: null }); setOtErrors([]); setModNewOT(true); }}>+ Fazla Mesai Bildir</button>
        <div style={{ height: 12 }} />
        <div style={S.sec}><span>⏱</span> Son Mesailer</div>
        {myOTs.length === 0 && <div style={S.emp}>Henüz mesai kaydı yok</div>}
        {myOTs.slice(0, 10).map(o => (<div key={o.id} style={S.crd} onClick={() => setSelOT(o)}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div><div style={{ fontSize: 13, fontWeight: 600 }}>{fD(o.work_date)}</div><div style={{ fontSize: 11, color: C.dim }}>{o.start_time?.slice(0, 5)}→{o.end_time?.slice(0, 5)}</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{o.hours}s<span style={{ color: C.purple, fontSize: 12 }}> →{o.leave_hours}s</span></div><div style={S.tag(sColor(o.status) + "22", sColor(o.status))}>{sIcon(o.status)}</div></div>
          </div>
          {o.description && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{o.description.slice(0, 60)}{o.description.length > 60 ? "..." : ""}</div>}
        </div>))}
      </div>);
    }

    // Admin / Chef / Viewer dashboard (tüm sistemi görür)
    const list = profiles.filter(u => u.active && u.id !== profile?.id);
    const debtors = list.filter(u => debtDays(u.id) > 0);
    const viewPendCount = isViewer ? allPendCount : totPend;

    return (<div>
      {/* Bekleyen talep kutusu */}
      <div style={{ ...S.crd, background: viewPendCount > 0 ? C.orangeD : C.card, cursor: (viewPendCount > 0 && (canApprove || isViewer)) ? "pointer" : "default", textAlign: "center" }} onClick={() => viewPendCount > 0 && setPage("approvals")}>
        <div style={{ fontSize: 28, fontWeight: 800, color: viewPendCount > 0 ? C.orange : C.green }}>{viewPendCount > 0 ? viewPendCount : "✓"}</div>
        <div style={{ fontSize: 12, color: C.dim }}>{viewPendCount > 0 ? "Onay Bekleyen Talep" : "Bekleyen talep yok"}</div>
        {isViewer && viewPendCount > 0 && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Sadece görüntüleme</div>}
      </div>

      {/* Borçlu personeller */}
      {debtors.length > 0 && <div style={{ marginBottom: 16 }}>
        <div style={{ ...S.sec, color: C.red }}><span>⚠</span> Borçlu Personel</div>
        {debtors.map((u) => (<div key={u.id} style={{ ...S.crd, borderColor: `${C.red}44` }} onClick={() => { setSelPerson(u.id); setPage("person"); }}>
          <div style={S.row}><div style={S.av(C.redD)}>{ini(u.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{u.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{u.role}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 800, color: C.red }}>{debtDays(u.id)}</div><div style={{ fontSize: 10, color: C.red }}>gün borç</div></div></div>
        </div>))}
      </div>}

      <div style={S.sec}><span>👥</span> Personel ({list.length})</div>
      {list.map((p, i) => {
        const rD = remDays(p.id), debt = debtDays(p.id), pend = pendCount(p.id);
        return (<div key={p.id} style={S.crd} onClick={() => { setSelPerson(p.id); setPage("person"); }}>
          <div style={S.row}>
            <div style={S.av(getAv(i))}>{ini(p.full_name)}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{p.role}{p.night_shift ? " • 🌙" : ""}</div></div>
            <div style={{ textAlign: "right" }}>
              {pend > 0 && <div style={{ ...S.tag(C.orangeD, C.orange), marginBottom: 4 }}>⏳ {pend}</div>}
              {debt > 0
                ? <><div style={{ fontSize: 18, fontWeight: 800, color: C.red }}>-{debt}</div><div style={{ fontSize: 10, color: C.red }}>borç</div></>
                : <><div style={{ fontSize: 18, fontWeight: 800, color: rD > 0 ? C.green : C.muted }}>{rD}</div><div style={{ fontSize: 10, color: C.dim }}>gün</div></>
              }
            </div>
          </div>
        </div>);
      })}
    </div>);
  };

  const renderApprovals = () => {
    if (isPerso) return <div style={S.emp}>Erişim yok</div>;

    // Viewer tüm bekleyenleri görür, admin/chef kendi seviyesini görür
    const visibleOTs = isViewer ? allPendOTs : pendOTs;
    const visibleLVs = isViewer ? allPendLVs : pendLVs;

    return (<div>
      {isViewer && <div style={{ background: C.blueD, borderRadius: 10, padding: "10px 14px", marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: C.blue, fontWeight: 600 }}>👁 Sadece Görüntüleme Modu</div>
      </div>}

      <div style={S.sec}><span>⏱</span> Mesai {visibleOTs.length > 0 && <span style={S.tag(C.orangeD, C.orange)}>{visibleOTs.length}</span>}</div>
      {visibleOTs.length === 0 && <div style={S.emp}>Yok ✓</div>}
      {visibleOTs.map(o => { const p = getU(o.personnel_id); const debt = debtDays(o.personnel_id); return (<div key={o.id} style={S.crd}>
        <div style={S.row}><div style={S.av(C.orangeD)}>{ini(p?.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{p?.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{fD(o.work_date)} • {o.start_time?.slice(0, 5)}→{o.end_time?.slice(0, 5)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{o.hours}s</div><div style={{ fontSize: 11, color: C.purple }}>→{o.leave_hours}s</div></div></div>
        <div style={{ fontSize: 12, color: C.dim, margin: "8px 0" }}>{o.description}</div>
        {(o.photo_before || o.photo_after) && <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>{o.photo_before && <img src={o.photo_before} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />}{o.photo_after && <img src={o.photo_after} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />}</div>}
        {debt > 0 && <div style={{ fontSize: 11, color: C.red, fontWeight: 600, marginBottom: 8 }}>⚠ Bu personelin {debt} gün mesai borcu var</div>}
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{sText(o.status)}</div>
        {/* Onay butonları SADECE canApprove rollerinde gösterilir */}
        {canApprove && <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btnS(C.green)} onClick={() => doApproveOT(o.id, isChef ? "chef" : "manager")}>✓ Onayla</button>
          <button style={S.btnS(C.redD, C.red)} onClick={() => doRejectOT(o.id)}>✗ Reddet</button>
        </div>}
      </div>); })}

      <div style={{ ...S.sec, marginTop: 20 }}><span>🏖</span> İzin {visibleLVs.length > 0 && <span style={S.tag(C.blueD, C.blue)}>{visibleLVs.length}</span>}</div>
      {visibleLVs.length === 0 && <div style={S.emp}>Yok ✓</div>}
      {visibleLVs.map(l => { const p = getU(l.personnel_id); const rH = remHours(l.personnel_id); const willDebt = rH < l.total_hours; return (<div key={l.id} style={S.crd}>
        <div style={S.row}><div style={S.av(C.blueD)}>{ini(p?.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{p?.full_name}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{(Array.isArray(l.dates) ? l.dates : []).map(d => <span key={d} style={S.tag(C.blueD, C.blue)}>{fDS(d)}</span>)}</div></div><div style={{ fontSize: 18, fontWeight: 800 }}>{(Array.isArray(l.dates) ? l.dates.length : 0)}g</div></div>
        {willDebt && <div style={{ fontSize: 11, color: C.red, fontWeight: 700, margin: "8px 0", background: C.redD, borderRadius: 6, padding: "4px 8px" }}>⚠ Bu izin onaylanırsa {Math.round((l.total_hours - rH) / 8 * 10) / 10} gün borçlanacak</div>}
        {l.previous_dates && <div style={{ fontSize: 11, color: C.orange, margin: "8px 0" }}>🔄 Eski: {(Array.isArray(l.previous_dates) ? l.previous_dates : []).map(d => fDS(d)).join(", ")}</div>}
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{sText(l.status)}</div>
        {/* Onay butonları SADECE canApprove rollerinde gösterilir */}
        {canApprove && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button style={S.btnS(C.green)} onClick={() => doApproveLV(l.id, isChef ? "chef" : "manager")}>✓ Onayla</button>
          <button style={S.btnS(C.redD, C.red)} onClick={() => doRejectLV(l.id)}>✗ Reddet</button>
        </div>}
      </div>); })}
    </div>);
  };

  const renderAdmin = () => {
    if (!isAdmin) return <div style={S.emp}>Erişim yok</div>;
    const activeAll = profiles.filter(u => u.active && u.id !== profile?.id);
    return (<div>
      <div style={S.sec}><span>⚙️</span> Yönetim</div>
      <button style={S.btn(C.accent)} onClick={() => setModAddUser(true)}>+ Yeni Personel</button><div style={{ height: 16 }} />
      <div style={S.sec}><span>👥</span> Aktif ({activeAll.length})</div>
      {activeAll.map((u, i) => {
        const roleLabel = u.user_role === "chef" ? "Şef" : u.user_role === "viewer" ? "İzleyici" : u.user_role === "admin" ? "Yönetici" : "Personel";
        const roleColor = u.user_role === "chef" ? C.orange : u.user_role === "viewer" ? C.blue : u.user_role === "admin" ? C.purple : C.green;
        const roleBg = u.user_role === "chef" ? C.orangeD : u.user_role === "viewer" ? C.blueD : u.user_role === "admin" ? C.purpleD : C.greenD;
        return (<div key={u.id} style={S.crd} onClick={() => setModEditUser(u)}>
          <div style={S.row}><div style={S.av(getAv(i))}>{ini(u.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{u.full_name}</div><div style={{ fontSize: 11, color: C.dim }}>{u.role}</div></div><div style={S.tag(roleBg, roleColor)}>{roleLabel}</div></div>
        </div>);
      })}
      {profiles.filter(u => !u.active).length > 0 && <><div style={{ ...S.sec, marginTop: 20 }}><span>🚫</span> Pasif</div>{profiles.filter(u => !u.active).map(u => <div key={u.id} style={{ ...S.crd, opacity: 0.6 }}><div style={S.row}><div style={S.av("rgba(255,255,255,0.05)")}>{ini(u.full_name)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14 }}>{u.full_name}</div></div><button style={S.btnS(C.greenD, C.green)} onClick={(e) => { e.stopPropagation(); doReactivateU(u.id); }}>Aktif Et</button></div></div>)}</>}
    </div>);
  };

  const renderCalendar = () => {
    const dim = daysInMonth(calY, calM), fd = firstDay(calY, calM);
    const isSel = calMode !== "view";
    // Viewer ve admin/chef tüm izinleri, personel sadece kendisini görür
    const myLvs = isPerso ? leavesState.filter(l => l.personnel_id === profile.id && l.status !== "rejected") : leavesState.filter(l => l.status !== "rejected");
    const lvDates = {};
    myLvs.forEach(l => (Array.isArray(l.dates) ? l.dates : []).forEach(d => { lvDates[d] = { status: l.status, id: l.id, personnel_id: l.personnel_id }; }));
    const avD = isPerso ? remDays(profile.id) : 0;
    const today = todayStr();

    function tog(d) {
      if (!isSel) return;
      const ds = dateStr(calY, calM, d);
      if (ds < today) { setToast("⚠ Geçmiş tarih seçilemez"); return; }
      if (lvDates[ds] && (!calModId || lvDates[ds].id !== calModId)) { setToast("⚠ Bu tarihte izin var"); return; }
      setCalSel(p => p.includes(ds) ? p.filter(x => x !== ds) : [...p, ds].sort());
    }
    function prev() { calM === 0 ? (setCalY(calY - 1), setCalM(11)) : setCalM(calM - 1); }
    function next() { calM === 11 ? (setCalY(calY + 1), setCalM(0)) : setCalM(calM + 1); }

    const cells = [];
    for (let i = 0; i < fd; i++) cells.push(<div key={`e${i}`} />);
    for (let d = 1; d <= dim; d++) {
      const ds = dateStr(calY, calM, d), isSeld = calSel.includes(ds), lv = lvDates[ds];
      const isToday = ds === today;
      let bg = "transparent", clr = C.text, brd = "2px solid transparent";
      if (isSeld) { bg = C.accent; clr = "#fff"; brd = `2px solid ${C.accentL}`; }
      else if (lv) { bg = lv.status === "approved" ? C.greenD : C.orangeD; clr = lv.status === "approved" ? C.green : C.orange; }
      else if (isToday) brd = `2px solid ${C.accent}`;
      cells.push(
        <div key={d} onClick={() => tog(d)} style={{ width: "100%", paddingTop: "100%", borderRadius: 10, background: bg, border: brd, position: "relative", cursor: isSel ? "pointer" : "default" }}>
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 14, fontWeight: isToday || isSeld ? 700 : 500, color: clr }}>{d}</div>
            {lv && !isSeld && <div style={{ width: 4, height: 4, borderRadius: "50%", background: lv.status === "approved" ? C.green : C.orange, marginTop: 2 }} />}
          </div>
        </div>
      );
    }

    const needH = calSel.length * 8;
    const currentRH = isPerso ? remHours(profile.id) : 0;
    const willDebt = isPerso && needH > 0 && currentRH < needH;
    const debtAmount = willDebt ? Math.round((needH - currentRH) / 8 * 10) / 10 : 0;

    return (<div>
      <div style={S.sec}><span>📅</span> İzin Takvimi</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={prev} style={{ background: C.accentD, border: "none", color: C.accent, width: 40, height: 40, borderRadius: 10, cursor: "pointer", fontSize: 18, fontWeight: 700, WebkitAppearance: "none" }}>‹</button>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 17, fontWeight: 700 }}>{MONTHS[calM]} {calY}</div>{isPerso && <div style={{ fontSize: 11, color: avD > 0 ? C.green : avD < 0 ? C.red : C.muted, marginTop: 2 }}>{avD < 0 ? `Borç: ${Math.abs(avD)} gün` : `Kalan: ${avD} gün`}</div>}</div>
        <button onClick={next} style={{ background: C.accentD, border: "none", color: C.accent, width: 40, height: 40, borderRadius: 10, cursor: "pointer", fontSize: 18, fontWeight: 700, WebkitAppearance: "none" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>{DAYS_TR.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, color: C.muted, fontWeight: 600, padding: "4px 0" }}>{d}</div>)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>{cells}</div>

      {isSel && calSel.length > 0 && <div style={{ ...S.lawBox, marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📅 Seçilen ({calSel.length} gün)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{calSel.sort().map(d => <div key={d} onClick={() => setCalSel(p => p.filter(x => x !== d))} style={{ ...S.tag(C.accentD, C.accent), cursor: "pointer", padding: "4px 10px" }}>{fDS(d)} ✕</div>)}</div>
        <div style={S.dv} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 11, color: C.dim }}>Kullanılacak</div><div style={{ fontSize: 18, fontWeight: 800, color: C.purple }}>{needH}s</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: C.dim }}>Kalan Hak</div><div style={{ fontSize: 18, fontWeight: 800, color: avD >= 0 ? C.green : C.red }}>{avD}g</div></div>
        </div>
        {willDebt && <div style={{ marginTop: 8, background: C.redD, borderRadius: 8, padding: "6px 10px", textAlign: "center" }}><span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>⚠ {debtAmount} gün borçlanma olacak</span></div>}
      </div>}

      {isSel && <div>
        {calMode === "select" && <button style={S.btn(willDebt ? C.orange : C.teal)} onClick={submitLeaveReq} disabled={submitting}>{submitting ? "Gönderiliyor..." : willDebt ? `⚠ Borçlanarak İzin Gönder (${calSel.length} gün)` : `📅 Onaya Gönder (${calSel.length} gün)`}</button>}
        {calMode === "modify" && <button style={S.btn(C.orange)} onClick={modifyLeave} disabled={submitting}>{submitting ? "..." : "📅 Tarihleri Değiştir"}</button>}
        <button style={S.btn(C.border, C.text)} onClick={() => { setCalMode("view"); setCalSel([]); setCalModId(null); }}>İptal</button>
      </div>}

      {!isSel && isPerso && <button style={S.btn(C.teal)} onClick={() => { setCalMode("select"); setCalSel([]); }}>📅 İzin Günlerini Seç</button>}

      {!isSel && <div style={{ marginTop: 16 }}>
        <div style={S.sec}><span>🏖</span> İzin Talepleri</div>
        {(isPerso ? leavesState.filter(l => l.personnel_id === profile.id) : leavesState).filter(l => l.status !== "rejected").map(l => {
          const p = getU(l.personnel_id);
          const dates = Array.isArray(l.dates) ? l.dates : [];
          return (<div key={l.id} style={S.crd} onClick={() => setSelLV(l)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div>{!isPerso && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p?.full_name}</div>}<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{dates.map(d => <span key={d} style={S.tag(l.status === "approved" ? C.greenD : C.orangeD, l.status === "approved" ? C.green : C.orange)}>{fDS(d)}</span>)}</div>{l.reason?.includes("borçlanma") && <div style={{ fontSize: 10, color: C.red, marginTop: 4, fontWeight: 600 }}>⚠ Borçlanma</div>}</div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700 }}>{dates.length}g</div><div style={S.tag(sColor(l.status) + "22", sColor(l.status))}>{sIcon(l.status)}</div></div>
            </div>
            {(isPerso || isAdmin) && l.status !== "approved" && <button style={{ ...S.btnS(C.orangeD, C.orange), marginTop: 8, fontSize: 11 }} onClick={e => { e.stopPropagation(); startModLV(l); }}>🔄 Tarihleri Değiştir</button>}
          </div>);
        })}
      </div>}
    </div>);
  };

  // ═══ MODALS ═══
  const renderOTDetail = () => {
    if (!selOT) return null;
    const o = selOT, p = getU(o.personnel_id);
    return (<div style={S.mod} onClick={() => setSelOT(null)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} />
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Mesai Detayı</div>
      {p && <div style={{ fontSize: 13, color: C.dim, marginBottom: 12 }}>{p.full_name}</div>}
      <div style={S.lawBox}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 11, color: C.dim }}>Tarih</div><div style={{ fontSize: 15, fontWeight: 700 }}>{fD(o.work_date)}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: C.dim }}>Saat</div><div style={{ fontSize: 15, fontWeight: 700 }}>{o.start_time?.slice(0, 5)} → {o.end_time?.slice(0, 5)}</div></div>
        </div>
        <div style={S.dv} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 11, color: C.dim }}>Çalışılan</div><div style={{ fontSize: 22, fontWeight: 800, color: C.accent }}>{o.hours}s</div></div>
          <div><div style={{ fontSize: 11, color: C.dim }}>→ İzin (×1.5)</div><div style={{ fontSize: 22, fontWeight: 800, color: C.purple }}>{o.leave_hours}s</div></div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}><div style={S.lbl}>Durum</div><div style={S.tag(sColor(o.status) + "22", sColor(o.status))}>{sIcon(o.status)} {sText(o.status)}</div></div>
      <div style={{ marginBottom: 12 }}><div style={S.lbl}>Açıklama</div><div style={{ fontSize: 13, color: C.text, background: C.bg, borderRadius: 8, padding: 10, border: `1px solid ${C.border}` }}>{o.description || "—"}</div></div>
      {(o.photo_before || o.photo_after) && <div><div style={S.lbl}>Fotoğraflar</div><div style={{ display: "flex", gap: 10 }}>
        {o.photo_before && <div style={{ flex: 1 }}><div style={{ fontSize: 10, color: C.orange, fontWeight: 700, marginBottom: 4 }}>ÖNCE</div><img src={o.photo_before} alt="" style={{ width: "100%", borderRadius: 10 }} /></div>}
        {o.photo_after && <div style={{ flex: 1 }}><div style={{ fontSize: 10, color: C.green, fontWeight: 700, marginBottom: 4 }}>SONRA</div><img src={o.photo_after} alt="" style={{ width: "100%", borderRadius: 10 }} /></div>}
      </div></div>}
      <button style={S.btn(C.border, C.text)} onClick={() => setSelOT(null)}>Kapat</button>
    </div></div>);
  };

  const renderLVDetail = () => {
    if (!selLV) return null;
    const l = selLV, p = getU(l.personnel_id);
    const dates = Array.isArray(l.dates) ? l.dates : [];
    const prevDates = Array.isArray(l.previous_dates) ? l.previous_dates : [];
    return (<div style={S.mod} onClick={() => setSelLV(null)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>İzin Detayı</div>
      {p && <div style={{ fontSize: 13, color: C.dim, marginBottom: 12 }}>{p.full_name}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>{dates.map(d => <span key={d} style={S.tag(l.status === "approved" ? C.greenD : C.orangeD, l.status === "approved" ? C.green : C.orange)}>{fD(d)}</span>)}</div>
      <div style={{ fontSize: 14, marginBottom: 8 }}>Toplam: <strong>{dates.length} gün</strong> ({l.total_hours} saat)</div>
      <div style={S.tag(sColor(l.status) + "22", sColor(l.status))}>{sIcon(l.status)} {sText(l.status)}</div>
      {l.reason?.includes("borçlanma") && <div style={{ fontSize: 12, color: C.red, marginTop: 8, fontWeight: 600 }}>⚠ Borçlanma dahil</div>}
      {prevDates.length > 0 && <div style={{ fontSize: 12, color: C.orange, marginTop: 12 }}>🔄 Önceki: {prevDates.map(d => fD(d)).join(", ")}</div>}
      <button style={S.btn(C.border, C.text)} onClick={() => setSelLV(null)}>Kapat</button>
    </div></div>);
  };

  const renderNewOT = () => {
    if (!modNewOT) return null;
    return (<div style={S.mod} onClick={() => setModNewOT(false)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Fazla Mesai Bildir</div><div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Tüm alanlar zorunlu</div>

      <div style={S.lbl}>Tarih</div>
      <input type="date" style={S.inp} value={otForm.date} onChange={e => setOtForm(prev => ({ ...prev, date: e.target.value }))} />

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><div style={S.lbl}>Başlangıç</div><input type="time" style={S.inp} value={otForm.startTime} onChange={e => setOtForm(prev => ({ ...prev, startTime: e.target.value }))} /></div>
        <div style={{ flex: 1 }}><div style={S.lbl}>Bitiş</div><input type="time" style={S.inp} value={otForm.endTime} onChange={e => setOtForm(prev => ({ ...prev, endTime: e.target.value }))} /></div>
      </div>

      {otForm.endTime && <div style={S.lawBox}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 11, color: C.dim }}>Mesai</div><div style={{ fontSize: 24, fontWeight: 800, color: liveOTH > 0 ? C.accent : C.red }}>{liveOTH}s</div></div><div style={{ fontSize: 20, color: C.dim, display: "flex", alignItems: "center" }}>→</div><div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: C.dim }}>İzin (×1.5)</div><div style={{ fontSize: 24, fontWeight: 800, color: C.purple }}>{liveLH}s</div></div></div><div style={{ fontSize: 10, color: C.muted, marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>📋 İş Kanunu Md.41</div></div>}

      <div style={S.lbl}>📷 Fotoğraflar (2 zorunlu)</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, justifyContent: "space-between" }}>
        <div style={S.pBox(!!otForm.photoBefore)} onClick={() => beforeRef.current?.click()}>
          <div style={S.pBoxInner}>
            {otForm.photoBefore
              ? <><img src={otForm.photoBefore} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10, position: "absolute", top: 0, left: 0 }} /><div style={{ position: "absolute", bottom: 6, left: 6, fontSize: 10, background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4, color: C.orange, fontWeight: 700, zIndex: 1 }}>ÖNCE ✓</div></>
              : <><div style={{ fontSize: 28 }}>📷</div><div style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>BAŞLANGIÇ</div></>
            }
          </div>
          <input ref={beforeRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handlePhoto(e, "before")} />
        </div>
        <div style={S.pBox(!!otForm.photoAfter)} onClick={() => afterRef.current?.click()}>
          <div style={S.pBoxInner}>
            {otForm.photoAfter
              ? <><img src={otForm.photoAfter} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10, position: "absolute", top: 0, left: 0 }} /><div style={{ position: "absolute", bottom: 6, left: 6, fontSize: 10, background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4, color: C.green, fontWeight: 700, zIndex: 1 }}>SONRA ✓</div></>
              : <><div style={{ fontSize: 28 }}>📷</div><div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>BİTİŞ</div></>
            }
          </div>
          <input ref={afterRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handlePhoto(e, "after")} />
        </div>
      </div>

      <div style={S.lbl}>Açıklama (min 10 karakter)</div>
      <textarea ref={descRef} style={S.ta} placeholder="Ne yapıldı?" defaultValue={otForm.desc} onBlur={e => setOtForm(prev => ({ ...prev, desc: e.target.value }))} />

      {otErrors.length > 0 && <div style={S.errBox}>{otErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: C.red }}>• {e}</div>)}</div>}
      <button style={S.btn(C.accent)} onClick={submitOT} disabled={submitting}>{submitting ? "Gönderiliyor..." : "Onaya Gönder"}</button>
      <button style={S.btn(C.border, C.text)} onClick={() => { setModNewOT(false); setOtErrors([]); }}>İptal</button>
    </div></div>);
  };

  const renderAddUser = () => {
    if (!modAddUser) return null;
    return (<div style={S.mod} onClick={() => setModAddUser(false)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>+ Personel</div>
      <div style={S.lbl}>Ad Soyad</div><input style={S.inp} value={nUser.name} onChange={e => setNUser(p => ({ ...p, name: e.target.value }))} />
      <div style={S.lbl}>E-posta</div><input style={S.inp} type="email" inputMode="email" autoCapitalize="none" placeholder="isim@ibb-teknik.com" value={nUser.email} onChange={e => setNUser(p => ({ ...p, email: e.target.value }))} />
      <div style={S.lbl}>Şifre</div><input style={S.inp} type="text" value={nUser.password} onChange={e => setNUser(p => ({ ...p, password: e.target.value }))} />
      <div style={S.lbl}>Görev</div><input style={S.inp} value={nUser.role} onChange={e => setNUser(p => ({ ...p, role: e.target.value }))} />
      <div style={S.lbl}>Yetki</div>
      <select style={S.sel} value={nUser.userRole} onChange={e => setNUser(p => ({ ...p, userRole: e.target.value }))}>
        <option value="personnel">Personel</option>
        <option value="chef">Teknik Şef (Onay Yetkili)</option>
        <option value="viewer">İzleyici (Tam Görüntüleme)</option>
      </select>
      <button style={S.btn(C.accent)} onClick={doAddUser} disabled={submitting}>{submitting ? "..." : "Ekle"}</button>
      <button style={S.btn(C.border, C.text)} onClick={() => setModAddUser(false)}>İptal</button>
    </div></div>);
  };

  const renderEditUser = () => {
    if (!modEditUser) return null;
    const u = modEditUser;
    return (<div style={S.mod} onClick={() => setModEditUser(null)}><div style={S.modC} onClick={e => e.stopPropagation()}>
      <div style={S.modH} /><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Düzenle: {u.full_name}</div>
      <div style={S.lbl}>Görev</div><input style={S.inp} value={u.role || ""} onChange={e => setModEditUser({ ...u, role: e.target.value })} />
      <div style={S.lbl}>Yetki</div>
      <select style={S.sel} value={u.user_role || "personnel"} onChange={e => setModEditUser({ ...u, user_role: e.target.value })}>
        <option value="personnel">Personel</option>
        <option value="chef">Teknik Şef (Onay Yetkili)</option>
        <option value="viewer">İzleyici (Tam Görüntüleme)</option>
      </select>
      <button style={S.btn(C.accent)} onClick={async () => {
        try {
          await supabase.from('profiles').update({ role: u.role, user_role: u.user_role }).eq('id', u.id);
          await fetchProfiles(); setModEditUser(null); setToast("✓ Kaydedildi");
        } catch (err) { setToast("❌ " + (err?.message || "Hata")); }
      }}>Kaydet</button>
      <div style={S.dv} /><button style={S.btn(C.red)} onClick={() => doDeactivateU(u.id)}>🚫 Pasif Yap</button>
      <button style={S.btn(C.border, C.text)} onClick={() => setModEditUser(null)}>Kapat</button>
    </div></div>);
  };

  // ═══ NAV ═══
  const navItems = isAdmin
    ? [{ k: "dashboard", i: "📊", l: "Özet" }, { k: "calendar", i: "📅", l: "Takvim" }, { k: "approvals", i: "✅", l: "Onaylar" }, { k: "admin", i: "⚙️", l: "Yönetim" }]
    : (isChef || isViewer)
    ? [{ k: "dashboard", i: "📊", l: "Özet" }, { k: "calendar", i: "📅", l: "Takvim" }, { k: "approvals", i: isViewer ? "👁" : "✅", l: isViewer ? "Takip" : "Onaylar" }]
    : [{ k: "dashboard", i: "📊", l: "Özet" }, { k: "calendar", i: "📅", l: "Takvim" }];

  const roleLabel = isAdmin ? "👑 Yönetici" : isChef ? "🔧 Şef" : isViewer ? "👁 İzleyici" : "👷 Personel";

  return (
    <div style={S.app}>
      <div style={S.hdr}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 36, height: 36, minWidth: 36, borderRadius: 10, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔧</div><div><div style={{ fontSize: 17, fontWeight: 700 }}>İBB Teknik Takip</div><div style={{ fontSize: 11, color: C.dim }}>Fazla Mesai & İzin</div></div></div>
          <button onClick={doLogout} style={{ fontSize: 11, padding: "6px 12px", borderRadius: 20, background: C.redD, color: C.red, border: "none", cursor: "pointer", fontWeight: 600, WebkitTapHighlightColor: "transparent" }}>Çıkış</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 12px" }}><div style={S.av(C.accentD, 28)}>{ini(profile.full_name)}</div><div><div style={{ fontSize: 13, fontWeight: 600 }}>{profile.full_name}</div><div style={{ fontSize: 10, color: C.dim }}>{roleLabel}</div></div></div>
      </div>
      <div style={S.cnt}>
        {page === "dashboard" && renderDashboard()}
        {page === "person" && renderPersonDetail()}
        {page === "calendar" && renderCalendar()}
        {page === "approvals" && renderApprovals()}
        {page === "admin" && renderAdmin()}
      </div>
      <div style={S.nav}>{navItems.map(n => (<button key={n.k} style={S.navB(page === n.k || (n.k === "dashboard" && page === "person"))} onClick={() => { setPage(n.k); setSelPerson(null); if (n.k !== "calendar") { setCalMode("view"); setCalSel([]); } }}><span style={{ fontSize: 18 }}>{n.i}</span>{n.l}{n.k === "approvals" && ((canApprove && totPend > 0) || (isViewer && allPendCount > 0)) && <div style={S.dot} />}</button>))}</div>
      {renderNewOT()}
      {renderAddUser()}
      {renderEditUser()}
      {renderOTDetail()}
      {renderLVDetail()}
      {toast && <div style={S.tst}>{toast}</div>}
    </div>
  );
}
