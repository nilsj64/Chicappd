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
const [{LanguageProvider,LanguageSwitch},{HistoryProvider},{default:App},{default:Physical},{default:Digital}]=await Promise.all([
  server.ssrLoadModule("/src/LanguageProvider.tsx"),server.ssrLoadModule("/src/HistoryProvider.tsx"),server.ssrLoadModule("/src/App.tsx"),
  server.ssrLoadModule("/src/IRLTable.tsx"),server.ssrLoadModule("/src/DigitalHistoryPanel.tsx")]);
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
test("digital empty and saved archives use translated navigation and dates",async()=>{
  const props={onBack:noop,onPhysical:noop,onPlay:noop};
  const empty=render("en",React.createElement(Digital,props));assert.match(empty,/Your first deal awaits/);assert.match(empty,/Physical matches/);
  const storage=disk(),store=new HistoryStore(storage,undefined,undefined,digitalHistoryOptions);
  const result=digitalResult(finishedDigitalRound().view,"local");store.append(await digitalResultId(result),result);
  const sv=render("sv",React.createElement(Digital,props),storage),en=render("en",React.createElement(Digital,props),storage);
  assert.match(sv,/Sista sticket:/);assert.match(en,/Final trick:/);assert.match(en,/LOCAL GAME/);assert.match(en,/pts/);
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
