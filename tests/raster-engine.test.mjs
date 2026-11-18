import test from 'node:test';
import assert from 'node:assert/strict';
import {RasterEngine as R} from '../src/raster-engine.js';
import {VirtualGrid} from '../src/virtual-grid.js';

const o=[ [11,3],[3,11],[-3,11],[-11,3],[-11,-3],[-3,-11],[3,-11],[11,-3] ];
const entries=[];
const target={setPixel(x,y,a=1){entries.push({x,y,a})}};
for(const [name,fn] of [['step',R.stepLine],['dda',R.ddaLine],['bres',R.bresenhamLine],['wu',R.wuLine]]) {
  test(`${name}: 8 octants + reverse + endpoints`,()=>{
    for(const [dx,dy] of o)for(const reverse of [false,true]) {
      entries.length=0;
      const [sx,sy,ex,ey]=reverse?[dx,dy,0,0]:[0,0,dx,dy];
      fn(sx,sy,ex,ey,target);
      const p=entries.filter(z=>z.a>0);
      assert.ok(p.some(z=>z.x===sx&&z.y===sy),name);
      assert.ok(p.some(z=>z.x===ex&&z.y===ey),name);
      assert.ok(p.every(z=>Number.isInteger(z.x)&&Number.isInteger(z.y)&&z.a<=1&&z.a>=0));
      const unique=[...new Set(p.map(z=>`${z.x},${z.y}`))];
      assert.ok(unique.length>=12 && unique.length<=25);
    }
  });
  test(`${name}: point, horizontal, vertical`,()=>{
    for(const [x,y,ex,ey] of [[-5,2,-5,2],[-7,3,7,3],[1,-9,1,9]]) {
      entries.length=0;fn(x,y,ex,ey,target);
      assert.ok(entries.some(p=>p.x===x&&p.y===y&&p.a>0));
      assert.ok(entries.some(p=>p.x===ex&&p.y===ey&&p.a>0));
    }
  });
}
test('Bresenham exact count & 8-neighbor connectivity on diverse lines',()=>{
  for(let dx=-20;dx<=20;dx++)for(let dy=-20;dy<=20;dy++) {
    entries.length=0;R.bresenhamLine(3,-6,3+dx,-6+dy,target);
    const pts=entries.map(({x,y})=>[x,y]);
    assert.equal(pts.length,Math.max(Math.abs(dx),Math.abs(dy))+1);
    for(let i=1;i<pts.length;i++){
      const [x0,y0]=pts[i-1],[x1,y1]=pts[i];
      assert.equal(Math.max(Math.abs(x1-x0),Math.abs(y1-y0)),1);
    }
  }
});
test('Wu uses real complementary fractional intensities',()=>{
  entries.length=0;R.wuLine(0,0,10,4,target);
  const a=entries.filter(z=>z.x===1); 
  assert.equal(a.length,2);
  assert.ok(Math.abs(a[0].a+a[1].a-1)<1e-9);
  assert.ok(a.some(z=>Math.abs(z.a-.6)<1e-9));
  assert.ok(a.some(z=>Math.abs(z.a-.4)<1e-9));
});
test('circle 8-symmetric, radius=0 and cardinal points',()=>{
  for(const r of [0,1,2,3,10,21]){
    entries.length=0;R.bresenhamCircle(2,-3,r,target);
    const pts=new Set(entries.map(z=>`${z.x},${z.y}`));
    for(const {x,y} of entries){
      for(const [a,b] of [[x-2,y+3],[-(x-2),y+3],[x-2,-(y+3)],[-(x-2),-(y+3)],[(y+3),x-2]])
        assert.ok(pts.has(`${2+a},${-3+b}`));
    }
    assert.ok(pts.has(`${2+r},-3`));assert.ok(pts.has(`${2-r},-3`));
    assert.ok(pts.has(`2,${-3+r}`));assert.ok(pts.has(`2,${-3-r}`));
  }
});
test('VirtualGrid maps positive math-Y upward, clamps alpha',()=>{
  const g=new VirtualGrid(21,21);
  g.setPixel(-2,3,.35);
  assert.ok(Math.abs(g.getPixel(-2,3)-.35)<.005);
  assert.equal(g.getPixel(3,-2),0);
  g.setPixel(-2,3,.1);assert.ok(g.getPixel(-2,3)>.3);
  g.setPixel(-2,3,5);assert.equal(g.getPixel(-2,3),1);
  g.clear();assert.equal(g.pixelCount(),0);
});
test('Pitteway conic ellipse is complete for ordinary radii',()=>{
  for(const [rx,ry] of [[10,10],[15,8],[6,14],[20,10],[8,8],[9,17]]){
    const grid=new VirtualGrid(101,101);
    const result=R.pittewayEllipse(0,0,rx,0,0,ry,grid);
    assert.equal(result.completed,true,`${rx}/${ry}: ${JSON.stringify(result)}`);
    assert.ok(grid.getPixel(rx,0)>0);
    assert.ok(grid.getPixel(-rx,0)>0);
    assert.ok(grid.getPixel(0,ry)>0);
    assert.ok(grid.getPixel(0,-ry)>0);
    assert.ok(grid.pixelCount()>=Math.max(rx,ry)*4);
  }
});
test('Pitteway curved parabolic arc hits endpoints',()=>{
  const grid=new VirtualGrid(101,101);
  const status=R.pittewayParabola(-16,-8,0,15,16,-8,grid);
  assert.equal(status.completed,true,JSON.stringify(status));
  assert.ok(grid.getPixel(-16,-8)>0 && grid.getPixel(16,-8)>0);
  assert.ok(grid.pixelCount()>32);
});
