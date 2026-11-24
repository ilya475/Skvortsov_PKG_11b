import test from 'node:test';
import assert from 'node:assert/strict';
import {PixelBuffer,mapIndex,grayPlane} from '../src/pixel-buffer.js';
import {applyAlgorithm,processSeparableStripe,gaussianKernel,boxKernel,luminanceHistogram,
  imageStatistics,otsuThreshold,createIntegralImages,rectStats,structuringOffsets,
  rgbToHsv,hsvToRgb,canny} from '../src/algorithms.js';

function build(w,h,fn=(x,y)=>[x*13+y*7,x*9+y*19,x*21+y*5]){
  const p=PixelBuffer.blank(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const [r,g,b]=fn(x,y),i=(y*w+x)*4;p.data[i]=r;p.data[i+1]=g;p.data[i+2]=b;
  }
  return p;
}
const action=(p,method,opts={})=>applyAlgorithm(p,{method,border:'reflect',...opts});

test('RGBA buffer: 4 bytes/pixel; alpha opaque',()=>{
 const p=PixelBuffer.blank(3,4);assert.equal(p.data.length,48);assert.equal(p.sample(2,3,3),255);
});
test('clamp and reflect-101 have defined nonzero boundaries',()=>{
 assert.equal(mapIndex(-1,5,'reflect'),1);assert.equal(mapIndex(5,5,'reflect'),3);
 assert.equal(mapIndex(-1,5,'clamp'),0);assert.equal(mapIndex(5,5,'clamp'),4);
 assert.equal(mapIndex(-10,1,'reflect'),0);assert.equal(mapIndex(-10,1,'clamp'),0);
});
test('separable kernels normalized to 1',()=>{
 assert.ok(Math.abs(gaussianKernel(1.25).reduce((a,b)=>a+b,0)-1)<1e-12);
 assert.ok(Math.abs(boxKernel(5).reduce((a,b)=>a+b,0)-1)<1e-12);
});
test('constant image stays constant under gaussian, box, every boundary strategy',()=>{
 const p=build(8,11,()=>[120,61,25]);
 for(const method of ['gaussian','box'])for(const border of ['reflect','clamp']){
  const out=applyAlgorithm(p,{method,border,sigma:1.5,size:7}).image;
  for(let i=0;i<out.data.length;i+=4)assert.deepEqual([...out.data.slice(i,i+3)],[120,61,25]);
 }
});
test('multi-stripe convolution identical to single-pass, for 2 kernels x 2 borders',()=>{
 const p=build(21,17,(x,y)=>[(17*x+21*y)%256,(13*x+31*y)%256,(5*x+9*y)%256]);
 for(const method of ['gaussian','box'])for(const border of ['reflect','clamp']){
  const opts={method,border,sigma:1.1,size:7};
  const actual=new Uint8ClampedArray(p.data.length);
  for(let i=0;i<4;i++){
    const a=Math.floor(i*p.height/4),b=Math.floor((i+1)*p.height/4);
    actual.set(processSeparableStripe(p,opts,a,b),a*p.width*4);
  }
  const expected=applyAlgorithm(p,opts).image.data;
  assert.deepEqual(actual,expected);
 }
});
test('histogram must contain exactly W*H values',()=>{
 const p=build(9,8);assert.equal(luminanceHistogram(p).reduce((s,v)=>s+v,0),72);
 const s=imageStatistics(p);assert.ok(s.entropy>=0&&s.entropy<=8);
});
test('Otsu must maximize between-class variance in a bimodal image',()=>{
 const p=build(20,10,(x)=>x<10?[25,25,25]:[210,210,210]);
 const {threshold,variance}=otsuThreshold(p);
 assert.equal(threshold,25);assert.ok(variance>0);
 const r=action(p,'otsu').image;assert.equal(r.data[0],0);assert.equal(r.data[(19)*4],255);
});
test('SAT mean and variance match direct ground truth',()=>{
 const p=build(3,2,(x,y)=>[x+y*3+1,x+y*3+1,x+y*3+1]);
 const s=createIntegralImages(p);
 assert.equal(rectStats(s,0,0,3,2).mean,3.5);
 assert.equal(rectStats(s,1,0,3,1).mean,2.5);
 assert.equal(rectStats(s,0,0,3,2).area,6);
 assert.ok(Math.abs(rectStats(s,0,0,3,2).sd-Math.sqrt(35/12))<1e-7);
});
test('Local and adaptive thresholds produce strictly binary results',()=>{
 const p=build(19,16);
 for(const method of ['bradley','sauvola','niblack','intermeans','manual']){
  const out=action(p,method,{radius:4,k:method==='niblack'?-0.2:0.3,threshold:127}).image;
  for(let i=0;i<out.data.length;i+=4)assert.ok(out.data[i]===0||out.data[i]===255);
 }
});
test('RGB ↔ HSV conversion retains primary and secondary colours',()=>{
 for(const rgb of [[255,0,0],[0,255,0],[0,0,255],[120,240,30],[105,82,172],[0,0,0],[255,255,255]]){
  const restored=hsvToRgb(...rgbToHsv(...rgb));
  for(let i=0;i<3;i++)assert.ok(Math.abs(restored[i]-rgb[i])<=1);
 }
});
test('CL(A)HE, RGB & HSV hist methods preserve buffer size and opaque alpha',()=>{
 const p=build(29,17);
 for(const method of ['clahe','hist-rgb','hist-hsv','contrast']){
  const result=action(p,method,{tileSize:10,clipLimit:2}).image;
  assert.equal(result.data.length,p.data.length);
  for(let i=3;i<result.data.length;i+=4)assert.equal(result.data[i],255);
 }
});
test('median suppresses a single impulse, min and max select extremums',()=>{
 const p=build(5,5,()=>[99,99,99]);const ix=(2*5+2)*4;p.data.fill(255,ix,ix+3);
 assert.equal(action(p,'median',{radius:1}).image.data[ix],99);
 assert.equal(action(p,'max',{radius:1}).image.data[ix-4],255);
 assert.equal(action(p,'min',{radius:1}).image.data[ix],99);
});
test('different structuring elements have defined footprints',()=>{
 assert.equal(structuringOffsets('square',2).length,25);
 assert.equal(structuringOffsets('cross',2).length,9);
 assert.equal(structuringOffsets('diamond',2).length,13);
 assert.equal(structuringOffsets('disk',2).length,13);
});
test('opening removes a single bright dot and top-hat isolates it',()=>{
 const p=build(11,11,()=>[0,0,0]),idx=(5*11+5)*4;
 p.data[idx]=p.data[idx+1]=p.data[idx+2]=255;
 assert.equal(action(p,'opening',{shape:'square',radius:1}).image.data[idx],0);
 assert.equal(action(p,'top-hat',{shape:'square',radius:1}).image.data[idx],255);
});
test('closing fills a single dark hole and black-hat isolates it',()=>{
 const p=build(11,11,()=>[255,255,255]),idx=(5*11+5)*4;
 p.data[idx]=p.data[idx+1]=p.data[idx+2]=0;
 assert.equal(action(p,'closing',{shape:'square',radius:1}).image.data[idx],255);
 assert.equal(action(p,'black-hat',{shape:'square',radius:1}).image.data[idx],255);
});
test('Sobel and Canny provide separate direction map with genuine RGB colours',()=>{
 const p=build(25,25,(x,y)=>[x>y?230:30,x>y?230:30,x>y?230:30]);
 for(const method of ['sobel','canny']){
  const r=action(p,method,{threshold:15,low:20,high:60,sigma:1});
  assert.ok(r.aux);assert.equal(r.aux.data.length,p.data.length);
  assert.ok(r.aux.data.some((v,i)=>i%4!==3&&v!==0));
 }
});
test('Hough returns line votes and per-pixel red overlay',()=>{
 const p=build(36,30,(x,y)=>Math.abs(y-15)<2?[255,255,255]:[0,0,0]);
 const r=action(p,'hough',{threshold:30,lines:4});
 assert.ok(Number.isInteger(r.meta.lineCount));assert.ok(r.meta.lineCount<=4);
 assert.ok(r.aux);
});
test('preserves no unexpected high-level API dependencies',()=>{
 const p=build(5,5);
 assert.ok(grayPlane(p) instanceof Float64Array);
 assert.notDeepEqual(action(p,'negative').image.data,p.data);
});

test('Every one of 32 menu algorithms executes from scratch on the same raw buffer',async()=>{
 const {categories}=await import('../src/config.js');
 const methods=categories.flatMap(cat=>cat.methods);
 assert.equal(categories.length,8);
 assert.equal(methods.length,32);
 const p=build(19,17,(x,y)=>[(x*17+y*13)%256,(x*5+y*21)%256,(x*11+y*3)%256]);
 for(const method of methods){
   const options={method:method.id,border:'clamp'};
   for(const param of method.params??[])options[param.key]=param.value;
   const result=applyAlgorithm(p,options);
   assert.equal(result.image.data.length,p.data.length,method.id);
   assert.ok(result.image.data.every((v,index)=>index%4!==3||v===255),method.id);
 }
});
