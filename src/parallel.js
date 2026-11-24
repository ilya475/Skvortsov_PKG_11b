/** Task coordinator: one worker for all operations, 2-4 simultaneous workers for separable convolutions. */
import {PixelBuffer} from './pixel-buffer.js';

const workerUrl=new URL('./processing.worker.js',import.meta.url);
function request(worker,job){
  return new Promise((resolve,reject)=>{
    worker.onmessage=({data:reply})=>{
      if(reply.id!==job.id)return;
      if(reply.ok)resolve(reply);else reject(new Error(reply.error||'Ошибка рабочего потока'));
    };
    worker.onerror=e=>reject(new Error(`Ошибка Web Worker: ${e.message}`));
    worker.postMessage(job,[job.pixels]);
  });
}
let nextTaskId=0;
export async function runProcessing(input,options,threads=1,onProgress=()=>{}){
  if(!globalThis.Worker)throw new Error('Web Workers недоступны. Откройте сайт по HTTPS или через локальный сервер.');
  const started=performance.now(),allowParallel=['box','gaussian'].includes(options.method);
  const requested=Math.max(1,Math.min(4,Math.round(threads)));
  const count=allowParallel?Math.min(requested,input.height):1;
  const workers=[];
  try {
    if(count===1){
      const worker=new Worker(workerUrl,{type:'module'});workers.push(worker);
      const pixels=input.data.slice().buffer;
      const response=await request(worker,{id:++nextTaskId,mode:'single',width:input.width,height:input.height,pixels,options});
      onProgress(1);
      return {image:new PixelBuffer(input.width,input.height,new Uint8ClampedArray(response.pixels)),
        aux:response.aux?new PixelBuffer(input.width,input.height,new Uint8ClampedArray(response.aux)):null,
        meta:response.meta??{},elapsed:performance.now()-started,workerTime:response.elapsed,workerCount:1};
    }
    const out=PixelBuffer.blank(input.width,input.height),parts=[];
    for(let i=0;i<count;i++){
      const worker=new Worker(workerUrl,{type:'module'});workers.push(worker);
      const startRow=Math.floor(i*input.height/count),endRow=Math.floor((i+1)*input.height/count);
      parts.push(request(worker,{id:++nextTaskId,mode:'stripe',width:input.width,height:input.height,
        startRow,endRow,pixels:input.data.slice().buffer,options}).then(reply=>{onProgress((++finished)/count);return reply;}));
    }
    var finished=0;
    const results=await Promise.all(parts);
    for(const p of results)out.data.set(new Uint8ClampedArray(p.pixels),p.startRow*input.width*4);
    return {image:out,aux:null,meta:{},elapsed:performance.now()-started,
      workerTime:Math.max(...results.map(r=>r.elapsed)),workerCount:count};
  }finally{for(const worker of workers)worker.terminate();}
}
