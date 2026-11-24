/** Processing Layer: pure pixel algorithms. No DOM, Canvas filters or image processing libraries. */
import {PixelBuffer, mapIndex, clampByte, grayPlane, grayImage, rgbaImage, luminance} from './pixel-buffer.js';

function outputLike(input) { return PixelBuffer.blank(input.width, input.height); }
function planeAt(plane, w, h, x, y, border) {
  return plane[mapIndex(y, h, border) * w + mapIndex(x, w, border)];
}
function copyGrayTransform(input, fn) {
  const gray = grayPlane(input);
  for (let i=0; i<gray.length; i++) gray[i] = fn(gray[i], i);
  return grayImage(input.width, input.height, gray);
}
function copyRGBTransform(input, fn) {
  const out=outputLike(input), src=input.data, dst=out.data;
  for(let i=0;i<src.length;i+=4) {
    for(let c=0;c<3;c++) dst[i+c]=clampByte(fn(src[i+c],c,i/4));
  }
  return out;
}

export function gaussianKernel(sigma=1.35) {
  sigma=Math.max(.25,+sigma);
  const radius=Math.max(1,Math.min(15,Math.ceil(3*sigma)));
  const k=new Float64Array(2*radius+1); let total=0;
  for(let j=-radius;j<=radius;j++) total+=k[j+radius]=Math.exp(-j*j/(2*sigma*sigma));
  for(let j=0;j<k.length;j++) k[j]/=total;
  return k;
}
export function boxKernel(size=5) {
  const n=Math.max(1,Math.min(31,Math.round(+size)|1));
  return new Float64Array(n).fill(1/n);
}

/** Horizontal + vertical 1-D convolutions; result is float RGB, not prematurely quantized. */
export function separableRGB(input, kernel, border='reflect') {
  const {width:w,height:h,data:src}=input, r=(kernel.length-1)/2;
  const horiz=new Float32Array(w*h*3);
  const dst=new Float32Array(w*h*3);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const base=(y*w+x)*3;
    for(let j=-r;j<=r;j++) {
      const px=(y*w+mapIndex(x+j,w,border))*4, k=kernel[j+r];
      horiz[base]+=src[px]*k;horiz[base+1]+=src[px+1]*k;horiz[base+2]+=src[px+2]*k;
    }
  }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const base=(y*w+x)*3;
    for(let j=-r;j<=r;j++) {
      const px=(mapIndex(y+j,h,border)*w+x)*3, k=kernel[j+r];
      dst[base]+=horiz[px]*k;dst[base+1]+=horiz[px+1]*k;dst[base+2]+=horiz[px+2]*k;
    }
  }
  return dst;
}
/** Independent stripe result, including a horizontal 'halo'; intended for true Web Worker parallelism. */
export function processSeparableStripe(input, options, startRow, endRow) {
  const {width:w,height:h,data:src}=input;
  if(startRow<0||endRow>h||endRow<=startRow)throw Error('Неверные границы полосы');
  const k=options.method==='gaussian'?gaussianKernel(options.sigma):boxKernel(options.size);
  const r=(k.length-1)/2, border=options.border??'reflect';
  const first=Math.max(0,startRow-r),last=Math.min(h,endRow+r);
  const intermediate=new Float32Array((last-first)*w*3);
  for(let y=first;y<last;y++) for(let x=0;x<w;x++) {
    const base=((y-first)*w+x)*3;
    for(let j=-r;j<=r;j++) {
      const px=(y*w+mapIndex(x+j,w,border))*4, factor=k[j+r];
      intermediate[base]+=src[px]*factor;
      intermediate[base+1]+=src[px+1]*factor;
      intermediate[base+2]+=src[px+2]*factor;
    }
  }
  const stripe=new Uint8ClampedArray((endRow-startRow)*w*4);
  for(let y=startRow;y<endRow;y++)for(let x=0;x<w;x++) {
    const base=((y-startRow)*w+x)*4;
    let red=0,green=0,blue=0;
    for(let j=-r;j<=r;j++) {
      const yy=mapIndex(y+j,h,border),idx=((yy-first)*w+x)*3,factor=k[j+r];
      red=Math.fround(red+intermediate[idx]*factor);green=Math.fround(green+intermediate[idx+1]*factor);blue=Math.fround(blue+intermediate[idx+2]*factor);
    }
    stripe[base]=clampByte(red);stripe[base+1]=clampByte(green);stripe[base+2]=clampByte(blue);stripe[base+3]=255;
  }
  return stripe;
}
export function separableGray(plane,w,h,kernel,border='reflect') {
  const r=(kernel.length-1)/2,mid=new Float32Array(w*h),result=new Float32Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let value=0;
    for(let j=-r;j<=r;j++)value+=plane[y*w+mapIndex(x+j,w,border)]*kernel[j+r];
    mid[y*w+x]=value;
  }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let value=0;
    for(let j=-r;j<=r;j++)value+=mid[mapIndex(y+j,h,border)*w+x]*kernel[j+r];
    result[y*w+x]=value;
  }
  return result;
}
function blurRGB(input,kernel,border) {return rgbaImage(input.width,input.height,separableRGB(input,kernel,border));}
function unsharp(input,sigma,amount,border) {
  const blur=separableRGB(input,gaussianKernel(sigma),border),out=outputLike(input);
  for(let p=0,i=0;p<input.data.length;p+=4,i+=3) for(let c=0;c<3;c++)
    out.data[p+c]=clampByte(input.data[p+c]+amount*(input.data[p+c]-blur[i+c]));
  return out;
}
function laplacianSharpen(input,amount,border){
  const out=outputLike(input),w=input.width,h=input.height;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4;
    for(let c=0;c<3;c++){
      const center=input.data[p+c];
      const lap=4*center-input.sample(x-1,y,c,border)-input.sample(x+1,y,c,border)-input.sample(x,y-1,c,border)-input.sample(x,y+1,c,border);
      out.data[p+c]=clampByte(center+amount*lap);
    }
  }
  return out;
}

