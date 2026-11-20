const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const PORT = process.env.PORT || 3001;
const rooms = new Map();

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const SUIT_SYMBOLS = { clubs:'♣', diamonds:'♦', hearts:'♥', spades:'♠' };
const FULL_RANKS = ['7','8','9','10','J','Q','K','A'];
const SHORT_RANKS = ['9','10','J','Q','K','A'];
const ORDER_NORMAL = ['7','8','9','J','Q','K','10','A'];
const ORDER_TRUMP = ['7','8','Q','K','10','A','9','J'];
const COMBO_ORDER = ['7','8','9','10','J','Q','K','A'];

function id(){ return crypto.randomBytes(8).toString('hex'); }
function roomCode(){ let c; do c=String(100000+Math.floor(Math.random()*900000)); while(rooms.has(c)); return c; }
function normalizeName(v){ return String(v||'').trim().slice(0,20)||'Игрок'; }
function nextId(room, playerId){ const i=room.players.findIndex(p=>p.id===playerId); return i<0?null:room.players[(i+1)%room.players.length].id; }
function player(room,pid){ return room.players.find(p=>p.id===pid); }
function modeConfig(mode){
  if(mode==='1v1') return {mode:'1v1',label:'1 × 1',maxPlayers:2,ranks:SHORT_RANKS,deckSize:24,teams:false};
  if(mode==='3p') return {mode:'3p',label:'3 игрока',maxPlayers:3,ranks:SHORT_RANKS,deckSize:24,teams:false};
  return {mode:'2v2',label:'2 × 2',maxPlayers:4,ranks:FULL_RANKS,deckSize:32,teams:true};
}
function config(room){ return modeConfig(room.mode); }
function makeDeck(room){
  const cfg=config(room), d=[];
  // 1v1 и 3 игрока: 24 карты — только 9,10,J,Q,K,A.
  // 2v2: 32 карты — 7,8,9,10,J,Q,K,A.
  for(const suit of SUITS) for(const rank of cfg.ranks) d.push({id:id(),rank,suit});
  if(d.length!==cfg.deckSize) throw new Error(`Неверный размер колоды для режима ${cfg.mode}: ${d.length}`);
  return d;
}

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function cardPoints(c,trump){ if(c.suit===trump) return ({'9':14,'10':10,J:20,Q:3,K:4,A:11,'7':0,'8':0})[c.rank] ?? 0; return ({'7':0,'8':0,'9':0,'10':10,J:2,Q:3,K:4,A:11})[c.rank] ?? 0; }
function strength(c,trump){ return (c.suit===trump?ORDER_TRUMP:ORDER_NORMAL).indexOf(c.rank); }
function teamForSeat(room,seat){ return config(room).teams ? (seat%2===0?1:2) : null; }

function publicPlayer(room,p,viewerId){
  return {id:p.id,name:p.name,seat:p.seat,owner:p.owner,connected:p.connected,team:p.team,cardCount:p.hand.length,
    cards:p.id===viewerId?p.hand:undefined,roundPoints:p.roundPoints,combinationPoints:p.combinationPoints,announcedPoints:p.announcedPoints||0,tricksWon:p.tricksWon||0,trumpPlayed:Boolean(p.trumpPlayed),matchScore:p.matchScore};
}
function publicGame(room,viewerId){
  const g=room.game, me=player(room,viewerId);
  return {phase:g.phase,roundNumber:g.roundNumber,dealerId:g.dealerId,turnPlayerId:g.turnPlayerId,
    trump:g.trump,trumpCard:g.trumpCard,offeredSuit:g.offeredSuit,trumpChooserId:g.trumpChooserId,autoTrump:Boolean(g.autoTrump),dealAnimation:g.dealAnimation||null,
    biddingRound:g.biddingRound,bidHistory:g.bidHistory,table:g.table,trickNumber:g.trickNumber,
    trickLeaderId:g.trickLeaderId,lastTrickWinnerId:g.lastTrickWinnerId,lastTrickPoints:g.lastTrickPoints,
    roundScores:g.roundScores,roundDisplayScores:g.roundDisplayScores||{},matchScores:g.matchScores,matchBiles:g.matchBiles||{},roundTeamScores:g.roundTeamScores,matchTeamScores:g.matchTeamScores,matchTeamBiles:g.matchTeamBiles||{1:0,2:0},announcements:g.announcements||[],
    combinations:g.combinations||[],myCards:me?me.hand:[],winnerId:g.winnerId||null,winnerTeam:g.winnerTeam||null,
    winningName:g.winningName||null,mode:room.mode};
}
function publicRoom(room,viewerId){
  return {code:room.code,name:room.name,passwordProtected:Boolean(room.password),mode:room.mode,modeLabel:config(room).label,
    maxPlayers:config(room).maxPlayers,target:101,started:room.started,
    players:room.players.map(p=>publicPlayer(room,p,viewerId)),game:room.game?publicGame(room,viewerId):null};
}
function emitRoom(room){ for(const p of room.players) if(p.socketId) io.to(p.socketId).emit('room-state',publicRoom(room,p.id)); }
function err(socket,msg,cb){ const r={success:false,message:msg}; if(typeof cb==='function')cb(r); socket.emit('error-message',{message:msg}); }
function fromSocket(socket){ for(const room of rooms.values()){ const p=room.players.find(x=>x.socketId===socket.id); if(p)return {room,p}; } return null; }

