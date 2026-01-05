import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import webpush from "web-push";

dotenv.config();

const app = express();
app.use(express.json());

// Serve o frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

function basicAuthHeader() {
  const basic = Buffer.from(`${process.env.MD_USER}:${process.env.MD_PASS}`).toString("base64");
  return `Basic ${basic}`;
}

/* =========================================================
   PUSH (Web Push)
   =========================================================
   Você vai colocar 2 variáveis no Render:
   - VAPID_PUBLIC_KEY
   - VAPID_PRIVATE_KEY

   (eu te ensino abaixo como gerar)
========================================================= */

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:suporte@movedriver.local",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const subscriptions = new Map(); // key -> subscription JSON string

function subKey(sub) {
  try { return JSON.stringify(sub); } catch { return null; }
}

async function pushToAll(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const msg = JSON.stringify(payload);

  const toDelete = [];
  for (const [key, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(sub, msg);
    } catch (e) {
      // se expirou / inválida, remove
      const status = e?.statusCode || e?.status || 0;
      if (status === 404 || status === 410) toDelete.push(key);
    }
  }
  for (const k of toDelete) subscriptions.delete(k);
}

// Chave pública pro frontend assinar
app.get("/push/public-key", (req, res) => {
  return res.json({ ok: true, publicKey: VAPID_PUBLIC_KEY || "" });
});

// Registrar inscrição do aparelho
app.post("/push/subscribe", (req, res) => {
  const sub = req.body;
  const key = subKey(sub);
  if (!key) return res.status(400).json({ ok: false, message: "Subscription inválida." });

  subscriptions.set(key, sub);
  return res.json({ ok: true, total: subscriptions.size });
});

