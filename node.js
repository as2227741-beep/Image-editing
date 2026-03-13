// ── STATE ──
const mainCanvas = document.getElementById('main-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const ctx = mainCanvas.getContext('2d');
const octx = overlayCanvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

let originalImage = null; // ImageData of source after each committed edit
let baseImageData = null; // working base before adjustments
let currentTool = 'select';
let zoom = 1;
let adjustments = { brightness:0,contrast:0,saturation:0,hue:0,exposure:0,blur:0,opacity:100 };
let currentFilter = 'none';
let history = [];
let historyIndex = -1;
let drawing = false;
let drawStart = {x:0,y:0};
let cropRect = null;
let cropAspect = 'free';
let freeRotateDeg = 0;

// ── SECTIONS ──
function toggleSection(hd){
  const body = hd.nextElementSibling;
  const arrow = hd.querySelector('span:last-child');
  body.classList.toggle('collapsed');
  arrow.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
}

// ── TOOLS ──
function setTool(t){
  currentTool = t;
  document.querySelectorAll('.tool').forEach(el=>el.classList.remove('active'));
  const btn = document.getElementById('tool-'+t);
  if(btn) btn.classList.add('active');
  document.getElementById('stat-tool').textContent = t;

  // cursor
  const cursors = {select:'default',crop:'crosshair',brush:'crosshair',eraser:'crosshair',
    text:'text',rect:'crosshair',line:'crosshair',eyedrop:'crosshair',blur:'crosshair'};
  mainCanvas.style.cursor = cursors[t]||'default';

  if(t!=='crop'){ octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height); cropRect=null; }
}

// ── OPEN / DROP ──
function triggerOpen(){ document.getElementById('file-input').click(); }

function loadFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => loadImageSrc(ev.target.result);
  reader.readAsDataURL(file);
}

function handleDrop(e){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if(!file||!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => loadImageSrc(ev.target.result);
  reader.readAsDataURL(file);
}

function loadImageSrc(src){
  const img = new Image();
  img.onload = () => {
    mainCanvas.width = img.width;
    mainCanvas.height = img.height;
    overlayCanvas.width = img.width;
    overlayCanvas.height = img.height;
    ctx.drawImage(img,0,0);
    originalImage = ctx.getImageData(0,0,img.width,img.height);
    baseImageData = ctx.getImageData(0,0,img.width,img.height);
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('stat-size').textContent = img.width+'×'+img.height;
    zoomFit();
    pushHistory('Open');
    resetSliders();
  };
  img.src = src;
}

// ── ZOOM ──
function zoomIn(){ zoom = Math.min(zoom*1.25,10); applyZoom(); }
function zoomOut(){ zoom = Math.max(zoom/1.25,0.05); applyZoom(); }
function zoomFit(){
  if(!mainCanvas.width) return;
  const area = document.getElementById('canvas-area');
  const pw = area.clientWidth-48, ph = area.clientHeight-48;
  zoom = Math.min(pw/mainCanvas.width, ph/mainCanvas.height, 1);
  applyZoom();
}
function applyZoom(){
  wrap.style.transform = `translate(-50%,-50%) scale(${zoom})`;
  document.getElementById('zoom-label').querySelector('span').textContent = Math.round(zoom*100);
}

// ── ADJUSTMENTS ──
const adjustIds = ['brightness','contrast','saturation','hue','exposure','blur','opacity'];
function applyAdjust(){
  adjustIds.forEach(id=>{
    const sl = document.getElementById('sl-'+id);
    adjustments[id] = parseFloat(sl.value);
    document.getElementById('v-'+id).textContent = sl.value;
    // update slider fill
    const min = parseFloat(sl.min), max = parseFloat(sl.max), val = parseFloat(sl.value);
    const pct = ((val-min)/(max-min))*100;
    sl.style.setProperty('--pct', pct+'%');
  });
  renderAdjustments();
}

function renderAdjustments(){
  if(!baseImageData) return;
  ctx.putImageData(baseImageData,0,0);

  const b = adjustments.brightness/100;
  const c = (adjustments.contrast/100)+1;
  const s = (adjustments.saturation/100)+1;
  const h = adjustments.hue;
  const e = adjustments.exposure/100;
  const blur = adjustments.blur;
  const opacity = adjustments.opacity/100;

  const data = new Uint8ClampedArray(baseImageData.data);

  for(let i=0;i<data.length;i+=4){
    let r=data[i],g=data[i+1],bch=data[i+2],a=data[i+3];
    // brightness + exposure
    r = r*(1+e) + b*255;
    g = g*(1+e) + b*255;
    bch = bch*(1+e) + b*255;
    // contrast
    r = (r-128)*c+128;
    g = (g-128)*c+128;
    bch = (bch-128)*c+128;
    // saturation via luminance
    const lum = 0.2126*r + 0.7152*g + 0.0722*bch;
    r = lum + (r-lum)*s;
    g = lum + (g-lum)*s;
    bch = lum + (bch-lum)*s;
    data[i]=clamp(r); data[i+1]=clamp(g); data[i+2]=clamp(bch); data[i+3]=a;
  }

  // apply filter presets on top
  applyFilterToData(data, currentFilter);

  const imgData = new ImageData(data, baseImageData.width, baseImageData.height);
  ctx.putImageData(imgData,0,0);

  // hue-rotate via canvas filter
  if(h!==0){
    const snap = ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
    ctx.filter = `hue-rotate(${h}deg)`;
    const tmp = document.createElement('canvas');
    tmp.width=mainCanvas.width; tmp.height=mainCanvas.height;
    const tc=tmp.getContext('2d');
    tc.putImageData(snap,0,0);
    ctx.drawImage(tmp,0,0);
    ctx.filter='none';
  }
  // blur
  if(blur>0){
    const snap2 = ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
    ctx.filter=`blur(${blur}px)`;
    const tmp2=document.createElement('canvas');
    tmp2.width=mainCanvas.width; tmp2.height=mainCanvas.height;
    tmp2.getContext('2d').putImageData(snap2,0,0);
    ctx.drawImage(tmp2,0,0);
    ctx.filter='none';
  }
  // opacity overlay
  if(opacity<1){
    ctx.globalAlpha=1-opacity;
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,mainCanvas.width,mainCanvas.height);
    ctx.globalAlpha=1;
  }
}

