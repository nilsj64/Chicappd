import test from "node:test";
import assert from "node:assert/strict";
import { english, swedish } from "../src/translations.ts";
import { translate, localizeMessage, localizedError, readLanguage, saveLanguage, languageStorageKey, localeFor } from "../src/locale.ts";
import { finishedDigitalRound } from "./digital-fixture.mjs";
import { supportAdvice } from "../src/support.ts";
import { createIRLGame, recordFirstHands, finishIRLDeal, correctIRLScore } from "../src/irl.ts";
import { defaultSettings } from "../src/scoring.ts";
import { accountError, canonicalUsername } from "../src/account.ts";

const disk = () => {const values = new Map(); return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test("English counts use singular nouns without rewriting numeric player names", () => {
  assert.equal(translate("en", "{0}: {1} spelade kort", ["001", 1]), "001: 1 card played");
  assert.equal(localizeMessage("en", "001 hade bästa hand (ett par) och fick 1 poäng vid rundans slut"), "001 had the best hand (one pair) and earned 1 point at the end of the deal");
});
test("language defaults to Swedish and persists only supported choices", () => {
  const storage = disk(); assert.equal(readLanguage(storage),"sv");
  storage.setItem(languageStorageKey,"fr"); assert.equal(readLanguage(storage),"sv");
  saveLanguage(storage,"en"); assert.equal(readLanguage(storage),"en");
  saveLanguage(storage,"sv"); assert.equal(readLanguage(storage),"sv");
  assert.equal(localeFor("sv"),"sv-SE"); assert.equal(localeFor("en"),"en-GB");
});
test("blocked device storage does not prevent language selection or rendering", () => {
  const storage = {getItem(){throw new Error("blocked");},setItem(){throw new Error("quota");}};
  assert.equal(readLanguage(storage),"sv"); assert.doesNotThrow(()=>saveLanguage(storage,"en"));
  assert.equal(translate("en","Gäst"),"Guest");
});
test("both catalogs preserve interpolation placeholders", () => {
  const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
  for (const [key,value] of Object.entries(english)) {
    assert.ok(value.trim(),key);
    assert.deepEqual(placeholders(value),placeholders(key),key);
    if (swedish[key]) assert.deepEqual(placeholders(swedish[key]),placeholders(key),key);
  }
  assert.equal(translate("en","Ta bort {0}",["<Alice>"]),"Remove <Alice>");
});
test("account and connection errors translate without exposing backend details", () => {
  assert.equal(localizedError("en",accountError({code:"invalid_credentials"})),"Incorrect username or password.");
  assert.match(localizedError("en",accountError({code:"user_already_exists"})),/username is taken/);
  let invalid;try{canonicalUsername("ab");}catch(error){invalid=error.message;}
  assert.match(localizedError("en",invalid),/^Invalid username. 3–24 characters/);
  assert.equal(localizedError("en","Draget är inte tillåtet just nu."),"That move is not allowed right now.");
  assert.equal(localizedError("en","Unexpected private backend detail"),"Something went wrong.");
});
test("stored physical summaries translate without changing payloads or player names", () => {
  let game = createIRLGame(["Färg", "Välj spelare"],defaultSettings);
  game = recordFirstHands(game,[{playerId:"irl-1",category:"three-of-a-kind"},null]);
  game = finishIRLDeal(game,{finalHand:{playerId:"irl-2",category:"one-pair"},finalTrickWinnerId:"irl-1"});
  game = correctIRLScore(game,"irl-1",19);
  const before = JSON.stringify(game);
  const summaries = game.lastSummary.map(s=>localizeMessage("en",s));
  assert.match(summaries[0],/Färg had the best hand \(three of a kind\)/);
  assert.match(summaries[2],/Välj spelare had the best hand \(one pair\)/);
  assert.ok(summaries.every(s=>!s.includes("poäng")&&!s.includes("sticket")));
  assert.equal(JSON.stringify(game),before);
  assert.deepEqual(game.lastSummary.map(s=>localizeMessage("sv",s)),game.lastSummary);
});
test("all generated digital activity and result hints translate", () => {
  const {game,view} = finishedDigitalRound();
  for (const entry of game.activity) assert.notEqual(localizeMessage("en",entry),entry,entry);
  const before = JSON.stringify(view);
  assert.match(supportAdvice(view,game.ownerId,"en").context,/The deal is over/);
  assert.equal(JSON.stringify(view),before);
  assert.equal(localizeMessage("en","Ett par – ess"),"One pair — aces");
  assert.equal(localizeMessage("en","Stege – kungar högst"),"Straight — king high");
});
test("English exchange and trick hints keep the same recommendations", () => {
  const {view,game} = finishedDigitalRound();
  const player=view.players.find(p=>p.id===game.ownerId);
  const hand=[['Q','spades'],['Q','hearts'],['9','diamonds'],['6','clubs'],['3','spades']].map(([rank,suit])=>({id:suit+rank,rank,suit}));
  const exchange={...view,tableStage:"exchange",exchangeCount:0,exchangeSubmittedPlayerIds:[],players:view.players.map(p=>p.id===player.id?{...p,hand}:p)};
  for(const next of [exchange,{...exchange,tableStage:"tricks",completedTricks:[],currentTrick:[],waitingForNextTrick:false,activePlayerId:player.id},
    {...exchange,tableStage:"tricks",completedTricks:Array(4).fill({cards:[],winnerId:player.id}),currentTrick:[{playerId:"other",card:{id:"spades2",rank:"2",suit:"spades"}}],waitingForNextTrick:false,activePlayerId:player.id}]) {
    const sv=supportAdvice(next,player.id,"sv"),en=supportAdvice(next,player.id,"en");
    assert.deepEqual(en.tips.map(t=>t.cardIds),sv.tips.map(t=>t.cardIds));
    assert.doesNotMatch(JSON.stringify(en),/poäng|hjärter|spader|behåll|bygger|kort\./i);
  }
});
