import {VirtualGrid} from './virtual-grid.js';
import {RasterEngine as R} from './raster-engine.js';

const methods = [
  ['step','Пошаговый',R.stepLine],
  ['dda','ЦДА',R.ddaLine],
  ['bres','Брезенхем',R.bresenhamLine],
  ['wu','Ву (Wu)',R.wuLine]
];
const now = () => performance.now();
const med = xs => xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
function rng(seed) {
  let state=seed>>>0;
  return () => {state ^= state<<13;state ^= state>>>17;state ^= state<<5;return (state>>>0);};
}

/** Generate integer line segments with explicitly balanced 8 octants. */
export function makeFanLines(n, minLength=4,maxLength=90,seed=0x4a31b) {
  const random=rng(seed);
  const lines=new Int16Array(n*4);
  for(let i=0;i<n;i++) {
    const oct=i%8;
    const major=minLength+(random()%(maxLength-minLength+1));
    const minor=Math.floor(major*(.08+random()/4294967296*.84));
    const sx = (oct===0||oct===1||oct===6||oct===7)?1:-1;
    const sy = (oct===0||oct===1||oct===2||oct===3)?1:-1;
    const steep=(oct%2)===1;
    const dx=sx*(steep?minor:major),dy=sy*(steep?major:minor);
    const x0=256+(random()%81)-40, y0=256+(random()%81)-40;
    const j=i*4;
    lines[j]=x0;lines[j+1]=y0;lines[j+2]=x0+dx;lines[j+3]=y0+dy;
  }
  return lines;
}

export function makeCircles(n,seed=0x9fab7) {
  const rand=rng(seed),circles=new Int16Array(n*3);
  for(let i=0;i<n;i++) {
    circles[3*i]=40+(rand()%432);
    circles[3*i+1]=40+(rand()%432);
    circles[3*i+2]=2+(rand()%31);
  }
  return circles;
}

function timeLines(grid,data,fn,n,repeat=3) {
  const times=[];
  for(let pass=0;pass<repeat;pass++) {
    grid.clear();const t0=now();
    for(let i=0;i<n*4;i+=4)fn(data[i],data[i+1],data[i+2],data[i+3],grid);
    times.push(now()-t0);
  }
  return med(times);
}
function timeCircles(grid,data,n,repeat=3) {
  const times=[];
  for(let pass=0;pass<repeat;pass++) {
    grid.clear();const t0=now();
    for(let i=0;i<3*n;i+=3)R.bresenhamCircle(data[i],data[i+1],data[i+2],grid);
    times.push(now()-t0);
  }
  return med(times);
}

export function runBenchmark(notify=()=>{}) {
  const grid=new VirtualGrid(512,512,0,511);
  const fan=makeFanLines(100000),circles=makeCircles(50000);
  const full=[];
  for(const [id,label,fn] of methods) {
    // Warm-up outside timed interval; JIT and first-time initialization.
    timeLines(grid,fan,fn,1500,1);
    const t=timeLines(grid,fan,fn,100000,3);
    full.push({id,label,count:100000,ms:+t.toFixed(3),throughput:+(100000/t*1000).toFixed(1)});
    notify(`100 000 отрезков: ${label} — ${t.toFixed(1)} мс`);
  }
  timeCircles(grid,circles,1500,1);
  const ct=timeCircles(grid,circles,50000,3);
  full.push({id:'circle',label:'Брезенхем (окружность)',count:50000,ms:+ct.toFixed(3),throughput:+(50000/ct*1000).toFixed(1)});
  notify(`50 000 окружностей: ${ct.toFixed(1)} мс`);

  const countSeries=[], nvals=[1000,10000,25000,50000,100000];
  for(const n of nvals) {
    for(const [id,label,fn] of methods.slice(1,3)) {
      const t=timeLines(grid,fan,fn,n,2);
      countSeries.push({n,method:id,label,ms:+t.toFixed(3)});
    }
  }
  notify('График времени от количества отрезков готов');
  const lengthSeries=[];
  for(const length of [10,25,50,75,100]) {
    const batch=makeFanLines(20000,length,length,0x4a31b + length);
    for(const [id,label,fn] of methods.slice(1,3)) {
      const t=timeLines(grid,batch,fn,20000,2);
      lengthSeries.push({length,method:id,label,ms:+t.toFixed(3),n:20000});
    }
  }
  notify('График времени от длины отрезка готов');
  const circleCountSeries=[];
  for(const n of [1000,10000,25000,50000]) {
    const t=timeCircles(grid,circles,n,2);
    circleCountSeries.push({n,ms:+t.toFixed(3)});
  }
  notify('График времени от количества окружностей готов');
  return {date:new Date().toISOString(),environment:'JavaScript (один поток); виртуальный массив 512×512, без UI',
          warmup:true,repeats:'3 (основной стресс), 2 (графики); медиана',seed:['0x4a31b','0x9fab7'],
          full,countSeries,lengthSeries,circleCountSeries};
}