function clamp(v){ return Math.max(0,Math.min(255,Math.round(v))); }

function applyFilterToData(data, filter){
  if(filter==='none') return;
  for(let i=0;i<data.length;i+=4){
    let r=data[i],g=data[i+1],b=data[i+2];
    if(filter==='grayscale'){const l=0.299*r+0.587*g+0.114*b;data[i]=data[i+1]=data[i+2]=l;}
    else if(filter==='sepia'){data[i]=clamp(r*.393+g*.769+b*.189);data[i+1]=clamp(r*.349+g*.686+b*.168);data[i+2]=clamp(r*.272+g*.534+b*.131);}
    else if(filter==='invert'){data[i]=255-r;data[i+1]=255-g;data[i+2]=255-b;}
    else if(filter==='warm'){data[i]=clamp(r+30);data[i+1]=clamp(g+10);data[i+2]=clamp(b-20);}
    else if(filter==='cool'){data[i]=clamp(r-20);data[i+1]=clamp(g+5);data[i+2]=clamp(b+30);}
    else if(filter==='fade'){data[i]=clamp(r*.85+25);data[i+1]=clamp(g*.85+25);data[i+2]=clamp(b*.85+25);}
    else if(filter==='vivid'){const l=0.299*r+0.587*g+0.114*b;data[i]=clamp(l+(r-l)*1.8);data[i+1]=clamp(l+(g-l)*1.8);data[i+2]=clamp(l+(b-l)*1.8);}
    else if(filter==='noir'){const l=0.299*r+0.587*g+0.114*b;const n=l<128?l*.6:l*.9+20;data[i]=data[i+1]=data[i+2]=clamp(n);}
    else if(filter==='chrome'){const l=0.299*r+0.587*g+0.114*b;data[i]=clamp(l+(r-l)*.6+30);data[i+1]=clamp(l+(g-l)*.6+15);data[i+2]=clamp(l+(b-l)*.3);}
  }
}

function setFilter(name, btn){
  currentFilter = name;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderAdjustments();
}

function resetSliders(){
  adjustIds.forEach(id=>{
    const sl = document.getElementById('sl-'+id);
    sl.value = id==='opacity'?100:0;
  });
  adjustments = {brightness:0,contrast:0,saturation:0,hue:0,exposure:0,blur:0,opacity:100};
  applyAdjust();
  currentFilter='none';
  document.querySelectorAll('.filter-btn').forEach((b,i)=>{b.classList.toggle('active',i===0)});
}
function resetAdjustments(){ resetSliders(); renderAdjustments(); }

