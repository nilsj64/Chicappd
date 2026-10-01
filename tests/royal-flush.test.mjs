import test from 'node:test';
import assert from 'node:assert/strict';
import { supportAdvice } from '../src/support.ts';
import { evaluateHand, isRoyalFlush } from '../src/poker.ts';
import { createRoom, createDeck, applyCommand, startRound, viewForPlayer, digitalMatchWinnerId } from '../src/game.ts';
import { digitalResult, digitalResultId, digitalStatistics, validDigitalHistory } from '../src/digitalHistory.ts';
const hand = (ranks, suit='spades') => ranks.map(rank=>({rank,suit,id:`${suit}-${rank}`}));
function exchangeTable(ranks=['10','J','Q','K','2']) {
  let g=createRoom('Ada','ROYAL','ada');
  g=applyCommand(g,{type:'add-human',actorId:'ada',playerId:'bo',name:'Bo'});
  g={...g,phase:'table',dealNumber:1,activePlayerId:'ada',roundStarterId:'ada',
    players:g.players.map((p,i)=>({...p,hand:i?hand(['3','5','7','9','J'],'hearts'):hand(ranks)}))};
  const held=new Set(g.players.flatMap(p=>p.hand.map(c=>c.id)));
  const deck=createDeck().filter(c=>!held.has(c.id));
  g.deck=[...deck.filter(c=>c.id==='spades-A'),...deck.filter(c=>c.id!=='spades-A')];
  return g;
}
test('only ten through ace of one suit is a Royal Flush',()=>{
  for(const suit of ['spades','hearts','diamonds','clubs']) assert.ok(isRoyalFlush(evaluateHand(hand(['10','J','Q','K','A'],suit))));
  for(const ranks of [['9','10','J','Q','K'],['A','2','3','4','5']]) assert.equal(isRoyalFlush(evaluateHand(hand(ranks))),false);
  const mixed=hand(['10','J','Q','K','A']);mixed[0]={...mixed[0],suit:'hearts',id:'hearts-10'};
  assert.equal(isRoyalFlush(evaluateHand(mixed)),false);
  assert.throws(()=>evaluateHand(hand(['10','J','Q','A','A'])));
});
test('accepting a Royal Flush ends before the next seat acts and persists the correct winner',async()=>{
  let g=exchangeTable();
  g=applyCommand(g,{type:'exchange',actorId:'ada',discardIds:['spades-2']});
  assert.equal(g.tableStage,'exchange');assert.equal(g.players[0].hand.at(-1).rank,'2');
  g=applyCommand(g,{type:'exchange-choice',actorId:'ada',accept:true});
  assert.equal(g.tableStage,'result');assert.equal(g.completedTricks.length,0);assert.equal(g.activePlayerId,null);
  assert.equal(digitalMatchWinnerId(g),'ada');assert.equal(g.players[0].score,8);
  assert.equal(g.players[0].hasDeclaredChicago,false);assert.equal(g.handAwards.length,1);
  assert.strictEqual(startRound(g),g);
  assert.strictEqual(applyCommand(g,{type:'exchange',actorId:'bo',discardIds:[]}),g);
  const own=digitalResult(viewForPlayer(g,'ada'),'online','ada'),other=digitalResult(viewForPlayer(g,'bo'),'online','bo');
  assert.ok(validDigitalHistory(own));assert.notEqual(await digitalResultId(own),await digitalResultId(other));
  const record={id:await digitalResultId(own),updated_at:'2026-10-01T12:00:00Z',game:own};
  const s=digitalStatistics([record,record]);assert.equal(s.gamesPlayed,1);assert.equal(s.wins,1);assert.equal(s.losses,0);
  assert.equal(s.royalFlushes,1);assert.equal(s.bestScore,8);assert.equal(s.averageScore,8);assert.equal(s.currentStreak,1);
  assert.equal(s.bestHand.tiebreakers[0],14);assert.equal(s.handCounts['straight-flush'],0);
  const loss=digitalStatistics([{...record,game:other}]);assert.equal(loss.losses,1);assert.equal(loss.royalFlushes,0);
});
test('ordinary Straight Flush follows existing exchange and scoring rules',()=>{
  let g=exchangeTable(['9','10','J','Q','K']);
  g=applyCommand(g,{type:'exchange',actorId:'ada',discardIds:[]});assert.equal(g.tableStage,'exchange');
  g=applyCommand(g,{type:'exchange',actorId:'bo',discardIds:[]});assert.equal(g.players[0].score,8);
  assert.equal(g.tableStage,'exchange');assert.equal(digitalMatchWinnerId(g),null);
});
test('rejected Royal Flush offer is not a win; replacement can win instead',()=>{
  let g=exchangeTable();g=applyCommand(g,{type:'exchange',actorId:'ada',discardIds:['spades-2']});
  g=applyCommand(g,{type:'exchange-choice',actorId:'ada',accept:false});assert.equal(g.tableStage,'exchange');
  assert.equal(g.royalFlushWinnerId,null);
  g=exchangeTable();const ace=g.deck[0];g.deck=[g.deck[1],ace,...g.deck.slice(2)];
  g=applyCommand(g,{type:'exchange',actorId:'ada',discardIds:['spades-2']});
  g=applyCommand(g,{type:'exchange-choice',actorId:'ada',accept:false});assert.equal(g.royalFlushWinnerId,'ada');
});
test('Royal Flush dealt initially is detected before any exchange',()=>{
  const original=crypto.getRandomValues;
  // Force the shuffled deck's first five positions to the spade Royal Flush.
  const deck=createDeck();const wanted=hand(['10','J','Q','K','A']).map(c=>c.id);const target=[...wanted,...deck.filter(c=>!wanted.includes(c.id)).map(c=>c.id)];let i=51;
  crypto.getRandomValues=function(a){const j=deck.findIndex(c=>c.id===target[i]);[deck[i],deck[j]]=[deck[j],deck[i]];a[0]=j;i--;return a;};
  try {
    let g=applyCommand(createRoom('Ada','ROYAL','ada'),{type:'add-human',actorId:'ada',playerId:'bo',name:'Bo'});
    g=startRound(g);assert.equal(g.tableStage,'result');assert.equal(digitalMatchWinnerId(g),'ada');
    assert.equal(g.exchangeEventSerial,0);assert.equal(g.players[0].score,8);
  } finally {crypto.getRandomValues=original;}
});
test('Royal Flush remains a win with the optional score reset and survives lobby restoration',()=>{
  let g=exchangeTable(['10','J','Q','K','A']);g.settings.resetOver52WithoutChicago=true;g.players[0].score=50;
  g=applyCommand(g,{type:'exchange',actorId:'ada',discardIds:[]});assert.equal(g.players[0].score,0);assert.equal(digitalMatchWinnerId(g),'ada');
  g=applyCommand(g,{type:'return-lobby',actorId:'ada'});assert.equal(digitalMatchWinnerId(g),'ada');assert.strictEqual(startRound(g),g);
});
test('a non-owner wins immediately on a multiple-card third exchange',()=>{
  let g=exchangeTable(['2','4','6','8','10']);
  g.players[1].hand=hand(['10','J','Q','2','3'],'hearts');
  const held=new Set(g.players.flatMap(p=>p.hand.map(c=>c.id)));
  const rest=createDeck().filter(c=>!held.has(c.id));
  g.deck=[...rest.filter(c=>['hearts-K','hearts-A'].includes(c.id)),...rest.filter(c=>!['hearts-K','hearts-A'].includes(c.id))];
  g.activePlayerId='bo';g.exchangeCount=2;
  g=applyCommand(g,{type:'exchange',actorId:'bo',discardIds:['hearts-2','hearts-3']});
  assert.equal(g.tableStage,'result');assert.equal(digitalMatchWinnerId(g),'bo');assert.equal(g.players[1].score,8);
  assert.equal(g.players[0].score,0);assert.equal(g.completedTricks.length,0);
  assert.equal(g.handAwards[0].winnerId,'bo');
});
test('live projections never reveal initial hand evaluations before results',()=>{
  let g=createRoom('Ada','ROYAL','ada');g=applyCommand(g,{type:'add-human',actorId:'ada',playerId:'bo',name:'Bo'});g=startRound(g);
  if(g.tableStage==='exchange')assert.equal(viewForPlayer(g,'bo').initialHandEvaluations,undefined);
});

test('Royal Flush result advice does not claim a final trick was played',()=>{
 let g=exchangeTable(['10','J','Q','K','A']);g=applyCommand(g,{type:'exchange',actorId:'ada',discardIds:[]});
 const v=viewForPlayer(g,'ada');assert.match(supportAdvice(v,'ada','sv').context,/Royal Flush ger omedelbar vinst/);
 assert.match(supportAdvice(v,'ada','en').context,/without playing tricks/);
 assert.doesNotMatch(supportAdvice(v,'ada','en').context,/gave .* points/);
});
