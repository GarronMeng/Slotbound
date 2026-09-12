// v16-smoke.mjs — Focus UX automation regression
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist', 'minitool');
const APP = join(DIST, 'js', 'app.js');
if (!existsSync(APP)) throw new Error('请先 npm run build');

function makeCtx(canvas) {
  const grad = { addColorStop() {} }; const noop = () => {};
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
const vc = new VirtualConsole(); const errors=[];
vc.on('jsdomError', e=>errors.push(String(e&&e.message))); vc.on('error', (...a)=>errors.push(a.join(' ')));
const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://minitool.local/', virtualConsole:vc });
const win = dom.window;
win.HTMLCanvasElement.prototype.getContext = function(){ if(!this.__ctx) this.__ctx=makeCtx(this); return this.__ctx; };
win.HTMLCanvasElement.prototype.toDataURL = ()=>'data:image/png;base64,';
win.confirm=()=>true; win.requestAnimationFrame=()=>0;
const stage=win.document.getElementById('stage');
Object.defineProperty(stage,'clientWidth',{value:390,configurable:true});
Object.defineProperty(stage,'clientHeight',{value:844,configurable:true});
win.Element.prototype.getBoundingClientRect=function(){
  if(this.id==='hud') return {left:0,top:0,right:390,bottom:96,width:390,height:96,x:0,y:0};
  return {left:0,top:0,right:390,bottom:844,width:390,height:844,x:0,y:0};
};
Object.defineProperty(win,'devicePixelRatio',{value:2,configurable:true});

win.eval(readFileSync(APP,'utf8'));
await new Promise(r=>setTimeout(r,0)); await new Promise(r=>setTimeout(r,0));
if(!win.SLOTBOUND) throw new Error('SLOTBOUND 未启动');
const {game,ui,STATE}=win.SLOTBOUND;
function assert(name,cond,extra=''){ if(!cond) throw new Error('FAIL '+name+(extra?' | '+extra:'')); console.log('PASS',name,extra); }

ui.startGame();
assert('进入 PLAY', game.state===STATE.PLAY);

// 自动主养：无需玩家打开面板操作。
game.update(0.01);
let primary=game.units.find(u=>u&&u._primary&&!u.dead);
assert('系统自动选择主养', !!primary, primary&&primary.type);

// 准备阶段自动调谐 + 自动进化。
const bow=game.units.find(u=>u.type==='bow');
bow.level=4; bow._absorbMass=8; bow._evolution=null; bow.applyLevel(game.mods);
game.startWave(2);
assert('进入准备阶段', game._prep===true && game._prepWave===2);
assert('准备阶段有自动倒计时', game._v16PrepTimer>0 && game._v16PrepTimer<=2.1, game._v16PrepTimer);
assert('自动设置下一波偏置', !!game._biasType && game._biasSpins===2, game._biasType+' '+game._biasSpins);
assert('Lv4单位自动选择进化', !!bow._evolution, bow._evolution);

// 常驻控制条被 v1.6 CSS 隐藏。
const style=win.document.getElementById('v16-style');
assert('v1.6 精简样式已注入', !!style && style.textContent.includes('#v14-tools{display:none!important}'));

// 无任何玩家操作时，短暂预告后自动开始下一波。
for(let i=0;i<8;i++) game.update(0.3);
assert('无人操作自动开始下一波', game._prep===false && game.wave===2 && game.queue.length>0, 'wave='+game.wave+' queue='+game.queue.length);

// 智能锁轮：命中当前偏置较多的一列时，下一转自动保留该列。
game.slot.state='idle'; game.energy=3; game._v16ManualLock=false;
game._biasType='bow';
const prior=[['bow','bow','guard'],['mage','cannon','guard'],['sword','mage','cannon']];
game.slot.result={outcome:prior}; game.slot.outcome=prior.map(x=>x.slice());
game.spin();
assert('智能锁定高价值滚轮', game.slot._v14Locks[0]===true, JSON.stringify(game.slot._v14Locks));

// 玩家正在查看单位时，自动开战必须停住。
game.slot.state='idle'; game.startWave(3);
const before=game._v16PrepTimer;
game._panelUnit=game.units[0]; game.paused=true;
for(let i=0;i<6;i++) game.update(0.3);
assert('玩家干预时暂停自动开战', game._prep===true && Math.abs(game._v16PrepTimer-before)<0.01, before+' -> '+game._v16PrepTimer);
game._panelUnit=null; game.paused=false;

assert('无运行时错误', errors.length===0, errors.join(' | '));
console.log('\nv1.6 smoke: all checks passed');