// ── TRANSFORM ──
function rotateCanvas(deg){
  if(!baseImageData) return;
  commitAdjust();
  const tmp=document.createElement('canvas');
  const rad=deg*Math.PI/180;
  if(deg===90||deg===-90){ tmp.width=mainCanvas.height; tmp.height=mainCanvas.width; }
  else{ tmp.width=mainCanvas.width; tmp.height=mainCanvas.height; }
  const tc=tmp.getContext('2d');
  tc.translate(tmp.width/2,tmp.height/2);
  tc.rotate(rad);
  tc.drawImage(mainCanvas,-mainCanvas.width/2,-mainCanvas.height/2);
  mainCanvas.width=tmp.width; mainCanvas.height=tmp.height;
  overlayCanvas.width=tmp.width; overlayCanvas.height=tmp.height;
  ctx.drawImage(tmp,0,0);
  originalImage=ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
  baseImageData=new ImageData(new Uint8ClampedArray(originalImage.data),originalImage.width,originalImage.height);
  document.getElementById('stat-size').textContent=mainCanvas.width+'×'+mainCanvas.height;
  zoomFit();
  pushHistory('Rotate '+deg+'°');
}

function flipCanvas(dir){
  if(!baseImageData) return;
  commitAdjust();
  const tmp=document.createElement('canvas');
  tmp.width=mainCanvas.width; tmp.height=mainCanvas.height;
  const tc=tmp.getContext('2d');
  tc.translate(dir==='h'?mainCanvas.width:0, dir==='v'?mainCanvas.height:0);
  tc.scale(dir==='h'?-1:1, dir==='v'?-1:1);
  tc.drawImage(mainCanvas,0,0);
  ctx.clearRect(0,0,mainCanvas.width,mainCanvas.height);
  ctx.drawImage(tmp,0,0);
  originalImage=ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
  baseImageData=new ImageData(new Uint8ClampedArray(originalImage.data),originalImage.width,originalImage.height);
  pushHistory('Flip '+(dir==='h'?'H':'V'));
}

function freeRotate(){
  if(!baseImageData) return;
  const deg = parseFloat(document.getElementById('sl-rotate').value);
  document.getElementById('v-rotate').textContent=deg;
  const rad=deg*Math.PI/180;
  const cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
  const nw=Math.round(baseImageData.width*cos+baseImageData.height*sin);
  const nh=Math.round(baseImageData.width*sin+baseImageData.height*cos);
  const tmp=document.createElement('canvas');
  tmp.width=baseImageData.width; tmp.height=baseImageData.height;
  tmp.getContext('2d').putImageData(baseImageData,0,0);
  mainCanvas.width=nw; mainCanvas.height=nh;
  overlayCanvas.width=nw; overlayCanvas.height=nh;
  ctx.translate(nw/2,nh/2);
  ctx.rotate(rad);
  ctx.drawImage(tmp,-baseImageData.width/2,-baseImageData.height/2);
  ctx.setTransform(1,0,0,1,0,0);
}

// ── CROP ──
let cropStart={x:0,y:0};
function setAspect(a){ cropAspect=a; }

function applyCrop(){
  if(!cropRect) return;
  const r = cropRect;
  const x=Math.round(Math.min(r.x,r.x+r.w)/zoom*devicePixelRatio||1);
  const y=Math.round(Math.min(r.y,r.y+r.h)/zoom*devicePixelRatio||1);
  const w=Math.abs(Math.round(r.w/zoom*devicePixelRatio||1));
  const h=Math.abs(Math.round(r.h/zoom*devicePixelRatio||1));
  // clamp
  const cx=Math.max(0,Math.min(x,mainCanvas.width-1));
  const cy=Math.max(0,Math.min(y,mainCanvas.height-1));
  const cw=Math.max(1,Math.min(w,mainCanvas.width-cx));
  const ch=Math.max(1,Math.min(h,mainCanvas.height-cy));
  const id=ctx.getImageData(cx,cy,cw,ch);
  mainCanvas.width=cw; mainCanvas.height=ch;
  overlayCanvas.width=cw; overlayCanvas.height=ch;
  ctx.putImageData(id,0,0);
  originalImage=ctx.getImageData(0,0,cw,ch);
  baseImageData=new ImageData(new Uint8ClampedArray(originalImage.data),cw,ch);
  cropRect=null;
  octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  document.getElementById('stat-size').textContent=cw+'×'+ch;
  zoomFit();
  pushHistory('Crop');
  setTool('select');
}

// ── HISTORY ──
function pushHistory(label){
  if(!mainCanvas.width) return;
  history = history.slice(0,historyIndex+1);
  history.push({ label, data: ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height), w:mainCanvas.width, h:mainCanvas.height });
  historyIndex = history.length-1;
  updateHistList();
}

