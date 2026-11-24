import {rgbaToGray, grayToRgba, histogram, statistics} from './src/pixels.js';
import {LOCAL_METHODS} from './src/algorithms.js';

const $ = id => document.getElementById(id);
const samples = [
  {file:'contrast_low.png', title:'Малоконтрастная сцена', purpose:'Линейное контрастирование / CLAHE'},
  {file:'illumination_document.png', title:'Документ с неоднородным освещением', purpose:'Локальный / адаптивный порог'},
  {file:'colored_dim.png', title:'Приглушённые цвета', purpose:'Гистограммы яркости / CLAHE'},
  {file:'noise_salt_pepper.png', title:'Импульсный шум', purpose:'Устойчивость пороговой обработки к шуму'},
  {file:'noise_gaussian.png', title:'Гауссов шум', purpose:'Зависимость порога от статистики'},
  {file:'blurred_edges.png', title:'Размытые границы', purpose:'Влияние размытия'},
  {file:'border_checker.png', title:'Проверка границ', purpose:'Сравнение Reflect и Clamp'},
  {file:'large_scene.png', title:'Большое изображение (1680 × 1050)', purpose:'Многопоточность'}
];
const methods = {
  linear: 'Растяжение диапазона яркости между двумя выбранными процентилями.',
  'local-mean': 'Порог в каждом пикселе равен среднему значению яркости в его окрестности.',
  niblack: 'Локальный порог: среднее плюс k, умноженное на стандартное отклонение.',
  sauvola: 'Адаптивный порог Сауволы: среднее зависит от контраста в локальном окне.',
  otsu: 'Автоматический глобальный порог, максимизирующий межклассовую дисперсию.',
  clahe: 'Локальное выравнивание гистограмм с ограничением усиления контраста.'
};
const state = {rgba:null, gray:null, width:0, height:0, result:null, source:'', busy:false, version:0, running:new Set()};
let currentMode = $('mode').value;
const fmt = x => Number(x).toLocaleString('ru-RU', {maximumFractionDigits:2});

