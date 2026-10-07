import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { languageStorageKey } from "../src/locale.ts";
import { createIRLGame, recordFirstHands, finishIRLDeal } from "../src/irl.ts";
import { createRoom, addDemoPlayer, startRound, applyCommand, viewForPlayer } from "../src/game.ts";
import { defaultSettings } from "../src/scoring.ts";
import { digitalResult, digitalResultId, digitalHistoryOptions } from "../src/digitalHistory.ts";
import { HistoryStore } from "../src/history.ts";
import { finishedDigitalRound } from "./digital-fixture.mjs";
import { lockedHumanRoom } from "./exchange-fixture.mjs";

// Render the actual components with no environment file, accounts or network calls.
const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),"chicappd-locale-ui-"));
const server=await createServer({configFile:false,envFile:false,cacheDir,server:{middlewareMode:true,hmr:false},appType:"custom",
  // The browser-only provider has no SSR snapshot. Supply it only in this test
  // transform; its real state/records are still used and no source is changed.
  plugins:[{name:"test-ssr-snapshot",enforce:"pre",transform(code,id,options){
    if(options?.ssr && id.endsWith("/DigitalGame.tsx")) return code + "\nexport { Table, Entry, Lobby };";
    if(options?.ssr && id.endsWith("/HistoryProvider.tsx")) return code.replace(/useSyncExternalStore\((\w+)\.subscribe, \1\.getSnapshot\)/g,"useSyncExternalStore($1.subscribe, $1.getSnapshot, $1.getSnapshot)");
  }}]});
const [{LanguageProvider,LanguageSwitch},{HistoryProvider},{default:App},{Table,Entry,Lobby},{default:Physical},{default:Digital},{AccountIdentity}]=await Promise.all([
  server.ssrLoadModule("/src/LanguageProvider.tsx"),server.ssrLoadModule("/src/HistoryProvider.tsx"),server.ssrLoadModule("/src/App.tsx"),server.ssrLoadModule("/src/DigitalGame.tsx"),
  server.ssrLoadModule("/src/IRLTable.tsx"),server.ssrLoadModule("/src/DigitalHistoryPanel.tsx"),server.ssrLoadModule("/src/AccountControl.tsx")]);