function updateHistList(){
  const list = document.getElementById('hist-list');
  list.innerHTML = history.map((h,i)=>`<div class="hist-item${i===historyIndex?' current':''}" onclick="jumpHistory(${i})">${h.label}</div>`).join('');
  list.scrollTop = list.scrollHeight;
}

function jumpHistory(i){
  historyIndex=i;
  const h=history[i];
  mainCanvas.width=h.w; mainCanvas.height=h.h;
  overlayCanvas.width=h.w; overlayCanvas.height=h.h;
  ctx.putImageData(h.data,0,0);
  baseImageData=new ImageData(new Uint8ClampedArray(h.data.data),h.w,h.h);
  originalImage=new ImageData(new Uint8ClampedArray(h.data.data),h.w,h.h);
  updateHistList();
}

function undoAction(){ if(historyIndex>0) jumpHistory(historyIndex-1); }
function redoAction(){ if(historyIndex<history.length-1) jumpHistory(historyIndex+1); }

function commitAdjust(){
  baseImageData = ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
  originalImage = new ImageData(new Uint8ClampedArray(baseImageData.data),baseImageData.width,baseImageData.height);
  resetSliders();
}

// ── DRAWING ──
mainCanvas.addEventListener('mousedown', e=>{
  if(!mainCanvas.width) return;
  const pos = canvasPos(e);
  drawing=true;
  drawStart=pos;

  if(currentTool==='brush'||currentTool==='eraser'){
    ctx.beginPath();
    ctx.moveTo(pos.x,pos.y);
  }
  if(currentTool==='eyedrop'){
    const p=ctx.getImageData(Math.round(pos.x),Math.round(pos.y),1,1).data;
    const hex='#'+[p[0],p[1],p[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
    document.getElementById('draw-color').value=hex;
    document.getElementById('stat-color').textContent=hex;
  }
});

mainCanvas.addEventListener('mousemove', e=>{
  const pos = canvasPos(e);
  document.getElementById('stat-cursor').textContent = Math.round(pos.x)+','+Math.round(pos.y);

  if(!drawing) return;
  const size = parseFloat(document.getElementById('sl-size').value);
  const drawOpacity = parseFloat(document.getElementById('sl-draw-opacity').value)/100;
  const color = document.getElementById('draw-color').value;

  if(currentTool==='brush'){
    ctx.lineWidth=size; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle=hexToRgba(color,drawOpacity);
    ctx.globalCompositeOperation='source-over';
    ctx.lineTo(pos.x,pos.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pos.x,pos.y);
  }
  if(currentTool==='eraser'){
    ctx.lineWidth=size; ctx.lineCap='round';
    ctx.globalCompositeOperation='destination-out';
    ctx.lineTo(pos.x,pos.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pos.x,pos.y);
  }
  if(currentTool==='blur'){
    const r=size*2;
    const snap=ctx.getImageData(Math.max(0,pos.x-r),Math.max(0,pos.y-r),r*2,r*2);
    const tmp=document.createElement('canvas'); tmp.width=r*2; tmp.height=r*2;
    const tc=tmp.getContext('2d');
    tc.putImageData(snap,0,0);
    ctx.save(); ctx.filter=`blur(${size/3}px)`;
    ctx.drawImage(tmp,Math.max(0,pos.x-r),Math.max(0,pos.y-r));
    ctx.restore(); ctx.filter='none';
  }
  if(currentTool==='crop'||currentTool==='rect'||currentTool==='line'){
    octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
    const dx=pos.x-drawStart.x, dy=pos.y-drawStart.y;
    octx.strokeStyle=color; octx.lineWidth=2;

    let rw=dx,rh=dy;
    if(cropAspect!=='free'&&currentTool==='crop'){
      rw=dx; rh=dx/cropAspect;
    }
    if(currentTool==='crop'){
      cropRect={x:drawStart.x,y:drawStart.y,w:rw,h:rh};
      octx.fillStyle='rgba(0,0,0,0.45)';
      octx.fillRect(0,0,overlayCanvas.width,overlayCanvas.height);
      octx.clearRect(drawStart.x,drawStart.y,rw,rh);
      octx.strokeStyle='rgba(232,255,90,.9)';
      octx.strokeRect(drawStart.x,drawStart.y,rw,rh);
      // rule of thirds
      octx.strokeStyle='rgba(232,255,90,.25)';
      for(let i=1;i<3;i++){
        octx.beginPath(); octx.moveTo(drawStart.x+rw*i/3,drawStart.y); octx.lineTo(drawStart.x+rw*i/3,drawStart.y+rh); octx.stroke();
        octx.beginPath(); octx.moveTo(drawStart.x,drawStart.y+rh*i/3); octx.lineTo(drawStart.x+rw,drawStart.y+rh*i/3); octx.stroke();
      }
    } else if(currentTool==='rect'){
      octx.fillStyle=hexToRgba(document.getElementById('fill-color').value,0.3);
      octx.fillRect(drawStart.x,drawStart.y,dx,dy);
      octx.strokeRect(drawStart.x,drawStart.y,dx,dy);
    } else if(currentTool==='line'){
      octx.beginPath(); octx.moveTo(drawStart.x,drawStart.y); octx.lineTo(pos.x,pos.y); octx.stroke();
    }
  }
});

mainCanvas.addEventListener('mouseup', e=>{
  if(!drawing) return;
  drawing=false;
  ctx.globalCompositeOperation='source-over';

  if(currentTool==='rect'||currentTool==='line'){
    const pos=canvasPos(e);
    const size=parseFloat(document.getElementById('sl-size').value);
    const color=document.getElementById('draw-color').value;
    const fillColor=document.getElementById('fill-color').value;
    const op=parseFloat(document.getElementById('sl-draw-opacity').value)/100;
    ctx.lineWidth=size; ctx.strokeStyle=hexToRgba(color,op);
    if(currentTool==='rect'){
      ctx.fillStyle=hexToRgba(fillColor,op*0.5);
      ctx.fillRect(drawStart.x,drawStart.y,pos.x-drawStart.x,pos.y-drawStart.y);
      ctx.strokeRect(drawStart.x,drawStart.y,pos.x-drawStart.x,pos.y-drawStart.y);
    } else {
      ctx.beginPath(); ctx.moveTo(drawStart.x,drawStart.y); ctx.lineTo(pos.x,pos.y); ctx.stroke();
    }
    octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
    pushHistory(currentTool==='rect'?'Draw Rect':'Draw Line');
  }
  if(currentTool==='brush') pushHistory('Brush');
  if(currentTool==='eraser') pushHistory('Erase');
  if(currentTool==='blur') pushHistory('Blur');

  if(currentTool!=='crop'){
    baseImageData=ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
    originalImage=new ImageData(new Uint8ClampedArray(baseImageData.data),baseImageData.width,baseImageData.height);
  }
});

// text tool
mainCanvas.addEventListener('click', e=>{
  if(currentTool!=='text') return;
  const pos=canvasPos(e);
  const txt=prompt('Enter text:','Hello');
  if(!txt) return;
  const size=parseFloat(document.getElementById('sl-size').value)*2;
  const color=document.getElementById('draw-color').value;
  ctx.font=`${size}px Syne,sans-serif`;
  ctx.fillStyle=color;
  ctx.fillText(txt,pos.x,pos.y);
  baseImageData=ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
  pushHistory('Text');
});

function canvasPos(e){
  const rect=mainCanvas.getBoundingClientRect();
  return {
    x:(e.clientX-rect.left)/zoom,
    y:(e.clientY-rect.top)/zoom
  };
}

function hexToRgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── CLEAR ──
function clearCanvas(){
  if(!mainCanvas.width) return;
  ctx.clearRect(0,0,mainCanvas.width,mainCanvas.height);
  octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  baseImageData=ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
  pushHistory('Clear');
}

// ── EXPORT ──
function exportImage(){
  if(!mainCanvas.width) return;
  const a=document.createElement('a');
  a.href=mainCanvas.toDataURL('image/png');
  a.download='darkroom-export.png';
  a.click();
}

// ── KEYBOARD ──
document.addEventListener('keydown', e=>{
  if(e.ctrlKey||e.metaKey){
    if(e.key==='z'&&!e.shiftKey){e.preventDefault();undoAction();}
    if((e.key==='y')||(e.key==='z'&&e.shiftKey)){e.preventDefault();redoAction();}
    if(e.key==='o'){e.preventDefault();triggerOpen();}
    if(e.key==='s'||e.key==='e'){e.preventDefault();exportImage();}
  }
  if(e.key==='v') setTool('select');
  if(e.key==='b') setTool('brush');
  if(e.key==='e') setTool('eraser');
  if(e.key==='c') setTool('crop');
  if(e.key==='t') setTool('text');
  if(e.key==='+') zoomIn();
  if(e.key==='-') zoomOut();
});

// ── SLIDERS INIT ──
adjustIds.forEach(id=>{
  const sl=document.getElementById('sl-'+id);
  const min=parseFloat(sl.min),max=parseFloat(sl.max),val=parseFloat(sl.value);
  const pct=((val-min)/(max-min))*100;
  sl.style.setProperty('--pct',pct+'%');
});