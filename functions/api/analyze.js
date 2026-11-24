import { authenticate } from "./_auth.js";
import { userFromToken } from "./staff.js";
import { planOfClub } from "./_billing.js";

const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const safeEq=(a,b)=>{a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;};
const MODES={
  poomsae:"Video menunjukkan jurus (Poomsae). Nilai Poomsae (ketepatan gerakan, kuda-kuda, keseimbangan, transisi). Kyorugi = null.",
  kyorugi:"Video menunjukkan sparring/tendangan (Kyorugi). Nilai Kyorugi (kuda-kuda tempur, posisi guard, jarak, tinggi & teknik tendangan). Poomsae = null.",
  umum:"Video latihan umum (dasar, tendangan, atau drill). Nilai hanya aspek yang terlihat jelas, sisanya null."
};
const SYSTEM=`Kamu asisten pelatih Taekwondo di dojang. Kamu menerima gambar diam berurutan dari satu video latihan seorang murid dan membuat penilaian.
Aturan:
- Skala 1-5 (1 = perlu banyak latihan, 3 = cukup untuk levelnya, 5 = sangat baik untuk level sabuk dan usianya). Sesuaikan harapan dengan sabuk dan usia.
- Beri null untuk aspek yang tidak bisa dinilai dari gambar (misalnya Disiplin atau Kekuatan jika tidak terlihat jelas).
- Gambar diam tidak menunjukkan kecepatan dan tenaga. Jangan menilai itu kecuali jelas terlihat; sebut sebagai keterbatasan.
- Fokus pada teknik: kuda-kuda, keseimbangan, posisi tangan dan kaki, tinggi tendangan, pandangan, kerapian transisi.
- Jangan mengidentifikasi orang dan jangan berkomentar tentang tubuh atau penampilan fisik.
- Bahasa ramah, positif, konstruktif, aman untuk anak.
- Jawab HANYA JSON valid, tanpa teks lain, dengan bentuk:
{"poomsae":1-5|null,"kyorugi":1-5|null,"kekuatan":1-5|null,"kelenturan":1-5|null,"disiplin":1-5|null,"catatan":"2-4 kalimat","saran":["maks 3 saran latihan singkat"],"keyakinan":"rendah|sedang|tinggi"}`;

async function viaCF(env,frames,text,o={}){
  if(!env.AI)return {err:"Workers AI belum dipasang (Settings > Bindings > Workers AI, nama variabel: AI)"};
  const pick=frames.length>4?[0,1,2,3].map(i=>frames[Math.round(i*(frames.length-1)/3)]):frames;
  const content=[{type:"text",text}];
  pick.forEach(data=>content.push({type:"image_url",image_url:{url:"data:image/jpeg;base64,"+data}}));
  let r;
  try{
    r=await env.AI.run(env.CF_MODEL||"@cf/meta/llama-4-scout-17b-16e-instruct",{messages:[{role:"system",content:o.sys||SYSTEM},{role:"user",content}],max_tokens:o.max||700});
  }catch(e){
    const m=String((e&&e.message)||e);
    return {err:/3036|neuron|limit/i.test(m)?"Kuota gratis Workers AI hari ini habis, coba lagi besok (reset 07.00 WIB)":"Workers AI error: "+m.slice(0,160)};
  }
  const raw=typeof r==="string"?r:(r&&(r.response||(r.result&&r.result.response)||(r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content)))||"";
  return {raw:typeof raw==="string"?raw:JSON.stringify(raw)};
}

async function viaGemini(env,frames,text,o={}){
  const model=env.GEMINI_MODEL||"gemini-3.8-flash";
  let res;
  try{
    res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"content-type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:o.sys||SYSTEM}]},
        contents:[{role:"user",parts:[...frames.map(data=>({inline_data:{mime_type:"image/jpeg",data}})),{text}]}],
        generationConfig:o.plain?{maxOutputTokens:o.max||3000}:{responseMimeType:"application/json",maxOutputTokens:2000}
      })
    });
  }catch(e){return {err:"Gagal menghubungi layanan analisa"};}
  if(!res.ok){
    const e=await res.json().catch(()=>null);
    const base=res.status===429?"Kuota gratis habis atau terlalu cepat, coba lagi beberapa menit lagi":(res.status===400||res.status===403)?"API key Gemini salah atau belum aktif":res.status===404?"Model tidak ditemukan, ubah variabel GEMINI_MODEL":"Layanan analisa error ("+res.status+")";
    return {err:base+((e&&e.error&&e.error.message)?" — "+String(e.error.message).slice(0,160):"")};
  }
  const data=await res.json().catch(()=>null);
  const parts=(data&&data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts)||[];
  return {raw:parts.map(p=>p.text||"").join("")};
}

