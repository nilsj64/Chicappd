import test from 'node:test';
import assert from 'node:assert/strict';
import { digitalResult, digitalResultId, digitalStatistics, validDigitalHistory } from '../src/digitalHistory.ts';
import { evaluateHand } from '../src/poker.ts';
import { finishedDigitalRound } from './digital-fixture.mjs';
const cards=(ranks,suit='spades')=>ranks.map(rank=>({id:`${suit}-${rank}`,rank,suit}));
const sample=digitalResult(finishedDigitalRound().view,'local');
function record(index,score,win,evals=[evaluateHand(cards(['2','4','6','8','10']))]) {
 const playerId=sample.players[0].id,otherId=sample.players[1].id;
 return {id:`record-${index}`,updated_at:`2026-10-01T12:00:0${index}Z`,game:{...sample,matchId:`match-${index}`,playerId,
   players:sample.players.map((p,i)=>({...p,score:i?70:score})),winnerId:win===null?null:win?playerId:otherId,evaluations:{[playerId]:evals}}};
}
test('lifetime outcomes, streaks, scores and hands use the local seat and stable chronology',()=>{
 const royal=evaluateHand(cards(['10','J','Q','K','A']));
 const rows=[record(1,55,true),record(2,60,true),record(3,20,false),record(4,8,true,[royal]),record(5,58,true),record(6,30,null)];
 const s=digitalStatistics([...rows].reverse());
 assert.equal(s.gamesPlayed,5);assert.equal(s.wins,4);assert.equal(s.losses,1);assert.equal(s.winPercentage,80);
 assert.equal(s.currentStreak,2);assert.equal(s.longestStreak,2);assert.equal(s.bestScore,60);assert.equal(s.averageScore,231/6);
 assert.deepEqual(s.recent,['win','win','loss','win','win']);assert.equal(s.royalFlushes,1);assert.equal(s.handCounts['straight-flush'],0);
 assert.equal(s.bestHand,royal);assert.equal(s.scoredDeals,6);
 assert.deepEqual(digitalStatistics([...rows,...rows]),s);
 const loss=digitalStatistics([...rows,record(7,20,false)]);assert.equal(loss.currentStreak,0);assert.equal(loss.longestStreak,2);
});
test('tied scores without a rule-defined winner do not create fabricated wins, losses or draws',()=>{
 const r=record(1,60,null);r.game.players=r.game.players.map(p=>({...p,score:60,hasDeclaredChicago:true}));
 delete r.game.winnerId;assert.equal(digitalStatistics([r]).gamesPlayed,0);
});
test('legacy final hands are reconstructed without changing stored results; unknown online seats are excluded',()=>{
 const g=structuredClone(sample);for(const key of ['matchId','dealNumber','winnerId','royalFlushWinnerId','evaluations','playerId']) delete g[key];
 g.players[0].score=55;g.players[0].hasDeclaredChicago=true;
 const backup=JSON.stringify(g),r={id:'old',updated_at:'2026-10-01T12:00:00Z',game:g};
 assert.ok(validDigitalHistory(g));const s=digitalStatistics([r]);assert.equal(s.gamesPlayed,1);assert.equal(s.wins,1);assert.ok(s.bestHand);
 assert.equal(Object.values(s.handCounts).reduce((a,b)=>a+b,0),1);assert.equal(JSON.stringify(g),backup);
 g.source='online';assert.equal(digitalStatistics([r]).unassigned,1);
 assert.equal(digitalStatistics([r],g.players[0].name).wins,1);
});
test('best hand uses evaluator hierarchy and tiebreakers, including initial and intermediate hands',()=>{
 const initial=evaluateHand(cards(['9','10','J','Q','K']));const final=evaluateHand(cards(['2','4','6','8','10']));
 const s=digitalStatistics([record(1,8,true,[initial,final])]);assert.equal(s.bestHand,initial);
 assert.equal(s.handCounts.flush,1);assert.equal(s.handCounts['straight-flush'],0);
});
test('result identity survives revisions but distinguishes seats and successive deals',async()=>{
 const g=structuredClone(sample);g.playerId=g.players[0].id;
 const id=await digitalResultId(g);assert.equal(await digitalResultId({...g,sourceRevision:100}),id);
 assert.notEqual(await digitalResultId({...g,dealNumber:g.dealNumber+1}),id);
 assert.notEqual(await digitalResultId({...g,playerId:g.players[1].id}),id);
});
test('all poker-hand counts use the existing evaluator, with one final hand per deal',()=>{
 const patterns=[
 ['high-card','AS JH 9D 6C 3S'],['one-pair','QS QH 9D 6C 3S'],['two-pair','JS JH 8D 8C 3S'],
 ['three-of-a-kind','KS KH KD 6C 3S'],['straight','9S 8H 7D 6C 5S'],['flush','AH JH 9H 6H 3H'],
 ['full-house','10S 10H 10D 4C 4S'],['four-of-a-kind','8S 8H 8D 8C 3S'],['straight-flush','9H 8H 7H 6H 5H']];
 const suits={S:'spades',H:'hearts',D:'diamonds',C:'clubs'};
 const rows=patterns.map(([category,pattern],i)=>{
  const hand=pattern.split(' ').map(c=>({rank:c.slice(0,-1),suit:suits[c.at(-1)],id:suits[c.at(-1)]+'-'+c.slice(0,-1)}));
  const e=evaluateHand(hand);assert.equal(e.category,category);return record(i,8,true,[e,e,e]);
 });
 const s=digitalStatistics(rows);for(const [category] of patterns)assert.equal(s.handCounts[category],1);
 assert.equal(s.royalFlushes,0);assert.equal(s.handCounts['royal-flush'],0);
});