function legalCards(room,p){
  const g=room.game;
  if(!g||g.phase!=='playing'||g.turnPlayerId!==p.id) return [];
  if(!g.table.length) return p.hand;
  const lead=g.table[0].card.suit;
  const leadCards=p.hand.filter(c=>c.suit===lead);
  if(leadCards.length){
    if(lead===g.trump){
      const top=g.table.filter(x=>x.card.suit===g.trump).sort((a,b)=>strength(b.card,g.trump)-strength(a.card,g.trump))[0];
      if(top){ const higher=leadCards.filter(c=>strength(c,g.trump)>strength(top.card,g.trump)); if(higher.length)return higher; }
    }
    return leadCards;
  }
  const trumps=p.hand.filter(c=>c.suit===g.trump);
  if(!trumps.length)return p.hand;
  const top=g.table.filter(x=>x.card.suit===g.trump).sort((a,b)=>strength(b.card,g.trump)-strength(a.card,g.trump))[0];
  if(!top)return trumps;
  const higher=trumps.filter(c=>strength(c,g.trump)>strength(top.card,g.trump));
  return higher.length?higher:trumps;
}
function trickWinner(room){
  const g=room.game, lead=g.table[0].card.suit; let win=g.table[0];
  for(const x of g.table.slice(1)){
    const a=win.card,b=x.card,at=a.suit===g.trump,bt=b.suit===g.trump;
    if(bt&&!at){win=x;continue;} if(at&&!bt)continue;
    const aLead=a.suit===lead,bLead=b.suit===lead;
    if(bLead&&!aLead){win=x;continue;} if(aLead&&!bLead)continue;
    if(a.suit===b.suit&&strength(b,g.trump)>strength(a,g.trump))win=x;
  }
  return win.playerId;
}

