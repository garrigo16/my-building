#!/usr/bin/env bash
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
HILO=${1:?hilo}; TXT=${2:?fichero de texto}; PRUEBA=0; [ "${3:-}" = "--prueba" ] && PRUEBA=1
[ -s "$TXT" ] || { echo "texto vacío: $TXT" >&2; exit 2; }
HILO="$HILO" TXT="$TXT" PRUEBA="$PRUEBA" PERSONA="${PERSONA:-}" node -e '
const fs=require("fs"),os=require("os"),path=require("path"),e=process.env;
const sal=(c,m)=>{ (c?console.error:console.log)(m); process.exit(c); };
const lee=(f,k)=>{ try{ for(const l of fs.readFileSync(path.join(os.homedir(),".config",f),"utf8").split("\n")){ const x=l.replace("\r","").trim(); if(x.startsWith(k+"=")) return x.slice(k.length+1).trim().replace(/^["\x27]|["\x27]$/g,""); } }catch(err){} return ""; };
const tokU=lee("oficina-slack.env","SLACK_USER_TOKEN"), tokB=lee("canal-slack.env","SLACK_BOT_TOKEN");
if(!tokU||!tokB) sal(3,"Falta SLACK_USER_TOKEN (oficina-slack.env) o SLACK_BOT_TOKEN (canal-slack.env). No se ha enviado nada.");
let v={}; try{ v=JSON.parse(fs.readFileSync(path.join(os.homedir(),".oficina","privados.json"),"utf8")); }catch(err){}
const per=(e.PERSONA||"").trim().toLowerCase(), todos=Object.values(v.avisos||{}).filter(x=>x.hilo===e.HILO&&x.dm);
const cands=todos.filter(x=>!per||String(x.persona||"").toLowerCase().includes(per));
if(new Set(cands.map(x=>x.dm)).size>1) sal(4,"Hay varios privados en este hilo ("+[...new Set(cands.map(x=>x.persona))].join(", ")+"): repite con PERSONA=<nombre>. No se ha enviado nada.");
const a=cands.sort((x,y)=>parseFloat(y.avisoTs)-parseFloat(x.avisoTs))[0];
if(!a) sal(4,"No hay ningún privado vigilado para este hilo (la oficina solo conoce los que abrió una IA y avisó en el hilo). No se ha enviado nada.");
const texto=fs.readFileSync(e.TXT,"utf8").replace(/\r/g,"").trim().slice(0,3000);
if(e.PRUEBA==="1") sal(0,`PRUEBA (no se envía): a ${a.persona} por privado: «${texto.slice(0,300)}»`);
const api=async(m,p,t)=>{ const r=await fetch("https://slack.com/api/"+m,{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json; charset=utf-8"},body:JSON.stringify(p)}); return r.json(); };
(async()=>{
  const r=await api("chat.postMessage",{channel:a.dm,text:texto},tokU);
  if(!r.ok) sal(5,"Slack no lo ha enviado: "+r.error);
  const hora=new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Madrid"});
  await api("chat.postMessage",{channel:lee("canal-slack.env","SLACK_CANAL_ID")||"CCANAL00001",thread_ts:e.HILO,text:`↩ *${e.EDIFICIO_NOMBRE||"Humano"}* a *${a.persona}* por privado (${hora}):\n> ${texto.replace(/\n/g,"\n> ")}`,unfurl_links:false},tokB);
  sal(0,`ENVIADO a ${a.persona} por privado (y copia en el hilo).`);
})().catch(err=>sal(5,"Error: "+String(err.message).slice(0,200)));'
