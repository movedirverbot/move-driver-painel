const origemEl = document.getElementById("origem");
const destinoEl = document.getElementById("destino");
const obsEl = document.getElementById("obs");

const btnCriar = document.getElementById("btnCriar");
const btnLimpar = document.getElementById("btnLimpar");

const apiDot = document.getElementById("apiDot");
const apiText = document.getElementById("apiText");

const ridesListEl = document.getElementById("ridesList");
const emptyStateEl = document.getElementById("emptyState");

// push ui (se existir no index.html)
const btnPush = document.getElementById("btnPush");
const pushText = document.getElementById("pushText");

const watchers = new Map();

/* =======================
   💾 PERSISTÊNCIA
   ======================= */
const STORAGE_KEY = "md_open_rides_v5";

function loadSavedRides(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  }catch{
    return [];
  }
}

function saveRides(){
  try{
    const data = Array.from(watchers.values()).map(w => ({
      id: w.id,
      origem: w.origem,
      destino: w.destino,
      obs: w.obs || "",
      createdAt: w.createdAt,
      alerted: Boolean(w.alerted),
      canceled: Boolean(w.canceled),
      frozen: Boolean(w.frozen),
      relaunchOf: w.relaunchOf || null,
      relaunchedTo: w.relaunchedTo || null,
      status: w.status || "",
      pushed: Boolean(w.pushed)
    }));

    data.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.slice(0, 120)));
  }catch{}
}

/* =======================
   🔊 BUZINA
   ======================= */
let audioCtx = null;
function buzina() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.12;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.setValueAtTime(0.12, now + 0.15);
    gain.gain.linearRampToValueAtTime(0.0, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.4);
  } catch {}
}

/* =======================
   STATUS API
   ======================= */
function setApiStatus(ok){
  apiDot.style.background = ok ? "var(--ok)" : "var(--danger)";
  apiText.textContent = ok ? "API Online" : "API Offline";
}
async function ping(){
  try{
    const r = await fetch("/health");
    setApiStatus(r.ok);
  }catch{
    setApiStatus(false);
  }
}
ping();
setInterval(ping, 10000);

/* =======================
   HELPERS
   ======================= */
function clearForm(){
  origemEl.value = "";
  destinoEl.value = "";
  obsEl.value = "";
  origemEl.focus();
}
btnLimpar.onclick = clearForm;

