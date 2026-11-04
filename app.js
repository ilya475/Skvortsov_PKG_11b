const $ = (s) => document.querySelector(s);
const PAGE_SIZE = 100;
const state = { files: [], results: [], done: 0, bad: 0, start: 0, workers: [], queue: [], page: 1, filtered: [] };

const folderInput = $("#folderInput");
const filesInput = $("#filesInput");
const body = $("#resultsBody");
const search = $("#search");
const statusFilter = $("#statusFilter");
const formatFilter = $("#formatFilter");

folderInput.addEventListener("change", () => startScan([...folderInput.files]));
filesInput.addEventListener("change", () => startScan([...filesInput.files]));
$("#clearBtn").addEventListener("click", clearResults);
search.addEventListener("input", () => { state.page = 1; render(); });
statusFilter.addEventListener("change", () => { state.page = 1; render(); });
formatFilter.addEventListener("change", () => { state.page = 1; render(); });
$("#prevPage").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); render(); });
$("#nextPage").addEventListener("click", () => { state.page = Math.min(Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE)), state.page + 1); render(); });
$("#exportBtn").addEventListener("click", exportCSV);

function clearResults() {
  state.workers.forEach(w => w.terminate());
  Object.assign(state, { files: [], results: [], done: 0, bad: 0, start: 0, workers: [], queue: [], page: 1, filtered: [] });
  render(); updateProgress();
  $("#clearBtn").disabled = true;
  $("#exportBtn").disabled = true;
  folderInput.value = ""; filesInput.value = "";
}

function startScan(files) {
  state.workers.forEach(w => w.terminate());
  state.files = files;
  state.results = [];
  state.done = state.bad = 0;
  state.start = performance.now();
  state.page = 1;
  state.filtered = [];
  state.queue = files.map((file, index) => ({ file, index }));
  $("#clearBtn").disabled = files.length === 0;
  $("#exportBtn").disabled = true;
  body.innerHTML = `<tr class="empty"><td colspan="9">${files.length ? "Подготовка рабочих потоков…" : "В выбранном источнике нет файлов."}</td></tr>`;

  if (!files.length) { updateProgress(); render(); return; }
  const workerCount = Math.min(Math.max(2, (navigator.hardwareConcurrency || 4) - 1), 8, files.length);
  for (let i = 0; i < workerCount; i++) spawnWorker();
  updateProgress();
}

function spawnWorker() {
  const worker = new Worker("worker.js");
  worker.currentItem = null;
  state.workers.push(worker);

  worker.onmessage = ({ data }) => {
    if (data.type === "ready") { pump(worker); return; }
    if (data.type !== "result") return;
    worker.currentItem = null;
    acceptResult(data.index, data.result);
    if (state.done < state.files.length) pump(worker);
    else finishIfDone();
  };

  worker.onerror = (error) => {
    console.error("Worker error:", error);
    const failedItem = worker.currentItem;
    worker.terminate();
    state.workers = state.workers.filter(w => w !== worker);
    if (failedItem) acceptResult(failedItem.index, baseClient(failedItem.file, "Файл поврежден", "Ошибка рабочего потока"));
    if (state.done < state.files.length) {
      const replacement = spawnWorker();
      // Новый Worker сам отправит ready и получит следующую задачу.
    } else finishIfDone();
  };
}

function pump(worker) {
  if (worker.currentItem || !state.queue.length) return;
  const item = state.queue.shift();
  worker.currentItem = item;
  worker.postMessage({ type: "parse", index: item.index, file: item.file });
}

function acceptResult(index, result) {
  state.results[index] = result;
  state.done++;
  if (result.status !== "OK") state.bad++;
  updateProgress();
  if (state.done % 25 === 0 || state.done === state.files.length) render();
}

function finishIfDone() {
  if (state.done !== state.files.length) return;
  state.workers.forEach(w => w.terminate());
  state.workers = [];
  $("#exportBtn").disabled = false;
  render();
  updateProgress();
}

