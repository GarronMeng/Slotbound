// v15-smoke.mjs — enemy counters / boss phases / evolution identity regression
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
win.HTMLCanvasElement.prototype.getContext=function(){ if(!this.__ctx) this.__ctx=makeCtx(this); return this.__ctx; };
win.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';
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
function clearEnemies(){ game.enemies.clear(); }

ui.startGame();
assert('进入 PLAY', game.state===STATE.PLAY);
assert('v1.5 matchup API 已安装', typeof game.v15MatchupMultiplier==='function');
assert('v1.5 敌情建议 API 已安装', typeof game.v15WaveAdvice==='function');

// 克制关系应该形成明确差异。
clearUnits(); clearEnemies();
const bow=game.placeUnit('bow');
const cannon=game.placeUnit('cannon');
const sword=game.placeUnit('sword');
const runner=game.spawnEnemy('runner',0,game.L.fieldTop+80,1,1);
const armor=game.spawnEnemy('armor',1,game.L.fieldTop+80,1,1);
const caster=game.spawnEnemy('caster',2,game.L.fieldTop+80,1,1);
assert('弓手克制疾行', game.v15MatchupMultiplier(bow,runner)>1.3, game.v15MatchupMultiplier(bow,runner));
assert('重炮克制重甲', game.v15MatchupMultiplier(cannon,armor)>1.4, game.v15MatchupMultiplier(cannon,armor));
assert('剑士克制术士', game.v15MatchupMultiplier(sword,caster)>1.4, game.v15MatchupMultiplier(sword,caster));
assert('重炮不擅长追疾行', game.v15MatchupMultiplier(cannon,runner)<1, game.v15MatchupMultiplier(cannon,runner));

// 职业分支不是纯面板数值：神射手对满血目标有额外开场爆发。
bow._evolution='sniper';
runner.hp=runner.maxHp;
assert('神射手满血狙击机制生效', game.v15MatchupMultiplier(bow,runner)>1.9, game.v15MatchupMultiplier(bow,runner));

// 壁垒卫士获得真实减伤机制。
const guard=game.placeUnit('guard');
guard._evolution='fortress'; guard.fullHeal();
const hpBefore=guard.hp;
guard.hurt(10,game);
assert('壁垒卫士实际承伤低于10', hpBefore-guard.hp<8, (hpBefore-guard.hp).toFixed(2));

// Boss 70%后屏障、38%后狂暴；屏障期近战与远程表现明显不同。
clearEnemies();
const boss=game.spawnEnemy('boss',1,game.L.fieldTop+100,1,1);
boss.hp=boss.maxHp*0.69;
boss.update(1/60,game);
assert('Boss 70%进入屏障期', boss._v15BossPhase==='shield', boss._v15BossPhase);
assert('屏障期近战破盾有优势', game.v15MatchupMultiplier(sword,boss)>1.3, game.v15MatchupMultiplier(sword,boss));
assert('屏障期远程受到抑制', game.v15MatchupMultiplier(cannon,boss)<0.8, game.v15MatchupMultiplier(cannon,boss));
const bossDmg=boss.dmg;
boss.hp=boss.maxHp*0.37;
boss.update(1/60,game);
assert('Boss 38%进入狂暴期', boss._v15BossPhase==='rage', boss._v15BossPhase);
assert('狂暴期攻击提高', boss.dmg>bossDmg, bossDmg+'->'+boss.dmg);

// 准备阶段必须把“敌情”翻译为具体应对建议，而不是只报数量。
game.wave=5;
game.startWave(6);
game.update(0);
assert('第6波进入准备阶段', game._prep===true && game._prepWave===6);
const advice=game.v15WaveAdvice(6);
assert('第6波建议识别重甲', advice.includes('重甲'), advice);
const adviceEl=win.document.getElementById('v15-advice');
assert('准备面板显示克制建议', !!adviceEl && adviceEl.textContent.includes('克制建议'), adviceEl && adviceEl.textContent);

assert('无运行时错误', errors.length===0, errors.join(' | '));
console.log('\nv1.5 smoke: all checks passed');