function status(message, kind='') {
  $('status').textContent = message;
  $('status').parentElement.className = 'status ' + kind;
}
function updateControls() {
  const mode = $('mode').value, local = LOCAL_METHODS.has(mode);
  $('contrastGroup').classList.toggle('hidden',mode!=='linear');
  $('windowGroup').classList.toggle('hidden',!local);
  $('kGroup').classList.toggle('hidden',!['niblack','sauvola'].includes(mode));
  $('rGroup').classList.toggle('hidden',mode!=='sauvola');
  $('claheGroup').classList.toggle('hidden',mode!=='clahe');
  $('borderGroup').classList.toggle('hidden',!local);
  $('threadsGroup').classList.toggle('hidden',!local);
  if (mode !== currentMode) {
    if (mode === 'sauvola') { $('kRange').min=0; $('kRange').max=.8; $('kRange').value=.2; }
    if (mode === 'niblack') { $('kRange').min=-.6; $('kRange').max=.6; $('kRange').value=-.2; }
    currentMode=mode;
  }
  $('methodHelp').textContent=methods[mode];
  updateLabels();
}
function updateLabels() {
  $('contrastLabel').textContent = `${$('lowPercent').value}% – ${$('highPercent').value}%`;
  $('windowLabel').textContent = `${$('windowSize').value} × ${$('windowSize').value}`;
  $('kLabel').textContent = Number($('kRange').value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
  $('rLabel').textContent = $('rRange').value;
  $('tilesLabel').textContent = `${$('tilesRange').value} × ${$('tilesRange').value}`;
  $('clipLabel').textContent = Number($('clipRange').value).toFixed(1).replace('.',',');
}
function options() {
  return {
    windowSize:Number($('windowSize').value),
    k:Number($('kRange').value),R:Number($('rRange').value),
    lowPercent:Number($('lowPercent').value), highPercent:Number($('highPercent').value),
    tiles:Number($('tilesRange').value),clipLimit:Number($('clipRange').value),
    borderMode:$('borderMode').value
  };
}
function cancelWorkers() {
  for (const task of [...state.running]) task.cancel();
  state.running.clear();
  state.version++;
  state.busy = false;
  $('processBtn').disabled=false;
}
function workerJob(mode, params, startRow, endRow, version) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./worker.js', import.meta.url), {type:'module'});
    const task = {cancel:()=>{cleanup();reject(new Error('Обработка отменена'));}};
    const cleanup = ()=>{state.running.delete(task);worker.terminate();};
    state.running.add(task);
    const payload=state.gray.slice().buffer;
    worker.onmessage=event=>{
      cleanup();
      if (version!==state.version) { reject(new Error('Обработка отменена')); return; }
      const r=event.data;
      if(r.error) reject(new Error(r.error));else resolve(r);
    };
    worker.onerror=event=>{cleanup();reject(new Error('Ошибка Web Worker: '+(event.message||'неизвестная ошибка')));};
    worker.postMessage({id:version,width:state.width,height:state.height,grayBuffer:payload,
      mode,params,startRow,endRow},[payload]);
  });
}
function drawImage(canvas, rgba, width, height) {
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}
function clearCanvas(canvas) {canvas.width=2;canvas.height=2;canvas.getContext('2d').clearRect(0,0,2,2);}
function histDraw(canvas,h,maxCount,tint) {
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#f7fafb';ctx.fillRect(0,0,W,H);
  const left=28,right=W-10,top=13,bottom=H-24;
  ctx.strokeStyle='#e4ecef';ctx.lineWidth=1;
  for(let t=0;t<=4;t++) {let y=bottom-(bottom-top)*t/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  ctx.strokeStyle=tint;ctx.lineWidth=1.7;ctx.beginPath();
  for(let i=0;i<256;i++){
    const x=left+(right-left)*i/255, y=bottom-h[i]/Math.max(1,maxCount)*(bottom-top);
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.stroke();ctx.fillStyle='#6f8492';ctx.font='12px sans-serif';
  ctx.fillText('0',left,bottom+17);ctx.fillText('128',left+(right-left)*.5-10,bottom+17);
  ctx.fillText('255',right-22,bottom+17);ctx.fillText(fmt(maxCount),left,11);
}
function renderHistogram(before,after=null) {
  const h1=histogram(before),h2=after?histogram(after):new Uint32Array(256);
  const maxCount=Math.max(...h1,...h2,1);
  histDraw($('histBefore'),h1,maxCount,'#078578');
  histDraw($('histAfter'),h2,maxCount,'#317caf');
}
function renderStats(before,after) {
  const a=statistics(before), b=after?statistics(after):null;
  $('meanPair').textContent=`${fmt(a.mean)} → ${b?fmt(b.mean):'—'}`;
  $('sdPair').textContent=`${fmt(a.sd)} → ${b?fmt(b.sd):'—'}`;
  $('rangePair').textContent=`${a.range} → ${b?b.range:'—'}`;
}
function resetProcessed() {
  state.result=null;
  clearCanvas($('afterCanvas'));
  $('elapsed').textContent='—';$('thresholdInfo').textContent='—';
  $('downloadBtn').disabled=true;
  if(state.gray){renderHistogram(state.gray);renderStats(state.gray,null);}
}
async function decodeImage(blob) {
  const bitmap=await createImageBitmap(blob);
  try {
    const pixels=bitmap.width*bitmap.height, scale=Math.min(1,Math.sqrt(12_000_000/pixels));
    const width=Math.max(1,Math.floor(bitmap.width*scale)),height=Math.max(1,Math.floor(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,width,height);
    return {rgba:ctx.getImageData(0,0,width,height).data, width,height};
  } finally{bitmap.close();}
}
async function loadBlob(blob, label) {
  cancelWorkers();const version=state.version;
  status('Загружается изображение…','busy');
  try {
    const image=await decodeImage(blob);
    if(version!==state.version)return;
    state.width=image.width;state.height=image.height;
    state.rgba=new Uint8ClampedArray(image.rgba);
    state.gray=rgbaToGray(state.rgba);state.source=label;
    drawImage($('beforeCanvas'),state.rgba,state.width,state.height);
    resetProcessed();
    $('pixelCount').textContent=fmt(state.width*state.height);
    $('sourceLabel').textContent=`Источник: ${label} · ${state.width} × ${state.height}`;
    status('Изображение загружено. Выберите метод и параметры.','ready');
  } catch(err) {status('Ошибка открытия изображения: '+err.message,'error');}
}
async function loadSelected() {
  const item=samples[Number($('sampleSelect').value)];
  if(!item)return;
  try {
    const response=await fetch(`./samples/${item.file}`);
    if(!response.ok)throw Error('Не удалось загрузить файл из набора');
    await loadBlob(await response.blob(),item.title);
  } catch(error) {status('Ошибка тестового изображения: '+error.message,'error');}
}
async function process() {
  if(!state.gray) {status('Сначала загрузите изображение.','error');return;}
  if(state.busy)return;
  state.busy=true;$('processBtn').disabled=true;$('downloadBtn').disabled=true;
  const version=state.version, mode=$('mode').value, params=options(), local=LOCAL_METHODS.has(mode);
  const requested=$('threads').value;
  let count=local ? (requested==='auto'
    ? (state.width*state.height >= 1_000_000 ? Math.min(4,Math.max(2,(navigator.hardwareConcurrency||4)-1)):1)
    : Number(requested)) : 1;
  count=Math.min(count,state.height);const started=performance.now();
  try {
    const jobs=[];
    for(let i=0;i<count;i++){
      const startRow=Math.floor(i*state.height/count),endRow=Math.floor((i+1)*state.height/count);
      if(startRow!==endRow)jobs.push(workerJob(mode,params,startRow,endRow,version));
    }
    status(`Обработка в ${jobs.length} рабоч${jobs.length===1?'ем потоке':'их потоках'}…`,'busy');
    const results=await Promise.all(jobs);
    if(version!==state.version)return;
    const after=new Uint8ClampedArray(state.width*state.height);
    for(const result of results)after.set(new Uint8ClampedArray(result.grayBuffer), result.startRow*state.width);
    state.result=after;
    drawImage($('afterCanvas'),grayToRgba(after),state.width,state.height);
    renderHistogram(state.gray,after);renderStats(state.gray,after);
    $('elapsed').textContent=`${(performance.now()-started).toFixed(1)} мс`;
    const meta=results[0]?.info||{};
    $('thresholdInfo').textContent=mode==='otsu'?`T = ${meta.threshold}`
      : local?`${params.windowSize}×${params.windowSize} · ${jobs.length} пот.`
      : mode==='clahe'?`${params.tiles}×${params.tiles}`
      : `${meta.low}…${meta.high}`;
    $('downloadBtn').disabled=false;
    status(`Готово. ${jobs.length} рабоч${jobs.length===1?'ий поток':'их потока'}. Гистограммы построены.`, 'ready');
  } catch(err) {if(version===state.version)status('Ошибка обработки: '+err.message,'error');}
  finally {if(version===state.version){state.busy=false;$('processBtn').disabled=false;}}
}
function saveResult() {
  if(!state.result)return;
  $('afterCanvas').toBlob(blob=>{
    if(!blob){status('Не удалось сохранить PNG','error');return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`lab3_${$('mode').value}_${state.width}x${state.height}.png`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
}
async function loadProtocol() {
  const host=$('protocolContent');
  try {
    const response=await fetch('./report/protocol.json');
    if(!response.ok)throw Error('Протокол не найден');
    const data=await response.json();
    host.replaceChildren();
    const intro=document.createElement('p');intro.className='muted';
    intro.textContent='Числа вычислены JavaScript-алгоритмами из этого проекта на исходных PNG. F1 использует заранее заданную эталонную маску текста.';
    intro.style.marginBottom='12px';host.append(intro);
    const table=document.createElement('table');table.className='protocol-table';
    const thead=document.createElement('thead');const headings=['Изображение','Метод и параметры','Цель','Фактическое наблюдение'];
    const hr=document.createElement('tr');for (const name of headings){const th=document.createElement('th');th.textContent=name;hr.append(th);}thead.append(hr);table.append(thead);
    const tbody=document.createElement('tbody');for(const item of data){
      const tr=document.createElement('tr');for(const key of ['image','method','purpose','result']){
        const td=document.createElement('td');td.textContent=item[key];tr.append(td);
      }tbody.append(tr);
    }table.append(tbody);host.append(table);
  } catch(err) {host.textContent='Не удалось открыть протокол: '+err.message;}
}
async function runTests() {
  const button=$('runTests');button.disabled=true;
  const host=$('testResults');host.textContent='Выполняются контрольные вычисления…';
  try {
    const {selfTests}=await import('./tests/self-tests.js');
    const results=selfTests(),passed=results.filter(x=>x.ok).length;
    host.replaceChildren();
    const title=document.createElement('b');title.textContent=`${passed} из ${results.length} проверок пройдено`;
    host.append(title,document.createElement('br'));
    for(const r of results){const line=document.createElement('div');line.className=r.ok?'pass':'fail';line.textContent=`${r.ok?'✓':'✕'} ${r.name}${r.error?' — '+r.error:''}`;host.append(line);}
  } catch(error) {host.textContent='Не удалось выполнить тесты: '+error.message;}
  finally {button.disabled=false;}
}
function init() {
  for(const [i,sample] of samples.entries()){
    const opt=document.createElement('option');opt.value=String(i);opt.textContent=sample.title;
    $('sampleSelect').append(opt);
  }
  $('sampleSelect').addEventListener('change',loadSelected);
  $('fileInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)loadBlob(f,f.name);e.target.value='';});
  $('resetBtn').addEventListener('click',()=>{cancelWorkers();$('fileInput').value='';$('sampleSelect').value='0';$('mode').value='linear';$('windowSize').value=21;$('lowPercent').value=2;$('highPercent').value=98;$('tilesRange').value=8;$('clipRange').value=2;$('threads').value='auto';updateControls();loadSelected();});
  const drop=$('dropZone');
  drop.addEventListener('click',()=>$('fileInput').click());
  drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click();}});
  for(const type of ['dragover','dragenter'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragover');});
  for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragover');});
  drop.addEventListener('drop',e=>{const file=e.dataTransfer?.files?.[0];if(file)loadBlob(file,file.name);});
  $('mode').addEventListener('change',()=>{updateControls();if(state.gray)resetProcessed();});
  for(const control of document.querySelectorAll('input[type=range], select#borderMode, select#threads')) control.addEventListener('input',updateLabels);
  $('processBtn').addEventListener('click',process);
  $('downloadBtn').addEventListener('click',saveResult);
  $('runTests').addEventListener('click',runTests);
  $('protocolPanel').addEventListener('toggle',e=>{if(e.target.open && !e.target.dataset.loaded){e.target.dataset.loaded='1';loadProtocol();}});
  updateControls();loadSelected();
}
init();