function cardLabel(c){ return `${c.rank}${SUIT_SYMBOLS[c.suit]}`; }
function comboDetect(hand,trump){
  const out=[];
  const add=(key,label,points,suit,cards)=>out.push({id:`${key}|${suit||''}|${cards.map(c=>c.id).join(',')}`,key,label,points,suit,cards:cards.map(cardLabel),announced:false,cancelled:false});
  const q=hand.find(c=>c.suit===trump&&c.rank==='Q'), k=hand.find(c=>c.suit===trump&&c.rank==='K');
  if(q&&k)add('bela','Bela',20,trump,[q,k]);
  for(const s of SUITS){
    const cs=hand.filter(c=>c.suit===s).sort((a,b)=>COMBO_ORDER.indexOf(a.rank)-COMBO_ORDER.indexOf(b.rank));
    let run=[];
    for(const c of cs){
      if(!run.length||COMBO_ORDER.indexOf(c.rank)===COMBO_ORDER.indexOf(run.at(-1).rank)+1)run.push(c);
      else {if(run.length>=3)addSeq(out,run);run=[c];}
    }
    if(run.length>=3)addSeq(out,run);
  }
  for(const rank of FULL_RANKS){
    const cs=hand.filter(c=>c.rank===rank); if(cs.length!==4)continue;
    if(rank==='7')add('four_sevens','Четыре 7',0,null,cs);
    else if(rank==='8')add('four_eights','Четыре 8',0,null,cs);
    else if(rank==='9')add('four_nines','Четыре 9',150,null,cs);
    else if(rank==='J')add('four_jacks','Четыре J',200,null,cs);
    else add(`four_${rank}`,`Четыре ${rank}`,100,null,cs);
  }
  if(hand.filter(c=>c.suit===trump).length===8){
    const all=COMBO_ORDER.map(r=>hand.find(c=>c.suit===trump&&c.rank===r)).filter(Boolean);
    if(all.length===8)add('full_trump','Белот',0,trump,all);
  }
  return out;
}
function addSeq(out,run){
  const n=run.length,points=n>=5?100:n===4?50:20,label=n>=5?'100':n===4?'50':'Терц';
  out.push({id:`seq|${run[0].suit}|${n}|${run[0].rank}|${run.map(c=>c.id).join(',')}`,key:`sequence_${n}`,label,points,suit:run[0].suit,cards:run.map(cardLabel),announced:false,cancelled:false});
}
function sameCombo(a,b){ if(a.key==='bela'||b.key==='bela')return a.key===b.key; if(a.key.startsWith('sequence_')&&b.key.startsWith('sequence_'))return a.key===b.key; if(a.key.startsWith('four_')&&b.key.startsWith('four_'))return a.key===b.key; return a.key===b.key; }
function compareCombo(a,b,trump){ const pa=[a.points,a.cards.length,a.suit===trump?1:0],pb=[b.points,b.cards.length,b.suit===trump?1:0]; for(let i=0;i<pa.length;i++)if(pa[i]!==pb[i])return pa[i]>pb[i]?1:-1; return 0; }
function calcCombos(room){ room.game.combinations=room.players.map(p=>({playerId:p.id,items:comboDetect(p.hand,room.game.trump),totalPoints:0})); refreshCombos(room); }
function announcementRank(room, item, playerId){
  /*
    Сила объявления:
    1) количество очков;
    2) длина комбинации;
    3) козырная масть;
    4) если всё одинаково — более раннее объявление.
  */
  const points=Number(item.points||0);
  const length=Number(item.cards?.length||0);
  const trump=item.suit===room.game.trump?1:0;
  const announcements=room.game.announcements||[];
  const index=announcements.findIndex(a=>a.playerId===playerId&&a.comboId===item.id);
  return [points,length,trump,index===-1?Number.MAX_SAFE_INTEGER:index];
}

function compareAnnouncement(room,a,aPlayerId,b,bPlayerId){
  const pa=announcementRank(room,a,aPlayerId);
  const pb=announcementRank(room,b,bPlayerId);
  for(let i=0;i<3;i++){
    if(pa[i]!==pb[i])return pa[i]>pb[i]?1:-1;
  }
  /* При полном равенстве проходит первое объявленное. */
  if(pa[3]!==pb[3])return pa[3]<pb[3]?1:-1;
  return 0;
}

