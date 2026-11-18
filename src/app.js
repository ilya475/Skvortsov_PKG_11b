import {RasterEngine as R} from './raster-engine.js';
import {VirtualGrid} from './virtual-grid.js';
import {GridPainter} from './grid-painter.js';

const el=id=>document.getElementById(id);
const grid=new VirtualGrid(43,43);
const painter=new GridPainter(el('raster'));
const labels={step:'Пошаговый алгоритм',dda:'ЦДА / DDA',bres:'Брезенхем · отрезок',circle:'Брезенхем · окружность',wu:'Ву (Wu) · сглаживание',ellipse:'Кастл–Питвей · эллипс',parabola:'Кастл–Питвей · параболическая дуга'};
let active='bres',currentTrace=[],stepIndex=-1,stepTimer=null,currentArgs=null,latestBenchmark=null,octantIndex=0;
const lineTypes=new Set(['step','dda','bres','wu']);
const lineInputs=['x0','y0','x1','y1'];
const pointsFor=step => [step.x,step.y];

function integer(id,lower=-2000,upper=2000) {
  const raw=el(id).value.trim(), n=Number(raw);
  if(!raw||!Number.isInteger(n)||n<lower||n>upper)throw Error(`Поле «${id}»: нужно целое число от ${lower} до ${upper}.`);
  return n;
}
function readArgs() {
  if(lineTypes.has(active))return lineInputs.map(id=>integer(id));
  if(active==='circle')return [integer('circle-x'),integer('circle-y'),integer('radius',0,500)];
  if(active==='ellipse')return [integer('ellipse-x'),integer('ellipse-y'),integer('ellipse-a',1,300),integer('ellipse-b',1,300),integer('ellipse-angle',0,360)];
  return ['para-x0','para-y0','para-xc','para-yc','para-x1','para-y1'].map(id=>integer(id));
}
function stopAnimation(){if(stepTimer!==null){clearInterval(stepTimer);stepTimer=null;}el('play-steps').textContent='▶ Анимация';}
function selectAlgo(name) {
  active=name;stopAnimation();
  document.querySelectorAll('.algo-btn').forEach(b=>{b.classList.toggle('selected',b.dataset.algo===name); b.setAttribute('aria-pressed',String(b.dataset.algo===name));});
  el('active-title').textContent=labels[name];
  el('line-fields').classList.toggle('hidden',!lineTypes.has(name));
  el('circle-fields').classList.toggle('hidden',name!=='circle');
  el('ellipse-fields').classList.toggle('hidden',name!=='ellipse');
  el('parabola-fields').classList.toggle('hidden',name!=='parabola');
  draw();
}
function getOctant(dx,dy) {
  if(dx===0&&dy===0)return 'точка';
  const a=(Math.atan2(dy,dx)+2*Math.PI)%(2*Math.PI);
  return String(Math.floor(a/(Math.PI/4))+1)+' / 8';
}
function ellipsePoints(args){
  const [cx,cy,a,b,angle]=args,t=angle*Math.PI/180;
  // Quantize conjugate diameters to the integer lattice; pure kernel
  // does not use sin/cos or floating-point after this initialization.
  const px=Math.round(a*Math.cos(t)),py=Math.round(a*Math.sin(t));
  const qx=Math.round(-b*Math.sin(t)),qy=Math.round(b*Math.cos(t));
  return [cx,cy,cx+px,cy+py,cx+qx,cy+qy];
}
function renderKernel(args,target,trace=null){
  switch(active){
    case 'step': R.stepLine(...args,target,trace);break;
    case 'dda': R.ddaLine(...args,target,trace);break;
    case 'bres': R.bresenhamLine(...args,target,trace);break;
    case 'circle': R.bresenhamCircle(...args,target,trace);break;
    case 'wu': R.wuLine(...args,target,trace);break;
    case 'ellipse': return R.pittewayEllipse(...ellipsePoints(args),target,trace);
    case 'parabola': return R.pittewayParabola(...args,target,trace);
  }
  return {completed:true};
}
function draw(){
  stopAnimation();
  try {
    const args=readArgs();
    if(lineTypes.has(active)&&Math.max(Math.abs(args[2]-args[0]),Math.abs(args[3]-args[1]))>2000)throw Error('Отрезок слишком длинный для интерактивного просмотра (максимум 2000 шагов).');
    grid.clear();currentTrace=[];currentArgs=args;
    const result=renderKernel(args,grid,currentTrace);
    stepIndex=-1;
    el('input-error').textContent=result?.completed===false?`Крайний случай коники: ${result.reason}. Измените параметры для корректного построения.`:(result?.connector?'Конец дуги дополнен соединительным отрезком.':'');
    updateView();
  }catch(e){el('input-error').textContent=e.message;grid.clear();currentTrace=[];currentArgs=null;stepIndex=-1;updateView();}
}
function drawIncrement(step) {
  if(active==='circle'){
    const [cx,cy]=currentArgs,x=step.x,y=step.y;
    for(const [a,b] of [[x,y],[-x,y],[x,-y],[-x,-y],[y,x],[-y,x],[y,-x],[-y,-x]])grid.setPixel(cx+a,cy+b);
  } else if(active==='wu') {
    if(step.steep) {grid.setPixel(step.y,step.x,step.a1); if(step.a2>1e-12)grid.setPixel(step.y+1,step.x,step.a2);}
    else {grid.setPixel(step.x,step.y,step.a1);if(step.a2>1e-12)grid.setPixel(step.x,step.y+1,step.a2);}
  } else grid.setPixel(step.x,step.y);
}
function drawStepFrame(){
  if(!currentArgs)return;
  grid.clear();
  for(let i=0;i<=stepIndex;i++)drawIncrement(currentTrace[i]);
  updateView();
}
function updateView(){
  const zoom=Number(el('zoom').value);
  el('zoom-value').textContent=`${zoom} px`;
  painter.render(grid,zoom,{axes:el('show-axes').checked,grid:el('show-grid').checked});
  el('pixel-count').textContent=grid.pixelCount().toLocaleString('ru-RU');
  el('pixel-writes').textContent=grid.writes.toLocaleString('ru-RU');
  el('step-count').textContent=currentTrace.length.toLocaleString('ru-RU');
  el('octant-info').textContent=lineTypes.has(active)&&currentArgs?getOctant(currentArgs[2]-currentArgs[0],currentArgs[3]-currentArgs[1]):'8 / 8';
  updateSteps();
}
function fmt(n){return Number(n).toFixed(3).replace(/\.000$/,'').replace(/0+$/,'').replace(/\.$/,'');}
function describe(s){
  if(!s)return 'Построение ещё не выполнено.';
  switch(active){
    case 'step':return `Точка k=${s.k}: t=${fmt(s.t)}, округление координат → (${s.x}, ${s.y}).`;
    case 'dda':return `Шаг ${s.k}: вещественные координаты (${fmt(s.xf)}, ${fmt(s.yf)}) → пиксель (${s.x}, ${s.y}).`;
    case 'bres':return `Шаг ${s.k}: e=${s.err}, удвоенная ошибка 2e=${s.e2}; решение о сдвиге принимается без деления.`;
    case 'circle':return `Итерация ${s.k}: точка октанта (${s.x}, ${s.y}), решающий параметр d=${s.d}; отражение даёт до 8 пикселей.`;
    case 'wu':return `Основная ось ${s.x}: идеальная координата ${fmt(s.yf)}, α₀=${fmt(s.a1)}, α₁=${fmt(s.a2)} (сумма 1).`;
    default:return `Коника: шаг ${s.k}, октант ${s.octant}, d=${fmt(s.d)}, u=${fmt(s.u)}, v=${fmt(s.v)}; пиксель (${s.x}, ${s.y}).`;
  }
}
function updateSteps(){
  const total=currentTrace.length;
  el('steps-progress-fill').style.width=total?(stepIndex<0?'100%':`${100*(stepIndex+1)/total}%`):'0%';
  const s=stepIndex>=0?currentTrace[stepIndex]:currentTrace[0];
  el('step-explain').textContent=total?(stepIndex<0?`Построены все ${total} шагов. Пример первого: ${describe(s)}`:`${stepIndex+1} / ${total}: ${describe(s)}`):'Измените параметры или выберите алгоритм.';
  const headers=el('steps-headers');
  if(active==='wu')headers.innerHTML='<th>k</th><th>x</th><th>y</th><th>α верх</th><th>α низ</th>';
  else if(active==='ellipse'||active==='parabola')headers.innerHTML='<th>k</th><th>x</th><th>y</th><th>Октант</th><th>d</th>';
  else headers.innerHTML='<th>k</th><th>x</th><th>y</th><th>e / d / t</th>';
  el('steps-tbody').innerHTML=currentTrace.slice(0,12).map((s,i)=>{
    let cells;
    if(active==='wu')cells=[i,s.x,s.y,fmt(s.a1),fmt(s.a2)];
    else if(active==='ellipse'||active==='parabola')cells=[i,s.x,s.y,s.octant,fmt(s.d)];
    else cells=[i,s.x,s.y,fmt(s.err??s.d??s.xf??s.t??0)];
    return `<tr ${i===stepIndex?'class="active"':''}>${cells.map(v=>`<td>${v}</td>`).join('')}</tr>`;
  }).join('')||'<tr><td colspan="5">Нет данных.</td></tr>';
}
function setStep(k){stopAnimation();if(!currentTrace.length)return;stepIndex=Math.max(0,Math.min(currentTrace.length-1,k));drawStepFrame();}
function startAnimation(){
  if(stepTimer!==null){stopAnimation();return;}
  if(!currentTrace.length)return;
  if(stepIndex>=currentTrace.length-1)stepIndex=-1;
  el('play-steps').textContent='Ⅱ Пауза';
  stepTimer=setInterval(()=>{
    if(stepIndex>=currentTrace.length-1){stopAnimation();return;}
    stepIndex++;drawStepFrame();
    if(stepIndex>=currentTrace.length-1)stopAnimation();
  },Math.max(45,Math.min(300,2800/currentTrace.length)));
}
function showAll(){stopAnimation();if(!currentArgs)return;grid.clear();renderKernel(currentArgs,grid);stepIndex=-1;updateView();}

