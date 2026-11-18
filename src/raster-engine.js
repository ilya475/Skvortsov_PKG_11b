/**
 * Pure rasterization kernels. NO Canvas/DOM/drawing primitives here.
 * Each method receives IRasterTarget with setPixel(int x,int y,double alpha).
 * All coordinates and radii are integers. Only Wu and DDA use fractions.
 * The general conic update follows M. L. V. Pitteway's finite-difference
 * algorithm as discussed by Foley et al. and J. VanAken (MIT source, 2019).
 */
export class RasterEngine {
  static stepLine(x0, y0, x1, y1, target, trace = null) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (n === 0) { target.setPixel(x0, y0, 1); if (trace) trace.push({x:x0,y:y0,k:0,t:0}); return; }
    // Each point is evaluated directly from the parametric equation.
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = Math.round(x0 + dx * t), y = Math.round(y0 + dy * t);
      target.setPixel(x, y, 1);
      if (trace) trace.push({x,y,k,t});
    }
  }

  static ddaLine(x0, y0, x1, y1, target, trace = null) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (n === 0) { target.setPixel(x0,y0); if (trace) trace.push({x:x0,y:y0,k:0,xf:x0,yf:y0}); return; }
    const incX = dx/n, incY = dy/n;
    let xf = x0, yf = y0;
    for (let k = 0; k <= n; k++) {
      // Coordinates are projected onto the pixel lattice at each iteration.
      const x = Math.round(xf), y = Math.round(yf);
      target.setPixel(x,y);
      if (trace) trace.push({x,y,k,xf,yf});
      xf += incX; yf += incY;
    }
    // Counter the small floating-point accumulation error at the last point.
    target.setPixel(x1,y1);
  }

  static bresenhamLine(x0, y0, x1, y1, target, trace = null) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    // All octants, including steep, reversed, vertical, horizontal and point.
    let error = dx - dy, x = x0, y = y0, k = 0;
    while (true) {
      target.setPixel(x,y);
      if (trace) trace.push({x,y,k,err:error,e2:2*error});
      if (x === x1 && y === y1) break;
      const e2 = 2 * error;
      if (e2 > -dy) { error -= dy; x += sx; }
      if (e2 <  dx) { error += dx; y += sy; }
      k++;
    }
  }

  static wuLine(x0, y0, x1, y1, target, trace = null) {
    let steep = Math.abs(y1-y0) > Math.abs(x1-x0);
    if (steep) { [x0,y0] = [y0,x0]; [x1,y1] = [y1,x1]; }
    if (x0 > x1) { [x0,x1] = [x1,x0]; [y0,y1] = [y1,y0]; }
    const dx=x1-x0, dy=y1-y0;
    const gradient = dx === 0 ? 0 : dy/dx;
    for (let x=x0; x<=x1; x++) {
      const yf = y0 + gradient*(x-x0);
      const y = Math.floor(yf), fraction = yf-y;
      if (steep) {
        target.setPixel(y,x,1-fraction);
        if (fraction>1e-12) target.setPixel(y+1,x,fraction);
        if (trace) trace.push({x:x,y:y,yf,a1:1-fraction,a2:fraction,steep:1});
      } else {
        target.setPixel(x,y,1-fraction);
        if (fraction>1e-12) target.setPixel(x,y+1,fraction);
        if (trace) trace.push({x,y,yf,a1:1-fraction,a2:fraction,steep:0});
      }
    }
  }

  static bresenhamCircle(cx, cy, radius, target, trace = null) {
    if (!Number.isInteger(radius) || radius < 0) throw new RangeError('Radius must be a nonnegative integer');
    let x = 0, y = radius, decision = 3-2*radius, k=0;
    while (x<=y) {
      const pts=[[x,y],[-x,y],[x,-y],[-x,-y],[y,x],[-y,x],[y,-x],[-y,-x]];
      for (const [px,py] of pts) target.setPixel(cx+px,cy+py);
      if (trace) trace.push({x,y,d:decision,k,points:pts.length});
      if (decision < 0) decision += 4*x+6;
      else { decision += 4*(x-y)+10; y--; }
      x++; k++;
    }
  }

  static getConicOctant(dx,dy) {
    let oct=0;
    if (dx<0) { oct=7; dx=-dx; }
    if (dy>0) { oct^=3; dy=-dy; }
    if (dx > -dy) oct^=1;
    return oct+1;
  }

  /**
   * General Pitteway conic F(x,y)=Ax^2+Bxy+Cy^2+Dx+Ey+F.
   * Coefficients are expressed relative to the START point (xs,ys).
   * Returns an object reporting successful/partial traversal.
   * In contrast with a midpoint ellipse-only implementation, this
   * tracks 8 changing tangent octants, updating integer differences.
   */
  static pittewayConic(xs,ys,xe,ye,A,B,C,D,E,F,target,trace=null,maxPixels=100000) {
    let octant=RasterEngine.getConicOctant(D,E);
    let count;
    if (xs!==xe || ys!==ye) {
      const dx=xe-xs, dy=ye-ys;
      const ex=2*A*dx+B*dy+D, ey=B*dx+2*C*dy+E;
      count=RasterEngine.getConicOctant(ex,ey)-octant;
      if (count<0) count+=8;
    } else count=8;
    let diagX=1,diagY=1,squareX=0,squareY=0;
    if ((octant+1)&4) {D=-D;diagX=-1;}
    if ((octant-1)&4) {E=-E;diagY=-1;}
    if ((octant-1)&2) B=-B;
    if (octant&2) {
      squareY=diagY;
      [A,C]=[C,A]; [D,E]=[E,D];
    } else squareX=diagX;
    A*=4; B*=4; C*=4; D*=4; E*=4; F*=4;
    let d=A+B/2+C/4+D+E/2+F;
    let u=A+B/2+D, v=A+B/2+D+E;
    let k1=2*A, k2=2*A+B, k3=2*A+2*B+2*C;
    if (!(octant&1)) { d=-d;u=-u;v=-v;k1=-k1;k2=-k2;k3=-k3; }
    let x=xs,y=ys,drawn=0,pixelCount=-1;
    while (count>=0) {
      if (count===0) pixelCount=(octant&2) ? 1+Math.abs(ye-y) : 1+Math.abs(xe-x);
      while ((u>0 || (octant&1)) && (v<0 || !(octant&1))) {
        target.setPixel(x,y);
        if (trace) trace.push({x,y,octant,d,u,v,k:drawn});
        drawn++;
        if (drawn>=maxPixels) return {completed:false,reason:'maxPixels',drawn};
        if (--pixelCount===0) return {completed:true,drawn};
        if (d<0) { // square step
          x+=squareX; y+=squareY;
          u+=k1; v+=k2; d+=u;
        } else { // diagonal step
          x+=diagX; y+=diagY;
          u+=k2; v+=k3; d+=v;
        }
      }
      if (--count<0) {
        // In rare very thin conics, tangent octants may change within
        // a single cell: report it instead of pretending full accuracy.
        // The conic loop stops immediately before revisiting the start
        // pixel on a closed ellipse (typically at x=xs, y=ys-1).
        if (xs === xe && ys === ye && Math.max(Math.abs(x-xs),Math.abs(y-ys)) <= 1)
          return {completed:true,reason:'closed',drawn};
        // An open arc may miss its final pixel in the last octant; use
        // an explicitly reported Bresenham connector, as in the source.
        RasterEngine.bresenhamLine(x,y,xe,ye,target);
        return {completed:true,reason:'endpoint-connector',drawn,connector:true};
      }
      ++octant;
      if (octant&1) { // square-octant crossing
        d=-d-u+v-k1+k2;
        v=-2*u+v-k1+k2;
        u=-u-k1+k2;
        k3=-4*k1+4*k2-k3;
        k2=-2*k1+k2;
        k1=-k1;
        [diagX,diagY]=[-diagY,diagX];
      } else { // diagonal-octant crossing
        d=-d+u-v/2+k2/2-3*k3/8;
        u=u-v+k2/2-k3/2;
        v=-v+k2-k3/2;
        k1=-k1+2*k2-k3;
        k2=k2-k3;
        k3=-k3;
        [squareX,squareY]=[-squareY,squareX];
      }
    }
    return {completed:false,reason:'unexpected',drawn};
  }

  /** Integer Pitteway conic ellipse, optionally rotated through integer conjugate diameters. */
  static pittewayEllipse(cx,cy,p1x,p1y,p2x,p2y,target,trace=null) {
    let px=p1x-cx, py=p1y-cy, qx=p2x-cx, qy=p2y-cy;
    const A=py*py+qy*qy, B=-2*(px*py+qx*qy), C=px*px+qx*qx;
    let cross=px*qy-qx*py;
    if (cross===0) return {completed:false,reason:'degenerate',drawn:0};
    if (cross<0) { [p1x,p2x]=[p2x,p1x]; [p1y,p2y]=[p2y,p1y]; [px,qx]=[qx,px]; [py,qy]=[qy,py]; cross=-cross; }
    const D=2*qy*cross, E=-2*qx*cross, F=0;
    const budget=32*(Math.abs(px)+Math.abs(py)+Math.abs(qx)+Math.abs(qy)+1);
    return RasterEngine.pittewayConic(p1x,p1y,p1x,p1y,A,B,C,D,E,F,target,trace,budget);
  }

  /** Quadratic parabolic spline (conic), control point Pc. */
  static pittewayParabola(xs,ys,xc,yc,xe,ye,target,trace=null) {
    let qx=xe-xs,qy=ye-ys,rx=xc-xs,ry=yc-ys;
    let cross=rx*qy-qx*ry;
    if (cross===0) {
      RasterEngine.bresenhamLine(xs,ys,xc,yc,target);
      RasterEngine.bresenhamLine(xc,yc,xe,ye,target);
      return {completed:true,reason:'degenerate-to-lines',drawn:0};
    }
    if (cross<0) {
      [xs,xe]=[xe,xs]; [ys,ye]=[ye,ys];
      qx=-qx;qy=-qy;rx+=qx;ry+=qy;cross=-cross;
    }
    const A=4*(ry-qy)*ry+qy*qy;
    const B=4*((qx-rx)*ry-(ry-qy)*rx)-2*qx*qy;
    const C=4*(rx-qx)*rx+qx*qx;
    const D=4*ry*cross, E=-4*rx*cross, F=0;
    const budget=64*(Math.abs(qx)+Math.abs(qy)+Math.abs(rx)+Math.abs(ry)+1);
    return RasterEngine.pittewayConic(xs,ys,xe,ye,A,B,C,D,E,F,target,trace,budget);
  }
}
