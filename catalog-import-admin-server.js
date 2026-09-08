const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { activate, assertGlantier } = require("./glantier-catalog-core");

const root = __dirname;
const stagingFile = process.env.CATALOG_STAGING_PATH ? path.resolve(root,process.env.CATALOG_STAGING_PATH) : path.join(root, "data", "glantier-catalog-staging.json");
const port = Number(process.env.CATALOG_ADMIN_PORT || 4174);
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp" };
const json = (res,status,data) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data)); };
const readStaging = () => JSON.parse(fs.readFileSync(stagingFile,"utf8"));
const writeStaging = (records) => fs.writeFileSync(stagingFile,JSON.stringify(records,null,2)+"\n");
const validPrice = (value) => /^\d+(?:[.,]\d{1,2})?$/.test(String(value).trim()) && Number(String(value).replace(",",".")) > 0;

async function body(req) {
  let raw=""; for await (const chunk of req) { raw+=chunk; if(raw.length>1_000_000) throw new Error("Request te groot."); }
  return JSON.parse(raw||"{}");
}

async function api(req,res,url) {
  if(req.method==="GET"&&url.pathname==="/api/catalog-import") return json(res,200,{products:readStaging()});
  if(req.method==="POST"&&url.pathname==="/api/catalog-import/prices") {
    const data=await body(req); const updates=Array.isArray(data.products)?data.products:[]; const records=readStaging(); const byId=new Map(records.map((item)=>[item.catalog_id,item]));
    let pricesSaved=0,activated=0,skipped=0; const errors=[];
    for(const update of updates) {
      const record=byId.get(String(update.catalog_id||""));
      if(!record){skipped++;errors.push(`${update.catalog_id||"Onbekend"}: product niet gevonden`);continue;}
      if(!validPrice(update.price)){skipped++;if(update.activate)errors.push(`${record.reference_number}: geldige prijs is verplicht voor activatie`);continue;}
      assertGlantier(record); const price=Number(String(update.price).replace(",","."));
      let next={...record,price,price_status:"set",updated_at:new Date().toISOString()}; pricesSaved++;
      if(update.activate===true){next=activate(next,price);next.add_to_cart_enabled=true;next.active=true;activated++;}
      byId.set(record.catalog_id,next);
    }
    writeStaging(records.map((item)=>byId.get(item.catalog_id)));
    const remaining=[...byId.values()].filter((item)=>!(Number(item.price)>0)).length;
    return json(res,200,{pricesSaved,activated,remaining,skipped,errors});
  }
  if(req.method==="POST"&&url.pathname==="/api/catalog-import/activate-priced") {
    const data=await body(req); if(data.confirm!==true)return json(res,400,{error:"Bulkactivatie moet expliciet worden bevestigd."});
    const records=readStaging();let activated=0,skipped=0;
    const updated=records.map((record)=>{if(record.status==="active")return record;if(validPrice(record.price)){activated++;return {...activate(record,record.price),add_to_cart_enabled:true,active:true};}skipped++;return record;});
    writeStaging(updated);return json(res,200,{pricesSaved:0,activated,remaining:updated.filter((item)=>!(Number(item.price)>0)).length,skipped,errors:[]});
  }
  if(req.method==="POST"&&url.pathname==="/api/catalog-import/generate") {
    const commands=[]; for(const script of ["generate:products","generate:feed"]){const result=spawnSync(process.platform==="win32"?"npm.cmd":"npm",["run",script],{cwd:root,encoding:"utf8"});commands.push({script,ok:result.status===0,output:(result.stdout||"")+(result.stderr||"")});if(result.status!==0)return json(res,500,{error:`${script} is mislukt.`,commands});}
    return json(res,200,{ok:true,commands});
  }
  return json(res,404,{error:"Niet gevonden."});
}

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,"http://127.0.0.1");if(url.pathname.startsWith("/api/"))return await api(req,res,url);const requested=url.pathname==="/"?"/products/catalog-import.html":url.pathname;const file=path.resolve(root,"."+requested);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end("Niet gevonden");}res.writeHead(200,{"Content-Type":mime[path.extname(file).toLowerCase()]||"application/octet-stream"});fs.createReadStream(file).pipe(res);}catch(error){console.error(error);json(res,500,{error:error.message});}});
server.listen(port,"127.0.0.1",()=>console.log(`Catalogusprijsbeheer: http://127.0.0.1:${port}/products/catalog-import.html`));