function plotChart(id,xValues,series,xLabel='Количество',yLabel='Время, мс'){
  const target=el(id);if(!xValues?.length)return;
  const W=560,H=240,p={l:48,r:14,t:15,b:46};
  const X0=Math.min(...xValues),X1=Math.max(...xValues),maxY=Math.max(1,...series.flatMap(s=>s.ys))*1.16;
  const xx=n=>p.l+(n-X0)/Math.max(1,X1-X0)*(W-p.l-p.r);
  const yy=n=>H-p.b-(n/maxY)*(H-p.t-p.b);
  const t=[];
  t.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${yLabel} в зависимости от ${xLabel}">`);
  for(let i=0;i<=4;i++){
    const yv=maxY*i/4, y=yy(yv);
    t.push(`<line x1="${p.l}" y1="${y}" x2="${W-p.r}" y2="${y}" stroke="#35445b" stroke-width="1"/>`);
    t.push(`<text x="${p.l-7}" y="${y+4}" text-anchor="end" font-size="11" fill="#9cb0c6">${yv.toFixed(0)}</text>`);
  }
  xValues.forEach(xv=>t.push(`<text x="${xx(xv)}" y="${H-25}" text-anchor="middle" font-size="11" fill="#9cb0c6">${xv>=1000?`${xv/1000}k`:xv}</text>`));
  series.forEach((s,ind)=>{
    const color=ind===0?'#57d7d3':'#f6c08a';
    t.push(`<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${xValues.map((x,i)=>`${xx(x)},${yy(s.ys[i])}`).join(' ')}"/>`);
    xValues.forEach((x,i)=>t.push(`<circle cx="${xx(x)}" cy="${yy(s.ys[i])}" r="3.5" fill="${color}" stroke="#111c2d" stroke-width="2"/>`));
    t.push(`<circle cx="${p.l+ind*140}" cy="${H-8}" r="4" fill="${color}"/><text x="${p.l+10+ind*140}" y="${H-4}" font-size="10" fill="#cbdce9">${s.label}</text>`);
  });
  t.push('</svg>');target.innerHTML=t.join('');
}
function updateBenchmark(data){
  latestBenchmark=data;
  el('export-btn').disabled=false;
  el('bench-tbody').innerHTML=data.full.map(row=>`<tr><td>${row.label}</td><td>${row.count.toLocaleString('ru-RU')}</td><td>${row.ms.toFixed(2)} мс</td><td>${row.throughput.toLocaleString('ru-RU')}</td></tr>`).join('');
  const ns=[...new Set(data.countSeries.map(d=>d.n))];
  plotChart('count-chart',ns,['dda','bres'].map(id=>({label:id==='dda'?'ЦДА':'Брезенхем',ys:ns.map(n=>data.countSeries.find(v=>v.n===n&&v.method===id)?.ms??0)})));
  const lengths=[...new Set(data.lengthSeries.map(d=>d.length))];
  plotChart('length-chart',lengths,['dda','bres'].map(id=>({label:id==='dda'?'ЦДА':'Брезенхем',ys:lengths.map(n=>data.lengthSeries.find(v=>v.length===n&&v.method===id)?.ms??0)})));
  plotChart('circle-chart',data.circleCountSeries.map(d=>d.n),[{label:'Окружности',ys:data.circleCountSeries.map(d=>d.ms)}]);
  const lineD=data.full.find(v=>v.id==='dda'),lineB=data.full.find(v=>v.id==='bres');
  const ratio=(lineD.ms/lineB.ms).toFixed(2);
  el('bench-status').textContent=`Тест завершён. На вашем устройстве отношение времени ЦДА / Брезенхем = ${ratio}×. Дата: ${new Date(data.date).toLocaleString('ru-RU')}. Результаты относятся только к этому запуску и окружению.`;
}
function benchmark(){
  const button=el('benchmark-btn');button.disabled=true;
  el('bench-status').textContent='Worker запущен: разогрев и 3 повтора на метод. Это может занять некоторое время.';
  const worker=new Worker(new URL('./benchmark.worker.js',import.meta.url),{type:'module'});
  worker.addEventListener('message',event=>{
    const {type,message,result}=event.data;
    if(type==='progress')el('bench-status').textContent=message;
    else if(type==='done'){updateBenchmark(result);button.disabled=false;worker.terminate();}
    else if(type==='error'){el('bench-status').textContent=`Ошибка теста: ${message}`;button.disabled=false;worker.terminate();}
  });
  worker.addEventListener('error',e=>{button.disabled=false;el('bench-status').textContent=`Не удалось запустить Worker: ${e.message}. Запускайте приложение через HTTP-сервер, а не file://`;worker.terminate();});
  worker.postMessage({type:'run'});
}
function exportCsv(){
  if(!latestBenchmark)return;
  const rows=[['algorithm','primitives','median_ms','primitives_per_second'],...latestBenchmark.full.map(v=>[v.id,v.count,v.ms,v.throughput])];
  rows.push([],['dataset','x','method','median_ms']);
  for(const d of latestBenchmark.countSeries)rows.push(['count',d.n,d.method,d.ms]);
  for(const d of latestBenchmark.lengthSeries)rows.push(['length',d.length,d.method,d.ms]);
  for(const d of latestBenchmark.circleCountSeries)rows.push(['circles',d.n,'circle',d.ms]);
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lab4_benchmark.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
document.querySelectorAll('.algo-btn').forEach(b=>b.addEventListener('click',()=>selectAlgo(b.dataset.algo)));
el('draw-btn').addEventListener('click',draw);
el('zoom').addEventListener('input',updateView);
el('show-grid').addEventListener('change',updateView);
el('show-axes').addEventListener('change',updateView);
el('prev-step').addEventListener('click',()=>setStep(stepIndex<0?currentTrace.length-2:stepIndex-1));
el('next-step').addEventListener('click',()=>setStep(stepIndex<0?0:stepIndex+1));
el('play-steps').addEventListener('click',startAnimation);
el('full-render').addEventListener('click',showAll);
el('clear-btn').addEventListener('click',()=>{stopAnimation();grid.clear();currentTrace=[];stepIndex=-1;currentArgs=null;updateView()});
el('octant-btn').addEventListener('click',()=>{
  const dirs=[[15,6],[6,15],[-6,15],[-15,6],[-15,-6],[-6,-15],[6,-15],[15,-6]];
  const [dx,dy]=dirs[octantIndex];octantIndex=(octantIndex+1)%8;
  el('x0').value=0;el('y0').value=0;el('x1').value=dx;el('y1').value=dy;draw();
});
el('raster').addEventListener('click',event=>{
  if(!lineTypes.has(active))return;
  const rect=event.currentTarget.getBoundingClientRect(),cell=Number(el('zoom').value);
  const x=Math.floor((event.clientX-rect.left)/rect.width*grid.width)-grid.originX;
  const y=grid.originY-Math.floor((event.clientY-rect.top)/rect.height*grid.height);
  // Alternating click selects end then start, like an interactive ruler.
  if(!el('raster').dataset.firstClick || el('raster').dataset.firstClick==='0') {
    el('x0').value=x;el('y0').value=y;el('raster').dataset.firstClick='1';
  } else {el('x1').value=x;el('y1').value=y;el('raster').dataset.firstClick='0';}
  draw();
});
el('benchmark-btn').addEventListener('click',benchmark);
el('export-btn').addEventListener('click',exportCsv);
selectAlgo(active);
