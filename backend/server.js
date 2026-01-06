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

function basicAuthHeader() {
  const basic = Buffer.from(`${process.env.MD_USER}:${process.env.MD_PASS}`).toString("base64");
  return `Basic ${basic}`;
}

function toNumberBR(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  // aceita "25,00" / "25.00" / "25"
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Criar corrida (com Valor opcional)
app.post("/rides", async (req, res) => {
  try {
    const { origem, destino, obs, valor } = req.body;

    if (!origem?.trim() || !destino?.trim()) {
      return res.status(400).json({ ok: false, message: "Informe Origem e Destino." });
    }

    const valorNum = toNumberBR(valor);

    const payload = {
      ClienteID: Number(process.env.CLIENTE_ID),
      ServicoItemID: Number(process.env.SERVICO_ID),
      TipoPagamentoID: Number(process.env.PAGAMENTO_ID),
      // Valor é opcional na API. Se enviar, usa o fixo; se não, o sistema calcula.
      ...(valorNum !== null ? { Valor: valorNum } : {}),
      enderecoOrigem: {
        CEP: process.env.CEP_PADRAO,
        Endereco: origem.trim(),
        Cidade: process.env.CIDADE,
        EstadoSigla: process.env.UF,
      },
      lstDestino: [
        {
          CEP: process.env.CEP_PADRAO,
          Endereco: destino.trim(),
          Cidade: process.env.CIDADE,
          EstadoSigla: process.env.UF,
        },
      ],
      Observacao: (obs || "").trim(),
    };

    const url = `${process.env.MD_API_BASE_URL}/CriarSolicitacaoViagem`;

    const apiResp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const raw = await apiResp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({ ok: false, details: data });
    }

    // Tenta extrair o ID (padrão do exemplo da documentação)
    const solicitacaoId =
      data?.Resultado?.resultado?.SolicitacaoID ??
      data?.Resultado?.resultado?.SolicitacaoId ??
      data?.Resultado?.resultado?.solicitacaoID ??
      data?.Resultado?.resultado?.solicitacaoId ??
      null;

    return res.json({
      ok: true,
      result: data,
      solicitacaoId,
      valorInformado: valorNum,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Consultar etapa (motorista/placa etc.)
app.get("/rides/:id/etapa", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "ID inválido." });

    const url = `${process.env.MD_API_BASE_URL}/EtapaSolicitacao?solicitacaoID=${id}`;

    const apiResp = await fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader() },
    });

    const raw = await apiResp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!apiResp.ok) return res.status(apiResp.status).json({ ok: false, details: data });

    return res.json({ ok: true, etapa: data?.EtapaSolicitacao ?? null, raw: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Consultar solicitação (para pegar crd_valor final, crd_status etc.)
app.get("/rides/:id/solicitacao", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "ID inválido." });

    const url = `${process.env.MD_API_BASE_URL}/Solicitacao?solicitacaoID=${id}`;

    const apiResp = await fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader() },
    });

    const raw = await apiResp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!apiResp.ok) return res.status(apiResp.status).json({ ok: false, details: data });

    const item = Array.isArray(data?.Solicitacao) ? data.Solicitacao[0] : null;

    return res.json({ ok: true, solicitacao: item, raw: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Cancelar solicitação (tipo=C)
app.post("/rides/:id/cancel", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "ID inválido." });

    const url = `${process.env.MD_API_BASE_URL}/CancelarSolicitacao?solicitacaoID=${id}&tipo=C&cancEngano=false&cliNaoEncontrado=false`;

    const apiResp = await fetch(url, {
      method: "POST",
      headers: { Authorization: basicAuthHeader() },
    });

    const raw = await apiResp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!apiResp.ok) return res.status(apiResp.status).json({ ok: false, details: data });

    return res.json({ ok: true, result: data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.listen(Number(process.env.PORT || 3001), () => {
  console.log("✅ Sistema rodando em: http://localhost:3001");
});