function updateProgress() {
  const total = state.files.length;
  const pct = total ? Math.round(state.done / total * 100) : 0;
  $("#totalCount").textContent = total.toLocaleString("ru-RU");
  $("#doneCount").textContent = (state.done - state.bad).toLocaleString("ru-RU");
  $("#badCount").textContent = state.bad.toLocaleString("ru-RU");
  $("#progressBar").style.width = pct + "%";
  $("#progressPercent").textContent = pct + "%";
  $("#progressText").textContent = !total ? "Ожидание файлов" : state.done === total ? "Анализ завершён" : "Идёт чтение структуры файлов…";
  $("#elapsed").textContent = state.start ? ((performance.now() - state.start) / 1000).toFixed(1).replace(".", ",") + " с" : "0,0 с";
}

function baseClient(file, status, details) {
  return { name: file.name, fileSize: file.size, format: "UNKNOWN", width: 0, height: 0, resolution: "—", colorDepth: "—", compression: "—", status, details };
}

function render() {
  const q = search.value.trim().toLowerCase();
  const sf = statusFilter.value;
  const ff = formatFilter.value;
  const rows = [];
  for (let i = 0; i < state.results.length; i++) {
    const r = state.results[i];
    if (!r) continue;
    const haystack = `${r.name} ${r.format} ${r.details || ""}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    if (sf === "ok" && r.status !== "OK") continue;
    if (sf === "bad" && r.status === "OK") continue;
    if (ff !== "all" && r.format !== ff) continue;
    rows.push({ r, i });
  }
  state.filtered = rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  $("#pageInfo").textContent = rows.length
    ? `Записи ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} из ${rows.length.toLocaleString("ru-RU")}`
    : "Результатов пока нет";
  $("#prevPage").disabled = state.page <= 1;
  $("#nextPage").disabled = state.page >= pages;

  if (!pageRows.length) {
    body.innerHTML = `<tr class="empty"><td colspan="9">${state.results.length ? "По заданным условиям ничего не найдено." : "Загрузите папку или отдельные изображения, чтобы начать эксперимент."}</td></tr>`;
    return;
  }

  body.innerHTML = pageRows.map(({ r, i }) => `<tr>
    <td><div class="file-name" title="${esc(r.name)}">${esc(r.name)}</div><div class="file-size">${fmtBytes(r.fileSize)}</div></td>
    <td><span class="format-tag">${esc(r.format)}</span></td>
    <td>${r.width && r.height ? `${r.width} × ${r.height}` : "—"}</td>
    <td>${esc(r.resolution || "не задано")}</td>
    <td>${esc(r.colorDepth || "—")}</td>
    <td>${esc(r.compression || "—")}</td>
    <td><span class="status ${r.status === "OK" ? "ok" : "bad"}">${r.status === "OK" ? "OK" : "ОШИБКА"}</span></td>
    <td class="details" title="${esc(r.details || "")}">${esc(r.details || "")}</td>
    <td>${r.status === "OK" ? `<button class="preview" data-index="${i}" title="Открыть изображение">↗</button>` : ""}</td>
  </tr>`).join("");

  body.querySelectorAll(".preview").forEach(btn => btn.addEventListener("click", () => showPreview(Number(btn.dataset.index))));
}

function showPreview(index) {
  const file = state.files[index];
  const result = state.results[index];
  if (!file || !result || result.status !== "OK") return;
  const url = URL.createObjectURL(file);
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) { URL.revokeObjectURL(url); return; }
  win.document.write(`<title>${esc(result.name)}</title><body style="margin:0;background:#101522;display:grid;place-items:center"><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain"></body>`);
  win.addEventListener("beforeunload", () => URL.revokeObjectURL(url));
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function exportCSV() {
  const columns = ["name", "format", "width", "height", "resolution", "colorDepth", "compression", "status", "details", "fileSize"];
  const lines = [columns.join(";")];
  for (const result of state.results) {
    if (result) lines.push(columns.map(key => `"${String(result[key] ?? "").replaceAll('"', '""')}"`).join(";"));
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "skvortsov_image_metadata.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

render();
setInterval(() => { if (state.files.length && state.done < state.files.length) updateProgress(); }, 250);
