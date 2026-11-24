#!/usr/bin/env bash
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
PRUEBA=0; ARGS=()
for a in "$@"; do [ "$a" = "--prueba" ] && PRUEBA=1 || ARGS+=("$a"); done
[ ${#ARGS[@]} -ge 3 ] || { sed -n 2,13p "$0" >&2; exit 2; }
ORI=${ARGS[0]}; DES=${ARGS[1]}; TIT=${ARGS[2]}; DESC=${ARGS[3]:-}
[ -z "$DESC" ] || [ -f "$DESC" ] || { echo "no existe el fichero de descripción: $DESC" >&2; exit 2; }
ORI="$ORI" DES="$DES" TIT="$TIT" DESC="$DESC" PRUEBA="$PRUEBA" SOLO_TITULO="${SOLO_TITULO:-0}" REPO="${BB_REPO:-oca-global/oca-salesforce}" node -e '
const fs=require("fs"),os=require("os"),path=require("path"),e=process.env;
const conf={}; try{ for(const l of fs.readFileSync(path.join(os.homedir(),".config","canal-slack.env"),"utf8").split("\n")){ const x=l.replace("\r","").trim(),i=x.indexOf("="); if(i>0&&!x.startsWith("#")) conf[x.slice(0,i)]=x.slice(i+1).trim().replace(/^["\x27]|["\x27]$/g,""); } }catch(err){}
const sal=(c,m)=>{ (c?console.error:console.log)(m); process.exit(c); };
if(!conf.BITBUCKET_EMAIL||!conf.BITBUCKET_API_TOKEN) sal(3,"Faltan BITBUCKET_EMAIL y BITBUCKET_API_TOKEN en ~/.config/canal-slack.env (token de API de Atlassian solo para Bitbucket, con read:repository, read:pullrequest y write:pullrequest). No se ha abierto nada.");
const auth="Basic "+Buffer.from(conf.BITBUCKET_EMAIL+":"+conf.BITBUCKET_API_TOKEN).toString("base64");
const base="https://api.bitbucket.org/2.0/repositories/"+e.REPO;
const api=async(u,o={})=>{ const r=await fetch(base+u,{...o,headers:{Authorization:auth,Accept:"application/json",...(o.body?{"Content-Type":"application/json"}:{})}}); let j=null; try{j=await r.json()}catch(err){} return {st:r.status,j}; };
const msg=j=>(j&&j.error&&(j.error.message+(j.error.detail?" ("+(typeof j.error.detail==="string"?j.error.detail:JSON.stringify(j.error.detail))+")":"")))||"";
(async()=>{
  const LINEAS={PRJB:"TRANSVERSAL",BDXN:"INDUSTRIA",CERTA:"CERTIFICACION",BDC:"CERTIFICACION",SGAG:"CERTIFICACION",SGAG2:"CERTIFICACION",BDY:"INTERNACIONAL",BDZ:"FORMACION",PROJA:"DTT"};
  let tit=e.TIT.replace(/\s+/g," ").trim(), avisoTit="";
  const FORMATO=/^[A-ZÁÉÍÓÚÑ]+(?: [A-ZÁÉÍÓÚÑ]+)? \| [A-Z][A-Z0-9]*-\d+ \| \S/;
  if(!FORMATO.test(tit)){
    const m=tit.match(/\b([A-Z][A-Z0-9]*)-(\d+)\b/);
    if(!m) sal(2,`El título tiene que ser «LÍNEA | TICKET | Descripción» (p. ej. «INDUSTRIA | BDXN-401 | …») y no lleva ticket. No se ha abierto nada.`);
    const linea=LINEAS[m[1]]; if(!linea) sal(2,`El título tiene que ser «LÍNEA | ${m[0]} | Descripción»: no sé la línea de negocio de ${m[1]}; ponla tú. No se ha abierto nada.`);
    const desc=tit.replace(/^[A-ZÁÉÍÓÚÑ ]+\|\s*/,"").replace(new RegExp("\\(?\\b"+m[0]+"\\b\\)?\\s*[-:|·]?\\s*","g"),"").replace(/^[\s\-:|·]+|[\s\-:|·]+$/g,"").trim();
    tit=`${linea} | ${m[0]} | ${desc||"(sin descripción)"}`; avisoTit=` · título ajustado al formato (línea deducida de ${m[1]}: revisadla)`;
  }
  const kk=(tit.match(/\| ([A-Z][A-Z0-9]*-\d+) \|/)||[])[1]; if(kk) tit=tit.replace(new RegExp("\\s*\\("+kk+"\\)\\s*$"),"");   // sin «(TICKET)» repetido al final
  if(e.SOLO_TITULO==="1") sal(0,"TÍTULO: "+tit+avisoTit);   // para probar el formato sin tocar Bitbucket
  for(const b of [e.ORI,e.DES]){ const r=await api("/refs/branches/"+encodeURIComponent(b));
    if(r.st===404) sal(4,`La rama «${b}» no está en Bitbucket (¿falta el push?). No se ha abierto nada.`);
    if(r.st===401||r.st===403) sal(5,`Bitbucket no deja leer el repo con ese token (${r.st}): revisa sus permisos. ${msg(r.j)}`);
    if(r.st!==200) sal(5,`Bitbucket ${r.st} al comprobar «${b}»: ${msg(r.j)}`); }
  const q=encodeURIComponent(`source.branch.name="${e.ORI}" AND destination.branch.name="${e.DES}" AND state="OPEN"`);
  const ya=await api("/pullrequests?q="+q+"&pagelen=5");
  const abierta=ya.st===200&&(ya.j.values||[])[0];
  if(abierta) sal(0,`YA EXISTE: PR #${abierta.id} «${abierta.title}» ${abierta.links.html.href}`);
  const cuerpo={ title:tit.slice(0,255), description:e.DESC?fs.readFileSync(e.DESC,"utf8").slice(0,30000):"", source:{branch:{name:e.ORI}}, destination:{branch:{name:e.DES}}, close_source_branch:false };
  if(e.PRUEBA==="1") sal(0,"PRUEBA (no se crea nada)"+avisoTit+": "+JSON.stringify({...cuerpo,description:cuerpo.description.slice(0,200)+(cuerpo.description.length>200?"…":"")}));
  const r=await api("/pullrequests",{method:"POST",body:JSON.stringify(cuerpo)});
  if(r.st!==201) sal(5,`Bitbucket no ha abierto la PR (${r.st}): ${msg(r.j)}`);
  sal(0,`ABIERTA: PR #${r.j.id} «${r.j.title}» ${e.ORI} → ${e.DES} ${r.j.links.html.href}${avisoTit}`);
})().catch(err=>sal(5,"Error: "+String(err.message).slice(0,200)));'
