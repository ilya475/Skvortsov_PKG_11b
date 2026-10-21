const $ = s => document.querySelector(s);
const PAGE_SIZE = 100;
const state = {files:[], results:[], done:0, bad:0, start:0, workers:[], queue:[], active:0, page:1, filtered:[]};

const input=$("#folderInput"), body=$("#resultsBody"), search=$("#search"), statusFilter=$("#statusFilter"), formatFilter=$("#formatFilter");

input.addEventListener("change", ()=>startScan([...input.files]));
$("#clearBtn").addEventListener("click", ()=>{ state.files=[];state.results=[];state.done=state.bad=0; state.queue=[]; state.workers.forEach(w=>w.terminate());state.workers=[];state.start=0; render(); updateProgress(); $("#clearBtn").disabled=true; $("#exportBtn").disabled=true; });
search.addEventListener("input",()=>{state.page=1;render()}); statusFilter.addEventListener("change",()=>{state.page=1;render()}); formatFilter.addEventListener("change",()=>{state.page=1;render()});
$("#prevPage").addEventListener("click",()=>{state.page=Math.max(1,state.page-1);render()});
$("#nextPage").addEventListener("click",()=>{state.page=Math.min(Math.max(1,Math.ceil(state.filtered.length/PAGE_SIZE)),state.page+1);render()});
$("#exportBtn").addEventListener("click", exportCSV);

