const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");

function setRunning(running) {
  startBtn.style.display = running ? "none" : "block";
  stopBtn.style.display = running ? "block" : "none";
}

function render(state) {
  if (!state) return;
  setRunning(state.running);
  statusEl.textContent = state.message || "Pronto.";
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(msg) {
  const tab = await getTab();
  if (!tab || !tab.url || !tab.url.startsWith("https://web.whatsapp.com")) {
    statusEl.textContent = "Abra o WhatsApp Web (web.whatsapp.com) nesta aba primeiro.";
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    statusEl.textContent = "Recarregue a página do WhatsApp Web (F5) e tente de novo.";
    return null;
  }
}

startBtn.addEventListener("click", async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const texto = mode === "clear"
    ? "Limpar as mensagens de TODAS as conversas? Isso não pode ser desfeito."
    : "Apagar TODAS as conversas da lista? Isso não pode ser desfeito.";
  if (!confirm(texto)) return;
  const state = await send({ type: "start", mode });
  render(state);
});

stopBtn.addEventListener("click", async () => {
  const state = await send({ type: "stop" });
  render(state);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "progress") render(msg.state);
});

(async () => {
  const state = await send({ type: "status" });
  render(state);
})();
