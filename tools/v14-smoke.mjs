// v14-smoke.mjs — Preparation / slot control / primary carry regression
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
function clearUnits(){ game.units.length=0; for(let c=0;c<game.grid.length;c++) for(let r=0;r<game.grid[c].length;r++) game.grid[c][r]=null; }
function mass(u){ return u._absorbMass===undefined ? Math.pow(2,u.level-1) : u._absorbMass; }

ui.startGame();
assert('进入 PLAY', game.state===STATE.PLAY);
assert('开局直接进入第1波', game.wave===1 && !game._prep, 'wave='+game.wave);

// 后续波次不应直接开打，而是进入准备阶段。
game.startWave(2);
assert('第2波先进入准备阶段', game._prep===true && game._prepWave===2);
assert('准备阶段不生成敌军队列', game.queue.length===0, game.queue.length);
assert('准备阶段 UI 已创建', !!win.document.getElementById('v14-prep'));
game.beginPreparedWave();
assert('手动开始后才进入第2波', game._prep===false && game.wave===2 && game.queue.length>0, 'wave='+game.wave+' queue='+game.queue.length);

// 偏置：选定一个兵种，持续3次 spin。
const bt=game.cycleSlotBias();
assert('偏置已选择兵种', !!bt && game._biasSpins===3, bt+' '+game._biasSpins);

// 锁轮：已有结果后可最多锁两列，并在下一次 spin 保留列内容。
const prior=[['guard','bow','sword'],['mage','cannon','guard'],['bow','mage','cannon']];
game.slot.result={outcome:prior}; game.slot.outcome=prior.map(x=>x.slice()); game.slot.state='idle';
assert('锁定第一列成功', game.toggleReelLock(0)===true && game.slot._v14Locks[0]===true);
game.slot.spin();
assert('锁轮保留上一盘第一列', JSON.stringify(game.slot.outcome[0])===JSON.stringify(prior[0]), JSON.stringify(game.slot.outcome[0]));
assert('完成一次spin后偏置次数减少', game._biasSpins===2, game._biasSpins);

// 豪赌：下一次 spin 扣10核心生命，并进入倍率结算状态。
game.slot.state='idle'; game.energy=3; game.coreHp=100; game._gambleQueued=false;
assert('豪赌可开启', game.toggleGamble()===true && game._gambleQueued===true);
game.spin();
assert('豪赌扣10HP', game.coreHp===90, game.coreHp);
assert('豪赌已进入本次结算状态', game._gambleActive===true);

// ⭐主养：满5人时，新兵种材料优先喂给主养。
clearUnits(); game.slot.state='idle'; game.mods.boardCap=5;
for(const t of ['guard','sword','bow','mage','cannon']) game.placeUnit(t);
assert('组成5人主力', game.units.filter(u=>u&&!u.dead).length===5);
const primary=game.units.find(u=>u.type==='guard'); primary._primary=true;
const before=mass(primary);
game.placeUnit('prism');
assert('满编后不增加第6人', game.units.filter(u=>u&&!u.dead).length===5);
assert('异种材料优先喂给主养', mass(primary)===before+1, before+'->'+mass(primary));

assert('无运行时错误', errors.length===0, errors.join(' | '));
console.log('\nv1.4 smoke: all checks passed');