async function viaClaude(env,frames,text,o={}){
  const content=frames.map(data=>({type:"image",source:{type:"base64",media_type:"image/jpeg",data}}));
  content.push({type:"text",text});
  let res;
  try{
    res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:env.ANALYZE_MODEL||"claude-sonnet-5-5",max_tokens:o.max||900,system:o.sys||SYSTEM,messages:[{role:"user",content}]})});
  }catch(e){return {err:"Gagal menghubungi layanan analisa"};}
  if(!res.ok){
    return {err:res.status===401?"API key salah atau belum aktif":res.status===429?"Terlalu banyak permintaan, coba lagi sebentar":res.status===529?"Layanan sedang sibuk, coba lagi":"Layanan analisa error ("+res.status+")"};
  }
  const data=await res.json().catch(()=>null);
  return {raw:((data&&data.content)||[]).filter(b=>b.type==="text").map(b=>b.text).join("")};
}

export async function onRequestPost({request,env}){
  if(!env.AI&&!env.GEMINI_API_KEY&&!env.ANTHROPIC_API_KEY)return J({error:"Server belum diatur: pasang Workers AI (gratis) atau isi GEMINI_API_KEY / ANTHROPIC_API_KEY di Cloudflare, lalu deploy ulang"},500);
  // Boleh dipakai: admin klub / Super Admin (Username + PIN) atau pelatih yang sudah masuk
  let clubId="";
  const tokUser=request.headers.get("X-Dojang-Token")?await userFromToken(request,env):null;
  if(tokUser)clubId=tokUser.clubId;
  else{
    const a=await authenticate(env,request);
    if(!a.ok)return J({error:a.error||"Tidak diizinkan"},a.status||403);
    clubId=a.clubId||"";
    if(!clubId)return J({error:"Pilih dojang klien terlebih dahulu"},400);
  }
  // Paket tanpa Analisa Video AI Cloud (mis. Basic) ditolak; klub dengan paket tidak dikenal tidak diblokir
{
  const crow = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs' AND id=?").bind(clubId).first();
  if (crow) { let c = null; try { c = { id: crow.id, ...JSON.parse(crow.data) }; } catch (e) {} const pl = c ? await planOfClub(env, c) : null; if (pl && !pl.ai) return J({ error: "Analisa Video AI Cloud tersedia di paket Pro. Mode analisa di perangkat tetap gratis. Upgrade di menu Langganan." }, 402); }
}
// Batas pemakaian per klub per hari (biaya AI ditanggung pemilik aplikasi). Atur dengan ANALYZE_DAILY_LIMIT.
  const limit=Math.max(1,Number(env.ANALYZE_DAILY_LIMIT)||30);
  const day=new Date(Date.now()+7*3600*1000).toISOString().slice(0,10);
  const qid=clubId+"@"+day;
  const qrow=await env.DB.prepare("SELECT data FROM docs WHERE coll='ai_usage' AND id=?").bind(qid).first();
  const used=qrow?Number(JSON.parse(qrow.data).n)||0:0;
  if(used>=limit)return J({error:"Batas analisa video hari ini sudah tercapai ("+limit+"x). Coba lagi besok."},429);
  if(Number(request.headers.get("content-length")||0)>8000000)return J({error:"Data terlalu besar"},413);
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object")return J({error:"bad body"},400);
  if(body.mode==="poomsae_wt"){
    const tel=body.telemetry;
    if(!tel||typeof tel!=="object"||JSON.stringify(tel).length>60000)return J({error:"Data telemetri tidak valid"},400);
    const dr=Array.isArray(body.durRange)&&body.durRange.length===2?body.durRange.map(x=>Math.max(1,Math.min(600,Number(x)||0))):[5,8];
    const prompt=`PERAN & KONTEKS:
Anda adalah Wasit Internasional World Taekwondo (WT) dan Pelatih Kepala Poomsae Kukkiwon. Anda akan menerima data telemetri biomekanik dalam format JSON yang diekstrak secara lokal dari video penampilan Poomsae (tanpa lampiran video).

DATA JURUS:
- Nama Jurus: ${String(body.jurus||"-").slice(0,60)}
- Kategori / Sabuk: ${String(body.kategori||"-").slice(0,60)}
- Konteks: ${body.konteks==="Simulasi Kejuaraan"?"Simulasi Kejuaraan":"UKT"}

TUGAS ANDA:
1. Analisa seluruh log (jenis, tingkat, potongan, timestamp), ringkasan, dan parameter pada data JSON di bawah.
2. Nilai menurut aturan World Taekwondo (Poomsae Competition Rules and Interpretation, Pasal 16):
   - Accuracy (basis 4.00): -0.1 untuk setiap kesalahan kecil pada gerakan (kuda-kuda atau gerakan tangan menyimpang dari pedoman penilaian); -0.3 untuk setiap kesalahan besar (gerakan salah atau tidak ada di pedoman, Kihap tidak dibuat atau salah momen, berhenti sementara 3 detik atau lebih, pandangan tidak mengikuti arah gerakan, kaki yang terangkat menyentuh lantai pada Hakdari-seogi, Jireugi tanpa tenaga dan suara, napas terlalu keras); -0.6 jika poomsae diulang dari awal.
   - Presentation (basis 6.00): TIDAK dipotong per kesalahan, dinilai dari keseluruhan penampilan: Speed & Power (0-2.00), Rhythm & Tempo (0-2.00; kontrol kekuatan, kecepatan, dan ritme; kecepatan, tenaga, dan ritme yang seragam dari awal sampai akhir dikurangi), Expression of Energy (0-2.00; ukuran gerakan, konsentrasi, pandangan, Kihap, sikap, percaya diri).
3. Buat tabel Log Kesalahan per Timestamp berisi: Timestamp, Urutan Gerakan, Kesalahan (sebutkan angka dari data), dan Potongan Poin.
4. Susun 3 Program Drill Korektif paling prioritas (Nama Drill, Target Otot/Sendi, Langkah Eksekusi, dan Set/Repetisi) untuk memperbaiki kesalahan terbesar pada data tersebut.

PARAMETER TAMBAHAN (OPSIONAL DI JSON):
- head_yaw_aligned: Boolean, apakah arah hadap wajah/pandangan mata (gaze) mengarah tepat ke sasaran sebelum gerakan dikunci.
- kihap_detected: Boolean, apakah Kihap terbaca sesuai jumlah wajib jurus tersebut.
- is_slow_motion: Boolean; true jika ada gerakan lambat yang disengaja (misal Taegeuk 6-8 atau poomsae sabuk hitam), maka deteksi berhenti 3 detik dinonaktifkan.

ATURAN GUARDRAIL:
1. Null-Safe (Anti-Halusinasi): Jika ada parameter yang bernilai null atau tidak tercantum di JSON, ABAIKAN parameter tersebut. Jangan mengarang angka atau memberi potongan poin.
2. Potongan resmi hanya berasal dari entri log bertingkat "major" atau "minor" yang potongannya bukan 0 (Kihap dan berhenti sementara). Entri bertingkat "observasi" (potongan 0) adalah catatan biomekanik perkiraan: WT tidak menetapkan angka sudut atau jarak, jadi jangan beri potongan dan jangan sebut itu kesalahan resmi; jadikan saran perbaikan. Kesalahan kuda-kuda dan gerakan tangan menurut pedoman resmi tidak bisa dinilai dari data ini karena nama dan urutan gerakan tidak tersedia.
3. Durasi: jangan memberi potongan karena durasi klip. Angka 5-8 detik pada tabel referee hanya untuk gerakan lambat tertentu per gerakan, bukan seluruh klip.
4. Penilaian Gaze & Kihap: gunakan head_yaw_aligned dan kihap_detected (jika tersedia) sebagai dasar utama menilai Expression of Energy (0.00 - 2.00).
5. Jangkar angka Presentation (kalibrasi pelatih, bukan aturan WT; wajib dipatuhi agar skor realistis):
   - Jika Konteks = UKT: rentang normal total Presentation adalah 4.20 - 5.10 (tiap sub-kriteria di kisaran 1.40 - 1.70).
   - Jika Konteks = Simulasi Kejuaraan: gunakan standar ketat di kisaran 3.60 - 4.70. Skor total Presentation di atas 4.80 HANYA boleh diberikan jika peak_velocity konsisten tinggi hingga step terakhir, hip_wobble hampir nol, dan head_yaw_aligned selalu true.
6. Kihap (aturan WT): Kihap tidak dibuat atau salah momen adalah kesalahan besar (-0.3) pada Accuracy dan ikut menentukan Expression of Energy. Pakai kihap_wajib_jumlah dan kihap_wajib_gerakan dari JSON; jangan mengarang jumlah atau titik Kihap sendiri.

DATA TELEMETRI JSON LOKAL:
${JSON.stringify(tel)}

Catatan: data ini estimasi dari pose tubuh; sebutkan keterbatasannya singkat. Jawab dalam bahasa ${body.lang==="en"?"Inggris":"Indonesia"}, format teks biasa dengan tabel berbasis teks (kolom dipisah " | "), tanpa markdown tebal.`;
    const sys="Kamu wasit World Taekwondo dan pelatih Poomsae. Patuhi instruksi pengguna. Jangan mengidentifikasi orang atau mengomentari fisik. Bahasa ramah dan konstruktif, aman untuk anak.";
    const o={sys,max:3000,plain:true};
    const prov=env.ANALYZE_PROVIDER||(env.AI?"cf":env.ANTHROPIC_API_KEY?"claude":"gemini");
    const out=prov==="cf"?await viaCF(env,[],prompt,o):prov==="claude"?await viaClaude(env,[],prompt,o):await viaGemini(env,[],prompt,o);
    if(out.err)return J({error:out.err},502);
    const report=String(out.raw||"").trim().slice(0,8000);
    if(!report)return J({error:"Hasil analisa kosong, coba ulangi"},502);
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('ai_usage',?,?)").bind(qid,JSON.stringify({n:used+1,day})).run();
    return J({ok:true,report,left:Math.max(0,limit-used-1)});
  }
  const frames=Array.isArray(body.frames)?body.frames:[];
  if(frames.length<4||frames.length>12||!frames.every(f=>typeof f==="string"&&f.length<900000&&/^[A-Za-z0-9+/=]+$/.test(f)))return J({error:"Gambar tidak valid (4-12 gambar)"},400);
  const mode=MODES[body.mode]?body.mode:"umum";
  const st=body.student||{};
  const age=Number(st.age)>0?Math.min(99,Number(st.age)):null;
  const belt=String(st.belt||"").slice(0,40);
  const text=`${MODES[mode]}\nUsia murid: ${age?age+" tahun":"tidak diketahui"}. Sabuk: ${belt||"tidak diketahui"}.\nBerikut ${frames.length} gambar berurutan dari awal sampai akhir video. Tulis catatan dan saran dalam bahasa ${body.lang==="en"?"Inggris":"Indonesia"}.`;
  const prov=env.ANALYZE_PROVIDER||(env.AI?"cf":env.ANTHROPIC_API_KEY?"claude":"gemini");
  const out=prov==="cf"?await viaCF(env,frames,text):prov==="claude"?await viaClaude(env,frames,text):await viaGemini(env,frames,text);
  if(out.err)return J({error:out.err},502);
  const raw=out.raw;
  const m=raw.match(/\{[\s\S]*\}/);
  let p=null;
  try{p=m?JSON.parse(m[0]):null;}catch(e){}
  if(!p)return J({error:"Hasil analisa tidak terbaca, coba ulangi"},502);
  const sc=v=>{const n=Math.round(Number(v));return n>=1&&n<=5?n:null;};
  const result={
    poomsae:sc(p.poomsae),kyorugi:sc(p.kyorugi),kekuatan:sc(p.kekuatan),kelenturan:sc(p.kelenturan),disiplin:sc(p.disiplin),
    catatan:String(p.catatan||"").slice(0,800),
    saran:(Array.isArray(p.saran)?p.saran:[]).slice(0,3).map(x=>String(x).slice(0,200)),
    keyakinan:["rendah","sedang","tinggi"].includes(p.keyakinan)?p.keyakinan:"sedang"
  };
  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('ai_usage',?,?)").bind(qid,JSON.stringify({n:used+1,day})).run();
  return J({ok:true,result,left:Math.max(0,limit-used-1)});
}