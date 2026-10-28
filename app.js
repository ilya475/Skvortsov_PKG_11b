// app.js — Высокопроизводительный оркестратор (Папки, Файлы, Drag & Drop)
const $ = s => document.querySelector(s);
const PAGE_SIZE = 100;

const state = {
  files: [],
  results: [],
  done: 0,
  bad: 0,
  start: 0,
  workers: [],
  queue: [],
  active: 0,
  page: 1,
  filtered: []
};

const folderInput = $("#folderInput");
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const body = $("#resultsBody");
const search = $("#search");
const statusFilter = $("#statusFilter");
const formatFilter = $("#formatFilter");

// 1. Выбор папки
folderInput.addEventListener("change", () => {
  if (folderInput.files && folderInput.files.length) {
    startScan([...folderInput.files]);
  }
});

// 2. Выбор отдельных файлов (один или несколько)
fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files.length) {
    startScan([...fileInput.files]);
  }
});

// 3. Поддержка Drag & Drop
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", async e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  
  const droppedFiles = [];
  if (e.dataTransfer.items) {
    const queue = [];
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      const item = e.dataTransfer.items[i];
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) queue.push(traverseFileTree(entry));
      } else if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) droppedFiles.push(f);
      }
    }
    if (queue.length) {
      const nested = await Promise.all(queue);
      nested.flat().forEach(f => droppedFiles.push(f));
    }
  } else if (e.dataTransfer.files) {
    droppedFiles.push(...e.dataTransfer.files);
  }

  if (droppedFiles.length) {
    startScan(droppedFiles);
  }
});

// Рекурсивный обход перетащенных директорий
function traverseFileTree(item) {
  return new Promise(resolve => {
    if (item.isFile) {
      item.file(f => resolve([f]), () => resolve([]));
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      const entries = [];
      const readEntries = () => {
        dirReader.readEntries(async result => {
          if (!result.length) {
            const promises = entries.map(traverseFileTree);
            const nested = await Promise.all(promises);
            resolve(nested.flat());
          } else {
            entries.push(...result);
            readEntries();
          }
        }, () => resolve([]));
      };
      readEntries();
    } else {
      resolve([]);
    }
  });
}

$("#clearBtn").addEventListener("click", resetAll);
search.addEventListener("input", () => { state.page = 1; render(); });
statusFilter.addEventListener("change", () => { state.page = 1; render(); });
formatFilter.addEventListener("change", () => { state.page = 1; render(); });
$("#prevPage").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); render(); });
$("#nextPage").addEventListener("click", () => {
  const maxPage = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  state.page = Math.min(maxPage, state.page + 1);
  render();
});
$("#exportBtn").addEventListener("click", exportCSV);

function resetAll() {
  state.files = [];
  state.results = [];
  state.done = state.bad = 0;
  state.queue = [];
  state.workers.forEach(w => w.terminate());
  state.workers = [];
  state.start = 0;
  state.page = 1;
  state.filtered = [];
  folderInput.value = "";
  fileInput.value = "";
  render();
  updateProgress();
  $("#clearBtn").disabled = true;
  $("#exportBtn").disabled = true;
}

function startScan(files) {
  state.workers.forEach(w => w.terminate());
  state.workers = [];
  state.files = files;
  state.results = new Array(files.length);
  state.done = state.bad = 0;
  state.start = performance.now();
  state.page = 1;
  state.filtered = [];
  state.queue = files.map((file, index) => ({ file, index }));
  state.active = 0;

  $("#clearBtn").disabled = false;
  $("#exportBtn").disabled = true;
  body.innerHTML = '<tr class="empty-state"><td colspan="9">Идёт побайтовый анализ файлов в многопоточном режиме...</td></tr>';

  const workerCount = Math.min(Math.max(2, (navigator.hardwareConcurrency || 4) - 1), 8);
  for (let i = 0; i < workerCount; i++) {
    spawnWorker();
  }
  updateProgress();
}

function spawnWorker() {
  const w = new Worker(`worker.js?v=${Date.now()}`);
  state.workers.push(w);

  w.onmessage = e => {
    const m = e.data;
    if (m.type === "ready") {
      pump(w);
      return;
    }
    if (m.type === "result") {
      state.results[m.index] = m.result;
      state.done++;
      if (m.result.status !== "OK") state.bad++;
      updateProgress();

      if (state.done === state.files.length) {
        state.workers.forEach(x => x.terminate());
        $("#exportBtn").disabled = false;
        render();
      } else {
        pump(w);
      }

      if (state.done % 25 === 0 || state.done === state.files.length) {
        render();
      }
    }
  };

  w.onerror = err => {
    console.error("Worker error:", err);
    const item = state.queue.pop();
    if (item) {
      state.results[item.index] = {
        name: item.file.name,
        fileSize: item.file.size,
        format: "UNKNOWN",
        width: 0,
        height: 0,
        resolution: "не задано",
        colorDepth: "—",
        compression: "—",
        status: "Файл поврежден",
        details: "Ошибка Worker Thread"
      };
      state.done++;
      state.bad++;
      updateProgress();
      if (state.done === state.files.length) {
        state.workers.forEach(x => x.terminate());
        $("#exportBtn").disabled = false;
        render();
      } else {
        pump(w);
      }
    }
  };
}