function refreshCombos(room){
  const arr=room.game.combinations||[];

  for(const x of arr){
    for(const c of x.items){
      c.cancelled=false;
    }
  }

  /*
    ВАЖНО:
    в нашей механике за раздачу засчитывается только ОДНО
    самое старшее реально объявленное объявление.

    Если игрок объявил Терц +20, Bela +20 и Четыре J +200,
    после последнего объявления засчитываются только Четыре J +200.

    Необъявленная комбинация вообще не участвует в сравнении.
  */
  const announced=[];
  for(const x of arr){
    for(const c of x.items){
      if(c.announced){
        announced.push({item:c,playerId:x.playerId});
      }
    }
  }

  if(announced.length){
    let winner=announced[0];
    for(const current of announced.slice(1)){
      if(compareAnnouncement(room,current.item,current.playerId,winner.item,winner.playerId)>0){
        winner=current;
      }
    }

    for(const current of announced){
      if(current!==winner){
        current.item.cancelled=true;
      }
    }
  }

  for(const x of arr){
    x.totalPoints=x.items.reduce(
      (sum,c)=>sum+(c.announced&&!c.cancelled?c.points:0),
      0
    );
    const p=player(room,x.playerId);
    if(p){
      p.combinationPoints=x.totalPoints;
      p.announcedPoints=x.totalPoints;
    }
  }
}
function announceCombo(room,p,comboId){
  if(room.game.phase!=='playing')return {success:false,message:'Комбинации сейчас объявлять нельзя.'};
  if((room.game.trickNumber||0)>2)return {success:false,message:'Комбинации можно объявлять только до конца второй взятки.'};
  const mine=room.game.combinations.find(x=>x.playerId===p.id), c=mine?.items.find(x=>x.id===comboId);
  if(!c)return {success:false,message:'Комбинация не найдена.'}; if(c.announced)return {success:false,message:'Эта комбинация уже объявлена.'};
  c.announced=true;
  // refreshCombos сам определит, чьё объявление сейчас действительно.
  // Поэтому 50 Иры остаётся видно до тех пор, пока Аня не объявит 100.
  refreshCombos(room);
  room.game.announcements=room.game.announcements||[];
  room.game.announcements.push({playerId:p.id,playerName:p.name,comboId:c.id,label:c.label,points:c.points,at:Date.now()});
  return {success:true};
}

