import {PixelBuffer} from './pixel-buffer.js';
import {imageStatistics,luminanceHistogram} from './algorithms.js';
import {runProcessing} from './parallel.js';
import {categories,methodMap,samples} from './config.js';

const $=id=>document.getElementById(id);
let original=null,processed=null,currentFile='contrast_low.png',busy=false,selectedSample='contrast_low.png';
const methodSelect=$('method'),paramContainer=$('params'),resultCanvas=$('result'),originalCanvas=$('original'),auxCanvas=$('aux');

function init(){
  for(const cat of categories){
    const group=document.createElement('optgroup');group.label=cat.name;
    for(const method of cat.methods){const opt=document.createElement('option');opt.value=method.id;opt.textContent=method.title;group.appendChild(opt);}
    methodSelect.appendChild(group);
  }
  methodSelect.value='contrast';
  methodSelect.addEventListener('change',()=>{renderParameters();clearResult();});
  $('border').addEventListener('change',clearResult);
  $('workers').addEventListener('change',clearResult);
  $('run').addEventListener('click',run);
  $('restore').addEventListener('click',clearResult);
  $('download').addEventListener('click',download);
  $('upload').addEventListener('change',event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!file.type.startsWith('image/')){setStatus('Выберите изображение (PNG, JPG, WEBP, BMP или GIF).',true);return;}
    const url=URL.createObjectURL(file);
    loadImage(url,file.name,'').finally(()=>URL.revokeObjectURL(url));
  });
  document.body.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});
  document.body.addEventListener('drop',e=>{
    if(e.dataTransfer?.files?.length){e.preventDefault();const f=e.dataTransfer.files[0];if(f.type.startsWith('image/')){const url=URL.createObjectURL(f);loadImage(url,f.name,'').finally(()=>URL.revokeObjectURL(url));}}
  });
  renderSamples();renderParameters();loadSample(samples[0]);
}
function renderParameters(){
  const selected=methodMap.get(methodSelect.value);
  $('method-tag').textContent=selected.category;
  $('method-hint').textContent=selected.hint;
  $('method-explain').textContent=selected.explain;
  paramContainer.replaceChildren();
  for(const spec of selected.params??[]){
    const div=document.createElement('div');div.className='param-group';
    const id='option-'+spec.key;
    if(spec.type==='range'){
      const row=document.createElement('div');row.className='param-row';
      const label=document.createElement('label');label.htmlFor=id;label.textContent=spec.label;
      const display=document.createElement('output');display.htmlFor=id;
      const v=document.createElement('input');Object.assign(v,{id,type:'range',min:spec.min,max:spec.max,step:spec.step,value:spec.value});v.dataset.param=spec.key;
      const current=()=>{display.value=Number(v.value).toLocaleString('ru-RU',{maximumFractionDigits:3})+(spec.unit||'');};
      v.addEventListener('input',()=>{current();clearResult();});current();row.append(label,display);
      const ends=document.createElement('div');ends.className='param-minmax';ends.innerHTML=`<span>${spec.min}</span><span>${spec.max}</span>`;
      div.append(row,v,ends);
    }else{
      const label=document.createElement('label');label.className='field-label';label.htmlFor=id;label.textContent=spec.label;
      const input=document.createElement('select');input.className='field-select';input.id=id;input.dataset.param=spec.key;
      for(const [value,name]of spec.choices){const option=document.createElement('option');option.value=value;option.textContent=name;input.append(option);}
      input.value=spec.value;input.addEventListener('change',clearResult);div.append(label,input);
    }
    paramContainer.appendChild(div);
  }
}
function renderSamples(){
  const grid=$('samples');
  for(const s of samples){
    const button=document.createElement('button');button.className='sample-card';button.type='button';button.dataset.file=s.file;
    const image=document.createElement('img');image.className='thumb';image.src=`assets/tests/${s.file}`;image.alt=s.title;image.loading='lazy';
    const body=document.createElement('span');body.className='sample-body';
    const title=document.createElement('span');title.className='sample-title';title.textContent=s.title;
    const note=document.createElement('span');note.className='sample-caption';note.textContent=s.note;
    body.append(title,note);button.append(image,body);
    button.addEventListener('click',()=>loadSample(s));grid.append(button);
  }
}
function setStatus(text,error=false){$('status').textContent=text;$('status').className='status '+(error?'error':'success');}
function markSample(){for(const el of document.querySelectorAll('.sample-card'))el.classList.toggle('active',el.dataset.file===selectedSample);}
async function loadSample(sample){
  selectedSample=sample.file;currentFile=sample.file;
  markSample();methodSelect.value=sample.method;renderParameters();
  await loadImage(`assets/tests/${sample.file}`,sample.file,sample.file);
  // Preserve the explicit user action of choosing an example without auto-overwriting the result.
}
async function loadImage(url,filename,sampleFile){
  if(busy){setStatus('Обработка выполняется. Дождитесь завершения.',true);return;}
  try{
    setStatus('Загрузка изображения…');
    const img=await new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Невозможно загрузить изображение.'));
      image.src=url;
    });
    if(img.naturalWidth*img.naturalHeight>32_000_000)throw Error('Разрешение больше 32 Мп. Выберите изображение меньшего размера.');
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    original=PixelBuffer.fromImageData(pixels);currentFile=filename;selectedSample=sampleFile;markSample();
    drawBuffer(original,originalCanvas);$('original-placeholder').hidden=true;
    $('image-size').textContent=`${original.width} × ${original.height} px`;
    clearResult();setStatus(`Загружено: ${filename} (${original.width} × ${original.height}).`);
  }catch(error){setStatus(`Ошибка: ${error.message}`,true);}
}
function drawBuffer(buffer,canvas){
  canvas.width=buffer.width;canvas.height=buffer.height;
  const context=canvas.getContext('2d');
  const imageData=new ImageData(new Uint8ClampedArray(buffer.data),buffer.width,buffer.height);
  context.putImageData(imageData,0,0);
}
function clearResult(){
  processed=null;resultCanvas.width=1;resultCanvas.height=1;
  $('result-placeholder').hidden=false;$('aux-card').hidden=true;
  $('download').disabled=true;$('restore').disabled=!original;
  $('elapsed').textContent='Параметры изменены — запустите обработку';
  $('extra-metrics').textContent='Энтропия не является универсальной мерой качества. Сравнивайте характеристики с учётом задачи.';
  updateHistograms(original,null);updateMetrics(original,null);
}
function showProgress(done){
  $('progress-wrap').hidden=done;
  if(done)return;
  $('progress').value=0;$('progress-percent').textContent='0%';$('progress-status').textContent='Вычисление в Web Workers…';
}
async function run(){
  if(!original||busy)return;
  const chosen=methodMap.get(methodSelect.value),options={method:chosen.id,border:$('border').value};
  for(const e of paramContainer.querySelectorAll('[data-param]'))options[e.dataset.param]=e.type==='range'?Number(e.value):e.value;
  const threads=Number($('workers').value);
  busy=true;$('run').disabled=true;$('download').disabled=true;showProgress(false);setStatus('Обработка выполняется в фоновом потоке…');
  try{
    const result=await runProcessing(original,options,threads,fraction=>{
      $('progress').value=Math.round(fraction*100);$('progress-percent').textContent=`${Math.round(fraction*100)}%`;
    });
    processed=result.image;drawBuffer(processed,resultCanvas);$('result-placeholder').hidden=true;
    if(result.aux){drawBuffer(result.aux,auxCanvas);$('aux-card').hidden=false;}else $('aux-card').hidden=true;
    updateHistograms(original,processed);updateMetrics(original,processed,result.meta);
    $('elapsed').textContent=`${result.elapsed.toFixed(0)} мс (включая запуск потоков) · ${result.workerCount} Web Worker`;
    $('download').disabled=false;
    let details='';
    if(Number.isFinite(result.meta.threshold))details+=` Порог: ${Number(result.meta.threshold).toFixed(1)}.`;
    if(Number.isFinite(result.meta.lineCount))details+=` Найдено прямых: ${result.meta.lineCount}.`;
    if(Number.isFinite(result.meta.edgePixels))details+=` Пикселей границы: ${result.meta.edgePixels}.`;
    setStatus(`Готово: ${chosen.title}.${details}`);
  }catch(error){setStatus(`Ошибка обработки: ${error.message}`,true);console.error(error);}finally{
    busy=false;$('run').disabled=false;showProgress(true);
  }
}
function download(){
  if(!processed)return;
  resultCanvas.toBlob(blob=>{
    if(!blob){setStatus('Не удалось создать PNG.',true);return;}
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.download=`${currentFile.replace(/\.[^.]+$/,'')}_${methodSelect.value}.png`;anchor.href=url;
    document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
}
function plotHistogram(canvas,data,maximum,color){
  const {width:w,height:h}=canvas,ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#0b1521';ctx.fillRect(0,0,w,h);
  const ml=31,mr=13,mt=13,mb=27,gw=w-ml-mr,gh=h-mt-mb;
  ctx.strokeStyle='#27384a';ctx.lineWidth=1;ctx.font='11px system-ui';ctx.textAlign='right';ctx.fillStyle='#8198a9';
  for(let i=0;i<=4;i++){
    const y=mt+gh*i/4;ctx.beginPath();ctx.moveTo(ml,y);ctx.lineTo(ml+gw,y);ctx.stroke();
    ctx.fillText(`${Math.round(maximum*(4-i)/4)}`,ml-7,y+3);
  }
  ctx.textAlign='center';for(const x of [0,64,128,192,255]){
    const px=ml+gw*x/255;ctx.fillText(x,px,h-8);
  }
  ctx.globalAlpha=.86;ctx.fillStyle=color;
  for(let i=0;i<256;i++){
    const bar=Math.max(0,data[i]/Math.max(1,maximum)*gh);
    ctx.fillRect(ml+i*gw/256,mt+gh-bar,Math.max(1.15,gw/256-.13),bar);
  }
  ctx.globalAlpha=1;
}
function updateHistograms(a,b){
  const histA=a?luminanceHistogram(a):new Array(256).fill(0);
  const histB=b?luminanceHistogram(b):new Array(256).fill(0);
  const maximum=Math.max(1,...histA,...histB);
  plotHistogram($('hist-before'),histA,maximum,'#62ddc7');plotHistogram($('hist-after'),histB,maximum,'#f8ab78');
}
function updateMetrics(a,b,extra={}){
  const rows=[['Средняя яркость', 'mean', 1, ''],['Среднекв. отклонение', 'sd', 1, ''],['Энтропия, бит', 'entropy', 2, ''],['Диапазон P5–P95', 'range', 0, ''],['Доля тёмных пикселей', 'blackPercent', 1, '%']];
  const sa=a?imageStatistics(a):null,sb=b?imageStatistics(b):null;
  const tbody=$('metrics');tbody.replaceChildren();
  if(!sa){const tr=document.createElement('tr');tr.innerHTML='<td colspan="4">Загрузите изображение.</td>';tbody.append(tr);return;}
  for(const [name,key,decimals,suffix] of rows){
    const tr=document.createElement('tr'),left=document.createElement('td');left.textContent=name;tr.append(left);
    const format=n=>Number(n).toFixed(decimals).replace('.',',')+suffix;
    const before=document.createElement('td');before.textContent=format(sa[key]);tr.append(before);
    const after=document.createElement('td');after.textContent=sb?format(sb[key]):'—';tr.append(after);
    const delta=document.createElement('td');const change=sb?sb[key]-sa[key]:null;
    delta.textContent=change===null?'—':(change>0?'+':'')+format(change);
    if(change!==null)delta.className=change>=0?'delta-pos':'delta-neg';
    tr.append(delta);tbody.append(tr);
  }
  const items=[];
  if(Number.isFinite(extra.threshold))items.push(`Найденный порог: ${extra.threshold.toFixed(2)}.`);
  if(Number.isFinite(extra.variance))items.push(`Межклассовая дисперсия Оцу: ${extra.variance.toFixed(2)}.`);
  if(Number.isFinite(extra.iterations))items.push(`Итераций: ${extra.iterations}.`);
  if(Number.isFinite(extra.lower))items.push(`Опорный диапазон растяжения: [${extra.lower}; ${extra.upper}].`);
  if(Number.isFinite(extra.lineCount))items.push(`Линий Хафа: ${extra.lineCount}.`);
  if(Number.isFinite(extra.subpixelMeanAbsoluteOffset))items.push(`Среднее |субпиксельного смещения|: ${extra.subpixelMeanAbsoluteOffset.toFixed(3)} пикс.`);
  $('extra-metrics').textContent=items.join(' ')||'Рост энтропии не всегда означает улучшение: фильтрация шума может уменьшить энтропию и одновременно повысить полезность изображения.';
}
init();
