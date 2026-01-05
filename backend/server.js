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
   PUSH (Web Push) - para todas as atendentes
   ========================================================= */
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

// guarda inscrições (vários celulares)
const subscriptions = new Map(); // key -> subscription

function subKey(sub) {
  try { return JSON.stringify(sub); } catch { return null; }
}

function isVapidReady() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

if (isVapidReady()) {
  webpush.setVapidDetails(
    "mailto:suporte@movedriver.local",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

async function pushToAll(payload) {
  if (!isVapidReady()) return { ok: false, message: "VAPID não configurado." };

  const msg = JSON.stringify(payload);
  const toDelete = [];

  for (const [key, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(sub, msg);
    } catch (e) {
      const status = e?.statusCode || e?.status || 0;
      if (status === 404 || status === 410) toDelete.push(key);
    }
  }

  for (const k of toDelete) subscriptions.delete(k);
  return { ok: true, sentTo: subscriptions.size };
}

app.get("/push/public-key", (req, res) => {
  return res.json({ ok: true, publicKey: VAPID_PUBLIC_KEY || "" });
});

app.post("/push/subscribe", (req, res) => {
  const sub = req.body;
  const key = subKey(sub);
  if (!key) return res.status(400).json({ ok: false, message: "Subscription inválida." });

  subscriptions.set(key, sub);
  return res.json({ ok: true, total: subscriptions.size });
});

// ✅ agora dá pra testar abrindo no navegador
app.get("/push/test", async (req, res) => {
  const out = await pushToAll({
    title: "Move Driver",
    body: "Push de teste OK ✅",
    url: "/"
  });
  if (!out.ok) return res.status(400).json(out);
  return res.json(out);
});

// ✅ endpoint para o frontend disparar push quando motorista aceitar
app.post("/push/notify", async (req, res) => {
  try {
    const { title, body, url, data } = req.body || {};
    const out = await pushToAll({
      title: title || "Move Driver — Motorista aceitou ✅",
      body: body || "Um motorista aceitou uma corrida.",
      url: url || "/",
      data: data || {}
    });
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
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

    const solicitacaoID = findSolicitacaoIdDeep(data);

    return res.json({ ok: true, result: data, solicitacaoID: solicitacaoID || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ✅ EtapaSolicitacao (endpoint correto)
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

// (Opcional) Status geral — se existir
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

// Cancelar solicitação
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

// achar solicitacaoID no JSON
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