function resetRound(room){
  for(const p of room.players){p.roundPoints=0;p.combinationPoints=0;p.announcedPoints=0;p.tricksWon=0;p.trumpPlayed=false;p.hand=[];}
  room.game.roundScores={};
  room.game.roundTeamScores={1:0,2:0};
  room.game.table=[];
  room.game.lastTrickWinnerId=null;
  room.game.lastTrickPoints=0;
}
function deal(room){
  resetRound(room);
  const g=room.game, deck=shuffle(makeDeck(room)); g.deck=deck;
  // Первая часть раздачи: по 5 карт каждому. Сам процесс показываем анимацией на клиенте.
  for(let i=0;i<5;i++)for(const p of room.players)p.hand.push(deck.shift());
  g.trumpCard=deck[0];
  g.offeredSuit=g.trumpCard.suit;
  g.trump=null;
  g.trumpChooserId=null;
  g.autoTrump=false;
  g.biddingRound=1;
  g.bidHistory=[];
  g.phase='dealing';
  const di=room.players.findIndex(p=>p.id===g.dealerId);
  g.turnPlayerId=room.players[(di+1)%room.players.length].id;
  g.dealAnimation={stage:'deal-five',startedAt:Date.now(),duration:1800,recipientId:null,cardId:null};
  emitRoom(room);
  setTimeout(()=>revealTurnedCard(room),1900);
}
function revealTurnedCard(room){
  if(!room.game||room.game.phase!=='dealing')return;
  const g=room.game;
  if(!g.trumpCard)return;
  g.dealAnimation={stage:'turn-card',startedAt:Date.now(),duration:1300,recipientId:null,cardId:g.trumpCard.id};
  emitRoom(room);
  setTimeout(()=>{
    if(!room.game||room.game.phase!=='dealing'||!room.game.trumpCard)return;
    const g2=room.game;
    if(g2.trumpCard.rank==='J'){
      g2.trump=g2.offeredSuit;
      g2.trumpChooserId=g2.turnPlayerId;
      g2.autoTrump=true;
      g2.dealAnimation={stage:'jack-flight',startedAt:Date.now(),duration:1200,recipientId:g2.trumpChooserId,cardId:g2.trumpCard.id};
      emitRoom(room);
      setTimeout(()=>finishDeal(room),1250);
    }else{
      g2.phase='bidding';
      g2.dealAnimation={stage:'bidding',startedAt:Date.now(),duration:0,recipientId:null,cardId:g2.trumpCard.id};
      emitRoom(room);
    }
  },1300);
}
function finishDeal(room){
  if(!room.game)return;
  const g=room.game, chooser=player(room,g.trumpChooserId);
  const idx=g.deck.findIndex(c=>c.id===g.trumpCard?.id);

  const targetHandSize = room.mode==='1v1' ? 12 : 8;

  if(g.autoTrump && chooser && idx>=0){
    // БИЗОН: открытый валет физически переходит игроку, которому он выпал.
    // Затем раздаём оставшиеся карты до полной руки.
    const [turned]=g.deck.splice(idx,1);
    chooser.hand.push(turned);
    for(const p of room.players){
      while(p.hand.length<targetHandSize){
        const c=g.deck.shift();
        if(!c)break;
        p.hand.push(c);
      }
    }
  }else{
    // Обычная открытая карта после выбора масти возвращается в колоду.
    // Затем раздаём все оставшиеся карты до полной руки.
    if(idx>=0){const [turned]=g.deck.splice(idx,1);g.deck.push(turned);}
    for(const p of room.players){
      while(p.hand.length<targetHandSize){
        const c=g.deck.shift();
        if(!c)break;
        p.hand.push(c);
      }
    }
  }

  g.trumpCard=null;
  g.dealAnimation={stage:'deal-final',startedAt:Date.now(),duration:1800,recipientId:null,cardId:null};
  g.phase='playing';
  g.turnPlayerId=g.trumpChooserId||g.turnPlayerId;
  g.trickLeaderId=g.turnPlayerId;
  g.trickNumber=1;
  g.table=[];
  g.lastTrickWinnerId=null;
  g.lastTrickPoints=0;
  calcCombos(room);
  emitRoom(room);
  setTimeout(()=>{
    if(!room.game||room.game.phase!=='playing')return;
    room.game.dealAnimation=null;
    emitRoom(room);
  },1400);
}
function startRoomGame(room){
  room.started=true;room.matchScores={};
  for(const p of room.players)p.matchScore=0;
  const dealer=room.players[0].id;
  room.game={phase:'bidding',roundNumber:1,dealerId:dealer,turnPlayerId:null,trump:null,trumpCard:null,offeredSuit:null,trumpChooserId:null,
    autoTrump:false,dealAnimation:null,
    biddingRound:1,bidHistory:[],announcements:[],deck:[],table:[],trickNumber:0,trickLeaderId:null,lastTrickWinnerId:null,lastTrickPoints:0,
    roundScores:{},roundDisplayScores:{},roundTeamScores:{1:0,2:0},matchScores:{},matchBiles:{},matchTeamScores:{1:0,2:0},matchTeamBiles:{1:0,2:0},combinations:[],winnerId:null,winnerTeam:null,winningName:null};
  deal(room);
}
function advanceDealer(room){const i=room.players.findIndex(p=>p.id===room.game.dealerId);room.game.dealerId=room.players[(i+1)%room.players.length].id;}
function addRoundScore(room,pid,points){room.game.roundScores[pid]=(room.game.roundScores[pid]||0)+points;const p=player(room,pid);if(p)p.roundPoints+=points;if(config(room).teams)room.game.roundTeamScores[p.team]+=points;}
function finishTrick(room){
  const g=room.game,winnerId=trickWinner(room),pts=g.table.reduce((s,x)=>s+cardPoints(x.card,g.trump),0)+(room.players.every(p=>p.hand.length===0)?10:0);
  addRoundScore(room,winnerId,pts);
  const winner=player(room,winnerId); if(winner)winner.tricksWon=(winner.tricksWon||0)+1;
  g.lastTrickWinnerId=winnerId;g.lastTrickPoints=pts;
  if(room.players.every(p=>p.hand.length===0)){finalizeRound(room);return;}
  g.table=[];g.trickNumber++;g.trickLeaderId=winnerId;g.turnPlayerId=winnerId;
}
function roundToBiles(points){
  // Каждые 10 очков дают 1 бель.
  // Округляем обычным математическим округлением:
  // 11 -> 1, 19 -> 2, 33 -> 3, 56 -> 6,
  // 89 -> 9, 101 -> 10, 139 -> 14,
  // 205 -> 20, 227 -> 23.
  if(points<=0)return 0;
  return Math.max(0,Math.round(points/10));
}
function hasAnnouncedCombos(room){
  return (room.game.combinations||[]).some(x=>x.items?.some(c=>c.announced));
}

