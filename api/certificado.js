const soap = require("soap");
const WSDL_URL = "http://devinet.dfa.es/WHASCCertificados/WHASCCertificados.svc?wsdl";

async function getCertificadoViaSOAP({ nif, comprobar = true, usuario = "Internet" }) {
  const client = await soap.createClientAsync(WSDL_URL);
  const [result] = await client.certificadoSitTributariaAsync({
    pNIF: nif,
    pNombre: " ",
    pComprobar: Boolean(comprobar),
    pUsuario: usuario || "Internet",
  });
  const certificado = (result && (result.certificadoSitTributariaResult || result)) || {};

  let pdfBase64 = null;
  for (const [k, v] of Object.entries(certificado)) {
    if (/pdf/i.test(k)) {
      if (Array.isArray(v)) pdfBase64 = Buffer.from(v).toString("base64");
      else if (Buffer.isBuffer(v)) pdfBase64 = v.toString("base64");
      else if (typeof v === "string") pdfBase64 = v;
    }
  }
  return { certificado, pdfBase64 };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { nif, comprobar = true, usuario = "Internet" } = req.body || {};
    if (!nif) return res.status(400).json({ error: "Falta NIF" });
    const { certificado, pdfBase64 } = await getCertificadoViaSOAP({ nif, comprobar, usuario });
    res.json({ ok: true, certificado, pdfBase64 });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};