const originalStorage=globalThis.localStorage;
after(async()=>{globalThis.localStorage=originalStorage;await server.close();fs.rmSync(cacheDir,{recursive:true,force:true});});
const disk = () => {const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const noop=()=>{};
function render(language,component,storage=disk()) {
  storage.setItem(languageStorageKey,language);globalThis.localStorage=storage;
  return renderToStaticMarkup(React.createElement(LanguageProvider,null,React.createElement(LanguageSwitch),React.createElement(HistoryProvider,null,component)));
}

test("locked human sees the localized exchange waiting view and public CPU offer", t => {
  let game = applyCommand(lockedHumanRoom(t), { type: "start-round", actorId: "ada" });
  const props = { viewerId: "ada", online: false, selectedCardIds: [], exchangeBusy: false, actionBusy: false,
    visibleDiscard: 0, flight: null, reviewedTrickCount: 0,
    ...Object.fromEntries(["onToggle", "onExchange", "onKeep", "onExchangeChoice", "onPlayTrickCard", "onDeclareChicago", "onCardLanded", "onNextRound", "onLobby", "onLeave"].map(key => [key, noop])) };
  for (const offered of [false, true]) {
    if (offered) game = applyCommand(game, { type: "advance-bot", actorId: "ada" });
    const sv = render("sv", React.createElement(Table, { ...props, game: viewForPlayer(game, "ada") }));
    const en = render("en", React.createElement(Table, { ...props, game: viewForPlayer(game, "ada") }));
    assert.match(sv, /Du får inte byta kort\. Väntar på Terra…/);
    assert.match(en, /You cannot exchange cards\. Waiting for Terra…/);
    assert.doesNotMatch(en, /Choose cards to exchange|Take the face-up card/);
    if (offered) assert.match(en, /spades-2/);
  }
});

test("actual landing and optional account UI render in either language",()=>{
  const sv=render("sv",React.createElement(App)),en=render("en",React.createElement(App));
  assert.match(sv,/Skapa spel/);assert.match(sv,/Historik på den här enheten/);
  assert.match(en,/Create game/);assert.match(en,/History on this device/);assert.match(en,/OPTIONAL ACCOUNT/);
  assert.doesNotMatch(en,/Skapa spel|Huvudmeny|Konton är inte|Logga in/);
});
test("physical results and validation controls render without mixed-language summaries",()=>{
  const storage=disk();let game=createIRLGame(["Ada","Bo"],defaultSettings);
  game=recordFirstHands(game,[{playerId:"irl-1",category:"one-pair"},null]);
  game=finishIRLDeal(game,{finalHand:null,finalTrickWinnerId:"irl-2"});
  storage.setItem("chicappd-irl-game",JSON.stringify(game));const backup=storage.getItem("chicappd-irl-game");
  const props={onExit:noop,onDigital:noop};
  const sv=render("sv",React.createElement(Physical,props),storage),en=render("en",React.createElement(Physical,props),storage);
  assert.match(sv,/Poängen är registrerade/);assert.match(en,/Scores recorded/);assert.match(en,/Ada had the best hand \(one pair\)/);
  assert.match(en,/Undo last change/);assert.doesNotMatch(en,/poäng|sticket|Registrera|Huvudmeny|Kortbyte/);
  assert.equal(storage.getItem("chicappd-irl-game"),backup);
});
test("digital statistics render a localized profile rather than an archive",async()=>{
  const props={onBack:noop,onPhysical:noop,onPlay:noop};
  const empty=render("en",React.createElement(Digital,props));assert.match(empty,/Your first game awaits/);assert.match(empty,/Physical matches/);
  const storage=disk(),store=new HistoryStore(storage,undefined,undefined,digitalHistoryOptions);
  const result=digitalResult(finishedDigitalRound().view,"local");store.append(await digitalResultId(result),result);
  const sv=render("sv",React.createElement(Digital,props),storage),en=render("en",React.createElement(Digital,props),storage);
  assert.match(sv,/Spelade matcher/);assert.match(en,/Games played/);assert.match(en,/Average score/);assert.match(en,/Poker hands/);
  assert.doesNotMatch(en,/Final trick:|LOCAL GAME|TEST1/);
  assert.doesNotMatch(en,/Gäst|Sista sticket|LOKALT SPEL|Digitala givar/);
});
test("UI text outside the catalog is limited to names, card symbols and language self-labels",()=>{
  const allowed=new Set(["A","K","Chicago","Chicappd","chicappd","CHICAGO ·","Svenska","English"]);
  for(const file of fs.readdirSync("src").filter(f=>f.endsWith(".tsx"))) {
    const source=ts.createSourceFile(file,fs.readFileSync("src/"+file,"utf8"),ts.ScriptTarget.Latest,true);
    function visit(node){if(ts.isJsxText(node)&&/[A-Za-zåäö]/.test(node.text))assert.ok(allowed.has(node.text.trim()),file+": "+node.text.trim());ts.forEachChild(node,visit);}
    visit(source);
  }
});

test("signed-in identity uses the Auth creation timestamp with localized dates; guests have none",()=>{
  const user={email:"alice@accounts.chicappd.invalid",created_at:"2026-10-01T12:30:00Z",user_metadata:{created_at:"2000-01-01",username:"wrong"}};
  const sv=render("sv",React.createElement(AccountIdentity,{user}));
  const en=render("en",React.createElement(AccountIdentity,{user}));
  assert.match(sv,/alice/);assert.match(sv,/Konto skapat 1 oktober 2026/);
  assert.match(en,/Account created 1 October 2026/);assert.doesNotMatch(en,/2026-10-01|2000|wrong/);
  const guest=render("en",React.createElement(AccountIdentity,{user:null}));
  assert.match(guest,/Playing as a guest/);assert.doesNotMatch(guest,/Account created|<button/);
  const old=render("en",React.createElement(AccountIdentity,{user:{...user,created_at:"2023-03-15T12:00:00Z"}}));
  assert.match(old,/Account created 15 March 2023/);
});

test("legacy statistics explain the recoverable final-hand baseline",async()=>{
 const storage=disk(),store=new HistoryStore(storage,undefined,undefined,digitalHistoryOptions);
 const legacy=digitalResult(finishedDigitalRound().view,"local");
 for(const key of ["evaluations","matchId","dealNumber","winnerId","royalFlushWinnerId"])delete legacy[key];
 store.append(await digitalResultId(legacy),legacy);
 const html=render("en",React.createElement(Digital,{onBack:noop,onPhysical:noop,onPlay:noop}),storage);
 assert.match(html,/Older results include only the final hand/);
 assert.match(html,/Earlier hands cannot be recovered/);
});


test("Swedish digital table and online room screens render natural copy while English stays localized", () => {
  const room=addDemoPlayer(createRoom("Ada", "TEST1"));
  const game=startRound(room), viewerId=game.ownerId;
  const before=JSON.stringify(game);
  const tableProps={viewerId,online:false,selectedCardIds:[],exchangeBusy:false,actionBusy:false,visibleDiscard:0,flight:null,reviewedTrickCount:5,
    ...Object.fromEntries(["onToggle","onExchange","onKeep","onExchangeChoice","onPlayTrickCard","onDeclareChicago","onCardLanded","onNextRound","onLobby","onLeave"].map(k=>[k,noop]))};
  const exchange=render("sv",React.createElement(Table,{...tableProps,game:viewForPlayer(game,viewerId)}));
  assert.match(exchange,/Välj vilka kort du vill byta/);
  const offered=applyCommand(game,{type:"exchange",actorId:viewerId,discardIds:[game.players[0].hand[0].id]});
  const offer=render("sv",React.createElement(Table,{...tableProps,game:viewForPlayer(offered,viewerId)}));
  assert.match(offer,/Ta det öppna kortet/);assert.match(offer,/Tacka nej/);assert.doesNotMatch(offer,/presenterade|Avstå/);
  const {view}=finishedDigitalRound();
  const result=render("sv",React.createElement(Table,{...tableProps,viewerId:view.players[0].id,game:view}));
  assert.match(result,/Rundan är slut|vann sista sticket|Matchen är avgjord/);assert.doesNotMatch(result,/\bgiv(?:en|ar|ens)?\b/i);
  const en=render("en",React.createElement(Table,{...tableProps,viewerId:view.players[0].id,game:view}));
  assert.match(en,/Final trick|Royal Flush/);assert.doesNotMatch(en,/rundan|sticket|Behåll/);
  const lobby=render("sv",React.createElement(Lobby,{game:viewForPlayer(room,viewerId),viewerId,online:true,onRemoveBot:noop,onAddBot:noop,onSettings:noop,onStart:noop,onLeave:noop}));
  assert.match(lobby,/Den som skapade rummet/);assert.match(lobby,/Datorstyrd spelare/);
  const join=render("sv",React.createElement(Entry,{mode:"join",onBack:noop,onSubmit:noop,busy:false,error:"Ogiltig spelarsession."}));
  assert.match(join,/Rumskod/);assert.match(join,/Du behöver gå med i rummet igen/);
  assert.equal(JSON.stringify(game),before);
});

const {default:Status}=await server.ssrLoadModule("/src/HistoryStatus.tsx");
test("Swedish history UI distinguishes local saves, pending account saves, refreshes and failures", () => {
  const cases=[
    [{loading:false,error:null,records:[]},false,/Historik på den här enheten/],
    [{loading:false,error:null,records:[{dirty:true}]},true,/Sparat på enheten · väntar på att sparas på ditt konto/],
    [{loading:false,error:null,records:[{dirty:false}]},true,/Historiken är sparad på ditt konto/],
    [{loading:true,error:null,records:[]},true,/Hämtar historiken/],
    [{loading:true,error:null,records:[{dirty:false}]},true,/Uppdaterar historiken/],
    [{loading:false,error:"network",records:[{dirty:true}]},true,/Det som redan är sparat på enheten finns kvar/],
    [{loading:false,error:"Kunde inte spara på den här enheten. Håll sidan öppen och försök igen.",records:[]},false,/Kunde inte spara på den här enheten/],
  ];
  for(const [history,signedIn,expected] of cases) {
    const html=render("sv",React.createElement(Status,{history,signedIn,onRetry:noop}));
    assert.match(html,expected);assert.doesNotMatch(html,/kontotjänst|kontoärende|synka/);
  }
});

test("six-human lobby and scoreboard localize Chicago rule ON/OFF without empty indicator columns", () => {
  let room = createRoom("Ada", "TEST1", "ada");
  for(let i=1;i<6;i++) room=applyCommand(room,{type:"add-human",actorId:"ada",playerId:`h${i}`,name:`Human ${i}`});
  const lobbyProps={viewerId:"ada",online:true,onRemoveBot:noop,onAddBot:noop,onSettings:noop,onStart:noop,onLeave:noop};
  const props={viewerId:"ada",online:true,selectedCardIds:[],exchangeBusy:false,actionBusy:false,visibleDiscard:0,flight:null,reviewedTrickCount:5,
    ...Object.fromEntries(["onToggle","onExchange","onKeep","onExchangeChoice","onPlayTrickCard","onDeclareChicago","onCardLanded","onNextRound","onLobby","onLeave"].map(k=>[k,noop]))};
  for(const language of ["sv","en"]) for(const required of [true,false]) {
    room={...room,settings:{...room.settings,chicagoRequiredToWin:required}};
    const lobby=render(language,React.createElement(Lobby,{...lobbyProps,game:viewForPlayer(room,"ada")}));
    assert.match(lobby,language==="sv"?/AV 6 PLATSER/:/OF 6 SEATS/);
    assert.equal((lobby.match(/class="lobby-seat seat-filled"/g)||[]).length,6);
    assert.match(lobby,language==="sv"?/Chicago krävs för vinst/:/Chicago required to win/);
    const game=startRound(room);
    const html=render(language,React.createElement(Table,{...props,game:viewForPlayer(game,"ada")}));
    assert.equal((html.match(/class="chicago-check/g)||[]).length,required?6:0);
    if(required) assert.match(html,language==="sv"?/Du måste ha sagt Chicago minst en gång för att vinna/:/You must have declared Chicago at least once to win/);
    else assert.doesNotMatch(html,/chicago-check|✓ =|You must have declared Chicago|Du måste ha sagt Chicago/);
    assert.match(html,language==="sv"?/Royal Flush ger omedelbar vinst/:/Royal Flush wins immediately/);
    assert.doesNotMatch(html,/sidebar-bottom|Spela tillsammans\.|Play together\./);
    assert.match(html,/felt-many/);
  }
});

test("CPU public offer renders its name and exactly one offered card in either language", () => {
  const room=addDemoPlayer(createRoom("Ada","TEST1","ada"));
  const game=startRound(room);
  game.pendingExchange={playerId:game.players[1].id,discardId:game.players[1].hand[0].id,card:game.deck[0],revealUntil:Date.now()+5000};
  const props={viewerId:"ada",online:false,selectedCardIds:[],exchangeBusy:false,actionBusy:false,visibleDiscard:0,flight:null,reviewedTrickCount:0,
    ...Object.fromEntries(["onToggle","onExchange","onKeep","onExchangeChoice","onPlayTrickCard","onDeclareChicago","onCardLanded","onNextRound","onLobby","onLeave"].map(k=>[k,noop]))};
  for(const language of ["sv","en"]) {
    const html=render(language,React.createElement(Table,{...props,game:viewForPlayer(game,"ada")}));
    assert.match(html,language==="sv"?/Terra\s+byter ett kort/:/Terra\s+is exchanging one card/);
    assert.match(html,/class="exchange-offer"/);
    assert.equal((html.match(/class="playing-card /g)||[]).length,6); // five own cards + public offer
    assert.doesNotMatch(html,/exchange-offer-actions/);
  }
});

test("physical setup and six-human scoreboard respect the optional Chicago requirement", () => {
  for(const language of ["sv","en"]) {
    const props={onExit:noop,onDigital:noop};
    const setup=render(language,React.createElement(Physical,props));
    assert.match(setup,language==="sv"?/Chicago krävs för vinst/:/Chicago required to win/);
    const storage=disk();
    storage.setItem("chicappd-irl-game",JSON.stringify(createIRLGame(["Ada","Bo","Cy","Dee","Eve","Flo"],{...defaultSettings,chicagoRequiredToWin:false})));
    const html=render(language,React.createElement(Physical,props),storage);
    assert.doesNotMatch(html,/chicago-check|Du måste ha sagt Chicago|You must have declared Chicago/);
    assert.match(html,language==="sv"?/Över 52 poäng krävs för vinst/:/More than 52 points are needed to win/);
  }
});

test("new CPU names are consistent in lobby, active table and both languages", () => {
  let room=createRoom("Alex","TEST1","ada"); // A human's old-looking name must stay untouched.
  for(let i=0;i<3;i++) room=addDemoPlayer(room);
  const view=viewForPlayer(startRound(room),"ada");
  assert.deepEqual(view.players.map(p=>p.name),["Alex","Terra","Luna","Astra"]);
  const lobbyProps={viewerId:"ada",online:false,onRemoveBot:noop,onAddBot:noop,onSettings:noop,onStart:noop,onLeave:noop};
  const tableProps={viewerId:"ada",online:false,selectedCardIds:[],exchangeBusy:false,actionBusy:false,visibleDiscard:0,flight:null,reviewedTrickCount:0,
    ...Object.fromEntries(["onToggle","onExchange","onKeep","onExchangeChoice","onPlayTrickCard","onDeclareChicago","onCardLanded","onNextRound","onLobby","onLeave"].map(k=>[k,noop]))};
  for(const language of ["sv","en"]) {
    const lobby=render(language,React.createElement(Lobby,{...lobbyProps,game:viewForPlayer(room,"ada")}));
    const table=render(language,React.createElement(Table,{...tableProps,game:view}));
    for(const name of ["Alex","Terra","Luna","Astra"]) {assert.ok(lobby.includes(name));assert.ok(table.includes(name));}
    assert.doesNotMatch(lobby,/\bSam\b|\bKim\b/);assert.doesNotMatch(table,/\bSam\b|\bKim\b/);
  }
});

test('Chicago confirmation shows the chosen check, explains lost points, and offers an explicit pass off-turn', () => {
  const room=addDemoPlayer(createRoom('Ada', 'CHECK', 'ada'));
  let game=startRound(room);
  game={...game,tableStage:'tricks',exchangeCount:3,roundStarterId:'demo-1',activePlayerId:'demo-1',
    players:game.players.map(player=>({...player,score:player.id==='ada'?30:0}))};
  const props={viewerId:'ada',online:true,selectedCardIds:[],exchangeBusy:false,actionBusy:false,
    visibleDiscard:0,flight:null,reviewedTrickCount:5,
    ...Object.fromEntries(['onToggle','onExchange','onKeep','onExchangeChoice','onPlayTrickCard','onDeclareChicago','onPassChicago','onCardLanded','onNextRound','onLobby','onLeave'].map(key=>[key,noop]))};
  const pending=render('sv',React.createElement(Table,{...props,game:viewForPlayer(game,'ada')}));
  assert.match(pending,/Spela utan Chicago/);
  game=applyCommand(game,{type:'declare-chicago',actorId:'ada'});
  const chosen=render('sv',React.createElement(Table,{...props,game:viewForPlayer(game,'ada')}));
  assert.match(chosen,/chicago-check checked/);
  assert.match(chosen,/Du har valt Chicago/);
  assert.doesNotMatch(chosen,/Spela utan Chicago/);
  assert.equal(game.players[0].hasDeclaredChicago,false); // Seat priority is still resolved at the first card.
  const result={...game,tableStage:'result',activePlayerId:null,chicagoBreakerId:'demo-1',chicagoAward:{playerId:'ada',points:-15},
    players:game.players.map(player=>player.id==='ada'?{...player,score:15,hasDeclaredChicago:true}:player)};
  const lost=render('sv',React.createElement(Table,{...props,game:viewForPlayer(result,'ada')}));
  assert.match(lost,/Chicago gav −15 poäng/);
  assert.match(lost,/Krysset finns kvar/);
  assert.match(lost,/chicago-check checked/);
  const en=render('en',React.createElement(Table,{...props,game:viewForPlayer(result,'ada')}));
  assert.match(en,/Chicago awarded −15 points/);
});
