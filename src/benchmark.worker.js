import {runBenchmark} from './benchmark.js';
self.addEventListener('message', event => {
  if (event.data?.type !== 'run') return;
  try {
    const result = runBenchmark(msg => self.postMessage({type:'progress',message:msg}));
    self.postMessage({type:'done',result});
  } catch(e) {self.postMessage({type:'error',message:e.message??String(e)});}
});