function pump(w) {
  const item = state.queue.pop();
  if (!item) return;
  w.postMessage({ type: "parse", index: item.index, file: item.file });
}

function updateProgress() {
  const total = state.files.length;
  const pct = total ? Math.round((state.done / total) * 100) : 0;
  $("#totalCount").textContent = total.toLocaleString();
  $("#doneCount").textContent = state.done.toLocaleString();
  $("#badCount").textContent = state.bad.toLocaleString();
  $("#progressBar").style.width = pct + "%";
  $("#progressPercent").textContent = pct + "%";
  $("#progressText").textContent = total 
    ? (state.done === total ? "Анализ успешно завершён" : `Анализ файлов (${state.done} из ${total})...`)
    : "Ожидание выбора файлов или каталога...";
  $("#elapsed").textContent = state.start ? ((performance.now() - state.start) / 1000).toFixed(2) + " c" : "0.0 c";
}

function render() {
  const q = search.value.trim().toLowerCase();
  const sf = statusFilter.value;
  const ff = formatFilter.value;

  const rows = [];
  for (let i = 0; i < state.results.length; i++) {
    const r = state.results[i];
    if (!r) continue;
    if (q && !r.name.toLowerCase().includes(q) && !r.format.toLowerCase().includes(q)) continue;
    if (sf !== "all" && !((sf === "ok" && r.status === "OK") || (sf === "bad" && r.status !== "OK"))) continue;
    if (ff !== "all" && r.format !== ff) continue;
    rows.push({ r, i });
  }

  state.filtered = rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  $("#pageInfo").textContent = rows.length
    ? `Показаны строки ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} из ${rows.length.toLocaleString()} · Страница ${state.page} / ${pages}`
    : "Нет записей";

  $("#prevPage").disabled = state.page <= 1;
  $("#nextPage").disabled = state.page >= pages;

  if (!pageRows.length) {
    body.innerHTML = '<tr class="empty-state"><td colspan="9">' + 
      (state.results.length ? 'Ни один файл не удовлетворяет выбранным критериям поиска' : 'Выберите файлы или папку для начала анализа') + 
      '</td></tr>';
    return;
  }

  body.innerHTML = pageRows.map(({ r, i }) => `
    <tr>
      <td><button class="preview-btn" data-index="${i}" title="Открыть предпросмотр">👁</button></td>
      <td>
        <div style="font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.name)}">${esc(r.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${fmtBytes(r.fileSize)}</div>
      </td>
      <td><span style="font-family:var(--font-mono);font-weight:600;">${esc(r.format)}</span></td>
      <td style="font-family:var(--font-mono);">${r.width && r.height ? r.width + " × " + r.height : "—"}</td>
      <td>${esc(r.resolution || "не задано")}</td>
      <td>${esc(r.colorDepth || "—")}</td>
      <td>${esc(r.compression || "—")}</td>
      <td><span class="pill ${r.status === "OK" ? "ok" : "bad"}">${esc(r.status)}</span></td>
      <td style="color:var(--text-muted);font-size:12px;">${esc(r.details || "")}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".preview-btn").forEach(btn => {
    btn.addEventListener("click", () => showPreview(Number(btn.dataset.index)));
  });
}

function showPreview(index) {
  const f = state.files[index];
  const r = state.results[index];
  if (!f || !r) return;
  const url = URL.createObjectURL(f);
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) {
    URL.revokeObjectURL(url);
    alert("Разрешите всплывающие окна в браузере для предпросмотра изображения.");
    return;
  }
  w.document.write(`
    <title>Предпросмотр: ${esc(r.name)}</title>
    <body style="margin:0;background:#0b0f17;color:#f0f4f8;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;">
      <div style="text-align:center;padding:20px;">
        <img id="pImg" src="${url}" style="max-width:92vw;max-height:85vh;object-fit:contain;border:1px solid #273447;border-radius:8px;">
        <p id="pMsg" style="margin-top:12px;color:#8e9eb2;font-size:14px;">Загрузка растра...</p>
      </div>
      <script>
        const img = document.getElementById('pImg');
        const msg = document.getElementById('pMsg');
        img.onload = () => msg.textContent = '${esc(r.name)} (${r.width} × ${r.height} px)';
        img.onerror = () => { img.style.display='none'; msg.textContent='Браузер не смог отобразить растр (файл поврежден или формат не поддерживается встроенным движком).'; };
      <\/script>
    </body>
  `);
  w.addEventListener("beforeunload", () => URL.revokeObjectURL(url));
}

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function exportCSV() {
  const cols = ["name", "format", "width", "height", "resolution", "colorDepth", "compression", "status", "details", "fileSize"];
  const lines = [cols.join(";")];
  for (const r of state.results) {
    if (r) {
      lines.push(cols.map(k => `"${String(r[k] ?? "").replaceAll('"', '""')}"`).join(";"));
    }
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "image_metadata_inspection.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

render();
setInterval(() => {
  if (state.files.length && state.done < state.files.length) updateProgress();
}, 250);
