// Self-buff checkboxes carry their caveats in a tooltip. BuildEditor's own comment
// on the buff lists asks for exactly that - "any caveat (weapon restrictions, what
// exactly is boosted) in the hint instead" - and Assassin Cross of Sunset has long
// said "No effect while a bow or gun is equipped".
//
// The SELF_BUFFS list was the exception: it renders its own rows instead of going
// through buffCheckboxField, and its tooltip was a hardcoded ternary for the single
// buff that had something to say. Adding `hint` to an entry there did nothing at
// all, which is how the Gatling Fever restriction (2026-10-25) shipped invisible on
// the first pass - the engine was right and the checkbox still said nothing.
//
// Both are checked: the new hint, and Energy Coat's, which moved out of the
// renderer and into its entry and would otherwise be easy to lose silently.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";
const BASE = process.argv[2] || "http://localhost:5173/";
const FE=new URL("../../open-ps-calc-frontend/frontend/",import.meta.url);
const LZ=createRequire(new URL("package.json",FE))("lz-string");
const src=readFileSync(new URL("src/pages/BuildEditor.tsx",FE),"utf8");
const SLOTS=["right_hand","left_hand","head_top","head_mid","head_low","armor","garment","shoes","accessory_left","accessory_right"];
const blk=src.slice(src.indexOf("const Z3_KEYS: string[] = ["),src.indexOf("const Z3_ENC"));
const keys=[]; for(const l of blk.split("\n").slice(1)){ if(l.includes("...Z3_CARD_SLOTS")){for(const s of SLOTS)for(const i of [1,2,3,4])keys.push(`${s}_card${i}`);continue;} for(const m of l.replace(/\/\/.*$/,"").matchAll(/"([^"]+)"/g))keys.push(m[1]); }
const enc={}; keys.forEach((k,i)=>{if(!(k in enc))enc[k]=i.toString(36);});
const ren=(v)=>Array.isArray(v)?v.map(ren):(v&&typeof v==="object")?Object.fromEntries(Object.entries(v).map(([k,x])=>[enc[k]??k,ren(x)])):v;
const link=(st)=>`${BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(st)))}`;
const b=await chromium.launch({channel:"chrome",headless:true});
const p=await (await b.newContext({viewport:{width:1500,height:1600}})).newPage();
let ok=true; const check=(c,m,x)=>{console.log(`${c?"ok ":"FAIL"} ${m}${x===undefined?"":"  ["+JSON.stringify(x).slice(0,150)+"]"}`); if(!c) ok=false;};
// Gunslinger — Gatling Fever hint
await p.goto(link({build:{job_id:24,base_level:90,job_level:50,base_stats:{str:70,agi:80,vit:40,int:20,dex:90,luk:20},
  equipped:{right_hand:13100},target_mob_id:1036},skill:{id:0,level:1,label:"Normal Attack"},targetMode:"monster"}),{waitUntil:"networkidle"});
await p.waitForTimeout(3500);
const gf=await p.locator('label[title^="SC_GS_GATLINGFEVER"]').first().getAttribute("title").catch(()=>null);
check(!!gf && /Gatling guns only/i.test(gf), "Gatling Fever's checkbox explains the weapon restriction", gf);
// Mage — Energy Coat hint survived the move
await p.goto(link({build:{job_id:9,base_level:90,job_level:50,base_stats:{str:1,agi:40,vit:40,int:90,dex:50,luk:1},
  equipped:{right_hand:1601},target_mob_id:1036},skill:{id:0,level:1,label:"Normal Attack"},targetMode:"monster"}),{waitUntil:"networkidle"});
await p.waitForTimeout(3500);
const ec=await p.locator('label[title^="SC_ENERGYCOAT"]').first().getAttribute("title").catch(()=>null);
check(!!ec && /MG_ENERGYCOAT/.test(ec) && /81-100% SP/.test(ec), "Energy Coat kept its tooltip through the move", ec && ec.slice(0,80)+"…");
await b.close();
console.log(ok?"\nPASS":"\nFAIL"); process.exit(ok?0:1);