function startScan(files){
  state.workers.forEach(w=>w.terminate()); state.workers=[];
  state.files=files; state.results=[]; state.done=state.bad=0; state.start=performance.now(); state.page=1; state.filtered=[];
  state.queue=files.map((file,index)=>({file,index})); state.active=0;
  $("#clearBtn").disabled=false; $("#exportBtn").disabled=true;
  body.innerHTML='<tr class="empty"><td colspan="9">Идёт анализ…</td></tr>';
  const count=Math.min(Math.max(2,(navigator.hardwareConcurrency||4)-1),8);
  for(let i=0;i<count;i++) spawnWorker();
  updateProgress();
}
function spawnWorker(){
  const w=new Worker(`worker.js?v=5-${Date.now()}`); state.workers.push(w);
  w.onmessage=e=>{
    const m=e.data;
    if(m.type==="ready"){ pump(w); return; }
    if(m.type==="result"){
      state.results[m.index]=m.result; state.done++; if(m.result.status!=="OK")state.bad++;
      updateProgress();
      if(state.done===state.files.length){state.workers.forEach(x=>x.terminate());$("#exportBtn").disabled=false;}
      else pump(w);
      if(state.done % 25 === 0 || state.done===state.files.length) render();
    }
  };
  w.onerror=(err)=>{
    console.error("Worker error", err);
    const item=state.queue.pop();
    if(item){
      state.results[item.index]=baseClient(item.file, "Файл поврежден", "Ошибка Web Worker");
      state.done++; state.bad++; updateProgress();
      if(state.done===state.files.length){state.workers.forEach(x=>x.terminate());$("#exportBtn").disabled=false;render();}
      else pump(w);
    }
  };
}
function pump(w){
  const item=state.queue.pop();
  if(!item)return;
  state.active++;
  w.postMessage({type:"parse",index:item.index,file:item.file});
}
function updateProgress(){
  const total=state.files.length, pct=total?Math.round(state.done/total*100):0;
  $("#totalCount").textContent=total.toLocaleString();$("#doneCount").textContent=state.done.toLocaleString();$("#badCount").textContent=state.bad.toLocaleString();
  $("#progressBar").style.width=pct+"%";$("#progressPercent").textContent=pct+"%";
  $("#progressText").textContent=total?(state.done===total?"Анализ завершён":"Анализ файлов…"):"Ожидание файлов";
  $("#elapsed").textContent=state.start?((performance.now()-state.start)/1000).toFixed(1)+" c":"0.0 c";
}
function baseClient(f,status,details){return {name:f.name,fileSize:f.size,format:"UNKNOWN",width:0,height:0,resolution:"—",colorDepth:"—",compression:"—",status,details};}
function render(){
  const q=search.value.trim().toLowerCase(), sf=statusFilter.value, ff=formatFilter.value;
  const rows=[];
  for(let i=0;i<state.results.length;i++){
    const r=state.results[i]; if(!r) continue;
    if(q&&!r.name.toLowerCase().includes(q)&&!r.format.toLowerCase().includes(q)) continue;
    if(sf!=="all"&&!((sf==="ok"&&r.status==="OK")||(sf==="bad"&&r.status!=="OK"))) continue;
    if(ff!=="all"&&r.format!==ff) continue;
    rows.push({r,i});
  }
  state.filtered=rows;
  const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  state.page=Math.min(Math.max(1,state.page),pages);
  const start=(state.page-1)*PAGE_SIZE, pageRows=rows.slice(start,start+PAGE_SIZE);
  $("#pageInfo").textContent=rows.length?`Строки ${start+1}–${Math.min(start+PAGE_SIZE,rows.length)} из ${rows.length.toLocaleString()} · страница ${state.page}/${pages}`:"Нет результатов";
  $("#prevPage").disabled=state.page<=1; $("#nextPage").disabled=state.page>=pages;
  if(!pageRows.length){body.innerHTML='<tr class="empty"><td colspan="9">'+(state.results.length?'Нет совпадений':'Выберите папку для начала анализа')+'</td></tr>';return}
  body.innerHTML=pageRows.map(({r,i})=>`<tr>
    <td><button class="preview" data-index="${i}" title="Открыть изображение">👁</button></td><td><div class="name" title="${esc(r.name)}">${esc(r.name)}</div><div class="muted">${fmtBytes(r.fileSize)}</div></td>
    <td>${esc(r.format)}</td><td>${r.width&&r.height?r.width+" × "+r.height:"—"}</td>
    <td>${esc(r.resolution||"не задано")}</td><td>${esc(r.colorDepth||"—")}</td><td>${esc(r.compression||"—")}</td>
    <td><span class="pill ${r.status==="OK"?"ok":"bad"}">${esc(r.status)}</span></td>
    <td class="muted">${esc(r.details||"")}</td>
  </tr>`).join("");
  body.querySelectorAll(".preview").forEach(btn=>btn.addEventListener("click",()=>showPreview(Number(btn.dataset.index))));
}
function showPreview(index){
  const f=state.files[index]; const r=state.results[index]; if(!f||!r)return;
  const url=URL.createObjectURL(f);
  const w=window.open("","_blank","width=1000,height=800");
  if(!w){URL.revokeObjectURL(url);alert("Браузер заблокировал окно предпросмотра. Разреши всплывающие окна для этого сайта и повтори попытку.");return}
  w.document.write(`<title>${esc(r.name)}</title><body style="margin:0;background:#111;color:#eee;font:16px sans-serif;display:grid;place-items:center;min-height:100vh"><div style="text-align:center;padding:24px"><img id="previewImage" src="${url}" alt="Предпросмотр" style="max-width:95vw;max-height:85vh;object-fit:contain"><p id="previewMessage">Загрузка изображения…</p></div><script>const img=document.getElementById('previewImage'),msg=document.getElementById('previewMessage');img.onload=()=>msg.textContent='';img.onerror=()=>{img.style.display='none';msg.textContent='Браузер не смог декодировать изображение. Возможно, файл действительно повреждён или формат не поддерживается.'};</script></body>`);
  w.addEventListener("beforeunload",()=>URL.revokeObjectURL(url));
}
function fmtBytes(n){if(n<1024)return n+" B";if(n<1048576)return(n/1024).toFixed(1)+" KB";if(n<1073741824)return(n/1048576).toFixed(1)+" MB";return(n/1073741824).toFixed(2)+" GB"}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function exportCSV(){
  const cols=["name","format","width","height","resolution","colorDepth","compression","status","details","fileSize"];
  const lines=[cols.join(";")];
  for(const r of state.results) if(r) lines.push(cols.map(k=>`"${String(r[k]??"").replaceAll('"','""')}"`).join(";"));
  const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="image_metadata.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
render();
setInterval(()=>{if(state.files.length&&state.done<state.files.length)updateProgress()},250);