export function luminanceHistogram(input) {
  const counts=new Uint32Array(256),src=input.data;
  for(let i=0;i<src.length;i+=4)counts[clampByte(luminance(src[i],src[i+1],src[i+2]))]++;
  return Array.from(counts);
}
export function imageStatistics(input) {
  const hist=luminanceHistogram(input),n=input.width*input.height;
  let sum=0,sum2=0,entropy=0,total=0,black=0,nonzero=0;
  for(let i=0;i<256;i++){
    const v=hist[i];sum+=i*v;sum2+=i*i*v;
    if(v){let p=v/n;entropy-=p*Math.log2(p); nonzero++;}
    if(i<128)black+=v;
  }
  const perc=p=>{const goal=n*p;let acc=0;for(let i=0;i<256;i++){acc+=hist[i];if(acc>=goal)return i;}return 255;};
  const mean=sum/n;
  return {mean,sd:Math.sqrt(Math.max(0,sum2/n-mean*mean)),entropy,p5:perc(.05),p95:perc(.95),range:perc(.95)-perc(.05),blackPercent:100*black/n,uniqueLevels:nonzero};
}
function histCDF(values) {
  const hist=new Uint32Array(256);for(let i=0;i<values.length;i++) hist[clampByte(values[i])]++;
  const lut=new Uint8Array(256);let sum=0,first=0,seen=false;
  for(let i=0;i<256;i++){
    sum+=hist[i];if(!seen&&hist[i]){first=sum;seen=true;}
    lut[i]=values.length===first?i:clampByte((sum-first)*255/(values.length-first));
  }
  return lut;
}
export function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),delta=mx-mn;
  let h=0;
  if(delta>0){
    if(mx===r) h=((g-b)/delta)%6;
    else if(mx===g)h=(b-r)/delta+2;
    else h=(r-g)/delta+4;
    h=((h*60)%360+360)%360;
  }
  return [h,mx===0?0:delta/mx,mx];
}
export function hsvToRgb(h,s,v){
  const chroma=v*s, x=chroma*(1-Math.abs((h/60)%2-1)),m=v-chroma;
  let a=0,b=0,c=0;
  if(h<60){a=chroma;b=x;}else if(h<120){a=x;b=chroma;}
  else if(h<180){b=chroma;c=x;}else if(h<240){b=x;c=chroma;}
  else if(h<300){a=x;c=chroma;}else {a=chroma;c=x;}
  return [clampByte((a+m)*255),clampByte((b+m)*255),clampByte((c+m)*255)];
}
function linearContrast(input, clip=0) {
  const plane=grayPlane(input),h=new Uint32Array(256),n=plane.length;
  for(let i=0;i<n;i++)h[clampByte(plane[i])]++;
  const at=p=>{const target=p*n;let count=0;for(let i=0;i<256;i++){count+=h[i];if(count>=target)return i;}return 255;};
  const lo=at(Math.max(0,clip)/100),hi=at(1-Math.max(0,clip)/100);
  if(hi<=lo)return {image:input.clone(),meta:{lower:lo,upper:hi}};
  const out=outputLike(input);
  for(let p=0,i=0;p<input.data.length;p+=4,i++){
    const old=plane[i],newY=Math.max(0,Math.min(255,(old-lo)*255/(hi-lo)));
    const scale=old<1?0:newY/old;
    for(let c=0;c<3;c++)out.data[p+c]=clampByte(input.data[p+c]*scale);
    if(old<1)out.data[p]=out.data[p+1]=out.data[p+2]=0;
  }
  return {image:out,meta:{lower:lo,upper:hi}};
}
function equalizeRGB(input) {
  const channels=[[],[],[]],src=input.data;
  for(let p=0;p<src.length;p+=4)for(let c=0;c<3;c++)channels[c].push(src[p+c]);
  const luts=channels.map(histCDF),out=outputLike(input);
  for(let p=0;p<src.length;p+=4)for(let c=0;c<3;c++)out.data[p+c]=luts[c][src[p+c]];
  return out;
}
function equalizeHSV(input) {
  const n=input.width*input.height,HSV=new Float32Array(n*3),vs=new Uint8Array(n);
  for(let i=0,p=0;i<n;i++,p+=4){const v=rgbToHsv(input.data[p],input.data[p+1],input.data[p+2]);
    HSV.set(v,i*3);vs[i]=clampByte(v[2]*255);}
  const lut=histCDF(vs),out=outputLike(input);
  for(let i=0,p=0;i<n;i++,p+=4){
    const rgb=hsvToRgb(HSV[i*3],HSV[i*3+1],lut[vs[i]]/255);
    out.data[p]=rgb[0];out.data[p+1]=rgb[1];out.data[p+2]=rgb[2];
  }
  return out;
}
/** CLAHE: clipped tile histograms + redistributed overflow + bilinear CDF blending. */
export function clahe(input, tileSize=64, clipFactor=2) {
  const {width:w,height:h,data:src}=input;
  tileSize=Math.max(8,Math.round(+tileSize));clipFactor=Math.max(1,+clipFactor);
  const countX=Math.ceil(w/tileSize),countY=Math.ceil(h/tileSize),n=w*h;
  const value=new Uint8Array(n),hue=new Float32Array(n),sat=new Float32Array(n);
  for(let i=0,p=0;i<n;i++,p+=4){
    const hsv=rgbToHsv(src[p],src[p+1],src[p+2]);hue[i]=hsv[0];sat[i]=hsv[1];value[i]=clampByte(hsv[2]*255);
  }
  const lookup=Array.from({length:countX*countY},()=>new Uint8Array(256));
  for(let ty=0;ty<countY;ty++)for(let tx=0;tx<countX;tx++) {
    const x0=tx*tileSize,x1=Math.min(w,x0+tileSize),y0=ty*tileSize,y1=Math.min(h,y0+tileSize),tileN=(x1-x0)*(y1-y0);
    const hist=new Int32Array(256);for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) hist[value[y*w+x]]++;
    const limit=Math.max(1,Math.floor(tileN*clipFactor/256));let excess=0;
    for(let i=0;i<256;i++)if(hist[i]>limit){excess+=hist[i]-limit;hist[i]=limit;}
    const add=Math.floor(excess/256),remainder=excess%256;
    for(let i=0;i<256;i++)hist[i]+=add;
    for(let j=0;j<remainder;j++)hist[Math.floor((j+.5)*256/remainder)]++;
    let first=0,acc=0,found=false;const lut=lookup[ty*countX+tx];
    for(let i=0;i<256;i++){
      acc+=hist[i];if(!found&&hist[i]>0){first=acc;found=true;}
      lut[i]=tileN<=first?i:clampByte((acc-first)*255/(tileN-first));
    }
  }
  const out=outputLike(input),dst=out.data;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const gx=(x+.5)/tileSize-.5,gy=(y+.5)/tileSize-.5;
    const fx=Math.floor(gx),fy=Math.floor(gy),ax=gx-fx,ay=gy-fy;
    const x0=Math.max(0,Math.min(countX-1,fx)),x1=Math.max(0,Math.min(countX-1,fx+1));
    const y0=Math.max(0,Math.min(countY-1,fy)),y1=Math.max(0,Math.min(countY-1,fy+1));
    const i=y*w+x,v=value[i],a=lookup[y0*countX+x0][v],b=lookup[y0*countX+x1][v],c=lookup[y1*countX+x0][v],d=lookup[y1*countX+x1][v];
    const newV=((a*(1-ax)+b*ax)*(1-ay)+(c*(1-ax)+d*ax)*ay)/255;
    const rgb=hsvToRgb(hue[i],sat[i],newV),p=i*4;
    dst[p]=rgb[0];dst[p+1]=rgb[1];dst[p+2]=rgb[2];
  }
  return out;
}

