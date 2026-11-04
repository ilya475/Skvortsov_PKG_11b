/* RasterLab — лабораторная работа №4.
   Все алгоритмы записывают значения в виртуальный растр. Canvas используется
   только для отображения уже сформированного массива. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const W = 401, H = 301, CENTER_X = Math.floor(W/2), CENTER_Y = Math.floor(H/2);
let grid = new Float32Array(W*H), lastPoints = [], currentAlgo = "bres";
let scale = 12, panX = 0, panY = 0;
const idx = (x,y) => y*W+x;
function setPixel(x,y,a=1,target=grid) {
  x=Math.round(x); y=Math.round(y);
  if(x<0||y<0||x>=W||y>=H) return;
  const i=idx(x,y); target[i]=Math.max(target[i],Math.min(1,a));
}
function clearGrid(){grid.fill(0); lastPoints=[]; draw();}
function plotLineStep(x0,y0,x1,y1,target=grid){
  const dx=x1-x0,dy=y1-y0,n=Math.max(Math.abs(dx),Math.abs(dy));
  if(n===0){setPixel(x0,y0,1,target);return;}
  for(let i=0;i<=n;i++) setPixel(Math.round(x0+dx*i/n),Math.round(y0+dy*i/n),1,target);
}
function plotDDA(x0,y0,x1,y1,target=grid){
  const dx=x1-x0,dy=y1-y0,n=Math.max(Math.abs(dx),Math.abs(dy));
  if(n===0){setPixel(x0,y0,1,target);return;}
  const sx=dx/n,sy=dy/n; let x=x0,y=y0;
  for(let i=0;i<=n;i++){setPixel(Math.round(x),Math.round(y),1,target);x+=sx;y+=sy;}
}
function plotBres(x0,y0,x1,y1,target=grid){
  let dx=Math.abs(x1-x0), sx=x0<x1?1:-1, dy=-Math.abs(y1-y0), sy=y0<y1?1:-1;
  let err=dx+dy;
  while(true){setPixel(x0,y0,1,target);if(x0===x1&&y0===y1)break;
    const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
}
function plotCircle(cx,cy,r,target=grid){
  let x=0,y=r,d=3-2*r;
  while(y>=x){
    setPixel(cx+x,cy+y,1,target);setPixel(cx-x,cy+y,1,target);
    setPixel(cx+x,cy-y,1,target);setPixel(cx-x,cy-y,1,target);
    setPixel(cx+y,cy+x,1,target);setPixel(cx-y,cy+x,1,target);
    setPixel(cx+y,cy-x,1,target);setPixel(cx-y,cy-x,1,target);
    x++; if(d>0){y--;d+=4*(x-y)+10;}else d+=4*x+6;
  }
}
// Wu: две соседние точки получают интенсивности, сумма равна 1.
const ipart=x=>Math.floor(x), fpart=x=>x-Math.floor(x), rfpart=x=>1-fpart(x);
function plotWu(x0,y0,x1,y1,target=grid){
  let steep=Math.abs(y1-y0)>Math.abs(x1-x0);
  if(steep){[x0,y0]=[y0,x0];[x1,y1]=[y1,x1];}
  if(x0>x1){[x0,x1]=[x1,x0];[y0,y1]=[y1,y0];}
  const dx=x1-x0,dy=y1-y0,gradient=dx===0?1:dy/dx;
  let xend=Math.round(x0),yend=y0+gradient*(xend-x0),xgap=rfpart(x0+0.5);
  let xpxl1=xend,ypxl1=ipart(yend);
  const put=(x,y,a)=>steep?setPixel(y,x,a,target):setPixel(x,y,a,target);
  put(xpxl1,ypxl1,rfpart(yend)*xgap);put(xpxl1,ypxl1+1,fpart(yend)*xgap);
  let intery=yend+gradient;
  xend=Math.round(x1);yend=y1+gradient*(xend-x1);xgap=fpart(x1+0.5);
  const xpxl2=xend,ypxl2=ipart(yend);
  for(let x=xpxl1+1;x<xpxl2;x++){put(x,ipart(intery),rfpart(intery));put(x,ipart(intery)+1,fpart(intery));intery+=gradient;}
  put(xpxl2,ypxl2,rfpart(yend)*xgap);put(xpxl2,ypxl2+1,fpart(yend)*xgap);
}
// Целочисленный midpoint-алгоритм Питтвея для эллиптического сечения.
// Две области эллипса обходятся симметрично; решение выбирается по целому
// параметру ошибки, без вычисления sin/cos и без дробного шага.
function plotPittewayEllipse(cx,cy,rx,ry,target=grid){
  rx=Math.max(1,Math.round(Math.abs(rx)));ry=Math.max(1,Math.round(Math.abs(ry)));
  let x=0,y=ry,rx2=rx*rx,ry2=ry*ry,dx=0,dy=2*rx2*y;
  let d1=ry2-rx2*ry+0.25*rx2;
  const four=(x,y)=>{setPixel(cx+x,cy+y,1,target);setPixel(cx-x,cy+y,1,target);setPixel(cx+x,cy-y,1,target);setPixel(cx-x,cy-y,1,target);};
  while(dx<dy){four(x,y);x++;dx+=2*ry2;if(d1<0)d1+=dx+ry2;else{y--;dy-=2*rx2;d1+=dx-dy+ry2;}}
  let d2=ry2*(x+0.5)*(x+0.5)+rx2*(y-1)*(y-1)-rx2*ry2;
  while(y>=0){four(x,y);y--;dy-=2*rx2;if(d2>0)d2+=rx2-dy;else{x++;dx+=2*ry2;d2+=dx-dy+rx2;}}
}
function worldToGrid(x,y){return [CENTER_X+Math.round(x),CENTER_Y-Math.round(y)];}
function draw(){
  const c=$("view"),ctx=c.getContext("2d"),cw=c.width,ch=c.height;
  ctx.clearRect(0,0,cw,ch);ctx.fillStyle="#fff";ctx.fillRect(0,0,cw,ch);
  const s=scale, ox=cw/2+panX, oy=ch/2+panY;
  ctx.lineWidth=1;ctx.strokeStyle="#e8edf3";
  for(let x=ox% s;x<cw;x+=s){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,ch);ctx.stroke();}
  for(let y=oy% s;y<ch;y+=s){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cw,y);ctx.stroke();}
  ctx.strokeStyle="#7d8795";ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(ox,0);ctx.lineTo(ox,ch);ctx.moveTo(0,oy);ctx.lineTo(cw,oy);ctx.stroke();
  ctx.fillStyle="#64748b";ctx.font="11px Arial";
  const step=Math.max(1,Math.ceil(40/s));
  for(let gx=-Math.ceil(ox/s);gx<=Math.ceil((cw-ox)/s);gx+=step)ctx.fillText(String(gx),ox+gx*s+2,oy+13);
  for(let gy=-Math.ceil(oy/s);gy<=Math.ceil((ch-oy)/s);gy+=step)if(gy!==0)ctx.fillText(String(-gy),ox+4,oy+gy*s-3);
  // отображаем только готовый виртуальный растр
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const a=grid[idx(x,y)];if(a>0){
    ctx.fillStyle=`rgba(37,99,235,${Math.max(.08,a)})`;ctx.fillRect(ox+(x-CENTER_X)*s-s/2,oy+(y-CENTER_Y)*s-s/2,s-1,s-1);
  }}
  $("zoomLabel").textContent=`${scale}×`;
}
function readParams(){return ["x0","y0","x1","y1"].map(id=>Number($(id).value));}
function runDraw(){
  grid.fill(0);const [x0,y0,x1,y1]=readParams(),a=$("algorithm").value;
  const p0=worldToGrid(x0,y0),p1=worldToGrid(x1,y1);
  const t0=performance.now();
  if(a==="step")plotLineStep(...p0,...p1);else if(a==="dda")plotDDA(...p0,...p1);
  else if(a==="bres")plotBres(...p0,...p1);else if(a==="wu")plotWu(...p0,...p1);
  else if(a==="circle"){const [cx,cy]=worldToGrid(x0,y0);plotCircle(cx,cy,Math.max(1,Math.round(Number($("radius").value))));}
  else if(a==="pit"){const [cx,cy]=worldToGrid(x0,y0);plotPittewayEllipse(cx,cy,Number($("rx").value),Number($("ry").value));}
  const elapsed=performance.now()-t0;draw();
  $("drawTime").textContent=elapsed.toFixed(3)+" мс";
  $("pixelCount").textContent=grid.reduce((n,v)=>n+(v>0),0);
  $("algoInfo").textContent=({
    step:"Пошаговый: равномерное деление отрезка на max(|dx|, |dy|) шагов.",
    dda:"ЦДА: приращения x и y постоянны; координаты каждого шага округляются.",
    bres:"Брезенхем: целочисленная ошибка выбирает ближайший следующий пиксель.",
    wu:"Ву: интенсивность двух соседних пикселей определяется дробной частью y.",
    circle:"Брезенхем окружности: один октант вычисляется целочисленно, остальные получаются симметрией.",
    pit:"Питтвей: целочисленное пошаговое построение эллиптического конического сечения."
  })[a];
}
function randomInt(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function benchLines(count,length,algo){
  const target=new Float32Array(W*H),fn=algo==="dda"?plotDDA:algo==="step"?plotLineStep:plotBres;
  const t=performance.now();
  for(let i=0;i<count;i++){const x=randomInt(20,W-20),y=randomInt(20,H-20),ang=Math.random()*Math.PI*2;
    fn(x,y,Math.round(x+Math.cos(ang)*length),Math.round(y+Math.sin(ang)*length),target);}
  return performance.now()-t;
}
function chart(canvas,labels,series){
  const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  const max=Math.max(1,...series.flatMap(s=>s.values));const left=54,bottom=34,top=16,right=15,pw=w-left-right,ph=h-top-bottom;
  ctx.strokeStyle="#dbe2ea";ctx.fillStyle="#475569";ctx.font="11px Arial";
  for(let i=0;i<=4;i++){const y=top+ph*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText((max*(1-i/4)).toFixed(0),5,y+4);}
  labels.forEach((l,i)=>ctx.fillText(l,left+i*pw/Math.max(1,labels.length-1)-10,h-12));
  const colors=["#2563eb","#16a34a","#ea580c","#9333ea"];
  series.forEach((s,k)=>{ctx.strokeStyle=colors[k%colors.length];ctx.lineWidth=2;ctx.beginPath();
    s.values.forEach((v,i)=>{const x=left+i*pw/Math.max(1,labels.length-1),y=top+ph-(v/max)*ph;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    ctx.fillStyle=colors[k%colors.length];ctx.fillText(s.name,w-right-100,15+k*14);
  });
}
async function runBenchmark(){
  const btn=$("benchBtn");btn.disabled=true;$("benchStatus").textContent="Выполняется…";
  await new Promise(r=>setTimeout(r,30));
  try{
    const counts=[1000,5000,10000,25000,50000,100000],lengths=[16,32,64,128,200];
    const lines={step:[],dda:[],bres:[]};
    for(const a of Object.keys(lines)){for(const n of counts){lines[a].push(benchLines(n,64,a));await new Promise(r=>setTimeout(r,0));}}
    const byLength=[];for(const len of lengths)byLength.push(benchLines(10000,len,"bres"));
    const circleTarget=new Float32Array(W*H);const tc=performance.now();
    for(let i=0;i<50000;i++)plotCircle(randomInt(30,W-30),randomInt(30,H-30),randomInt(2,90),circleTarget);
    const circleMs=performance.now()-tc;
    const stressTarget=new Float32Array(W*H);const ts=performance.now();
    for(let i=0;i<100000;i++){const x=randomInt(0,W-1),y=randomInt(0,H-1),oct=i%8,dx=randomInt(1,180),dy=randomInt(1,180);
      const ends=[[dx,dy],[-dx,dy],[-dx,-dy],[dx,-dy],[dy,dx],[-dy,dx],[-dy,-dx],[dy,-dx]][oct];plotBres(x,y,x+ends[0],y+ends[1],stressTarget);}
    const stressLineMs=performance.now()-ts;
    chart($("countChart"),counts.map(String),[{name:"Пошаговый",values:lines.step},{name:"ЦДА",values:lines.dda},{name:"Брезенхем",values:lines.bres}]);
    chart($("lengthChart"),lengths.map(String),[{name:"Брезенхем · 10 000 линий",values:byLength}]);
    $("benchTable").innerHTML="<tr><th>Тест</th><th>Количество</th><th>Время, мс</th></tr>"+
      `<tr><td>Отрезки (Брезенхем, все октанты)</td><td>100 000</td><td>${stressLineMs.toFixed(2)}</td></tr>`+
      `<tr><td>Окружности (Брезенхем)</td><td>50 000</td><td>${circleMs.toFixed(2)}</td></tr>`+
      ["step","dda","bres"].map(a=>`<tr><td>${a.toUpperCase()} — 100 000 отрезков, длина 64</td><td>100 000</td><td>${lines[a][5].toFixed(2)}</td></tr>`).join("");
    $("benchStatus").textContent="Готово. Значения получены в этом браузере; результаты зависят от устройства.";
  }catch(e){$("benchStatus").textContent="Ошибка теста: "+e.message;}finally{btn.disabled=false;}
}
$("drawBtn").addEventListener("click",runDraw);$("clearBtn").addEventListener("click",clearGrid);
$("algorithm").addEventListener("change",()=>{$("circleFields").hidden=$("algorithm").value!=="circle";$("ellipseFields").hidden=$("algorithm").value!=="pit";});
$("zoomIn").onclick=()=>{scale=Math.min(28,scale+2);draw();};$("zoomOut").onclick=()=>{scale=Math.max(4,scale-2);draw();};
$("resetView").onclick=()=>{scale=12;panX=panY=0;draw();};$("benchBtn").onclick=runBenchmark;
$("exampleBtn").onclick=()=>{ $("algorithm").value="bres";$("x0").value=-12;$("y0").value=-7;$("x1").value=15;$("y1").value=9;runDraw();};
let dragging=false,lastX=0,lastY=0;const canvas=$("view");
canvas.addEventListener("pointerdown",e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener("pointermove",e=>{if(dragging){panX+=e.clientX-lastX;panY+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;draw();}});
canvas.addEventListener("pointerup",()=>dragging=false);
draw();runDraw();
})();