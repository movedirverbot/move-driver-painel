import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(express.json());

// Serve o frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));

// Teste rápido
app.get("/health", (req, res) => res.json({ ok: true }));

function basicAuthHeader() {
  const basic = Buffer.from(`${process.env.MD_USER}:${process.env.MD_PASS}`).toString("base64");
  return `Basic ${basic}`;
}

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

    return res.json({ ok: true, result: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ✅ Status por etapas (nome/placa/veículo/status)
app.get("/rides/:id/etapa", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    // ✅ ENDPOINT CORRETO NA WIKI: EtapaSolicitacao
    const url = `${process.env.MD_API_BASE_URL}/EtapaSolicitacao?solicitacaoID=${id}`;

    const apiResp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": basicAuthHeader()
      }
    });

    const raw = await apiResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({ ok: false, details: data });
    }

    // A resposta vem normalmente assim: { "EtapaSolicitacao": { ... } }
    const etapa = data?.EtapaSolicitacao ?? data?.etapaSolicitacao ?? data;

    return res.json({ ok: true, etapa });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// (Opcional) Status geral (se sua API tiver esse endpoint)
app.get("/rides/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const url = `${process.env.MD_API_BASE_URL}/SolicitacaoStatus?solicitacaoID=${id}`;

    const apiResp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": basicAuthHeader()
      }
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

// ✅ Cancelar solicitação
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

app.listen(Number(process.env.PORT || 3001), () => {
  console.log("✅ Sistema rodando em: http://localhost:3001");
});
