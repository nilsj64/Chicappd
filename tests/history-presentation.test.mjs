import test from "node:test";
import assert from "node:assert/strict";
import { historyStatus } from "../src/historyPresentation.ts";

test("guest copy describes local history without promising an account save", () => {
  const status = historyStatus({loading:false,error:null,records:[{dirty:true}]},false);
  assert.equal(status.state,"local");
  assert.doesNotMatch(status.text,/konto|väntar/i);
});

test("account status distinguishes loading, pending and acknowledged results", () => {
  const pending = {loading:false,error:null,records:[{dirty:true}]};
  assert.equal(historyStatus(pending,true).state,"pending");
  assert.equal(historyStatus({...pending,loading:true},true).state,"loading");
  assert.equal(historyStatus({...pending,records:[{dirty:false}]},true).state,"saved");
});

test("failed cloud refresh takes precedence over loading and does not claim a cloud save", () => {
  const input = {loading:true,error:"offline",records:[{dirty:true}]};
  const original = structuredClone(input);
  const status = historyStatus(input,true);
  assert.equal(status.state,"error");
  assert.match(status.text,/finns kvar/);
  assert.doesNotMatch(status.text,/Supabase|UUID|synk/i);
  assert.deepEqual(input,original);
});

test("device storage failures are never described as a successful local save", () => {
  const error = "Kunde inte spara på den här enheten. Håll sidan öppen och försök igen.";
  for (const signedIn of [false,true]) {
    assert.deepEqual(historyStatus({loading:false,error,records:[{dirty:true}]},signedIn),{state:"error",text:error});
  }
});
