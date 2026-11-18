/** Extended, reproducible property sweep for rotated conic ellipses. */
import {RasterEngine as R} from '../src/raster-engine.js';

let total=0, incomplete=0, start=performance.now();
const target={setPixel(x,y,a=1){
  if(!Number.isInteger(x)||!Number.isInteger(y)||!(a>=0&&a<=1))throw Error(`Invalid pixel (${x},${y}): ${a}`);
}};
for(let a=1;a<=30;a++)for(let b=1;b<=30;b++)for(const angle of [0,15,30,45,60]){
  const rad=angle*Math.PI/180;
  const px=Math.round(a*Math.cos(rad)),py=Math.round(a*Math.sin(rad));
  const qx=Math.round(-b*Math.sin(rad)),qy=Math.round(b*Math.cos(rad));
  const r=R.pittewayEllipse(0,0,px,py,qx,qy,target);
  total++;
  if(!r.completed){incomplete++;console.error('Not completed:',{a,b,angle,result:r});}
}
console.log(`Pitteway ellipses: ${total-incomplete}/${total} complete, ${(performance.now()-start).toFixed(1)} ms`);
if(total!==4500||incomplete)process.exitCode=1;
