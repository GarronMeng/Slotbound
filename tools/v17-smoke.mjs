// v17-smoke.mjs — Juice density / pity / momentum regression
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
function boardAllSame(out){ if(!out||!out[0]) return false; const t=out[0][0]; for(let c=0;c<3;c++) for(let r=0;r<3;r++) if(out[c][r]!==t) return false; return true; }

ui.startGame();
assert('进入 PLAY', game.state===STATE.PLAY);
assert('v1.7 状态已初始化', game._v17DrySpins===0 && game._v17JackpotDry===0 && game._v17FeverSpins===0);

// 连续平淡达到硬阈值后，下一转至少保底一条横线；不需要任何 UI 操作。
game._v17DrySpins=6; game._v17JackpotDry=0; game.slot._v14Locks=[false,false,false]; game.slot.state='idle';
game.slot.spin();
const pity=game.slot.outcome;
assert('连续平淡触发隐藏连线保底', pity[0][1]===pity[1][1] && pity[1][1]===pity[2][1], JSON.stringify(pity));

// 很久没有 jackpot 后进入硬保底。
game._v17JackpotDry=16; game._v17DrySpins=0; game.slot._v14Locks=[false,false,false]; game.slot.state='idle';
game.slot.spin();
assert('JACKPOT 长旱触发隐藏硬保底', boardAllSame(game.slot.outcome), JSON.stringify(game.slot.outcome));
assert('稀有结果延长第三轮停靠制造期待', game.slot.stopDelay[2] >= .9, game.slot.stopDelay[2]);

// 中奖会返还少量能量，形成“再拉一下”的连续爽感。
game.energy=0; game.energyMax=3;
const lineRes={jackpot:false,lines:[{r:1,type:'bow'}],cols:[],pairs:[],summons:{bow:2},score:220,label:'横向连线!',outcome:[['bow','bow','guard'],['mage','bow','guard'],['sword','bow','cannon']]};
game.onSpinResult(lineRes);
assert('普通连线返还能量', game.energy>=.33, game.energy);
assert('中奖累计热手 streak', game._v17WinStreak>=1, game._v17WinStreak);

// jackpot 会开启两次 FEVER，并重置 jackpot 旱期。
const jpOut=[['bow','bow','bow'],['bow','bow','bow'],['bow','bow','bow']];
const jpRes={jackpot:true,lines:[],cols:[],pairs:[],summons:{bow:3},score:2000,label:'JACKPOT!',outcome:jpOut};
game.onSpinResult(jpRes);
assert('JACKPOT 开启两次 FEVER', game._v17FeverSpins===2, game._v17FeverSpins);
assert('JACKPOT 重置旱期', game._v17JackpotDry===0, game._v17JackpotDry);

// 连续自动吸收会形成连击反馈状态，而不是每次弹 Toast。
game.placeUnit('guard');
game.placeUnit('guard');
game.placeUnit('guard');
assert('连续自动吸收形成吸收连击', game._v17AbsorbChain>=2, game._v17AbsorbChain);

assert('无运行时错误', errors.length===0, errors.join(' | '));
console.log('\nv1.7 smoke: all checks passed');