// Пользовательский вывод счёта за раздачу:
// без объявления показываем набранные очки как есть;
// если было объявление, его вклад считается по 5 очков за 1,
// а обычные очки взяток переводятся в десятки.
// Пример: 45 + 100 объявление = 4 + 20 = 24.
function roundDisplayScore(p){
  const tricks=Number(p.roundPoints||0);
  const combo=Number(p.combinationPoints||0);
  if(combo>0 || Number(p.announcedPoints||0)>0){
    return Math.max(0,Math.floor(tricks/10)+Math.floor(combo/5));
  }
  // Для обычной раздачи маленькие значения оставляем как есть,
  // а большие переводим в били. Так 56 -> 6, 73 -> 7, 139 -> 14,
  // при этом 14 и 17 остаются 14 и 17.
  if(tricks>=20) return roundToBiles(tricks);
  return tricks;
}
function finalizeRound(room){
  const g=room.game;refreshCombos(room);

  // Объявленные очки — это пока только обязательство игрока.
  // Если объявивший не взял ни одной взятки, объявление сгорает.
  // Дополнительно -10 получает только тот, кто при этом ни разу не сыграл козырем.
  for(const p of room.players){
    if((p.announcedPoints||0)>0 && (p.tricksWon||0)===0){
      p.combinationPoints=0;
      if(!p.trumpPlayed) g.roundScores[p.id]=-10;
      else g.roundScores[p.id]=g.roundScores[p.id]||0;
    }
  }

  for(const p of room.players)g.roundScores[p.id]=(g.roundScores[p.id]||0)+(p.combinationPoints||0);

  // Отдельно сохраняем пользовательский показатель именно этой раздачи.
  g.roundDisplayScores={};
  for(const p of room.players)g.roundDisplayScores[p.id]=roundDisplayScore(p);
  if(config(room).teams){
    g.roundDisplayScores['team-1']=0;
    g.roundDisplayScores['team-2']=0;
    for(const p of room.players)g.roundDisplayScores[`team-${p.team}`]+=roundDisplayScore(p);
  }

  // Если объявлений не было, общий счёт партии получает били, а не сырые очки.
  if(!hasAnnouncedCombos(room)){
    if(config(room).teams){
      g.roundTeamScores={1:0,2:0};
      for(const p of room.players)g.roundTeamScores[p.team]+=roundToBiles(g.roundScores[p.id]||0);
    } else {
      for(const p of room.players)g.roundScores[p.id]=roundToBiles(g.roundScores[p.id]||0);
    }
  }

  if(config(room).teams){
    if(hasAnnouncedCombos(room)){
      g.roundTeamScores={1:0,2:0};
      for(const p of room.players)g.roundTeamScores[p.team]+=g.roundScores[p.id]||0;
    }
    for(const t of [1,2]){
      g.matchTeamScores[t]=(g.matchTeamScores[t]||0)+(g.roundTeamScores[t]||0);
      g.matchTeamBiles[t]=(g.matchTeamBiles[t]||0)+(g.roundDisplayScores[`team-${t}`]||0);
    }
    for(const p of room.players)p.matchScore=g.matchTeamScores[p.team]||0;
    const crossed=[1,2].filter(t=>g.matchTeamBiles[t]>=101);
    g.table=[];
    if(crossed.length){
      const a=g.matchTeamBiles[1],b=g.matchTeamBiles[2];
      g.winnerTeam=a===b?null:(a>b?1:2);
      g.winningName=g.winnerTeam?`Команда ${g.winnerTeam}`:'Ничья';
      g.phase='match-over';g.turnPlayerId=null;return;
    }
  } else {
    for(const p of room.players){
      g.matchScores[p.id]=(g.matchScores[p.id]||0)+(g.roundScores[p.id]||0);
      g.matchBiles[p.id]=(g.matchBiles[p.id]||0)+(g.roundDisplayScores[p.id]||0);
      p.matchScore=g.matchScores[p.id];
    }
    const crossed=room.players.filter(p=>(g.matchBiles[p.id]||0)>=101);
    g.table=[];
    if(crossed.length){
      const winner=crossed.slice().sort((a,b)=>(g.matchBiles[b.id]||0)-(g.matchBiles[a.id]||0))[0];
      g.winnerId=winner.id;g.winningName=winner.name;g.phase='match-over';g.turnPlayerId=null;return;
    }
  }
  g.phase='round-over';g.turnPlayerId=null;

  // Следующая раздача запускается автоматически через 10 секунд.
  const roundNumber=g.roundNumber;
  setTimeout(()=>{
    if(!room.game || room.game.phase!=='round-over' || room.game.roundNumber!==roundNumber)return;
    advanceDealer(room);
    room.game.roundNumber++;
    deal(room);
    emitRoom(room);
  },10000);
}
function nextRound(room){advanceDealer(room);room.game.roundNumber++;deal(room);}
function removePlayer(room,pid){const i=room.players.findIndex(p=>p.id===pid);if(i<0)return;room.players.splice(i,1);if(!room.players.length){rooms.delete(room.code);return;}room.players.forEach((p,n)=>{p.seat=n;p.team=teamForSeat(room,n);});room.players[0].owner=true;}

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('/',(_,res)=>{
  const indexPath = path.join(distPath, 'index.html');
  if (require('fs').existsSync(indexPath)) return res.sendFile(indexPath);
  res.json({ok:true,rooms:rooms.size});
});
app.get(/.*/, (req,res,next)=>{
  if (req.path.startsWith('/socket.io/')) return next();
  const indexPath = path.join(distPath, 'index.html');
  if (require('fs').existsSync(indexPath)) return res.sendFile(indexPath);
  next();
});

