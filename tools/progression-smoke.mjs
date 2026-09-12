// progression-smoke.mjs — v1.3 主力锁定 / 随机词条 / 印记 / 职业进化
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist', 'minitool');
const APP = join(DIST, 'js', 'app.js');
if (!existsSync(APP)) throw new Error('请先 npm run build');

function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return {
    canvas, fillStyle:'#000', strokeStyle:'#000', lineWidth:1, globalAlpha:1,
    globalCompositeOperation:'source-over', font:'10px sans-serif', textAlign:'start', textBaseline:'alphabetic',
    lineCap:'butt', lineJoin:'miter', filter:'none', imageSmoothingEnabled:true, shadowBlur:0, shadowColor:'transparent',
    beginPath:noop, closePath:noop, moveTo:noop, lineTo:noop, arc:noop, arcTo:noop, ellipse:noop,
    quadraticCurveTo:noop, bezierCurveTo:noop, rect:noop, clip:noop, fill:noop, stroke:noop,
    fillRect:noop, strokeRect:noop, clearRect:noop, fillText:noop, strokeText:noop, save:noop, restore:noop,
    translate:noop, rotate:noop, scale:noop, setTransform:noop, transform:noop, resetTransform:noop,
    drawImage:noop, createLinearGradient:()=>grad, createRadialGradient:()=>grad, createPattern:()=>null,
    setLineDash:noop, getLineDash:()=>[], measureText:()=>({width:10})
  };
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push(String(e && e.message)));
vc.on('error', (...a) => errors.push(a.join(' ')));
const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://minitool.local/', virtualConsole:vc });
const win = dom.window;
win.HTMLCanvasElement.prototype.getContext = function(){ if(!this.__ctx) this.__ctx = makeCtx(this); return this.__ctx; };
win.HTMLCanvasElement.prototype.toDataURL = ()=>'data:image/png;base64,';
win.confirm = ()=>true;
win.requestAnimationFrame = ()=>0;
const stage = win.document.getElementById('stage');
Object.defineProperty(stage, 'clientWidth', { value:390, configurable:true });
Object.defineProperty(stage, 'clientHeight', { value:844, configurable:true });
win.Element.prototype.getBoundingClientRect = function(){
  if(this.id==='hud') return {left:0,top:0,right:390,bottom:96,width:390,height:96,x:0,y:0};
  return {left:0,top:0,right:390,bottom:844,width:390,height:844,x:0,y:0};
};
Object.defineProperty(win, 'devicePixelRatio', { value:2, configurable:true });

win.eval(readFileSync(APP, 'utf8'));
await new Promise(r=>setTimeout(r,0));
await new Promise(r=>setTimeout(r,0));
if(!win.SLOTBOUND) throw new Error('SLOTBOUND 未启动');
const { game, ui, STATE } = win.SLOTBOUND;
function assert(name, cond, extra='') {
  if(!cond) throw new Error('FAIL '+name+(extra?' | '+extra:''));
  console.log('PASS', name, extra);
}
function clearUnits(){
  game.units.length=0;
  for(let c=0;c<game.grid.length;c++) for(let r=0;r<game.grid[c].length;r++) game.grid[c][r]=null;
}

ui.startGame();
assert('进入 PLAY', game.state===STATE.PLAY);
clearUnits();
const u = game.placeUnit('guard');
assert('新单位生成随机属性', !!u._trait && !!u._trait.id, u._trait && u._trait.id);
assert('新单位生成印记', !!u._imprint && !!u._imprint.id, u._imprint && u._imprint.id);
assert('默认未锁定', u.locked===false, String(u.locked));

// 点击单位面板能够查看并切换主力锁定。
game.openUnitPanel(u);
const sheet = win.document.getElementById('unit-progress-sheet');
assert('单位面板已打开', sheet && sheet.classList.contains('show'));
assert('查看单位时暂停战斗', game.paused===true);
const lockBtn = sheet.querySelector('.unit-lock');
assert('存在锁定按钮', !!lockBtn);
lockBtn.click();
assert('锁定按钮实际改变单位状态', u.locked===true);
game.closeUnitPanel();
assert('关闭面板后恢复战斗', game.paused===false);

// Lv4 后可在两个职业分支中选择，并真正改变属性。
u._absorbMass = 8;
u.level = 4;
u.applyLevel(game.mods);
const hpBefore = u.maxHp;
assert('Lv4 允许职业进化', game.evolveUnit(u, 'fortress')===true);
assert('记录职业分支', u._evolution==='fortress', u._evolution);
assert('壁垒分支实际提高生命', u.maxHp > hpBefore, `${hpBefore}->${u.maxHp}`);
assert('同一单位不能重复进化', game.evolveUnit(u, 'paladin')===false);

game.openUnitPanel(u);
const cardText = win.document.getElementById('unit-progress-card').textContent;
assert('面板显示随机属性', cardText.includes(u._trait.name));
assert('面板显示印记', cardText.includes(u._imprint.name));
assert('面板显示职业', cardText.includes('壁垒卫士'));
game.closeUnitPanel();

assert('无运行时 console/jsdom 错误', errors.length===0, errors.join(' | '));
console.log('\nprogression smoke: all checks passed');
