import {mapIndex, clampByte, rgbaToGray, grayToRgba, histogram, statistics} from '../src/pixels.js';
import {linearContrast, otsu, paddedStripe, integralTables, rectangleSum, localThreshold, clahe, processGray} from '../src/algorithms.js';

function equal(a, b) {return a.length === b.length && a.every((v,i)=>v===b[i]);}
function referenceLocal(gray,w,h,mode,params) {
  const windowSize=params.windowSize, r=(windowSize-1)/2, out=new Uint8ClampedArray(gray.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0,sq=0;
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const v=gray[mapIndex(y+dy,h,params.borderMode)*w+mapIndex(x+dx,w,params.borderMode)];
      sum+=v;sq+=v*v;
    }
    const area=windowSize*windowSize,mean=sum/area,sd=Math.sqrt(Math.max(0,sq/area-mean*mean));
    const threshold=mode==='local-mean'?mean:mode==='niblack'?mean+params.k*sd:mean*(1+params.k*(sd/params.R-1));
    out[y*w+x]=gray[y*w+x]<=threshold?0:255;
  }
  return out;
}
const input=new Uint8ClampedArray(17*19);
for(let y=0;y<19;y++)for(let x=0;x<17;x++)input[y*17+x]=(x*x*7+y*13+x*y*3)%256;

export function selfTests(){
  const results=[];
  const test=(name,fn)=>{
    try{if(fn()===false)throw Error('Результаты не совпали');results.push({name,ok:true});}
    catch(error){results.push({name,ok:false,error:error.message});}
  };
  test('Доступ к RGBA и преобразование яркости',()=>equal(rgbaToGray(new Uint8ClampedArray([0,0,0,255,255,255,255,50])),new Uint8ClampedArray([0,255])));
  test('Обратное преобразование в RGBA',()=>equal(grayToRgba(new Uint8ClampedArray([12])),new Uint8ClampedArray([12,12,12,255])));
  test('Округление и ограничение байта',()=>clampByte(-10)===0&&clampByte(300)===255&&clampByte(12.51)===13);
  test('Границы Clamp',()=>mapIndex(-3,5,'clamp')===0&&mapIndex(9,5,'clamp')===4);
  test('Границы Reflect-101',()=>mapIndex(-1,5,'reflect')===1&&mapIndex(5,5,'reflect')===3&&mapIndex(-1,1,'reflect')===0);
  test('Гистограмма: частоты и сумма',()=>{const h=histogram(new Uint8ClampedArray([0,1,1,255]));return h[0]===1&&h[1]===2&&h[255]===1&&h.reduce((a,b)=>a+b,0)===4;});
  test('Статистика постоянного изображения',()=>{const s=statistics(new Uint8ClampedArray([50,50,50]));return s.sd===0&&s.entropy===0&&s.range===0;});
  test('Линейное контрастирование 0..255',()=>equal(linearContrast(new Uint8ClampedArray([100,150,200]),0,100).gray,new Uint8ClampedArray([0,128,255])));
  test('Линейное контрастирование постоянного поля',()=>equal(linearContrast(new Uint8ClampedArray([80,80]),0,100).gray,new Uint8ClampedArray([80,80])));
  test('Оцу: двухмодальный массив',()=>{const r=otsu(new Uint8ClampedArray([0,0,200,200]));return r.info.threshold===0 && equal(r.gray,new Uint8ClampedArray([0,0,255,255]));});
  test('Оцу: постоянное поле без деления на ноль',()=>{const r=otsu(new Uint8ClampedArray([80,80,80]));return r.info.threshold===80 && equal(r.gray,new Uint8ClampedArray([0,0,0]));});
  test('Оцу: порог ищется автоматически',()=>otsu(new Uint8ClampedArray([0,30,31,180,181,220])).info.threshold>=30);
  test('Интегральный SAT: сумма прямоугольника',()=>{const sat=integralTables(new Uint8ClampedArray([1,2,3,4,5,6]),3,2);return rectangleSum(sat.sum,sat.stride,1,0,3,2)===16&&rectangleSum(sat.square,sat.stride,0,0,3,2)===91;});
  test('Поля Clamp и Reflect не тождественны',()=>!equal(paddedStripe(new Uint8ClampedArray([10,100,200]),3,1,0,1,1,'clamp').tile,paddedStripe(new Uint8ClampedArray([10,100,200]),3,1,0,1,1,'reflect').tile));
  for(const mode of ['local-mean','niblack','sauvola']) for(const borderMode of ['clamp','reflect']) {
    const params={windowSize:5,k:mode==='sauvola'?.34:-.2,R:128,borderMode};
    test(`${mode}: SAT совпадает с прямым окном (${borderMode})`,()=>equal(localThreshold(input,17,19,mode,params).gray,referenceLocal(input,17,19,mode,params)));
    test(`${mode}: полосы совпадают с полным кадром (${borderMode})`,()=>{
      const full=localThreshold(input,17,19,mode,params).gray,out=new Uint8ClampedArray(full.length);
      for(const [a,b] of [[0,5],[5,12],[12,19]])out.set(localThreshold(input,17,19,mode,params,a,b).gray,a*17);
      return equal(full,out);
    });
  }
  test('Ниблэк при k=0 равен локальному среднему',()=>equal(localThreshold(input,17,19,'niblack',{windowSize:5,k:0}).gray,localThreshold(input,17,19,'local-mean',{windowSize:5}).gray));
  test('Саувола при k=0 равен локальному среднему',()=>equal(localThreshold(input,17,19,'sauvola',{windowSize:5,k:0,R:128}).gray,localThreshold(input,17,19,'local-mean',{windowSize:5}).gray));
  test('CLAHE: неизменность постоянного кадра',()=>equal(clahe(new Uint8ClampedArray(64).fill(120),8,8,2,2).gray,new Uint8ClampedArray(64).fill(120)));
  test('CLAHE: размеры и допустимость байтов',()=>{const arr=new Uint8ClampedArray(9*7);for(let i=0;i<arr.length;i++)arr[i]=(i*29)%256;const r=clahe(arr,9,7,4,2.5).gray;return r.length===arr.length && r.every(v=>v>=0&&v<=255);});
  test('Ровно шесть доступных способов',()=>['linear','local-mean','niblack','sauvola','otsu','clahe'].every(mode=>processGray(input,17,19,mode,{windowSize:3}).gray.length===input.length));
  return results;
}
