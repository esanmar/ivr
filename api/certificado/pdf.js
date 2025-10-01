const soap = require("soap");
const WSDL_URL = "http://devinet.dfa.es/WHASCCertificados/WHASCCertificados.svc?wsdl";

async function getPdfBase64({ nif, comprobar = true, usuario = "Internet" }) {
  const client = await soap.createClientAsync(WSDL_URL);
  const [result] = await client.certificadoSitTributariaAsync({
    pNIF: nif,
    pNombre: " ",
    pComprobar: Boolean(comprobar),
    pUsuario: usuario || "Internet",
  });
  const certificado = (result && (result.certificadoSitTributariaResult || result)) || {};
  for (const [k, v] of Object.entries(certificado)) {
    if (/pdf/i.test(k)) {
      if (Array.isArray(v)) return Buffer.from(v).toString("base64");
      if (Buffer.isBuffer(v)) return v.toString("base64");
      if (typeof v === "string") return v;
    }
  }
  return null;
}

module.exports = async (req, res) => {
  try {
    const isPost = req.method === "POST";
    const qs = isPost ? (req.body || {}) : (req.query || {});
    const { nif, comprobar = true, usuario = "Internet" } = qs;
    if (!nif) return res.status(400).json({ error: "Falta NIF" });

    const pdfBase64 = await getPdfBase64({ nif, comprobar: comprobar === true || comprobar === "true", usuario });
    if (!pdfBase64) return res.status(404).json({ error: "PDF no disponible" });

    const buf = Buffer.from(pdfBase64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=certificado.pdf");
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
