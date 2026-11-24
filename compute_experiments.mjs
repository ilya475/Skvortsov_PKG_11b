/* Runs the exact processing functions used by the browser; input raw RGBA is decoded by rebuild_experiments.py. */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rgbaToGray, statistics, histogram} from '../src/pixels.js';
import {processGray} from '../src/algorithms.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=path.join(root,'tools','_experiment_tmp');
const manifest=JSON.parse(readFileSync(path.join(temp,'images.json'),'utf8'));
const sources={};
for(const [name,{width,height}] of Object.entries(manifest)){
 const raw=new Uint8ClampedArray(readFileSync(path.join(temp,`${name}.rgba`)));
 sources[name]={width,height,gray:rgbaToGray(raw)};
}
const conditions=[
 ['contrast_original','contrast_low',null,{}],
 ['contrast_linear','contrast_low','linear',{lowPercent:2,highPercent:98}],
 ['contrast_clahe','contrast_low','clahe',{tiles:8,clipLimit:2}],
 ['color_original','colored_dim',null,{}],
 ['color_linear','colored_dim','linear',{lowPercent:2,highPercent:98}],
 ['color_clahe','colored_dim','clahe',{tiles:8,clipLimit:2}],
 ['doc_original','illumination_document',null,{}],
 ['doc_otsu','illumination_document','otsu',{}],
 ['doc_mean','illumination_document','local-mean',{windowSize:31,borderMode:'reflect'}],
 ['doc_niblack','illumination_document','niblack',{windowSize:31,k:-.2,borderMode:'reflect'}],
 ['doc_sauvola_standard','illumination_document','sauvola',{windowSize:31,k:.34,R:128,borderMode:'reflect'}],
 ['doc_sauvola','illumination_document','sauvola',{windowSize:31,k:.2,R:128,borderMode:'reflect'}],
 ['noise_original','noise_salt_pepper',null,{}],
 ['noise_otsu','noise_salt_pepper','otsu',{}],
 ['noise_sauvola','noise_salt_pepper','sauvola',{windowSize:31,k:.2,R:128,borderMode:'reflect'}],
 ['blur_original','blurred_edges',null,{}],
 ['blur_otsu','blurred_edges','otsu',{}],
 ['border_original','border_checker',null,{}],
 ['border_reflect','border_checker','niblack',{windowSize:31,k:-.2,borderMode:'reflect'}],
 ['border_clamp','border_checker','niblack',{windowSize:31,k:-.2,borderMode:'clamp'}],
 ['large_mean','large_scene','local-mean',{windowSize:31,borderMode:'reflect'}]
];
const truth=rgbaToGray(new Uint8ClampedArray(readFileSync(path.join(temp,'illumination_mask.rgba'))));
const f1=(actual,gt)=>{
 let tp=0,fp=0,fn=0;
 for(let i=0;i<actual.length;i++){
   const a=actual[i]<128,t=gt[i]<128;
   if(a&&t)tp++;else if(a&&!t)fp++;else if(!a&&t)fn++;
 }
 const p=tp/(tp+fp||1),r=tp/(tp+fn||1);
 return {f1:2*tp/(2*tp+fp+fn||1),precision:p,recall:r,tp,fp,fn};
};
const cases=[];
for (const [id,source,mode,params] of conditions) {
 const {width,height,gray}=sources[source];
 const start=performance.now();
 const result=mode?processGray(gray,width,height,mode,params):{gray,info:{}};
 const elapsedMs=performance.now()-start;
 writeFileSync(path.join(temp,`${id}.gray`),Buffer.from(result.gray));
 const item={id,source,mode:mode??'original',params,width,height,info:result.info,
   elapsedMs,statistics:statistics(result.gray),histogram:[...histogram(result.gray)]};
 if(source==='illumination_document'&&mode)item.segmentation=f1(result.gray,truth);
 cases.push(item);
 console.log(id,mode||'raw','range',item.statistics.range,'entropy',item.statistics.entropy.toFixed(3),
  'f1',item.segmentation?.f1.toFixed(5)??'—','ms',elapsedMs.toFixed(1));
}
const borderA=new Uint8ClampedArray(readFileSync(path.join(temp,'border_reflect.gray')));
const borderB=new Uint8ClampedArray(readFileSync(path.join(temp,'border_clamp.gray')));
const borderDifferences=borderA.reduce((n,v,i)=>n+(v!==borderB[i]),0);
const out={generated:'2026-11-24',method:'JS algorithms applied to original PNG samples; source converted by PIL only for RGBA decode', cases,
  borderDifferences, documentMask:'docs/illumination_mask.png', notes:'F1 uses black text as positive class. ElapsedMs from Node JS computation, not a guaranteed browser timing.'};
writeFileSync(path.join(root,'report/experiments.json'),JSON.stringify(out,null,2),'utf8');
console.log('border differences',borderDifferences);