function setEmptyState(){
  emptyStateEl.style.display = watchers.size === 0 ? "block" : "none";
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusClass(w){
  if (w.canceled) return "err";
  if (w.lastError) return "err";
  if (w.motorista) return "ok";
  if (w.frozen) return "wait";
  return "wait";
}

// ✅ só finalizada some
function isTripFinished(statusText){
  const t = (statusText || "").toLowerCase();
  return t.includes("finalizada") || t.includes("finalizado") || t.includes("concluída") || t.includes("concluido");
}

// 🧊 estados travados (não somem) -> param de atualizar e mostram relançar
function isFrozenTerminal(statusText){
  const t = (statusText || "").toLowerCase();
  return (
    t.includes("excedeu") ||
    t.includes("nenhum motorista") ||
    t.includes("sem motorista") ||
    t.includes("não foi possível") ||
    t.includes("nao foi possivel") ||
    t.includes("cancelada") ||
    t.includes("cancelado")
  );
}

function shouldShowRelaunch(w){
  if (w.canceled) return true;
  return isFrozenTerminal(w.status || "");
}

/* =======================
   UI
   ======================= */
function renderRideCard(w){
  const st = escapeHtml(w.status || "-");
  const motorista = w.motorista ? escapeHtml(w.motorista) : "-";
  const car = w.veiculo ? escapeHtml(w.veiculo) : "-";
  const placa = w.placa ? escapeHtml(w.placa) : "-";

  const compactCar = `${car}${w.placa ? " • " + placa : ""}`;
  const routeMini = `${w.origem} → ${w.destino}`;

  const cancelDisabled = w.canceled ? "disabled" : "";
  const relaunchDisabled = w.relaunching ? "disabled" : "";

  const showRelaunch = shouldShowRelaunch(w);

  const relInfo =
    w.relaunchedTo
      ? `<div class="rideStatus">Relançada → #${escapeHtml(String(w.relaunchedTo))}</div>`
      : "";

  return `
    <div class="rideCard" id="card-${w.id}">
      <div class="rideBar ${statusClass(w)}"></div>
      <div class="rideBody">
        <div class="rideTop">
          <div class="rideMain">
            <div class="rideId">#${w.id}</div>
            <div class="rideStatus truncate">${st}</div>
            ${relInfo}
          </div>

          <div class="rideRight">
            ${showRelaunch ? `<button class="smallBtn primary" data-relaunch="${w.id}" ${relaunchDisabled}>Relançar</button>` : ""}
            <button class="smallBtn danger" data-cancel="${w.id}" ${cancelDisabled}>Cancelar</button>
            <button class="smallBtn" data-remove="${w.id}">Remover</button>
          </div>
        </div>

        <div class="rideMeta">
          <div class="metaRow">
            <span class="pill">👤 <span class="truncate">${motorista}</span></span>
            <span class="pill muted">🚗 <span class="truncate">${compactCar}</span></span>
          </div>

          <div class="metaRow">
            <span class="pill muted truncate">📍 ${escapeHtml(routeMini)}</span>
          </div>
        </div>

        <div class="route">
          <details class="routeDetails">
            <summary>
              <span>Ver origem e destino</span>
              <span class="chev">▾</span>
            </summary>

            <div class="routeLine">
              <span class="tag">Origem</span>
              <div class="routeText">${escapeHtml(w.origem)}</div>
            </div>
            <div class="routeLine">
              <span class="tag">Destino</span>
              <div class="routeText">${escapeHtml(w.destino)}</div>
            </div>
          </details>
        </div>

        ${w.lastError ? `<div class="errBox">⚠️ ${escapeHtml(w.lastError)}</div>` : ""}
      </div>
    </div>
  `;
}

function draw(){
  ridesListEl.innerHTML = "";

  const list = Array.from(watchers.values())
    .sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

  for (const w of list){
    ridesListEl.insertAdjacentHTML("beforeend", renderRideCard(w));
  }

  setEmptyState();
}

/* =======================
   EVENTS
   ======================= */
document.addEventListener("click", async (e) => {
  const removeId = e.target?.getAttribute?.("data-remove");
  if (removeId) {
    stopWatcher(Number(removeId), { removeFromList: true });
    return;
  }

  const cancelId = e.target?.getAttribute?.("data-cancel");
  if (cancelId) {
    await cancelRide(Number(cancelId));
    return;
  }

  const relaunchId = e.target?.getAttribute?.("data-relaunch");
  if (relaunchId) {
    await relaunchRide(Number(relaunchId));
    return;
  }
});

/* =======================
   API FETCH
   ======================= */
async function buscarEtapa(id){
  const r = await fetch(`/rides/${id}/etapa`);
  const j = await r.json();
  if (!r.ok || !j.ok) throw j;
  return j.etapa;
}

async function buscarStatusOpcional(id){
  try{
    const r = await fetch(`/rides/${id}/status`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.ok) return null;
    return j.status || null;
  }catch{
    return null;
  }
}

function pickStatusText(etapaObj, statusObj, fallback){
  const s1 = etapaObj?.StatusSolicitacao || etapaObj?.statusSolicitacao;
  if (s1 && String(s1).trim()) return String(s1).trim();

  const s2 = statusObj?.StatusSolicitacaoDesc || statusObj?.statusSolicitacaoDesc;
  if (s2 && String(s2).trim()) return String(s2).trim();

  return fallback || "-";
}

/* =======================
   PUSH DISPARO (quando aceitar)
   ======================= */
async function sendPushAccepted(w){
  // manda só 1 vez por corrida
  if (w.pushed) return;
  if (!w.motorista) return;

  w.pushed = true;
  saveRides();

  const title = "Move Driver — Motorista aceitou ✅";
  const body = `#${w.id} • ${w.motorista} • ${w.veiculo || ""} • ${w.placa || ""}`.trim();

  try{
    await fetch("/push/notify", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        title,
        body,
        url: "/",
        data: {
          id: w.id,
          motorista: w.motorista,
          veiculo: w.veiculo,
          placa: w.placa,
          origem: w.origem,
          destino: w.destino
        }
      })
    });
  }catch{
    // se falhar push, não quebra atualização
  }
}

/* =======================
   WATCHERS
   ======================= */