export function otsuThreshold(input) {
  const hist=luminanceHistogram(input),n=input.width*input.height;
  let total=0;for(let i=0;i<256;i++)total+=i*hist[i];
  let lowCount=0,lowSum=0,best=-1,threshold=0;
  for(let t=0;t<256;t++){
    lowCount+=hist[t];lowSum+=t*hist[t];
    const highCount=n-lowCount;
    if(lowCount===0||highCount===0)continue;
    const m0=lowSum/lowCount,m1=(total-lowSum)/highCount;
    const variance=(lowCount/n)*(highCount/n)*(m0-m1)*(m0-m1);
    if(variance>best){best=variance;threshold=t;}
  }
  return {threshold,variance:best};
}
function intermeansThreshold(input){
  const hist=luminanceHistogram(input);
  let low=0,high=255;while(low<255&&hist[low]===0)low++;while(high>0&&hist[high]===0)high--;
  let t=(low+high)/2,iterations=0;
  for(let k=0;k<100;k++){
    let n0=0,n1=0,s0=0,s1=0;
    for(let i=0;i<256;i++)if(i<=t){n0+=hist[i];s0+=i*hist[i];}else{n1+=hist[i];s1+=i*hist[i];}
    if(n0===0||n1===0)break;
    const next=(s0/n0+s1/n1)/2;iterations=k+1;
    if(Math.abs(next-t)<.5){t=next;break;}t=next;
  }
  return {threshold:t,iterations};
}
function binarize(input, threshold) {return copyGrayTransform(input,v=>v<=threshold?0:255);}

