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
import { defaultSettings } from "../src/scoring.ts";
import { digitalResult, digitalResultId, digitalHistoryOptions } from "../src/digitalHistory.ts";
import { HistoryStore } from "../src/history.ts";
import { finishedDigitalRound } from "./digital-fixture.mjs";

// Render the actual components with no environment file, accounts or network calls.
const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),"chicappd-locale-ui-"));
const server=await createServer({configFile:false,envFile:false,cacheDir,server:{middlewareMode:true,hmr:false},appType:"custom",
  // The browser-only provider has no SSR snapshot. Supply it only in this test
  // transform; its real state/records are still used and no source is changed.
  plugins:[{name:"test-ssr-snapshot",enforce:"pre",transform(code,id,options){
    if(options?.ssr && id.endsWith("/HistoryProvider.tsx")) return code.replace(/useSyncExternalStore\((\w+)\.subscribe, \1\.getSnapshot\)/g,"useSyncExternalStore($1.subscribe, $1.getSnapshot, $1.getSnapshot)");
  }}]});
const [{LanguageProvider,LanguageSwitch},{HistoryProvider},{default:App},{default:Physical},{default:Digital},{AccountIdentity}]=await Promise.all([
  server.ssrLoadModule("/src/LanguageProvider.tsx"),server.ssrLoadModule("/src/HistoryProvider.tsx"),server.ssrLoadModule("/src/App.tsx"),
  server.ssrLoadModule("/src/IRLTable.tsx"),server.ssrLoadModule("/src/DigitalHistoryPanel.tsx"),server.ssrLoadModule("/src/AccountControl.tsx")]);
const originalStorage=globalThis.localStorage;
after(async()=>{globalThis.localStorage=originalStorage;await server.close();fs.rmSync(cacheDir,{recursive:true,force:true});});
const disk = () => {const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const noop=()=>{};
function render(language,component,storage=disk()) {
  storage.setItem(languageStorageKey,language);globalThis.localStorage=storage;
  return renderToStaticMarkup(React.createElement(LanguageProvider,null,React.createElement(LanguageSwitch),React.createElement(HistoryProvider,null,component)));
}

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
