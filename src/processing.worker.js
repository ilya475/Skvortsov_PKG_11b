/** Web Worker entry point: compute on transferable raw RGBA buffers, never block UI. */
import {PixelBuffer} from './pixel-buffer.js';
import {applyAlgorithm,processSeparableStripe} from './algorithms.js';

self.onmessage = ({data:task}) => {
  try {
    const source=new PixelBuffer(task.width,task.height,new Uint8ClampedArray(task.pixels));
    const started=performance.now();
    if(task.mode==='stripe'){
      const stripe=processSeparableStripe(source,task.options,task.startRow,task.endRow);
      self.postMessage({id:task.id,ok:true,mode:'stripe',startRow:task.startRow,endRow:task.endRow,elapsed:performance.now()-started,pixels:stripe.buffer},[stripe.buffer]);
    } else {
      const result=applyAlgorithm(source,task.options),transfer=[result.image.data.buffer];
      if(result.aux)transfer.push(result.aux.data.buffer);
      self.postMessage({id:task.id,ok:true,mode:'single',elapsed:performance.now()-started,
        pixels:result.image.data.buffer,aux:result.aux?.data.buffer??null,meta:result.meta},transfer);
    }
  }catch(error){self.postMessage({id:task.id,ok:false,error:error?.stack||String(error)});}
};
