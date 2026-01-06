const origemEl = document.getElementById("origem");
const destinoEl = document.getElementById("destino");
const obsEl = document.getElementById("obs");
const valorEl = document.getElementById("valor");

const btnCriar = document.getElementById("btnCriar");
const btnLimpar = document.getElementById("btnLimpar");

const ridesListEl = document.getElementById("ridesList");
const emptyStateEl = document.getElementById("emptyState");

const apiDot = document.getElementById("apiDot");
const apiText = document.getElementById("apiText");

const LS_KEY = "md_rides_open_v1";

// Rate limit: manter ~16s por ID pra não estourar. 
const POLL_MS = 16000;

let rides = loadRides(); // mais recente primeiro

function setApiStatus(ok){
  apiDot.style.background = ok ? "var(--ok)" : "var(--danger)";
  apiText.textContent = ok ? "API Online" : "API Offline";
}

async function ping(){
  try{ const r = await fetch("/health"); setApiStatus(r.ok); }
  catch{ setApiStatus(false); }
}
ping(); setInterval(ping, 10000);

function saveRides(){
  localStorage.setItem(LS_KEY, JSON.stringify(rides));
}

function loadRides(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function formatBRL(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

function parseNumberBR(v){
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// buzina simples quando aceita
function horn(){
  try{
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();

    o1.type = "sawtooth";
    o2.type = "square";

    o1.frequency.value = 220;
    o2.frequency.value = 330;

    g.gain.value = 0.0001;

    o1.connect(g); o2.connect(g);
    g.connect(ctx.destination);

    const now = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    o1.start(now);
    o2.start(now);

    o1.frequency.linearRampToValueAtTime(180, now + 0.25);
    o2.frequency.linearRampToValueAtTime(260, now + 0.25);

    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    o1.stop(now + 0.5);
    o2.stop(now + 0.5);

    setTimeout(() => ctx.close(), 700);
  }catch{}
}

function render(){
  ridesListEl.innerHTML = "";
  emptyStateEl.style.display = rides.length ? "none" : "block";

  for (const r of rides){
    const card = document.createElement("div");
    card.className = "rideCard";

    const top = document.createElement("div");
    top.className = "rideTop";

    const leftBadges = document.createElement("div");
    leftBadges.className = "badges";

    const bId = document.createElement("span");
    bId.className = "badge";
    bId.textContent = `#${r.id}`;

    const bValor = document.createElement("span");
    bValor.className = "badge warn";
    bValor.textContent = r.valorInformado != null ? `Valor: ${formatBRL(r.valorInformado)}` : "Valor: automático";

    const bStatus = document.createElement("span");
    bStatus.className = "badge";
    bStatus.textContent = r.statusTexto || "Criado";

    leftBadges.appendChild(bId);
    leftBadges.appendChild(bValor);
    leftBadges.appendChild(bStatus);

    top.appendChild(leftBadges);
    card.appendChild(top);

    const main = document.createElement("div");
    main.className = "rideMain";

    main.appendChild(line("Origem", r.origem));
    main.appendChild(line("Destino", r.destino));

    const motoristaLinha = document.createElement("div");
    motoristaLinha.className = "rideLine";
    const k = document.createElement("div");
    k.className = "rideKey";
    k.textContent = "Motorista";
    const v = document.createElement("div");
    v.className = "rideVal";
    v.textContent = r.motorista
      ? `${r.motorista}${r.veiculo ? " — " + r.veiculo : ""}${r.placa ? " — " + r.placa : ""}`
      : "—";
    motoristaLinha.appendChild(k);
    motoristaLinha.appendChild(v);
    main.appendChild(motoristaLinha);

    if (r.valorFinal != null){
      const vf = document.createElement("div");
      vf.className = "rideSmall";
      vf.textContent = `Valor final no sistema: ${formatBRL(r.valorFinal)}`;
      main.appendChild(vf);
    }

    card.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "rideActions";

    const btnCancel = document.createElement("button");
    btnCancel.className = "rideBtn danger";
    btnCancel.textContent = "Cancelar";
    btnCancel.onclick = () => cancelRide(r.id);

    const btnRelaunch = document.createElement("button");
    btnRelaunch.className = "rideBtn primary";
    btnRelaunch.textContent = "Lançar novamente";
    btnRelaunch.onclick = () => relaunchRide(r);

    actions.appendChild(btnCancel);
    actions.appendChild(btnRelaunch);
    card.appendChild(actions);

    ridesListEl.appendChild(card);
  }
}

function line(key, val){
  const row = document.createElement("div");
  row.className = "rideLine";
  const k = document.createElement("div");
  k.className = "rideKey";
  k.textContent = key;
  const v = document.createElement("div");
  v.className = "rideVal";
  v.textContent = val || "—";
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

btnLimpar.onclick = () => {
  origemEl.value = "";
  destinoEl.value = "";
  obsEl.value = "";
  valorEl.value = ""; // ✅ também limpa valor
  origemEl.focus();
};

btnCriar.onclick = async () => {
  const origem = origemEl.value.trim();
  const destino = destinoEl.value.trim();
  const obs = obsEl.value.trim();

  const valorStr = valorEl.value.trim(); // ✅ começa vazio por padrão
  const valorNum = parseNumberBR(valorStr);

  if (!origem || !destino){
    alert("Preencha Origem e Destino.");
    return;
  }

  // ✅ só valida se tiver preenchido
  if (valorStr && valorNum === null){
    alert("Valor inválido. Use por exemplo: 25,00");
    return;
  }

  btnCriar.disabled = true;
  btnCriar.textContent = "CRIANDO...";

  try{
    const resp = await fetch("/rides", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        origem,
        destino,
        obs,
        valor: valorStr // ✅ se vazio, backend não envia "Valor" e o sistema calcula
      })
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok){
      console.log(data);
      alert("Erro ao criar corrida. Veja o console (F12).");
      return;
    }

    const id = data.solicitacaoId;
    if (!id){
      alert("Corrida criada, mas não consegui ler o ID de retorno. Abra o console (F12) pra ver a resposta.");
      console.log("Resposta criar corrida:", data);
      return;
    }

    rides.unshift({
      id,
      origem,
      destino,
      obs,
      createdAt: Date.now(),
      valorInformado: data.valorInformado ?? (valorStr ? valorNum : null),
      statusTexto: "Pedido criado",
      etapa: null,
      motorista: null,
      veiculo: null,
      placa: null,
      valorFinal: null,
      acceptedBeeped: false
    });

    saveRides();
    render();

    // limpa campos (✅ inclusive valor, pra não “fixar” sem querer)
    origemEl.value = "";
    destinoEl.value = "";
    obsEl.value = "";
    valorEl.value = "";
    origemEl.focus();

    await updateRide(id);

  }catch(e){
    alert("Falha de comunicação com o backend.");
    console.log(e);
  }finally{
    btnCriar.disabled = false;
    btnCriar.textContent = "CRIAR CORRIDA";
  }
};

async function cancelRide(id){
  if (!confirm(`Cancelar a corrida #${id}?`)) return;

  try{
    const resp = await fetch(`/rides/${id}/cancel`, { method:"POST" });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok){
      alert("Erro ao cancelar. Veja console (F12).");
      console.log(data);
      return;
    }

    const r = rides.find(x => x.id === id);
    if (r){
      r.statusTexto = "Cancelada";
      saveRides();
      render();
    }
  }catch(e){
    alert("Falha ao cancelar (backend).");
    console.log(e);
  }
}

async function relaunchRide(r){
  try{
    const valorTxt = r.valorInformado != null ? String(r.valorInformado).replace(".", ",") : "";
    const resp = await fetch("/rides", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        origem: r.origem,
        destino: r.destino,
        obs: r.obs || "",
        // ✅ relança com o mesmo valor só se ele existia (senão automático)
        valor: valorTxt
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok){
      alert("Erro ao relançar. Veja console (F12).");
      console.log(data);
      return;
    }

    const id = data.solicitacaoId;
    if (!id){
      alert("Relançou, mas não consegui ler o ID retornado. Veja console (F12).");
      console.log(data);
      return;
    }

    rides.unshift({
      id,
      origem: r.origem,
      destino: r.destino,
      obs: r.obs || "",
      createdAt: Date.now(),
      valorInformado: data.valorInformado ?? r.valorInformado ?? null,
      statusTexto: "Pedido criado",
      etapa: null,
      motorista: null,
      veiculo: null,
      placa: null,
      valorFinal: null,
      acceptedBeeped: false
    });

    saveRides();
    render();
    await updateRide(id);
  }catch(e){
    alert("Falha ao relançar (backend).");
    console.log(e);
  }
}

async function updateRide(id){
  const r = rides.find(x => x.id === id);
  if (!r) return;

  try{
    const resp = await fetch(`/rides/${id}/etapa`);
    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.ok && data.etapa){
      r.etapa = data.etapa.Etapa ?? null;
      r.statusTexto = data.etapa.StatusSolicitacao || r.statusTexto;

      const nome = data.etapa.NomePrestador || null;
      const veic = data.etapa.Veiculo || null;
      const placa = data.etapa.Placa || null;

      const justAccepted = (r.acceptedBeeped === false) && (Number(r.etapa) >= 2) && nome;

      r.motorista = nome;
      r.veiculo = veic;
      r.placa = placa;

      if (justAccepted){
        r.acceptedBeeped = true;
        horn();
      }

      if (data.etapa.ViagemFinalizada === true){
        await fetchValorFinal(id);
        rides = rides.filter(x => x.id !== id);
        saveRides();
        render();
        return;
      }
    }else{
      console.log("Falha etapa", id, data);
    }
  }catch(e){
    console.log("Erro etapa", id, e);
  }

  await fetchValorFinal(id);

  saveRides();
  render();
}

async function fetchValorFinal(id){
  const r = rides.find(x => x.id === id);
  if (!r) return;

  try{
    const resp = await fetch(`/rides/${id}/solicitacao`);
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.ok && data.solicitacao){
      const vf = data.solicitacao.crd_valor;
      if (vf != null) r.valorFinal = Number(vf);
    }
  }catch{}
}

async function pollAll(){
  for (const r of [...rides]){
    await updateRide(r.id);
  }
}

render();
pollAll();
setInterval(pollAll, POLL_MS);