/** Summed Area Table over luminance and squared luminance; Float64 to avoid int32 overflow. */
export function createIntegralImages(input){
  const w=input.width,h=input.height,stride=w+1,plane=grayPlane(input);
  const sum=new Float64Array((w+1)*(h+1)),squared=new Float64Array((w+1)*(h+1));
  for(let y=1;y<=h;y++){
    let row=0,row2=0;
    for(let x=1;x<=w;x++){
      const v=plane[(y-1)*w+(x-1)];row+=v;row2+=v*v;
      const ix=y*stride+x;sum[ix]=sum[ix-stride]+row;squared[ix]=squared[ix-stride]+row2;
    }
  }
  return {width:w,height:h,stride,sum,squared,plane};
}
export function rectStats(sat,x0,y0,x1,y1){
  const w=sat.width,h=sat.height,st=sat.stride;
  x0=Math.max(0,x0);x1=Math.min(w,x1);y0=Math.max(0,y0);y1=Math.min(h,y1);
  const area=Math.max(1,(x1-x0)*(y1-y0));
  const rect=a=>a[y1*st+x1]-a[y0*st+x1]-a[y1*st+x0]+a[y0*st+x0];
  const mean=rect(sat.sum)/area,variance=Math.max(0,rect(sat.squared)/area-mean*mean);
  return {mean,sd:Math.sqrt(variance),area};
}
function adaptive(input,method,radius,k) {
  const sat=createIntegralImages(input),{width:w,height:h}=input,out=new Float64Array(w*h);
  radius=Math.max(1,Math.round(radius));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const {mean,sd}=rectStats(sat,x-radius,y-radius,x+radius+1,y+radius+1);
    const t=method==='bradley'?mean*(1-k):method==='niblack'?mean+k*sd:mean*(1+k*(sd/128-1));
    out[y*w+x]=sat.plane[y*w+x]<=t?0:255;
  }
  return grayImage(w,h,out);
}

