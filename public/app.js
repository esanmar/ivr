// public/app.js
const $ = (id) => document.getElementById(id);

function getFormValues() {
  const nif = $("nif")?.value?.trim().toUpperCase() || "";
  const comprobar = ($("comprobar")?.value ?? "true") === "true";
  const usuario = $("usuario")?.value?.trim() || "Internet";
  return { nif, comprobar, usuario };
}

function setStatus(msg, ok = true) {
  const el = $("status");
  if (!el) return;
  el.className = ok ? "ok" : "err";
  el.textContent = msg;
}

$("btnCert")?.addEventListener("click", async () => {
  try {
    const { nif, comprobar, usuario } = getFormValues();
    if (!nif) {
      setStatus("Falta NIF", false);
      return;
    }
    setStatus("Consultando certificado…", true);
    const r = await fetch("/api/certificado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nif, comprobar, usuario })
    });
    const data = await r.json();
    $("out").textContent = JSON.stringify(data, null, 2);
    setStatus(r.ok ? "OK" : "Error", r.ok);
  } catch (e) {
    setStatus("Error: " + e.message, false);
  }
});

$("btnPDF")?.addEventListener("click", async () => {
  try {
    const { nif, comprobar, usuario } = getFormValues();
    if (!nif) {
      setStatus("Falta NIF", false);
      return;
    }
    setStatus("Generando PDF…", true);
    const r = await fetch("/api/certificado/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nif, comprobar, usuario })
    });
    if (!r.ok) {
      const t = await r.text();
      setStatus("No hay PDF: " + (t || r.status), false);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    // gesto de usuario: abrir nueva pestaña sin bloqueo
    const w = window.open(url, "_blank");
    if (!w) alert("El navegador bloqueó el pop-up del PDF. Permite pop-ups.");
    setStatus("PDF abierto", true);
  } catch (e) {
    setStatus("Error: " + e.message, false);
  }
});

$("btnTTS")?.addEventListener("click", async () => {
  try {
    const out = $("out")?.textContent || "";
    if (!out) return setStatus("Primero obtén el certificado (JSON).", false);
    // texto simple a leer (puedes adaptarlo a tu payload real)
    const text = "Operación completada. Revisa el resultado en pantalla.";
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: "eu-ES", voice: "eu-ES-Standard-B" })
    });
    if (!r.ok) return setStatus("Error TTS", false);
    const buf = await r.arrayBuffer();
    const blob = new Blob([buf], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    setStatus("Reproduciendo TTS", true);
  } catch (e) {
    setStatus("Error TTS: " + e.message, false);
  }
});

// Evita que scripts antiguos lean 'nombre'
if (document.getElementById("nombre")) {
  document.getElementById("nombre").value = "";
}
