import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL=import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket=io(SERVER_URL,{autoConnect:true});
const SUITS=[
  {id:'clubs',symbol:'♣',name:'Трефы',red:false},
  {id:'diamonds',symbol:'♦',name:'Бубны',red:true},
  {id:'hearts',symbol:'♥',name:'Червы',red:true},
  {id:'spades',symbol:'♠',name:'Пики',red:false}
];
const MODES=[
  {id:'1v1',title:'1 × 1',desc:'2 игрока · каждый сам за себя',players:2},
  {id:'3p',title:'3 игрока',desc:'3 игрока · каждый сам за себя',players:3},
  {id:'2v2',title:'2 × 2',desc:'4 игрока · две команды',players:4}
];
const suit=s=>SUITS.find(x=>x.id===s)||SUITS[0];
const modeInfo=m=>MODES.find(x=>x.id===m)||MODES[2];

function App(){
  const [screen,setScreen]=useState('home'),[room,setRoom]=useState(null),[playerId,setPlayerId]=useState(null);
  const [name,setName]=useState(''),[roomName,setRoomName]=useState(''),[password,setPassword]=useState(''),[mode,setMode]=useState('2v2');
  const [joinCode,setJoinCode]=useState(''),[joinPassword,setJoinPassword]=useState(''),[joinName,setJoinName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const state=r=>{setRoom(r);if(r.started)setScreen('game');};
    const e=d=>setError(d?.message||'Ошибка');
    socket.on('room-state',state);socket.on('error-message',e);
    return()=>{socket.off('room-state',state);socket.off('error-message',e)};
  },[]);
  const me=useMemo(()=>room?.players?.find(p=>p.id===playerId),[room,playerId]);
  const emit=(event,data,after)=>{setError('');setBusy(true);socket.emit(event,data,r=>{setBusy(false);if(!r?.success)setError(r?.message||'Ошибка');else after?.(r)})};
  const create=()=>{if(!name.trim())return setError('Введите имя.');if(!roomName.trim())return setError('Введите название комнаты.');emit('create-room',{name,roomName,password,mode},r=>{setRoom(r.room);setPlayerId(r.playerId);setScreen('room')})};
  const join=()=>{if(!joinName.trim())return setError('Введите имя.');if(!joinCode.trim())return setError('Введите код комнаты.');emit('join-room',{name:joinName,code:joinCode,password:joinPassword},r=>{setRoom(r.room);setPlayerId(r.playerId);setScreen('room')})};
  const leave=()=>{socket.emit('leave-room');setRoom(null);setPlayerId(null);setScreen('home');setError('')};
  const start=()=>emit('start-game',{},r=>{setRoom(r.room);setScreen('game')});
  if(screen==='home')return <Home {...{name,setName,roomName,setRoomName,password,setPassword,mode,setMode,joinName,setJoinName,joinCode,setJoinCode,joinPassword,setJoinPassword,create,join,error,busy}}/>;
  if(screen==='room')return <Lobby room={room} me={me} start={start} leave={leave} busy={busy} error={error}/>;
  return <Table room={room} me={me} playerId={playerId} leave={leave} error={error}/>;
}
function Shell({children,error}){return <div className="app"><header className="sitebar"><button className="logo" onClick={()=>location.reload()}><span>♣</span> BELOT</button><div className="target">Игра до <b>101</b></div></header>{error&&<div className="error">{error}</div>}{children}</div>}
function Home(p){return <Shell error={p.error}><main className="home"><div className="hero"><div className="logo-big">♣</div><h1>Белот онлайн</h1><p>Классический Белот в трёх форматах игры.</p></div><div className="home-grid"><section className="home-card"><h2>Создать игру</h2><label>Ваше имя</label><input value={p.name} onChange={e=>p.setName(e.target.value)} placeholder="Введите имя"/><label>Название комнаты</label><input value={p.roomName} onChange={e=>p.setRoomName(e.target.value)} placeholder="Например, Игра друзей"/><label>Режим игры</label><div className="mode-grid">{MODES.map(m=><button key={m.id} type="button" className={`mode-option ${p.mode===m.id?'selected':''}`} onClick={()=>p.setMode(m.id)}><b>{m.title}</b><span>{m.desc}</span></button>)}</div><label>Пароль <small>необязательно</small></label><input value={p.password} onChange={e=>p.setPassword(e.target.value)} placeholder="Без пароля"/><button className="gold-btn" onClick={p.create} disabled={p.busy}>Создать комнату</button></section><section className="home-card"><h2>Войти в игру</h2><label>Ваше имя</label><input value={p.joinName} onChange={e=>p.setJoinName(e.target.value)} placeholder="Введите имя"/><label>Код комнаты</label><input value={p.joinCode} onChange={e=>p.setJoinCode(e.target.value)} placeholder="6 цифр" maxLength={6}/><label>Пароль <small>если установлен</small></label><input value={p.joinPassword} onChange={e=>p.setJoinPassword(e.target.value)} placeholder="Пароль комнаты"/><button className="dark-btn" onClick={p.join} disabled={p.busy}>Войти в комнату</button></section></div><div className="rules-note"><b>♠ Классический Белот</b><span>1×1 · 3 игрока · 2×2 · козырь · комбинации · партия до 101</span></div></main></Shell>}
function Lobby({room,me,start,leave,busy,error}){const cfg=modeInfo(room.mode);return <Shell error={error}><main className="lobby"><section className="lobby-card"><div className="lobby-head"><div><span className="eyebrow">КОМНАТА</span><h1>{room.name}</h1><p>Код комнаты: <b className="room-code">{room.code}</b></p></div><div className="mode-pill">{cfg.title}</div></div><div className="mode-description">{cfg.desc}</div><div className={`seat-grid seats-${cfg.players}`}>{Array.from({length:cfg.players},(_,i)=>{const p=room.players[i];return <div className={`seat ${p?'filled':''}`} key={i}><div className="avatar">{p?p.name.slice(0,1).toUpperCase():'?'}</div>{p?<><b>{p.name}{p.id===me?.id?' (вы)':''}</b><span>{room.mode==='2v2'?`Команда ${p.team}`:'Играет за себя'}</span>{p.owner&&<em>Создатель</em>}</>:<><b>Ожидание игрока</b><span>Место {i+1}</span></>}</div>})}</div><div className="lobby-actions"><button className="gold-btn" disabled={!me?.owner||room.players.length!==cfg.players||busy} onClick={start}>{room.players.length===cfg.players?'Начать игру':`Ожидание игроков ${room.players.length}/${cfg.players}`}</button><button className="link-btn" onClick={leave}>Выйти</button></div></section></main></Shell>}
function Table({room,me,playerId,leave,error}){
  const g=room.game,cfg=modeInfo(room.mode),turn=room.players.find(p=>p.id===g?.turnPlayerId),myTurn=turn?.id===playerId;
  const isDealing=g?.phase==='dealing',isBid=g?.phase==='bidding',isPlay=g?.phase==='playing',roundOver=g?.phase==='round-over',matchOver=g?.phase==='match-over';
  const seats=room.players;
  const chooser=room.players.find(p=>p.id===g?.dealAnimation?.recipientId);
  const chooserSide=chooser?seatSide(room,chooser):'top';
  return <Shell error={''}><main className={`game-wrap mode-${room.mode}`}>
    <div className="game-head"><div className="players-tabs">{seats.map(p=><div key={p.id} className={`tab ${p.id===playerId?'me':''}`}><span className="tab-dot">{p.name.slice(0,1)}</span><span>{p.name}</span></div>)}</div><div className="game-title"><span>Стол {room.code}</span><b>{cfg.title} · До 101</b></div></div>
    <div className="felt-area"><div className="felt"><div className="felt-inner">
      <DeckZone g={g}/>
      <DealOverlay g={g} chooserSide={chooserSide}/>
      <PlayerPos p={seats[0]} side="top" active={turn?.id===seats[0]?.id} g={g}/>
      {seats.length>2&&<PlayerPos p={seats[1]} side="left" active={turn?.id===seats[1]?.id} g={g}/>}
      <PlayerPos p={seats.length===2?seats[1]:seats[2]} side={seats.length===2?'right':'right'} active={turn?.id===(seats.length===2?seats[1]?.id:seats[2]?.id)} g={g}/>
      {seats.length===4&&<PlayerPos p={seats[3]} side="bottom" active={turn?.id===seats[3]?.id} g={g} me/>}
      {seats.length===3&&<PlayerPos p={seats[0]} side="bottom" active={false} g={g} ghost/>}
      <div className="center">
        <div className="table-status">{isDealing?dealStatus(g):isBid?`Круг ${g.biddingRound}`:matchOver?'Игра окончена':roundOver?'Раздача закончена':`Взятка ${g.trickNumber}`}</div>
        {g.announcements?.length>0&&<div className="announcement-feed">Объявление: <b>{g.announcements[g.announcements.length-1].playerName}</b> — <strong>{g.announcements[g.announcements.length-1].label}</strong> <span>+{g.announcements[g.announcements.length-1].points}</span></div>}
        {g.trump&&!isDealing&&<div className="trump-chip">Козырь <b>{suit(g.trump).symbol}</b></div>}
        <div className="table-cards">{g.table?.length?g.table.map(x=><Card key={x.card.id} card={x.card} table/>):<div className="empty-felt">{isBid?'Выберите козырь':' '}</div>}</div>
      </div><div className="dealer">D</div>
    </div></div></div>
    <section className="control-panel">{isBid&&<Bidding g={g} playerId={playerId}/>} {isPlay&&<PlayPanel g={g} playerId={playerId} myTurn={myTurn} turn={turn}/>} {roundOver&&<RoundResult room={room}/>} {matchOver&&<MatchResult room={room} game={g}/>}</section>
    <div className="hand-area">{(isDealing||isPlay||isBid)&&<div className={`hand ${isPlay && !myTurn ? 'hand-waiting' : ''} deal-stage-${g.dealAnimation?.stage||'none'}`}>{g.myCards.map((c,i)=>isPlay?<button key={c.id} className={`hand-card ${!myTurn ? 'waiting' : ''} ${dealCardClass(g,i)}`} style={{'--i':i,'--deal-delay':`${dealDelay(g,i)}ms`}} disabled={!myTurn} onClick={()=>act('play-card',{cardId:c.id})}><Card card={c}/></button>:<div key={c.id} className={`hand-card static ${dealCardClass(g,i)}`} style={{'--i':i,'--deal-delay':`${dealDelay(g,i)}ms`}}><Card card={c}/></div>)}</div>}
      <div className="bottom-bar"><button className="round-btn" onClick={leave}>Выйти</button><ScoreMini room={room}/></div>
    </div>
  </main></Shell>
}
function seatSide(room,p){
  if(!p)return 'top';
  if(room.players.length===2)return p.seat===0?'top':'right';
  if(room.players.length===3)return p.seat===0?'top':p.seat===1?'left':'right';
  return p.seat===0?'top':p.seat===1?'left':p.seat===2?'right':'bottom';
}
function dealStatus(g){
  if(g.dealAnimation?.stage==='deal-five')return 'Раздача • по 5 карт';
  if(g.dealAnimation?.stage==='turn-card')return 'Открываем карту колоды…';
  if(g.dealAnimation?.stage==='jack-flight')return 'БИЗОН! Валет определил козырь';
  if(g.dealAnimation?.stage==='deal-final')return g.autoTrump?'БИЗОН у игрока • раздаём остальные карты':'Масть выбрана • раздаём остальные карты';
  return 'Раздача карт';
}
function dealCardClass(g,i){
  const stage=g.dealAnimation?.stage;
  if(stage==='deal-five'&&i<5)return 'deal-in';
  if(stage==='deal-final'&&i>=5)return 'deal-in new-deal';
  return '';
}
function dealDelay(g,i){
  const stage=g.dealAnimation?.stage;
  if(stage==='deal-five')return i*95;
  if(stage==='deal-final'&&i>=5)return (i-5)*125;
  return 0;
}
function DeckZone({g}){
  const stage=g?.dealAnimation?.stage;
  const showDeck=g?.phase==='dealing'||g?.phase==='bidding';
  if(!showDeck||!g?.trumpCard)return null;
  const active=suit(g.offeredSuit||g.trump);
  const showTurned=stage==='turn-card'||stage==='bidding';
  const jack=stage==='jack-flight';
  return <div className={`deck-zone ${showTurned?'is-bidding':''} ${jack?'is-jack-flight':''}`}>
    <div className="deck-stack"><span/><span/><span/></div>
    {showTurned&&<div className="turned-card reveal-card"><Card card={g.trumpCard} table/><span className={active.red?'turned-suit red-text':'turned-suit'}>{active.symbol}</span></div>}
    {jack&&<div className="jack-source"><Card card={g.trumpCard} table/></div>}
    <div className="deck-label">{jack?<><b>БИЗОН</b> <span className={active.red?'red-text':''}>J {active.symbol}</span></>:showTurned?<><b>ОТКРЫТО</b> <span className={active.red?'red-text':''}>{active.symbol} {active.name}</span></>:<><b>КОЛОДА</b></>}</div>
  </div>
}
function DealOverlay({g,chooserSide}){
  if(g?.dealAnimation?.stage!=='jack-flight'||!g.trumpCard)return null;
  return <div className={`jack-flight-overlay target-${chooserSide}`}><div className="jack-flight-card"><Card card={g.trumpCard} table/><div className="flight-glow"/></div><div className="bizone-badge">БИЗОН <b>{suit(g.trumpCard.suit).symbol}</b></div></div>;
}
function PlayerPos({p,side,active,g,ghost}){if(!p||ghost)return null;const liveRound=Number(p.roundPoints||0)+Number(p.combinationPoints||0);const score=(g?.phase==='playing'||g?.phase==='bidding')?liveRound:(p.matchScore||0);return <div className={`player-pos ${side} ${active?'active':''}`}><div className="avatar large">{p.name.slice(0,1).toUpperCase()}</div><div className="player-name"><b>{p.name}</b><span className="live-score">Очки: <strong>{score}</strong></span>{(p.announcedPoints||0)>0&&<span className="live-announcement"><span>Объявлено</span> <strong>+{p.announcedPoints}</strong></span>}</div><div className="tricks-badge"><span>Взятки</span><strong>{p.tricksWon||0}</strong></div><div className="back-cards">{Array.from({length:Math.min(p.cardCount,5)}).map((_,i)=><span key={i}/>)}</div>{p.team&&<small className="team-tag">Команда {p.team}</small>}</div>}
function Card({card,table}){const s=suit(card.suit);return <div className={`card ${s.red?'red':''} ${table?'table-card':''}`}><div className="rank">{card.rank}</div><div className="big-suit">{s.symbol}</div>{['J','Q','K'].includes(card.rank)&&<div className="court">{card.rank==='J'?'♙':card.rank==='Q'?'♕':'♔'}</div>}</div>}
function Bidding({g,playerId}){const my=g.turnPlayerId===playerId,r=g.biddingRound,off=suit(g.offeredSuit);const unavailable=r===1?SUITS.filter(s=>s.id!==g.offeredSuit):SUITS.filter(s=>s.id===g.offeredSuit);return <div className="bid-box"><div><span className="eyebrow">КОЗЫРЬ</span><h2>{r===1?'Первый круг':r===2?'Второй круг':'Третий круг'}</h2><p>{r===1?<>Предложена масть <b>{off.symbol} {off.name}</b>. Можно взять её или сказать «Пас».</>:<>В первом круге от <b>{off.symbol} {off.name}</b> отказались. Теперь её выбрать нельзя.</>}</p></div><div className="bid-buttons">{SUITS.map(s=><button key={s.id} disabled={!my||(r===1&&s.id!==g.offeredSuit)||((r===2||r===3)&&s.id===g.offeredSuit)} onClick={()=>act('choose-trump',{choice:s.id})} className={`${s.red?'red':''} ${unavailable.some(x=>x.id===s.id)?'forbidden':''}`}><b>{s.symbol}</b><span>{s.name}</span></button>)}{r!==3&&<button className="pass" disabled={!my} onClick={()=>act('choose-trump',{choice:'pass'})}>Пас</button>}</div><div className="bid-state">{my?'ВАШ ХОД — выберите масть или «Пас»':'Ожидание решения игрока'}</div></div>}
function PlayPanel({g,playerId,myTurn,turn}){const mine=g.combinations?.find(x=>x.playerId===playerId),combo=mine?.items?.find(x=>!x.announced&&x.points>0),canAnnounce=(g.trickNumber||0)<=2;return <div className="play-controls"><div className="turn-text">{myTurn?'Ваш ход':`Ход: ${turn?.name||'—'}`}</div><div className="combo-row">{g.autoTrump&&<span className="auto-trump">Валет был открыт — козырь выбран автоматически</span>}{canAnnounce&&combo&&<button className="small-btn" onClick={()=>act('announce-combination',{combinationId:combo.id})}>Объявить {combo.label}</button>}<span>Козырь: {g.trump?suit(g.trump).symbol:'—'}</span></div></div>}
function ScoreMini({room}){if(room.mode==='2v2')return <div className="score-mini"><span>Команда 1 <b>{room.game?.matchTeamBiles?.[1]||0}</b></span><span>Команда 2 <b>{room.game?.matchTeamBiles?.[2]||0}</b></span></div>;return <div className="score-mini">{room.players.map(p=><span key={p.id}>{p.name} <b>{room.game?.matchBiles?.[p.id]||0}</b></span>)}</div>}
function RoundResult({room}){const g=room.game;const isTeam=room.mode==='2v2';return <div className="result-box"><h2>Раздача завершена</h2><div className="result-grid">{isTeam?[1,2].map(t=><div key={t}>Команда {t}<b>{g.roundDisplayScores?.[`team-${t}`]??g.roundTeamScores?.[t]??0}</b></div>):room.players.map(p=><div key={p.id}>{p.name}<b>{g.roundDisplayScores?.[p.id]??0}</b></div>)}</div><p className="auto-round-note">Следующая раздача начнётся автоматически через 4 секунды</p></div>}
function MatchResult({room,game}){return <div className="result-box winner"><h2>{room.mode==='2v2'?(game.winnerTeam?`Победила команда ${game.winnerTeam}`:'Ничья'):(game.winningName?`Победил ${game.winningName}`:'Игра окончена')}</h2><div className="result-grid">{room.mode==='2v2'?[1,2].map(t=><div key={t}>Команда {t}<b>{game.matchTeamBiles?.[t]??0}</b></div>):room.players.map(p=><div key={p.id}>{p.name}<b>{game.matchBiles?.[p.id]??0}</b></div>)}</div></div>}
function act(action,data){socket.emit('game-action',{action,...data},()=>{})}
export default App;