io.on('connection',socket=>{
  socket.on('create-room',(data={},cb)=>{
    const mode=['1v1','3p','2v2'].includes(data.mode)?data.mode:'2v2', cfg=modeConfig(mode);
    const p={id:id(),socketId:socket.id,name:normalizeName(data.name),owner:true,seat:0,team:teamForSeat({mode},0),connected:true,hand:[],roundPoints:0,combinationPoints:0,announcedPoints:0,tricksWon:0,trumpPlayed:false,matchScore:0};
    const room={code:roomCode(),name:String(data.roomName||'Новая игра').trim().slice(0,32)||'Новая игра',password:String(data.password||'').trim(),mode,started:false,players:[p],game:null,matchScores:{},matchTeamScores:{1:0,2:0}};
    rooms.set(room.code,room);socket.join(room.code);if(typeof cb==='function')cb({success:true,room:publicRoom(room,p.id),playerId:p.id});emitRoom(room);
  });
  socket.on('join-room',(data={},cb)=>{
    const room=rooms.get(String(data.code||'').trim());if(!room)return err(socket,'Комната не найдена.',cb);const cfg=modeConfig(room.mode);
    if(room.started)return err(socket,'Игра уже началась.',cb);if(room.players.length>=cfg.maxPlayers)return err(socket,`В комнате уже ${cfg.maxPlayers} игроков.`,cb);
    if(room.password&&String(data.password||'')!==room.password)return err(socket,'Неверный пароль комнаты.',cb);
    const seat=room.players.length,p={id:id(),socketId:socket.id,name:normalizeName(data.name),owner:false,seat,team:teamForSeat(room,seat),connected:true,hand:[],roundPoints:0,combinationPoints:0,announcedPoints:0,tricksWon:0,trumpPlayed:false,matchScore:0};
    room.players.push(p);socket.join(room.code);if(typeof cb==='function')cb({success:true,room:publicRoom(room,p.id),playerId:p.id});emitRoom(room);
  });
  socket.on('start-game',(data,cb)=>{
    const f=fromSocket(socket);if(!f)return err(socket,'Вы не в комнате.',cb);const cfg=config(f.room);
    if(!f.p.owner)return err(socket,'Только создатель может начать игру.',cb);if(f.room.players.length!==cfg.maxPlayers)return err(socket,`Нужно ${cfg.maxPlayers} игрока: ${f.room.players.length}/${cfg.maxPlayers}.`,cb);if(f.room.started)return err(socket,'Игра уже началась.',cb);
    startRoomGame(f.room);if(typeof cb==='function')cb({success:true,room:publicRoom(f.room,f.p.id)});emitRoom(f.room);
  });
  socket.on('game-action',(data={},cb)=>{
    const f=fromSocket(socket);if(!f)return err(socket,'Вы не в комнате.',cb);const room=f.room,p=f.p,g=room.game;if(!g)return err(socket,'Игра ещё не началась.',cb);
    if(data.action==='choose-trump'){
      if(g.phase!=='bidding')return err(socket,'Сейчас нельзя выбирать козырь.',cb);if(g.turnPlayerId!==p.id)return err(socket,'Сейчас ход другого игрока.',cb);
      const choice=data.choice;if(!SUITS.includes(choice)&&choice!=='pass')return err(socket,'Неверная масть.',cb);
      if(g.biddingRound===3&&choice==='pass')return err(socket,'В третьем круге нужно выбрать масть.',cb);
      if(g.biddingRound===1&&choice!=='pass'&&choice!==g.offeredSuit)return err(socket,'В первом круге можно взять только предложенную масть.',cb);
      if((g.biddingRound===2||g.biddingRound===3)&&choice!=='pass'&&choice===g.offeredSuit)return err(socket,'Эта масть уже была предложена и от неё отказались. Выберите другую масть.',cb);
      g.bidHistory.push({playerId:p.id,round:g.biddingRound,choice});
      const n=room.players.length;
      if(choice!=='pass'){g.trump=choice;g.trumpChooserId=p.id;finishDeal(room);}
      else if(g.biddingRound===1&&g.bidHistory.filter(x=>x.round===1).length===n){g.biddingRound=2;g.turnPlayerId=nextId(room,g.dealerId);}
      else if(g.biddingRound===2&&g.bidHistory.filter(x=>x.round===2).length===n){g.biddingRound=3;g.turnPlayerId=nextId(room,g.dealerId);}
      else g.turnPlayerId=nextId(room,p.id);
      if(typeof cb==='function')cb({success:true});emitRoom(room);return;
    }
    if(data.action==='announce-combination'){const r=announceCombo(room,p,data.combinationId);if(typeof cb==='function')cb(r);if(r.success)emitRoom(room);return;}
    if(data.action==='play-card'){
      if(g.phase!=='playing')return err(socket,'Сначала нужно завершить выбор козыря.',cb);if(g.turnPlayerId!==p.id)return err(socket,'Сейчас ход другого игрока.',cb);
      const idx=p.hand.findIndex(c=>c.id===data.cardId);if(idx<0)return err(socket,'Этой карты нет у вас.',cb);const legal=legalCards(room,p);if(!legal.some(c=>c.id===data.cardId))return err(socket,'Эту карту сейчас нельзя положить по правилам.',cb);
      const [card]=p.hand.splice(idx,1);
      if(card.suit===g.trump)p.trumpPlayed=true;
      g.table.push({playerId:p.id,card});if(g.table.length===room.players.length)finishTrick(room);else g.turnPlayerId=nextId(room,p.id);
      if(typeof cb==='function')cb({success:true});emitRoom(room);return;
    }
    err(socket,'Неизвестное действие.',cb);
  });
  socket.on('leave-room',()=>{const f=fromSocket(socket);if(!f)return;removePlayer(f.room,f.p.id);socket.leave(f.room.code);if(rooms.has(f.room.code))emitRoom(f.room);});
  socket.on('disconnect',()=>{const f=fromSocket(socket);if(!f)return;removePlayer(f.room,f.p.id);if(rooms.has(f.room.code))emitRoom(f.room);});
});

httpServer.listen(PORT,'0.0.0.0',()=>console.log(`Belot server listening on port ${PORT}`));