function orderStatistic(input,radius,method,percentile,border){
  radius=Math.max(1,Math.round(radius));
  const out=outputLike(input),win=(2*radius+1)**2;
  const cells=new Uint8Array(win),{width:w,height:h}=input;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4;
    for(let c=0;c<3;c++){
      let k=0;
      for(let yy=-radius;yy<=radius;yy++)for(let xx=-radius;xx<=radius;xx++)cells[k++]=input.sample(x+xx,y+yy,c,border);
      if(method==='min'){
        let m=255;for(let j=0;j<win;j++)m=Math.min(m,cells[j]);out.data[p+c]=m;
      }else if(method==='max'){
        let m=0;for(let j=0;j<win;j++)m=Math.max(m,cells[j]);out.data[p+c]=m;
      }else{
        cells.sort();out.data[p+c]=cells[Math.round((win-1)*(method==='median'?.5:percentile/100))];
      }
    }
  }
  return out;
}

function sobelGradient(plane,w,h,border){
  const gx=new Float32Array(w*h),gy=new Float32Array(w*h),mag=new Float32Array(w*h),angle=new Float32Array(w*h);
  let max=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const a=planeAt(plane,w,h,x-1,y-1,border),b=planeAt(plane,w,h,x,y-1,border),c=planeAt(plane,w,h,x+1,y-1,border);
    const d=planeAt(plane,w,h,x-1,y,border),f=planeAt(plane,w,h,x+1,y,border);
    const g=planeAt(plane,w,h,x-1,y+1,border),j=planeAt(plane,w,h,x,y+1,border),k=planeAt(plane,w,h,x+1,y+1,border);
    const idx=y*w+x,gxx=-a+c-2*d+2*f-g+k,gyy=-a-2*b-c+g+2*j+k;
    gx[idx]=gxx;gy[idx]=gyy;max=Math.max(max,mag[idx]=Math.hypot(gxx,gyy));angle[idx]=Math.atan2(gyy,gxx);
  }
  return {gx,gy,mag,angle,max};
}
function angleImage(grad,w,h,threshold=0){
  const out=PixelBuffer.blank(w,h);
  for(let i=0,p=0;i<w*h;i++,p+=4){
    if(grad.mag[i]<threshold)continue;
    const hue=((grad.angle[i]*180/Math.PI+360)%360);
    const brightness=Math.min(1,Math.max(.22,grad.mag[i]/Math.max(1,grad.max)));
    const rgb=hsvToRgb(hue,.9,brightness);
    out.data[p]=rgb[0];out.data[p+1]=rgb[1];out.data[p+2]=rgb[2];
  }
  return out;
}
function gradientSobelResult(input,threshold,border){
  const w=input.width,h=input.height,grad=sobelGradient(grayPlane(input),w,h,border);
  const pixels=new Float64Array(w*h);
  for(let i=0;i<pixels.length;i++)pixels[i]=grad.mag[i]<threshold?0:grad.mag[i]*255/Math.max(1,grad.max);
  return {image:grayImage(w,h,pixels),aux:angleImage(grad,w,h,threshold),meta:{maxGradient:+grad.max.toFixed(2)}};
}
function bilinear(plane,w,h,x,y,border){
  const x0=Math.floor(x),y0=Math.floor(y),dx=x-x0,dy=y-y0;
  const p00=planeAt(plane,w,h,x0,y0,border),p01=planeAt(plane,w,h,x0+1,y0,border);
  const p10=planeAt(plane,w,h,x0,y0+1,border),p11=planeAt(plane,w,h,x0+1,y0+1,border);
  return (p00*(1-dx)+p01*dx)*(1-dy)+(p10*(1-dx)+p11*dx)*dy;
}
/** Canny with real continuous gradient angle, bilinear nonmax suppression, quadratic subpixel offsets, BFS hysteresis. */
export function canny(input,{sigma=1.25,low=35,high=85,border='reflect'}={}){
  const w=input.width,h=input.height,n=w*h;
  const gray=separableGray(grayPlane(input),w,h,gaussianKernel(sigma),border);
  const grad=sobelGradient(gray,w,h,border),nms=new Float32Array(n),subpixel=new Float32Array(n);
  let countCandidates=0,absOffset=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,m=grad.mag[i];if(m===0)continue;
    const ux=grad.gx[i]/m,uy=grad.gy[i]/m;
    const backward=bilinear(grad.mag,w,h,x-ux,y-uy,border);
    const forward=bilinear(grad.mag,w,h,x+ux,y+uy,border);
    if(m>=backward&&m>=forward){
      nms[i]=m;
      const denominator=backward-2*m+forward;
      const offset=Math.abs(denominator)>1e-7?Math.max(-.5,Math.min(.5,.5*(backward-forward)/denominator)):0;
      subpixel[i]=offset;
      absOffset+=Math.abs(offset);countCandidates++;
    }
  }
  const hi=Math.max(low,high),lo=Math.min(low,high);
  const labels=new Uint8Array(n),queue=new Int32Array(n),out=new Float64Array(n);
  let tail=0,head=0;
  for(let i=0;i<n;i++)if(nms[i]>=hi){labels[i]=2;queue[tail++]=i;}
  const seeds=tail;
  while(head<tail){
    const i=queue[head++],x=i%w,y=Math.floor(i/w);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;
      if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const j=yy*w+xx;
      if(!labels[j]&&nms[j]>=lo){labels[j]=2;queue[tail++]=j;}
    }
  }
  for(let i=0;i<n;i++)if(labels[i])out[i]=255;
  return {image:grayImage(w,h,out),aux:angleImage(grad,w,h,lo),meta:{edgePixels:tail,strongSeeds:seeds,subpixelMeanAbsoluteOffset:countCandidates?(absOffset/countCandidates):0,subpixelCandidates:countCandidates}};
}
function points(input,threshold,border){
  const plane=grayPlane(input),w=input.width,h=input.height,out=new Float64Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const center=plane[y*w+x];let neigh=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)neigh+=planeAt(plane,w,h,x+dx,y+dy,border);
    out[y*w+x]=Math.abs(8*center-neigh)>=threshold*8?255:0;
  }
  return grayImage(w,h,out);
}
function hough(input,threshold,maxLines,border){
  const w=input.width,h=input.height,grad=sobelGradient(grayPlane(input),w,h,border);
  const diagonal=Math.ceil(Math.hypot(w,h)),binCount=2*diagonal+1,nA=180;
  const acc=new Int32Array(nA*binCount),cos=new Float32Array(nA),sin=new Float32Array(nA);
  for(let a=0;a<nA;a++){cos[a]=Math.cos(a*Math.PI/nA);sin[a]=Math.sin(a*Math.PI/nA);}
  // Bound runtime on very large frames by deterministic spatial subsampling.
  const stride=Math.max(1,Math.ceil((w*h)/70000));let samples=0;
  for(let i=0;i<w*h;i+=stride)if(grad.mag[i]>=threshold){
    const x=i%w,y=(i/w)|0;samples++;
    for(let a=0;a<nA;a++){
      const rho=Math.round(x*cos[a]+y*sin[a])+diagonal;
      acc[a*binCount+rho]++;
    }
  }
  const peaks=[],minVotes=Math.max(10,Math.ceil(Math.min(w,h)/12/stride));
  for(let a=2;a<nA-2;a++)for(let r=2;r<binCount-2;r++){
    const val=acc[a*binCount+r];if(val<minVotes)continue;
    let isMax=true;
    for(let da=-2;da<=2&&isMax;da++)for(let dr=-4;dr<=4;dr++){
      if((da||dr)&&acc[(a+da)*binCount+r+dr]>val){isMax=false;break;}
    }
    if(isMax)peaks.push({theta:a,rho:r-diagonal,votes:val});
  }
  peaks.sort((a,b)=>b.votes-a.votes);
  const chosen=[];
  for(const peak of peaks){
    if(chosen.length>=maxLines)break;
    if(chosen.some(p=>Math.abs(p.theta-peak.theta)<5 && Math.abs(p.rho-peak.rho)<12))continue;
    chosen.push(peak);
  }
  const out=input.clone();
  // In-place per-pixel overlay, no Canvas drawing primitives.
  for(const line of chosen){
    const nx=cos[line.theta],ny=sin[line.theta],rho=line.rho;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(Math.abs(x*nx+y*ny-rho)<=.65){const p=(y*w+x)*4;out.data[p]=255;out.data[p+1]=60;out.data[p+2]=70;}
    }
  }
  return {image:out,aux:angleImage(grad,w,h,threshold),meta:{lineCount:chosen.length,edgeSamples:samples,lines:chosen}};
}

