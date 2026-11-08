(() => {
  if (window.__wppLimpadorLoaded) return;
  window.__wppLimpadorLoaded = true;

  const state = { running: false, stop: false, done: 0, skipped: 0, message: "Pronto." };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function report(message) {
    state.message = message;
    try {
      chrome.runtime.sendMessage({ type: "progress", state: { ...state } }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }

  async function waitFor(fn, timeout = 3000, step = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findByText(regex, root = document) {
    const els = [...root.querySelectorAll('li, [role="menuitem"], [role="button"], button, div[tabindex]')];
    const matches = els.filter((e) => isVisible(e) && regex.test((e.innerText || "").trim()));
    matches.sort((a, b) => a.innerText.length - b.innerText.length);
    return matches[0] || null;
  }

  const MENU = {
    clear: /^(limpar conversa|clear chat)$/i,
    delete: /^(apagar conversa|excluir conversa|delete chat)$/i,
  };
  const CONFIRM = {
    clear: /^(limpar conversa|limpar|clear chat|clear)$/i,
    delete: /^(apagar conversa|apagar|excluir conversa|excluir|delete chat|delete)$/i,
  };

  function getPane() {
    return document.querySelector("#pane-side");
  }

  function getRows() {
    const pane = getPane();
    if (!pane) return [];
    let rows = [...pane.querySelectorAll('[role="listitem"], [role="row"]')];
    if (!rows.length) rows = [...pane.querySelectorAll('[data-testid="cell-frame-container"]')];
    return rows.filter(isVisible);
  }

  function rowKey(row) {
    const t = row.querySelector("span[title]");
    const title = t ? t.getAttribute("title") : "";
    return title || (row.innerText || "").split("\n")[0].trim();
  }

  function openContextMenu(row) {
    const target = row.querySelector("span[title]") || row;
    const r = row.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      })
    );
  }

  async function openMenuWithFallback(row, menuRegex) {
    openContextMenu(row);
    let item = await waitFor(() => findByText(menuRegex), 1500);
    if (item) return item;

    // Fallback: botão de seta que aparece ao passar o mouse sobre a conversa
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await sleep(200);
    const btn = row.querySelector('[aria-label*="Menu de contexto" i], [aria-label*="context menu" i], [data-icon="down-context"]');
    if (btn) {
      (btn.closest('[role="button"]') || btn).click();
      item = await waitFor(() => findByText(menuRegex), 1500);
    }
    return item;
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  }

  async function processRow(row, mode) {
    const item = await openMenuWithFallback(row, MENU[mode]);
    if (!item) {
      pressEscape();
      await sleep(200);
      return false;
    }
    item.click();

    const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), 2500);
    if (!dialog) {
      pressEscape();
      return false;
    }
    const confirmBtn = await waitFor(() => findByText(CONFIRM[mode], dialog), 2000);
    if (!confirmBtn) {
      pressEscape();
      await sleep(200);
      return false;
    }
    confirmBtn.click();

    // espera o diálogo fechar
    await waitFor(() => !document.querySelector('[role="dialog"]'), 4000);
    await sleep(400);
    return true;
  }

  async function run(mode) {
    if (state.running) return;
    state.running = true;
    state.stop = false;
    state.done = 0;
    state.skipped = 0;
    const seen = new Set();
    let stuck = 0;

    if (!getPane()) {
      state.running = false;
      report("Não encontrei a lista de conversas. Abra o WhatsApp Web e aguarde carregar.");
      return;
    }

    report("Iniciando...");
    while (!state.stop) {
      const rows = getRows();
      const row = rows.find((r) => !seen.has(rowKey(r)));

      if (row) {
        const key = rowKey(row);
        seen.add(key);
        row.scrollIntoView({ block: "nearest" });
        await sleep(150);
        const ok = await processRow(row, mode);
        if (ok) state.done++;
        else state.skipped++;
        report(`Processadas: ${state.done} | Ignoradas: ${state.skipped}`);
        stuck = 0;
        await sleep(300);
        continue;
      }

      // nada novo visível: rola a lista
      const pane = getPane();
      const before = pane.scrollTop;
      pane.scrollTop = before + pane.clientHeight * 0.8;
      await sleep(700);
      if (pane.scrollTop === before) {
        stuck++;
        if (stuck >= 2) break;
      } else {
        stuck = 0;
      }
    }

    state.running = false;
    report(
      (state.stop ? "Interrompido. " : "Concluído! ") +
        `Processadas: ${state.done} | Ignoradas: ${state.skipped}`
    );
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "start") {
      run(msg.mode === "delete" ? "delete" : "clear");
      sendResponse({ ...state, running: true });
    } else if (msg.type === "stop") {
      state.stop = true;
      sendResponse({ ...state, message: "Parando..." });
    } else if (msg.type === "status") {
      sendResponse({ ...state });
    }
    return false;
  });
})();