async function tick(id){
  const w = watchers.get(id);
  if (!w) return;
  if (w.canceled) return;
  if (w.frozen) return;

  try{
    const etapaObj = await buscarEtapa(id);
    const statusObj = await buscarStatusOpcional(id);

    const hadDriver = Boolean(w.motorista);

    w.motorista = etapaObj?.NomePrestador || etapaObj?.nomePrestador || "";
    w.veiculo   = etapaObj?.Veiculo || etapaObj?.veiculo || "";
    w.placa     = etapaObj?.Placa || etapaObj?.placa || "";
    w.etapa     = etapaObj?.Etapa ?? etapaObj?.etapa ?? "-";
    w.status    = pickStatusText(etapaObj, statusObj, w.status);
    w.lastError = "";

    // buzina local
    if (!hadDriver && w.motorista && !w.alerted){
      w.alerted = true;
      buzina();
    }

    // ✅ push para todas (mesmo fora do app)
    if (!hadDriver && w.motorista) {
      sendPushAccepted(w);
    }

    // ✅ finalizada some
    if (isTripFinished(w.status)) {
      stopWatcher(id, { removeFromList: true });
      return;
    }

    // ✅ terminal travado fica (mostra relançar), mas para atualizar
    if (isFrozenTerminal(w.status)) {
      w.frozen = true;
      if (w.timer) clearInterval(w.timer);
      w.timer = null;
      draw();
      saveRides();
      return;
    }

    draw();
    saveRides();
  }catch{
    w.lastError = "Erro ao atualizar";
    draw();
  }
}

function startWatcher({ id, origem, destino, obs, createdAt, alerted, canceled, frozen, relaunchOf, relaunchedTo, status, pushed }){
  if (watchers.has(id)) return;

  watchers.set(id, {
    id,
    origem,
    destino,
    obs: obs || "",
    motorista: "",
    veiculo: "",
    placa: "",
    status: status || (canceled ? "Cancelada" : "Pedido criado"),
    etapa: "-",
    lastError: "",
    alerted: Boolean(alerted),
    canceled: Boolean(canceled),
    frozen: Boolean(frozen),
    relaunchOf: relaunchOf || null,
    relaunchedTo: relaunchedTo || null,
    relaunching: false,
    pushed: Boolean(pushed),
    createdAt: createdAt || Date.now(),
    timer: null
  });

  const w = watchers.get(id);

  if (!w.canceled && !w.frozen) {
    tick(id);
    w.timer = setInterval(() => tick(id), 16000);
  }

  draw();
  saveRides();
}

function stopWatcher(id, { removeFromList } = { removeFromList: true }){
  const w = watchers.get(id);
  if (!w) return;

  if (w.timer) clearInterval(w.timer);

  if (removeFromList) watchers.delete(id);
  else w.timer = null;

  draw();
  saveRides();
}

/* =======================
   ✅ CANCELAR
   ======================= */
async function cancelRide(id){
  const w = watchers.get(id);
  if (!w) return;
  if (w.canceled) return;

  const ok = confirm(`Cancelar a solicitação #${id}?\n\nIsso vai cancelar no sistema.`);
  if (!ok) return;

  try{
    const btn = document.querySelector(`[data-cancel="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "Cancelando..."; }

    const r = await fetch(`/rides/${id}/cancel`, { method: "POST" });
    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok){
      alert("Não consegui cancelar.\n\n" + JSON.stringify(j, null, 2));
      if (btn) { btn.disabled = false; btn.textContent = "Cancelar"; }
      return;
    }

    w.canceled = true;
    w.frozen = true;
    w.status = "Cancelada";
    w.lastError = "";
    if (w.timer) clearInterval(w.timer);
    w.timer = null;

    draw();
    saveRides();
    alert(`Solicitação #${id} cancelada.`);
  }catch(e){
    alert("Erro ao cancelar.\n\n" + String(e?.message || e));
    const btn = document.querySelector(`[data-cancel="${id}"]`);
    if (btn) { btn.disabled = false; btn.textContent = "Cancelar"; }
  }
}

/* =======================
   🔁 RELANÇAR
   ======================= */
async function relaunchRide(oldId){
  const w = watchers.get(oldId);
  if (!w) return;

  const ok = confirm(
    `Relançar a corrida com os mesmos endereços?\n\n` +
    `Origem: ${w.origem}\nDestino: ${w.destino}`
  );
  if (!ok) return;

  w.relaunching = true;
  draw();

  try{
    const r = await fetch("/rides", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ origem: w.origem, destino: w.destino, obs: w.obs || "" })
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok){
      alert("Erro ao relançar.\n\n" + JSON.stringify(j, null, 2));
      w.relaunching = false;
      draw();
      return;
    }

    let newId = j.solicitacaoID || null;
    if (!newId) newId = findSolicitacaoIdDeep(j.result);

    if (!newId){
      alert("Relançou, mas não encontrei o novo ID.\n\n" + JSON.stringify(j, null, 2));
      w.relaunching = false;
      draw();
      return;
    }

    w.frozen = true;
    w.relaunching = false;
    w.relaunchedTo = Number(newId);
    if (w.timer) clearInterval(w.timer);
    w.timer = null;

    startWatcher({
      id: Number(newId),
      origem: w.origem,
      destino: w.destino,
      obs: w.obs || "",
      createdAt: Date.now(),
      relaunchOf: oldId
    });

    draw();
    saveRides();
  }catch(e){
    alert("Falha ao relançar.\n\n" + String(e?.message || e));
    w.relaunching = false;
    draw();
  }
}

