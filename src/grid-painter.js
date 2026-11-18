/** Presentation ONLY. No raster algorithm reaches Canvas2D. */
export class GridPainter {
  constructor(canvas) { this.canvas=canvas; this.ctx=canvas.getContext('2d'); }
  render(grid, zoom=16, options={}) {
    const g=Math.max(5,Math.min(32,zoom));
    const canvas=this.canvas, ctx=this.ctx;
    canvas.width=grid.width*g; canvas.height=grid.height*g;
    ctx.fillStyle='#0b1427';ctx.fillRect(0,0,canvas.width,canvas.height);
    // Pixel centers represent integer mathematical coordinates.
    for(let row=0;row<grid.height;row++) for(let col=0;col<grid.width;col++) {
      const alpha=grid.data[row*grid.width+col]/255;
      if (!alpha) continue;
      // White-background alpha composited explicitly over the dark raster.
      const r=Math.round(11*(1-alpha)+76*alpha);
      const gg=Math.round(20*(1-alpha)+217*alpha);
      const b=Math.round(39*(1-alpha)+241*alpha);
      ctx.fillStyle=`rgb(${r},${gg},${b})`;
      ctx.fillRect(col*g+1,row*g+1,Math.max(1,g-1),Math.max(1,g-1));
    }
    if (options.grid!==false) {
      ctx.fillStyle='#293550';
      for(let col=0;col<=grid.width;col++)ctx.fillRect(col*g,0,1,canvas.height);
      for(let row=0;row<=grid.height;row++)ctx.fillRect(0,row*g,canvas.width,1);
    }
    if (options.axes!==false) {
      ctx.fillStyle='#d7a663';
      if(grid.originX>=0&&grid.originX<grid.width)ctx.fillRect((grid.originX+.5)*g-1,0,2,canvas.height);
      if(grid.originY>=0&&grid.originY<grid.height)ctx.fillRect(0,(grid.originY+.5)*g-1,canvas.width,2);
      ctx.fillStyle='#ebd3b0';
      ctx.font=`${Math.max(9,Math.min(12,g*.68))}px sans-serif`;
      const step=g<=11?10:5;
      ctx.textAlign='center';ctx.textBaseline='top';
      for(let x=-grid.originX; x<grid.width-grid.originX; x++) {
        if (x===0 || x%step!==0) continue;
        ctx.fillText(String(x),(x+grid.originX+.5)*g,Math.min(canvas.height-14,(grid.originY+.5)*g+4));
      }
      ctx.textAlign='left';ctx.textBaseline='middle';
      for(let y=grid.originY;y>grid.originY-grid.height;y--) {
        if(y===0||y%step!==0)continue;
        ctx.fillText(String(y),Math.min(canvas.width-24,(grid.originX+.5)*g+5),(grid.originY-y+.5)*g);
      }
      ctx.fillText('0', Math.min(canvas.width-14,(grid.originX+.5)*g+4), Math.max(8,(grid.originY+.5)*g-9));
    }
  }
}
