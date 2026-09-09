const fs=require("fs");
const path=require("path");
const vm=require("vm");
const {extractIngredients}=require("./glantier-ingredients");

const root=__dirname;
const preview=JSON.parse(fs.readFileSync(path.join(root,"data/glantier-import-preview.json"),"utf8"));
const approvedPath=path.join(root,"data/glantier-approved-data.json");
const approved=JSON.parse(fs.readFileSync(approvedPath,"utf8"));
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,"products.js"),"utf8"),context);
const activeRefs=new Set(context.window.ORIVEA_PRODUCTS.map((item)=>String(item.glantierNummer||item.id||"")));
const all=process.argv.includes("--all");
const forceCurrentParser=process.argv.includes("--force-current-parser");
const requestedRefs=new Set((process.argv.find((arg)=>arg.startsWith("--refs="))||"").replace("--refs=","").split(",").map((ref)=>ref.trim()).filter(Boolean));
const delay=Math.max(900,Number(process.env.GLANTIER_REQUEST_DELAY_MS||1200));
const debugRoot=path.join(root,"data/crawler-debug");
const candidates=[...new Map(preview.filter((item)=>item.official?.official_product_url&&item.official?.brand==="Glantier"&&item.official?.source_status==="verified_official"&&activeRefs.has(String(item.reference_number))).sort((a,b)=>Number(Boolean(a.official.premium))-Number(Boolean(b.official.premium))).map((item)=>[String(item.reference_number),item])).values()];
const targets=candidates.filter((item)=>(!requestedRefs.size||requestedRefs.has(String(item.reference_number)))&&(all||forceCurrentParser||!approved[item.reference_number]?.ingredients_source_text||!["approved_official","found"].includes(approved[item.reference_number]?.ingredients_status)));
const report={generated_at:new Date().toISOString(),mode:all?"all":"missing_only",inventoried:activeRefs.size,official_targets:targets.length,found:0,not_found:0,parse_failed:0,conflicts:[],products:[]};

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const safeName=(value)=>String(value||"unknown").replace(/[^a-z0-9_.-]/gi,"-");
function debug(item,result,html){const dir=path.join(debugRoot,safeName(item.reference_number),safeName(item.official.product_type||"product"));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"ingredients-debug.json"),JSON.stringify({url:item.official.official_product_url,status:result.ingredients_status,labels:result.found_labels,candidates:result.candidates,reason:result.ingredients_status==="parse_failed"?"Label aanwezig maar geen plausibele INCI-lijst gevonden":"Geen ingrediëntenlabel of plausibele INCI-lijst gevonden"},null,2));const marker=Math.max(0,...["ingred","inci","composition","składniki"].map((needle)=>html.toLowerCase().indexOf(needle)).filter((index)=>index>=0));fs.writeFileSync(path.join(dir,"snippet.html"),html.slice(Math.max(0,marker-500),marker+5000));}
async function fetchOfficial(url){const parsed=new URL(url);if(parsed.hostname!=="www.glantier.com"||!parsed.pathname.startsWith("/nl/"))throw new Error("Niet-officiële URL geweigerd");const response=await fetch(url,{cache:"no-store",headers:{"user-agent":"ORIVEA-ProductImporter/2.1 (+https://orivea.nl; targeted ingredient refresh)",accept:"text/html,application/xhtml+xml","cache-control":"no-cache",pragma:"no-cache"},signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text();}

(async()=>{
  for(const item of targets){const old=approved[item.reference_number]?.ingredients_status||"not_found";let result;
    try{const html=await fetchOfficial(item.official.official_product_url);result=extractIngredients(html);if(result.ingredients_status==="approved_official"){
      const existing=approved[item.reference_number];
      const replaceParserOutput=forceCurrentParser&&existing?.crawler_version==="2.1.0"&&existing?.source_url===item.official.official_product_url;
      if(existing?.ingredients_source_text&&existing.ingredients_source_text!==result.ingredients_source_text&&!replaceParserOutput){report.conflicts.push({reference:item.reference_number,url:item.official.official_product_url});result.ingredients_status="review_required";}
      else{approved[item.reference_number]={...(existing||{}),reference_number:item.reference_number,product_name:item.official.product_name,product_type:item.official.product_type,volume:item.official.volume,ingredients_source_text:result.ingredients_source_text,ingredients:result.ingredients,ingredients_status:"approved_official",ingredients_extraction_source:result.extraction_source,official_product_url:item.official.official_product_url,source:"official_glantier",source_url:item.official.official_product_url,source_last_checked:new Date().toISOString(),source_status:"verified_official",crawler_version:"2.1.0",quality_status:"approved",approved_at:new Date().toISOString()};report.found++;}
      }else{report[result.ingredients_status]++;debug(item,result,html);}
    }catch(error){result={ingredients_status:"parse_failed",error:error.message};report.parse_failed++;debug(item,{...result,found_labels:[],candidates:[]},"");}
    report.products.push({reference:item.reference_number,name:item.official.product_name,url:item.official.official_product_url,old_status:old,new_status:result.ingredients_status,found:result.ingredients_status==="approved_official"});
    await sleep(delay);
  }
  fs.writeFileSync(approvedPath,JSON.stringify(approved,null,2)+"\n");fs.writeFileSync(path.join(root,"data/ingredients-refresh-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
})().catch((error)=>{console.error(error.stack||error.message);process.exitCode=1;});