export function structuringOffsets(shape='disk',radius=2){
  radius=Math.max(1,Math.round(radius));const offsets=[];
  for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
    const ok=shape==='square'||shape==='cross'?(shape==='square'||x===0||y===0):shape==='diamond'?(Math.abs(x)+Math.abs(y)<=radius):(x*x+y*y<=radius*radius);
    if(ok)offsets.push([x,y]);
  }
  return offsets;
}
function morphBasic(plane,w,h,offsets,operation,border){
  const out=new Float64Array(w*h),erosion=operation==='erosion';
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let val=erosion?255:0;
    for(const [dx,dy] of offsets){
      const v=planeAt(plane,w,h,x+dx,y+dy,border);
      val=erosion?Math.min(val,v):Math.max(val,v);
    }
    out[y*w+x]=val;
  }
  return out;
}
function morphology(input,method,shape,radius,border){
  const w=input.width,h=input.height,gray=grayPlane(input),offsets=structuringOffsets(shape,radius);
  const E=plane=>morphBasic(plane,w,h,offsets,'erosion',border),D=plane=>morphBasic(plane,w,h,offsets,'dilation',border);
  let result;
  switch(method){
    case 'erosion':result=E(gray);break;
    case 'dilation':result=D(gray);break;
    case 'opening':result=D(E(gray));break;
    case 'closing':result=E(D(gray));break;
    case 'morph-gradient':{
      const d=D(gray),e=E(gray);result=d.map((v,i)=>v-e[i]);break;
    }
    case 'top-hat':{
      const opened=D(E(gray));result=gray.map((v,i)=>Math.max(0,v-opened[i]));break;
    }
    case 'black-hat':{
      const closed=E(D(gray));result=gray.map((v,i)=>Math.max(0,closed[i]-v));break;
    }
    default:throw Error(`Неизвестная морфологическая операция: ${method}`);
  }
  return grayImage(w,h,result);
}

