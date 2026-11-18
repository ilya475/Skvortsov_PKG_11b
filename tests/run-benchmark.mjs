import {runBenchmark} from '../src/benchmark.js';
import {cpus,totalmem} from 'node:os';
import {writeFileSync,mkdirSync} from 'node:fs';
const result=runBenchmark(s=>console.log(s));
result.system={runtime:process.version,platform:process.platform,arch:process.arch,cpu:cpus()?.[0]?.model??'not reported',memoryGB:+(totalmem()/1e9).toFixed(2)};
mkdirSync('benchmarks',{recursive:true});
writeFileSync('benchmarks/measured_node.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.full,null,2));
console.log('Saved benchmarks/measured_node.json');