// Teste manual (opcional)
app.post("/push/test", async (req, res) => {
  try {
    await pushToAll({
      title: "Move Driver",
      body: "Push de teste OK ✅",
      url: "/"
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================================================
   MOVE DRIVER API
========================================================= */

// Criar corrida
app.post("/rides", async (req, res) => {
  try {
    const { origem, destino, obs } = req.body;

    if (!origem?.trim() || !destino?.trim()) {
      return res.status(400).json({ ok: false, message: "Informe Origem e Destino." });
    }

    const payload = {
      ClienteID: Number(process.env.CLIENTE_ID),
      ServicoItemID: Number(process.env.SERVICO_ID),
      TipoPagamentoID: Number(process.env.PAGAMENTO_ID),
      enderecoOrigem: {
        CEP: process.env.CEP_PADRAO,
        Endereco: origem.trim(),
        Cidade: process.env.CIDADE,
        EstadoSigla: process.env.UF
      },
      lstDestino: [
        {
          CEP: process.env.CEP_PADRAO,
          Endereco: destino.trim(),
          Cidade: process.env.CIDADE,
          EstadoSigla: process.env.UF
        }
      ],
      Observacao: (obs || "").trim()
    };

    const url = `${process.env.MD_API_BASE_URL}/CriarSolicitacaoViagem`;

    const apiResp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": basicAuthHeader()
      },
      body: JSON.stringify(payload)
    });

    const raw = await apiResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({ ok: false, details: data });
    }

    // Tenta achar o ID já aqui (pra servidor monitorar e mandar push)
    const id = findSolicitacaoIdDeep(data);
    if (id) {
      const { origem: o, destino: d } = req.body;
      activeRides.set(Number(id), {
        id: Number(id),
        origem: (o || "").trim(),
        destino: (d || "").trim(),
        createdAt: Date.now(),
        notified: false
      });
    }

    return res.json({ ok: true, result: data, solicitacaoID: id || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// EtapaSolicitacao (motorista/placa/veiculo/status)
app.get("/rides/:id/etapa", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const url = `${process.env.MD_API_BASE_URL}/EtapaSolicitacao?solicitacaoID=${id}`;

    const apiResp = await fetch(url, {
      method: "GET",
      headers: { "Authorization": basicAuthHeader() }
    });

    const raw = await apiResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({ ok: false, details: data });
    }

    const etapa = data?.EtapaSolicitacao ?? data?.etapaSolicitacao ?? data;
    return res.json({ ok: true, etapa });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Status geral (se existir)
app.get("/rides/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const url = `${process.env.MD_API_BASE_URL}/SolicitacaoStatus?solicitacaoID=${id}`;

    const apiResp = await fetch(url, {
      method: "GET",
      headers: { "Authorization": basicAuthHeader() }
    });

    const raw = await apiResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({ ok: false, details: data });
    }

    return res.json({ ok: true, status: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Cancelar
app.post("/rides/:id/cancel", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const tipo = "C";
    const cancEngano = "false";
    const cliNaoEncontrado = "false";

    const url =
      `${process.env.MD_API_BASE_URL}/CancelarSolicitacao` +
      `?solicitacaoID=${id}&tipo=${tipo}&cancEngano=${cancEngano}&cliNaoEncontrado=${cliNaoEncontrado}`;

    const apiResp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": basicAuthHeader(),
        "Content-Type": "application/json"
      }
    });

    const raw = await apiResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({ ok: false, details: data });
    }

    return res.json({ ok: true, result: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/* =========================================================
   SERVER-SIDE MONITOR (manda push mesmo se ninguém estiver no painel)
========================================================= */

const activeRides = new Map(); // id -> {origem,destino,notified,...}

function isTripFinished(statusText) {
  const t = String(statusText || "").toLowerCase();
  return t.includes("finalizada") || t.includes("finalizado") || t.includes("concluída") || t.includes("concluido");
}

function pickStatusText(etapaObj) {
  return etapaObj?.StatusSolicitacao || etapaObj?.statusSolicitacao || "";
}

async function fetchEtapaDirect(id) {
  const url = `${process.env.MD_API_BASE_URL}/EtapaSolicitacao?solicitacaoID=${id}`;
  const apiResp = await fetch(url, { method: "GET", headers: { "Authorization": basicAuthHeader() } });
  const raw = await apiResp.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!apiResp.ok) throw new Error(`EtapaSolicitacao ${apiResp.status}: ${raw}`);
  return data?.EtapaSolicitacao ?? data?.etapaSolicitacao ?? data;
}

// loop a cada 15s
setInterval(async () => {
  if (activeRides.size === 0) return;

  // se não tiver VAPID, não faz sentido monitorar push
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  for (const [id, ride] of activeRides.entries()) {
    try {
      const etapa = await fetchEtapaDirect(id);

      const motorista = etapa?.NomePrestador || etapa?.nomePrestador || "";
      const veiculo = etapa?.Veiculo || etapa?.veiculo || "";
      const placa = etapa?.Placa || etapa?.placa || "";
      const status = pickStatusText(etapa);

      // se finalizou, tira do monitor do servidor
      if (isTripFinished(status)) {
        activeRides.delete(id);
        continue;
      }

      // se motorista aceitou e ainda não notificou
      if (motorista && !ride.notified) {
        ride.notified = true;

        await pushToAll({
          title: "Move Driver — Motorista aceitou ✅",
          body: `#${id} • ${motorista} • ${veiculo} • ${placa}`,
          url: `/?open=${id}`,
          data: {
            id,
            motorista,
            veiculo,
            placa,
            origem: ride.origem,
            destino: ride.destino
          }
        });
      }
    } catch {
      // não remove por erro — pode ser instabilidade
    }
  }
}, 15000);

/* =========================================================
   UTIL: achar solicitacaoID no JSON
========================================================= */
function findSolicitacaoIdDeep(obj) {
  const seen = new Set();

  function walk(v) {
    if (v === null || v === undefined) return null;

    if (typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);

      if (Array.isArray(v)) {
        for (const it of v) {
          const found = walk(it);
          if (found) return found;
        }
        return null;
      }

      for (const [k, val] of Object.entries(v)) {
        if (/^solicitacaoid$/i.test(k) || /^solicitacao_id$/i.test(k) || /^idsolicitacao$/i.test(k)) {
          const n = Number(val);
          if (Number.isFinite(n) && n > 0) return n;
        }
        const found = walk(val);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(obj);
}

app.listen(Number(process.env.PORT || 3001), () => {
  console.log("✅ Sistema rodando");
});