export function applyAlgorithm(input,options){
  const method=options.method,border=options.border??'reflect';
  if(!(input instanceof PixelBuffer))throw Error('Ожидается PixelBuffer');
  let image,aux=null,meta={};
  switch(method){
    case 'negative':image=copyRGBTransform(input,v=>255-v);break;
    case 'brightness':image=copyRGBTransform(input,v=>v+(+options.delta||0));break;
    case 'gamma':image=copyRGBTransform(input,v=>255*Math.pow(v/255,+options.gamma||1));break;
    case 'contrast':({image,meta}=linearContrast(input,+options.clip||0));break;
    case 'gaussian':image=blurRGB(input,gaussianKernel(+options.sigma||1.35),border);break;
    case 'box':image=blurRGB(input,boxKernel(+options.size||5),border);break;
    case 'laplacian':image=laplacianSharpen(input,+options.amount||1,border);break;
    case 'unsharp':image=unsharp(input,+options.sigma||1.35,+options.amount||1,border);break;
    case 'median':case 'min':case 'max':case 'percentile':
      image=orderStatistic(input,+options.radius||1,method,+options.percentile||50,border);break;
    case 'hist-rgb':image=equalizeRGB(input);break;
    case 'hist-hsv':image=equalizeHSV(input);break;
    case 'clahe':image=clahe(input,+options.tileSize||64,+options.clipLimit||2);break;
    case 'otsu':{
      const result=otsuThreshold(input);image=binarize(input,result.threshold);meta=result;break;
    }
    case 'intermeans':{
      const result=intermeansThreshold(input);image=binarize(input,result.threshold);meta=result;break;
    }
    case 'manual':image=binarize(input,+(options.threshold ?? 128));meta={threshold:+(options.threshold ?? 128)};break;
    case 'bradley':case 'sauvola':case 'niblack':
      image=adaptive(input,method,+options.radius||15,+(options.k ?? .2));break;
    case 'sobel':({image,aux,meta}=gradientSobelResult(input,+options.threshold||30,border));break;
    case 'canny':({image,aux,meta}=canny(input,{sigma:+options.sigma||1.25,low:+options.low||35,high:+options.high||85,border}));break;
    case 'points':image=points(input,+options.threshold||30,border);break;
    case 'hough':({image,aux,meta}=hough(input,+options.threshold||90,+options.lines||8,border));break;
    case 'erosion':case 'dilation':case 'opening':case 'closing':case 'morph-gradient':case 'top-hat':case 'black-hat':
      image=morphology(input,method,options.shape??'disk',+options.radius||2,border);break;
    default:throw Error(`Неизвестный метод: ${method}`);
  }
  return {image,aux,meta};
}