/* =======================
   🔎 ID PROFUNDO
   ======================= */
function findSolicitacaoIdDeep(obj){
  const seen = new Set();

  function walk(v){
    if (!v) return null;
    if (typeof v !== "object") return null;

    if (seen.has(v)) return null;
    seen.add(v);

    if (Array.isArray(v)){
      for (const it of v){
        const f = walk(it);
        if (f) return f;
      }
      return null;
    }

    for (const [k,val] of Object.entries(v)){
      if (/^solicitacaoid$/i.test(k) || /^solicitacao_id$/i.test(k) || /^idsolicitacao$/i.test(k)){
        const n = Number(val);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (typeof val === "object"){
        const f = walk(val);
        if (f) return f;
      }
    }
    return null;
  }

  return walk(obj);
}

/* =======================
   CRIAR CORRIDA
   ======================= */
btnCriar.onclick = async () => {
  const origem = origemEl.value.trim();
  const destino = destinoEl.value.trim();
  const obs = obsEl.value.trim();

  if (!origem || !destino){
    alert("Preencha Origem e Destino.");
    return;
  }

  // destrava áudio iPhone
  buzina();

  btnCriar.disabled = true;
  btnCriar.textContent = "CRIANDO...";

  try{
    const r = await fetch("/rides", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ origem, destino, obs })
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok){
      alert("Erro ao criar corrida.\n\n" + JSON.stringify(j, null, 2));
      return;
    }

    let id = j.solicitacaoID || null;
    if (!id) id = findSolicitacaoIdDeep(j.result);

    if (!id){
      alert("Corrida criada, mas não consegui localizar o ID no retorno.\n\n" + JSON.stringify(j, null, 2));
      return;
    }

    startWatcher({ id:Number(id), origem, destino, obs });
    clearForm();
  }catch{
    alert("Erro ao criar corrida");
  }finally{
    btnCriar.disabled = false;
    btnCriar.textContent = "CRIAR";
  }
};

/* =======================
   🔁 RESTAURAR AO ABRIR
   ======================= */
(function restoreOnLoad(){
  const saved = loadSavedRides();

  for (const item of saved){
    if (!item || !item.id || !item.origem || !item.destino) continue;
    startWatcher({
      id: Number(item.id),
      origem: String(item.origem),
      destino: String(item.destino),
      obs: String(item.obs || ""),
      createdAt: Number(item.createdAt) || Date.now(),
      alerted: Boolean(item.alerted),
      canceled: Boolean(item.canceled),
      frozen: Boolean(item.frozen),
      relaunchOf: item.relaunchOf || null,
      relaunchedTo: item.relaunchedTo || null,
      status: item.status || "",
      pushed: Boolean(item.pushed)
    });
  }

  draw();
  setEmptyState();
})();

/* =========================================================
   PUSH: ativação no iPhone (PWA)
   (Esse bloco só funciona se o seu index.html tiver o botão)
========================================================= */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function setupPush(){
  try{
    if (!btnPush || !pushText) return;

    if (!("serviceWorker" in navigator)) {
      pushText.textContent = "Push não suportado aqui.";
      return;
    }

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (!isStandalone) {
      pushText.textContent = "No iPhone: use 'Adicionar à Tela de Início'.";
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      pushText.textContent = "Permissão negada.";
      return;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const keyResp = await fetch("/push/public-key");
    const keyJson = await keyResp.json();
    const publicKey = keyJson.publicKey;

    if (!publicKey) {
      pushText.textContent = "Falta VAPID no servidor.";
      return;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch("/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub)
    });

    pushText.textContent = "Notificações ativadas ✅";
  }catch{
    if (pushText) pushText.textContent = "Erro ao ativar push.";
  }
}

if (btnPush){
  btnPush.addEventListener("click", setupPush);
}
